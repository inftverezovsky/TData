import crypto from "node:crypto";

import type { ParserMonitorReport, SourceProbeResult } from "./parserMonitorTypes";
import { redactMonitorText } from "./parserMonitorRedaction";

export { redactMonitorText } from "./parserMonitorRedaction";

export interface TelegramNotificationState {
  activeFailureFingerprint: string | null;
  lastFailureAlertAt?: string | null;
  lastRecoveryAt?: string | null;
}

export interface TelegramTransitionOptions {
  botToken: string;
  chatId: string;
  transport?: (text: string) => Promise<void>;
  now?: Date;
}

export async function processTelegramTransition(
  report: ParserMonitorReport,
  state: TelegramNotificationState,
  options: TelegramTransitionOptions,
): Promise<{ state: TelegramNotificationState; sent: "failure" | "recovery" | null }> {
  const incidents = report.results.filter((result) => (
    result.required && (result.status === "failed" || result.status === "warning")
  ));
  const fingerprint = incidents.length > 0 ? fingerprintIncidents(incidents) : null;
  const now = options.now ?? new Date();
  const transport = options.transport ?? ((text) => sendTelegramMessage({
    botToken: options.botToken,
    chatId: options.chatId,
    text,
  }));

  if (fingerprint && fingerprint !== state.activeFailureFingerprint) {
    await transport(buildFailureMessage(report, incidents));
    return {
      state: {
        ...state,
        activeFailureFingerprint: fingerprint,
        lastFailureAlertAt: now.toISOString(),
      },
      sent: "failure",
    };
  }
  if (!fingerprint && state.activeFailureFingerprint) {
    await transport(buildRecoveryMessage(report));
    return {
      state: {
        ...state,
        activeFailureFingerprint: null,
        lastRecoveryAt: now.toISOString(),
      },
      sent: "recovery",
    };
  }
  return { state, sent: null };
}

export async function sendTelegramTestNotification(options: TelegramTransitionOptions) {
  const transport = options.transport ?? ((text) => sendTelegramMessage({
    botToken: options.botToken,
    chatId: options.chatId,
    text,
  }));
  await transport("TData: тест уведомлений мониторинга парсеров успешно выполнен. Инцидент не создан.");
}

export async function sendTelegramMessage(input: {
  botToken: string;
  chatId: string;
  text: string;
  fetchImpl?: typeof fetch;
  retryDelaysMs?: readonly number[];
  sleep?: (milliseconds: number) => Promise<void>;
}) {
  if (!input.botToken.trim() || !input.chatId.trim()) {
    throw new Error("Telegram bot token and chat id are required");
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const retryDelaysMs = input.retryDelaysMs ?? [1_000, 3_000];
  const sleep = input.sleep ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let lastError: unknown;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetchImpl(`https://api.telegram.org/bot${input.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: input.chatId, text: input.text.slice(0, 3500), disable_web_page_preview: true }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Telegram notification failed with HTTP ${response.status}`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < retryDelaysMs.length) await sleep(retryDelaysMs[attempt]);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(lastError instanceof Error ? lastError.message : "Telegram notification failed");
}

function fingerprintIncidents(incidents: SourceProbeResult[]) {
  const stable = incidents
    .map((incident) => `${incident.id}:${incident.status}:${incident.errorClass || "unknown"}`)
    .sort()
    .join("|");
  return crypto.createHash("sha256").update(stable).digest("hex");
}

function buildFailureMessage(report: ParserMonitorReport, incidents: SourceProbeResult[]) {
  const lines = [
    "TData: обнаружена поломка парсеров",
    `Проверка: ${report.finishedAt}`,
    `Проблемы: ${incidents.length} из ${report.summary.total}`,
    "",
    ...incidents.map((incident) => `• ${incident.source}${incident.scope ? `/${incident.scope}` : ""}: ${incident.status}/${incident.errorClass || "unknown"} — ${redactMonitorText(incident.summary)}`),
  ];
  return redactMonitorText(lines.join("\n")).slice(0, 3500);
}

function buildRecoveryMessage(report: ParserMonitorReport) {
  return [
    "TData: работа парсеров восстановлена",
    `Проверка: ${report.finishedAt}`,
    `Источников проверено: ${report.summary.total}`,
  ].join("\n");
}
