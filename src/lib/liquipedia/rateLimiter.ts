import { getGenericMinIntervalMs, getParseMinIntervalMs } from "@/lib/config/env";

type RateLimitChannel = {
  chain: Promise<void>;
  lastRequestAt: number;
};

// Per-proxy rate limit pools keyed by proxy identifier ("direct" for no proxy)
const genericChannels = new Map<string, RateLimitChannel>();
const parseChannels = new Map<string, RateLimitChannel>();

function getChannel(pool: Map<string, RateLimitChannel>, key: string): RateLimitChannel {
  let channel = pool.get(key);
  if (!channel) {
    channel = { chain: Promise.resolve(), lastRequestAt: 0 };
    pool.set(key, channel);
  }
  return channel;
}

export function withGenericRateLimit<T>(work: () => Promise<T>, proxyKey = "direct") {
  const channel = getChannel(genericChannels, proxyKey);

  const next = channel.chain.then(async () => {
    const now = Date.now();
    const waitMs = Math.max(0, getGenericMinIntervalMs() - (now - channel.lastRequestAt));
    if (waitMs > 0) await sleep(waitMs);
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
    const waitMs = Math.max(0, getParseMinIntervalMs() - (now - channel.lastRequestAt));
    if (waitMs > 0) await sleep(waitMs);
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
