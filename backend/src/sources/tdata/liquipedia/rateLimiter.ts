import { getGenericMinIntervalMs, getLiquipediaCooldownMs, getLiquipediaJitterMs, getParseMinIntervalMs } from "@backend/config/env";
import { normalizeParserErrorClass } from "@backend/proxy/parserErrors";

type RateLimitChannel = {
  chain: Promise<void>;
  lastRequestAt: number;
  cooldownUntil: number;
};

// Per-proxy rate limit pools keyed by proxy identifier ("direct" for no proxy)
const genericChannels = new Map<string, RateLimitChannel>();
const parseChannels = new Map<string, RateLimitChannel>();

function getChannel(pool: Map<string, RateLimitChannel>, key: string): RateLimitChannel {
  let channel = pool.get(key);
  if (!channel) {
    channel = { chain: Promise.resolve(), lastRequestAt: 0, cooldownUntil: 0 };
    pool.set(key, channel);
  }
  return channel;
}

export function withGenericRateLimit<T>(work: () => Promise<T>, proxyKey = "direct") {
  const channel = getChannel(genericChannels, proxyKey);

  const next = channel.chain.then(async () => {
    const now = Date.now();
    const waitMs = Math.max(0, channel.cooldownUntil - now, getGenericMinIntervalMs() - (now - channel.lastRequestAt));
    if (waitMs > 0) await sleep(waitMs + randomJitter());
    channel.lastRequestAt = Date.now();
    return work();
  });

  channel.chain = next.then(
    () => undefined,
    () => undefined
  );

  return next;
}

export function withParseRateLimit<T>(work: () => Promise<T>, proxyKey = "direct") {
  const channel = getChannel(parseChannels, proxyKey);

  const next = channel.chain.then(async () => {
    const now = Date.now();
    const waitMs = Math.max(0, channel.cooldownUntil - now, getParseMinIntervalMs() - (now - channel.lastRequestAt));
    if (waitMs > 0) await sleep(waitMs + randomJitter());
    channel.lastRequestAt = Date.now();
    return work();
  });

  channel.chain = next.then(
    () => undefined,
    () => undefined
  );

  return next;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomJitter() {
  const jitterMs = Math.max(0, getLiquipediaJitterMs());
  if (jitterMs === 0) return 0;
  return Math.floor(Math.random() * jitterMs);
}

export function registerLiquipediaBackoff(
  proxyKey: string,
  errorClass?: string | null,
  retryAfterHeader?: string | null,
  mode: "generic" | "parse" = "generic"
) {
  const normalized = normalizeParserErrorClass(errorClass);
  if (normalized !== "rate_limited" && normalized !== "cloudflare_block") return;

  const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
  const backoffMs = Math.max(retryAfterMs ?? 0, getLiquipediaCooldownMs());
  const channel = getChannel(mode === "parse" ? parseChannels : genericChannels, proxyKey);
  channel.cooldownUntil = Math.max(channel.cooldownUntil, Date.now() + backoffMs);
}

export function getLiquipediaRateLimitSnapshot(proxyKey: string, mode: "generic" | "parse" = "generic") {
  const channel = getChannel(mode === "parse" ? parseChannels : genericChannels, proxyKey);
  return {
    lastRequestAt: channel.lastRequestAt,
    cooldownUntil: channel.cooldownUntil,
  };
}

export function resetLiquipediaRateLimitForTests() {
  genericChannels.clear();
  parseChannels.clear();
}

function parseRetryAfterMs(value?: string | null) {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());

  return null;
}
