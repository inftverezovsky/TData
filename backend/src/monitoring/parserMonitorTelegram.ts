import crypto from "node:crypto";
import { HttpsProxyAgent } from "https-proxy-agent";
import fetch, { type RequestInit as NodeFetchRequestInit } from "node-fetch";

import { selectProxyCandidate, type ProxyCandidate } from "../proxy/proxySelector";
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
  proxyUrls?: readonly string[];
  transport?: (text: string) => Promise<void>;
  now?: Date;
}

type TelegramFetchResponse = Pick<Awaited<ReturnType<typeof fetch>>, "ok" | "status">;
type TelegramFetch = (url: string, init: NodeFetchRequestInit) => Promise<TelegramFetchResponse>;
type TelegramProxySelector = (attempt: number) => Promise<ProxyCandidate | null>;

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
    proxyUrls: options.proxyUrls,
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
    proxyUrls: options.proxyUrls,
  }));
  await transport("TData: тест уведомлений мониторинга парсеров успешно выполнен. Инцидент не создан.");
}

export async function sendTelegramMessage(input: {
  botToken: string;
  chatId: string;
  text: string;
  fetchImpl?: TelegramFetch;
  proxyUrls?: readonly string[];
  proxyAgentFactory?: (proxyUrl: string) => NodeFetchRequestInit["agent"];
  retryDelaysMs?: readonly number[];
  sleep?: (milliseconds: number) => Promise<void>;
}) {
  if (!input.botToken.trim() || !input.chatId.trim()) {
    throw new Error("Telegram bot token and chat id are required");
  }
  const fetchImpl: TelegramFetch = input.fetchImpl ?? fetch;
  const proxyAgentFactory = input.proxyAgentFactory ?? ((proxyUrl) => new HttpsProxyAgent(proxyUrl));
  const retryDelaysMs = input.retryDelaysMs ?? [1_000, 3_000];
  const sleep = input.sleep ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const proxyUrls = normalizeTelegramProxyUrls(input.proxyUrls || []);
  const routes: Array<string | null> = proxyUrls.length > 0
    ? [null, ...proxyUrls]
    : Array.from({ length: retryDelaysMs.length + 1 }, () => null);
  let lastError: unknown;
  let lastStatus: number | null = null;
  for (let attempt = 0; attempt < routes.length; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const proxyUrl = routes[attempt];
      const agent = proxyUrl ? proxyAgentFactory(proxyUrl) : undefined;
      const response = await fetchImpl(`https://api.telegram.org/bot${input.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: input.chatId, text: input.text.slice(0, 3500), disable_web_page_preview: true }),
        signal: controller.signal,
        ...(agent ? { agent } : {}),
      });
      if (!response.ok) {
        lastStatus = response.status;
        throw new Error("Telegram API rejected the notification");
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt < routes.length - 1) {
        const delay = retryDelaysMs[Math.min(attempt, Math.max(0, retryDelaysMs.length - 1))] ?? 0;
        if (delay > 0) await sleep(delay);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  if (lastStatus !== null) throw new Error(`Telegram notification failed with HTTP ${lastStatus}`);
  throw new Error(lastError ? "Telegram notification failed because the API is unreachable" : "Telegram notification failed");
}

export async function selectTelegramProxyUrls(
  selector: TelegramProxySelector = selectProxyCandidate,
  maxCandidates = 3,
) {
  const urls: string[] = [];
  for (let attempt = 1; attempt <= maxCandidates; attempt += 1) {
    try {
      const candidate = await selector(attempt);
      if (candidate?.proxyUrl && !urls.includes(candidate.proxyUrl)) urls.push(candidate.proxyUrl);
    } catch {
      // Telegram still has a bounded direct attempt when proxy discovery is unavailable.
    }
  }
  return normalizeTelegramProxyUrls(urls);
}

function normalizeTelegramProxyUrls(values: readonly string[]) {
  const normalized = new Map<string, string>();
  for (const value of values) {
    try {
      const trimmed = value.trim();
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      if (!normalized.has(parsed.toString())) normalized.set(parsed.toString(), trimmed);
    } catch {
      // Invalid proxy configuration is ignored without logging credential-bearing input.
    }
  }
  return [...normalized.values()];
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
