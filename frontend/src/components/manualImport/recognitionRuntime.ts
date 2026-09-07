import type { ClientAiImageCacheEntry, ManualMatch } from "./types";

// Кэш живёт только в памяти текущей вкладки. Каждому потребителю возвращаем копию матчей.
const CLIENT_AI_IMAGE_CACHE_TTL_MS = 30 * 60 * 1000;
const clientAiImageCache = new Map<string, ClientAiImageCacheEntry>();

export async function runImageBatchPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
) {
  // Каждый worker забирает индекс до await: одна позиция обрабатывается один раз, одновременно работает не больше лимита.
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

export function getClientAiImageCache(key: string) {
  const cached = clientAiImageCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt < Date.now()) {
    clientAiImageCache.delete(key);
    return null;
  }
  return {
    rawMatches: cached.rawMatches.map((match) => ({ ...match })),
    normalizedText: cached.normalizedText,
    expiresAt: cached.expiresAt,
  };
}

export function setClientAiImageCache(
  key: string,
  value: {
    rawMatches: ManualMatch[];
    normalizedText: string;
  }
) {
  cleanupClientAiImageCache();
  clientAiImageCache.set(key, {
    rawMatches: value.rawMatches.map((match) => ({ ...match })),
    normalizedText: value.normalizedText,
    expiresAt: Date.now() + CLIENT_AI_IMAGE_CACHE_TTL_MS,
  });
}

function cleanupClientAiImageCache() {
  const now = Date.now();
  for (const [key, value] of clientAiImageCache) {
    if (value.expiresAt < now) clientAiImageCache.delete(key);
  }
}

export function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}
