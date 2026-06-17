import { randomBytes } from "crypto";
import { MANUAL_IMPORT_SERVICE_CACHE_TTL_MS } from "./config";

type CacheEntry = {
  payload: unknown;
  expiresAt: number;
};

const globalCache = globalThis as typeof globalThis & {
  __manualImportJsonCache?: Map<string, CacheEntry>;
};

export function putManualImportJson(payload: unknown) {
  const cache = getCache();
  const token = createToken();
  const now = Date.now();

  cleanupExpired(cache, now);
  cache.set(token, {
    payload,
    expiresAt: now + MANUAL_IMPORT_SERVICE_CACHE_TTL_MS,
  });

  return token;
}

export function getManualImportJson(token: string) {
  const cache = getCache();
  const entry = cache.get(token);

  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(token);
    return null;
  }

  return entry.payload;
}

function getCache() {
  if (!globalCache.__manualImportJsonCache) {
    globalCache.__manualImportJsonCache = new Map();
  }

  return globalCache.__manualImportJsonCache;
}

function cleanupExpired(cache: Map<string, CacheEntry>, now: number) {
  for (const [key, entry] of cache) {
    if (entry.expiresAt < now) cache.delete(key);
  }
}

function createToken() {
  return randomBytes(18).toString("base64url");
}
