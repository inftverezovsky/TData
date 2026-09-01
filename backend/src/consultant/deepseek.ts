import { HttpsProxyAgent } from "https-proxy-agent";
import fetch, { type RequestInit as NodeFetchRequestInit } from "node-fetch";

import { readBoundedBodyJson } from "../http/boundedResponse";
import type { DeepSeekUsage } from "./budget";

const DEEPSEEK_CHAT_COMPLETIONS_URL = "https://api.deepseek.com/chat/completions";
const RETRYABLE_STATUS_CODES = new Set([429, 500, 503]);

type FetchResponse = {
  readonly body: unknown;
  readonly headers: { get(name: string): string | null };
  readonly ok: boolean;
  readonly status: number;
};
type FetchLike = (url: string, init: NodeFetchRequestInit) => Promise<FetchResponse>;

export interface DeepSeekAnswer {
  readonly answer: string;
  readonly usage: DeepSeekUsage;
  readonly finishReason: string | null;
}

export async function requestDeepSeekAnswer(input: {
  readonly apiKey: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly model?: "deepseek-v4-flash";
  readonly maxOutputTokens?: number;
  readonly proxyUrls?: readonly string[];
}, dependencies: {
  readonly fetchImpl?: FetchLike;
  readonly proxyAgentFactory?: (proxyUrl: string) => NodeFetchRequestInit["agent"];
  readonly sleep?: (milliseconds: number) => Promise<void>;
} = {}): Promise<DeepSeekAnswer> {
  if (!input.apiKey.trim()) throw new Error("DeepSeek API key is required");
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const proxyAgentFactory = dependencies.proxyAgentFactory ?? ((proxyUrl) => new HttpsProxyAgent(proxyUrl));
  const sleep = dependencies.sleep ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const proxies = normalizeProxyUrls(input.proxyUrls || []);
  const routes: Array<string | null> = [null, ...(proxies.length ? proxies : [null])];
  const body = JSON.stringify({
    model: input.model ?? "deepseek-v4-flash",
    messages: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: input.userPrompt },
    ],
    thinking: { type: "disabled" },
    max_tokens: Math.max(64, Math.min(450, input.maxOutputTokens ?? 450)),
    temperature: 0.2,
    stream: false,
  });

  let lastStatus: number | null = null;
  let hadNetworkFailure = false;
  for (let attempt = 0; attempt < routes.length; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 35_000);
    try {
      const proxyUrl = routes[attempt];
      const agent = proxyUrl ? proxyAgentFactory(proxyUrl) : undefined;
      const response = await fetchImpl(DEEPSEEK_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json",
        },
        body,
        signal: controller.signal,
        ...(agent ? { agent } : {}),
      });
      lastStatus = response.status;
      if (!response.ok) {
        if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt === routes.length - 1) {
          throw new DeepSeekHttpError(response.status);
        }
        await sleep(attempt === 0 ? 500 : 1_500);
        continue;
      }
      let payload: DeepSeekPayload;
      try {
        payload = await readBoundedBodyJson<DeepSeekPayload>(response, {
          maxBytes: 256 * 1024,
          signal: controller.signal,
          label: "DeepSeek response",
        });
      } catch {
        throw new DeepSeekResponseError("DeepSeek returned an invalid bounded response");
      }
      const answer = payload.choices?.[0]?.message?.content?.trim() || "";
      if (!answer) throw new DeepSeekResponseError("DeepSeek returned an empty answer");
      return {
        answer: answer.slice(0, 3_500),
        finishReason: payload.choices?.[0]?.finish_reason ?? null,
        usage: {
          promptTokens: safeInteger(payload.usage?.prompt_tokens),
          completionTokens: safeInteger(payload.usage?.completion_tokens),
          cacheHitTokens: safeInteger(payload.usage?.prompt_cache_hit_tokens),
        },
      };
    } catch (error) {
      if (error instanceof DeepSeekHttpError || error instanceof DeepSeekResponseError) throw error;
      hadNetworkFailure = true;
      if (attempt === routes.length - 1) break;
      await sleep(attempt === 0 ? 500 : 1_500);
    } finally {
      clearTimeout(timeout);
    }
  }
  if (lastStatus !== null) throw new DeepSeekHttpError(lastStatus);
  throw new Error(hadNetworkFailure ? "DeepSeek API is unreachable" : "DeepSeek request failed");
}

class DeepSeekHttpError extends Error {
  constructor(status: number) {
    super(`DeepSeek API failed with HTTP ${status}`);
    this.name = "DeepSeekHttpError";
  }
}

class DeepSeekResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeepSeekResponseError";
  }
}

interface DeepSeekPayload {
  readonly choices?: Array<{
    readonly finish_reason?: string | null;
    readonly message?: { readonly content?: string };
  }>;
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    readonly prompt_cache_hit_tokens?: number;
  };
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

function safeInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
