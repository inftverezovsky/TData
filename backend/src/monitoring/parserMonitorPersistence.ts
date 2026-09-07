import fs from "node:fs";
import path from "node:path";

import { isParserMonitorReport, type ParserMonitorReport } from "./parserMonitorTypes";
import type { TelegramNotificationState } from "./parserMonitorTelegram";

export const DEFAULT_PARSER_MONITOR_DIRECTORY = process.env.TDATA_PARSER_MONITOR_DIR
  || "/app/cache/parser-monitor";

export function persistParserMonitorReport(
  report: ParserMonitorReport,
  options: {
    directory?: string;
    retentionDays?: number;
    now?: Date;
  } = {},
) {
  const directory = path.resolve(
    /* turbopackIgnore: true */ options.directory || DEFAULT_PARSER_MONITOR_DIRECTORY,
  );
  const retentionDays = Math.max(1, options.retentionDays ?? 90);
  const now = options.now ?? new Date();
  fs.mkdirSync(directory, { recursive: true });

  const basename = report.runId.replace(/[^a-zA-Z0-9._-]/g, "-");
  const jsonPath = path.join(directory, `${basename}.json`);
  const markdownPath = path.join(directory, `${basename}.md`);
  writeAtomic(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeAtomic(markdownPath, renderParserMonitorMarkdown(report));
  writeAtomic(path.join(directory, "latest.json"), `${JSON.stringify(report, null, 2)}\n`);
  pruneReports(directory, now, retentionDays);
  return { jsonPath, markdownPath, latestPath: path.join(directory, "latest.json") };
}

export function readLatestParserMonitorReport(
  directory = DEFAULT_PARSER_MONITOR_DIRECTORY,
): ParserMonitorReport | null {
  const latestPath = path.join(path.resolve(/* turbopackIgnore: true */ directory), "latest.json");
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(latestPath, "utf8"));
    return isParserMonitorReport(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function readParserMonitorNotificationState(
  directory = DEFAULT_PARSER_MONITOR_DIRECTORY,
): TelegramNotificationState {
  const statePath = path.join(path.resolve(/* turbopackIgnore: true */ directory), "state.json");
  try {
    const value: unknown = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (!value || typeof value !== "object") return { activeFailureFingerprint: null };
    const state = value as Partial<TelegramNotificationState>;
    return {
      activeFailureFingerprint: typeof state.activeFailureFingerprint === "string"
        ? state.activeFailureFingerprint
        : null,
      lastFailureAlertAt: typeof state.lastFailureAlertAt === "string" ? state.lastFailureAlertAt : null,
      lastRecoveryAt: typeof state.lastRecoveryAt === "string" ? state.lastRecoveryAt : null,
    };
  } catch {
    return { activeFailureFingerprint: null };
  }
}

export function persistParserMonitorNotificationState(
  state: TelegramNotificationState,
  directory = DEFAULT_PARSER_MONITOR_DIRECTORY,
) {
  const resolved = path.resolve(/* turbopackIgnore: true */ directory);
  fs.mkdirSync(resolved, { recursive: true });
  writeAtomic(path.join(resolved, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
}

export function renderParserMonitorMarkdown(report: ParserMonitorReport) {
  const lines = [
    "# TData parser monitor",
    "",
    `- Run: \`${report.runId}\``,
    `- Started: ${report.startedAt}`,
    `- Finished: ${report.finishedAt}`,
    `- Healthy: ${report.summary.healthy}`,
    `- Healthy empty: ${report.summary.healthyEmpty}`,
    `- Warnings: ${report.summary.warning}`,
    `- Failed: ${report.summary.failed}`,
    "",
    "| Source | Scope | Status | Raw | Normalized | Attempts | Error | Summary |",
    "|---|---|---:|---:|---:|---:|---|---|",
  ];
  for (const result of report.results) {
    lines.push(`| ${escapeCell(result.source)} | ${escapeCell(result.scope || "-")} | ${result.status} | ${result.rawCandidates} | ${result.normalizedItems} | ${result.attempts} | ${result.errorClass || "-"} | ${escapeCell(result.summary)} |`);
  }
  return `${lines.join("\n")}\n`;
}

function writeAtomic(targetPath: string, content: string) {
  const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporaryPath, targetPath);
}

function pruneReports(directory: string, now: Date, retentionDays: number) {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !/^\d{4}-\d{2}-\d{2}T.*\.(?:json|md)$/u.test(entry.name)) continue;
    const filePath = path.join(directory, entry.name);
    try {
      if (fs.statSync(filePath).mtimeMs < cutoff) fs.unlinkSync(filePath);
    } catch {
      // A concurrent monitor run may already have pruned the file.
    }
  }
}

function escapeCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ").slice(0, 500);
}
