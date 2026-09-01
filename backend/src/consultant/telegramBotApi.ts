import { HttpsProxyAgent } from "https-proxy-agent";
import fetch, { type RequestInit as NodeFetchRequestInit } from "node-fetch";

import { readBoundedBodyJson } from "../http/boundedResponse";

type FetchResponse = {
  readonly body: unknown;
  readonly headers: { get(name: string): string | null };
  readonly ok: boolean;
  readonly status: number;
};
type FetchLike = (url: string, init: NodeFetchRequestInit) => Promise<FetchResponse>;

export interface TelegramUpdate {
  readonly update_id: number;
  readonly message?: {
    readonly message_id: number;
    readonly chat: { readonly id: number | string };
    readonly from?: { readonly id: number | string; readonly is_bot?: boolean };
    readonly text?: string;
  };
}

export interface TelegramWebhookInfo {
  readonly url: string;
  readonly pending_update_count?: number;
}

export function createTelegramBotClient(input: {
  readonly botToken: string;
  readonly proxyUrls?: readonly string[];
}, dependencies: {
  readonly fetchImpl?: FetchLike;
  readonly proxyAgentFactory?: (proxyUrl: string) => NodeFetchRequestInit["agent"];
} = {}) {
  if (!input.botToken.trim()) throw new Error("Telegram bot token is required");
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const proxyAgentFactory = dependencies.proxyAgentFactory ?? ((proxyUrl) => new HttpsProxyAgent(proxyUrl));
  const proxyUrls = normalizeProxyUrls(input.proxyUrls || []);

  return {
    getUpdates(options: { offset?: number; timeoutSeconds?: number } = {}) {
      return callTelegram<TelegramUpdate[]>("getUpdates", {
        offset: options.offset,
        timeout: Math.max(0, Math.min(50, options.timeoutSeconds ?? 25)),
        allowed_updates: ["message"],
      }, (options.timeoutSeconds ?? 25) * 1_000 + 10_000, input.botToken, proxyUrls, fetchImpl, proxyAgentFactory);
    },
    getWebhookInfo() {
      return callTelegram<TelegramWebhookInfo>(
        "getWebhookInfo",
        {},
        15_000,
        input.botToken,
        proxyUrls,
        fetchImpl,
        proxyAgentFactory,
      );
    },
    async sendMessage(chatId: string, text: string, replyToMessageId?: number) {
      await callTelegram<unknown>("sendMessage", {
        chat_id: chatId,
        text: text.slice(0, 3_500),
        disable_web_page_preview: true,
        ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
      }, 15_000, input.botToken, proxyUrls, fetchImpl, proxyAgentFactory);
    },
  };
}

async function callTelegram<T>(
  method: "getUpdates" | "getWebhookInfo" | "sendMessage",
  body: Record<string, unknown>,
  timeoutMs: number,
  botToken: string,
  proxyUrls: readonly string[],
  fetchImpl: FetchLike,
  proxyAgentFactory: (proxyUrl: string) => NodeFetchRequestInit["agent"],
): Promise<T> {
  const routes: Array<string | null> = [...proxyUrls, null];
  let lastStatus: number | null = null;
  for (let attempt = 0; attempt < routes.length; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const proxyUrl = routes[attempt];
      const agent = proxyUrl ? proxyAgentFactory(proxyUrl) : undefined;
      const response = await fetchImpl(`https://api.telegram.org/bot${botToken}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
        ...(agent ? { agent } : {}),
      });
      lastStatus = response.status;
      if (!response.ok) {
        if (response.status < 500 && response.status !== 429) {
          throw new TelegramHttpError(response.status);
        }
        if (attempt < routes.length - 1) continue;
        throw new TelegramHttpError(response.status);
      }
      const payload = await readBoundedBodyJson<TelegramResponse<T>>(response, {
        maxBytes: 512 * 1024,
        signal: controller.signal,
        label: "Telegram response",
      });
      if (!payload.ok || payload.result === undefined) throw new Error("Telegram API returned an invalid response");
      return payload.result;
    } catch (error) {
      if (error instanceof TelegramHttpError) throw error;
      if (attempt === routes.length - 1) break;
    } finally {
      clearTimeout(timeout);
    }
  }
  if (lastStatus !== null) throw new TelegramHttpError(lastStatus);
  throw new Error("Telegram API is unreachable");
}

class TelegramHttpError extends Error {
  constructor(status: number) {
    super(`Telegram API failed with HTTP ${status}`);
    this.name = "TelegramHttpError";
  }
}

interface TelegramResponse<T> {
  readonly ok?: boolean;
  readonly result?: T;
}

function normalizeProxyUrls(values: readonly string[]) {
  const result: string[] = [];
  for (const value of values) {
    try {
      const trimmed = value.trim();
      const parsed = new URL(trimmed);
      if ((parsed.protocol === "http:" || parsed.protocol === "https:") && !result.includes(trimmed)) {
        result.push(trimmed);
      }
    } catch {
      // Ignore invalid proxy input without exposing credentials.
    }
  }
  return result.slice(0, 3);
}
