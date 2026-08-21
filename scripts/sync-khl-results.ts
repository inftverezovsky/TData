import { PrismaClient } from "@prisma/client";

import {
  KHL_RESULTS_CUTOFF,
  KHL_RESULTS_DEFAULT_LOOKBACK_DAYS,
  KHL_RESULTS_REFRESH_HOURS,
  defaultKhlSyncFrom,
  syncKhlResults,
} from "@backend/results/khl/autoSync";

const prisma = new PrismaClient();

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log([
      "Usage: npm run sync:khl-results -- [options]",
      "  --full                 Scan everything from 2026-05-01",
      "  --from <ISO date>      Override the beginning of the range (clamped to cutoff)",
      "  --to <ISO date>        Override the end of the range (default: now)",
      `  --lookback-days <n>   Rolling window (default: ${KHL_RESULTS_DEFAULT_LOOKBACK_DAYS})`,
      `  --refresh-hours <n>   Refresh stored final protocols after n hours (default: ${KHL_RESULTS_REFRESH_HOURS})`,
    ].join("\n"));
    return;
  }

  const now = new Date();
  const to = args.to ? parseDate(args.to, "--to") : now;
  const from = args.full
    ? KHL_RESULTS_CUTOFF
    : args.from
      ? parseDate(args.from, "--from")
      : args.lookbackDays
        ? new Date(now.getTime() - readNumber(args.lookbackDays, "--lookback-days", 1, 366) * 86_400_000)
        : defaultKhlSyncFrom(now);
  const refreshExistingAfterMs = args.refreshHours === undefined
    ? KHL_RESULTS_REFRESH_HOURS * 60 * 60 * 1000
    : readNumber(args.refreshHours, "--refresh-hours", 0, 168) * 60 * 60 * 1000;

  const summary = await syncKhlResults({
    prisma,
    from,
    to,
    now,
    refreshExistingAfterMs,
  });
  console.log(JSON.stringify(summary));
  if (summary.failures.length > 0) process.exitCode = 1;
}

type ParsedArgs = {
  full: boolean;
  help: boolean;
  from?: string;
  to?: string;
  lookbackDays?: string;
  refreshHours?: string;
};

function parseArgs(values: string[]): ParsedArgs {
  const result: ParsedArgs = { full: false, help: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--full") {
      result.full = true;
      continue;
    }
    if (value === "--help" || value === "-h") {
      result.help = true;
      continue;
    }
    const key = value as "--from" | "--to" | "--lookback-days" | "--refresh-hours";
    if (!["--from", "--to", "--lookback-days", "--refresh-hours"].includes(key)) {
      throw new Error(`Unknown KHL sync option: ${value}`);
    }
    const next = values[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`${key} requires a value.`);
    index += 1;
    if (key === "--from") result.from = next;
    if (key === "--to") result.to = next;
    if (key === "--lookback-days") result.lookbackDays = next;
    if (key === "--refresh-hours") result.refreshHours = next;
  }
  if (result.full && result.from) throw new Error("Use either --full or --from, not both.");
  return result;
}

function parseDate(value: string, label: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} must be a valid ISO date.`);
  return date;
}

function readNumber(value: string, label: string, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

main()
  .catch((error) => {
    console.error("[KHL results sync]", error instanceof Error ? error.message : "Unknown error");
    process.exitCode = 2;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
