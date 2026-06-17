import crypto from "crypto";
import fs from "fs";
import path from "path";
import nodeFetch from "node-fetch";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import { prisma } from "@backend/db/db";
import { getLiquipediaUserAgent } from "@backend/config/env";
import { classifyParserError, isBlockedParserError } from "@backend/proxy/parserErrors";
import { markProxyFailure, markProxySuccess, maskProxyUrl, selectProxyCandidate } from "@backend/proxy/proxySelector";
import { extractDltvEventId, filterDltvEvents, filterDltvEventsByWindow, parseDltvEventPage, parseDltvEvents, parseDltvMatchPage } from "./parse";
import type { DltvMatchPageFailure, DltvRunResult } from "./types";

export type DltvMode = "events" | "search" | "event" | "health";

const DLTV_BASE_URL = (process.env.DLTV_BASE_URL || "https://ru.dltv.org").replace(/\/+$/, "");
const DLTV_TIMEOUT_MS = Number(process.env.DLTV_TIMEOUT_MS || 40000);
const DLTV_CACHE_TTL_MS = Number(process.env.DLTV_CACHE_TTL_MS || 30 * 60 * 1000);
const DLTV_STALE_TTL_MS = Number(process.env.DLTV_STALE_TTL_MS || 6 * 60 * 60 * 1000);
const DLTV_EVENT_MATCH_CONCURRENCY = Number(process.env.DLTV_EVENT_MATCH_CONCURRENCY || 4);
const DLTV_EVENTS_FUTURE_WINDOW_DAYS = Number(process.env.DLTV_EVENTS_FUTURE_WINDOW_DAYS || 60);
const DLTV_CACHE_VERSION = 4;
const DLTV_NEGATIVE_CACHE_TTL_BY_MODE: Record<DltvMode, number> = {
  events: Number(process.env.DLTV_EVENTS_NEGATIVE_CACHE_TTL_MS || 60 * 1000),
  search: Number(process.env.DLTV_SEARCH_NEGATIVE_CACHE_TTL_MS || 0),
  event: Number(process.env.DLTV_EVENT_NEGATIVE_CACHE_TTL_MS || 5 * 60 * 1000),
  health: Number(process.env.DLTV_HEALTH_NEGATIVE_CACHE_TTL_MS || 5 * 60 * 1000),
};

export const DLTV_CACHE_DIR = path.join(process.cwd(), "cache", "dltv");

export async function executeDltv(mode: DltvMode, queryOrUrl?: string, options: { noCache?: boolean } = {}): Promise<DltvRunResult> {
  if (mode === "health") {
    const html = await fetchDltvHtml(`${DLTV_BASE_URL}/events`, "health");
    return { ok: html.includes("DLTV") };
  }

  const cacheKey = `${mode}:${queryOrUrl || "default"}`;
  if (!options.noCache) {
    const fresh = readDltvCache(cacheKey, mode, DLTV_CACHE_TTL_MS);
    if (fresh) return { ...fresh, cacheHit: true, cacheLayer: "file" };
  }

  try {
    const result = await runDltvMode(mode, queryOrUrl);
    writeDltvCache(cacheKey, mode, result);
    return result;
  } catch (error) {
    const stale = readDltvCache(cacheKey, mode, DLTV_STALE_TTL_MS);
    if (stale) {
      return {
        ...stale,
        cacheHit: true,
        cacheLayer: "file-stale",
        stale: true,
        warning: error instanceof Error ? error.message : "DLTV upstream failed, returned stale cache.",
      };
    }
    throw error;
  }
}

async function runDltvMode(mode: DltvMode, queryOrUrl?: string): Promise<DltvRunResult> {
  if (mode === "events" || mode === "search") {
    const html = await fetchDltvHtml(`${DLTV_BASE_URL}/events`, mode);
    const events = filterDltvEventsByWindow(parseDltvEvents(html, DLTV_BASE_URL), new Date(), DLTV_EVENTS_FUTURE_WINDOW_DAYS);
    return { ok: true, events: mode === "search" ? filterDltvEvents(events, queryOrUrl || "") : events };
  }

  if (mode === "event") {
    const pageUrl = resolveDltvEventUrl(queryOrUrl || "");
    const html = await fetchDltvHtml(pageUrl, "event");
    const event = parseDltvEventPage(html, pageUrl);
    const matchHtmlItems = await mapWithConcurrency(event.matchUrls, DLTV_EVENT_MATCH_CONCURRENCY, async (matchUrl) => {
      try {
        return {
          ok: true as const,
          url: matchUrl,
          html: await fetchDltvHtml(matchUrl, "match"),
        };
      } catch (error) {
        return {
          ok: false as const,
          url: matchUrl,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
    const matchPageFailures: DltvMatchPageFailure[] = [];
    const matches = matchHtmlItems
      .map((item) => {
        if (!item.ok) {
          matchPageFailures.push({ url: item.url, error: item.error });
          return null;
        }

        try {
          const match = parseDltvMatchPage(item.html, item.url);
          if (!match?.id || !match.team1 || !match.team2) {
            matchPageFailures.push({ url: item.url, error: "DLTV match page is missing id or teams." });
            return null;
          }
          return match;
        } catch (error) {
          matchPageFailures.push({ url: item.url, error: error instanceof Error ? error.message : String(error) });
          return null;
        }
      })
      .filter((match): match is NonNullable<typeof match> => Boolean(match));

    return { ok: true, event, matches, matchPageFailures };
  }

  throw new Error(`Unsupported DLTV mode: ${mode}`);
}

async function fetchDltvHtml(url: string, mode: string, attempt = 1): Promise<string> {
  const proxy = await selectProxyCandidate(attempt);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DLTV_TIMEOUT_MS);
  const fetchOptions: any = {
    method: "GET",
    headers: {
      "User-Agent": getLiquipediaUserAgent(),
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.7,en;q=0.6",
      "Accept-Encoding": "gzip, deflate, br",
    },
    signal: controller.signal,
  };

  if (proxy?.proxyUrl) {
    fetchOptions.agent = proxy.proxyUrl.startsWith("socks") ? new SocksProxyAgent(proxy.proxyUrl) : new HttpsProxyAgent(proxy.proxyUrl);
    console.log(`[DLTV] Using proxy ${maskProxyUrl(proxy.proxyUrl)} for ${mode}`);
  }

  try {
    const response = await nodeFetch(url, fetchOptions as any);
    const text = await response.text();
    const durationMs = Date.now() - startedAt;
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorClass = classifyParserError({ statusCode: response.status, message: text.slice(0, 500) });
      throw dltvError(`DLTV request failed with ${response.status}`, errorClass, response.status, text.length);
    }

    await markProxySuccess(proxy?.proxyId || null, durationMs);
    await logDltvRequest({ mode, proxyId: proxy?.proxyId, statusCode: response.status, durationMs, bytesIn: text.length });
    return text;
  } catch (error) {
    clearTimeout(timeoutId);
    const message = error instanceof Error ? error.message : String(error);
    const statusCode = isDltvError(error) ? error.statusCode : undefined;
    const bytesIn = isDltvError(error) ? error.bytesIn : undefined;
    const errorClass = isDltvError(error)
      ? error.errorClass || classifyParserError({ message, statusCode })
      : classifyParserError({ message, timedOut: error instanceof Error && error.name === "AbortError" });
    await markProxyFailure(proxy?.proxyId || null, {
      errorClass,
      errorMessage: message,
      durationMs: Date.now() - startedAt,
      blocked: isBlockedParserError(errorClass),
    });
    await logDltvRequest({ mode, proxyId: proxy?.proxyId, statusCode, errorClass, durationMs: Date.now() - startedAt, bytesIn });
    throw dltvError(message, errorClass, statusCode, bytesIn);
  }
}

function resolveDltvEventUrl(value: string) {
  if (/^https?:\/\//i.test(value)) return value;
  const id = extractDltvEventId(value) || value.replace(/^\/?events\//, "");
  return `${DLTV_BASE_URL}/events/${encodeURIComponent(id)}`;
}

function readDltvCache(key: string, mode: DltvMode, ttlMs: number): DltvRunResult | null {
  const filePath = getDltvCachePath(key);
  if (!fs.existsSync(filePath)) return null;
  try {
    const cached = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (cached.version !== DLTV_CACHE_VERSION) return null;
    const cacheKind = cached.cacheKind || (isDltvEmptyResult(cached.result) ? "negative" : "positive");
    const effectiveTtl = cacheKind === "negative" ? Math.min(ttlMs, getDltvNegativeCacheTtl(mode)) : ttlMs;
    if (cacheKind === "negative" && effectiveTtl <= 0) return null;
    if (!cached.timestamp || Date.now() - Number(cached.timestamp) > effectiveTtl) return null;
    return cached.result || null;
  } catch {
    return null;
  }
}

function writeDltvCache(key: string, mode: DltvMode, result: DltvRunResult) {
  const cacheKind = isDltvEmptyResult(result) ? "negative" : "positive";
  if (cacheKind === "negative" && getDltvNegativeCacheTtl(mode) <= 0) return;
  fs.mkdirSync(DLTV_CACHE_DIR, { recursive: true });
  fs.writeFileSync(getDltvCachePath(key), JSON.stringify({ version: DLTV_CACHE_VERSION, timestamp: Date.now(), cacheKind, result }, null, 2));
}

function getDltvCachePath(key: string) {
  return path.join(DLTV_CACHE_DIR, `${crypto.createHash("sha1").update(key).digest("hex")}.json`);
}

function getDltvNegativeCacheTtl(mode: DltvMode) {
  const value = DLTV_NEGATIVE_CACHE_TTL_BY_MODE[mode];
  return Number.isFinite(value) ? value : 5 * 60 * 1000;
}

function isDltvEmptyResult(result: DltvRunResult | null | undefined) {
  return Boolean(result?.ok && (
    (Array.isArray(result.events) && result.events.length === 0) ||
    (Array.isArray(result.matches) && result.matches.length === 0)
  ));
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let index = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }));
  return results;
}

function dltvError(message: string, errorClass: string, statusCode?: number, bytesIn?: number) {
  const error = new Error(message) as Error & { errorClass?: string; statusCode?: number; bytesIn?: number };
  error.errorClass = errorClass;
  error.statusCode = statusCode;
  error.bytesIn = bytesIn;
  return error;
}

function isDltvError(error: unknown): error is Error & { errorClass?: string; statusCode?: number; bytesIn?: number } {
  return error instanceof Error && ("errorClass" in error || "statusCode" in error || "bytesIn" in error);
}

async function logDltvRequest(data: {
  mode: string;
  proxyId?: string | null;
  statusCode?: number;
  errorClass?: string | null;
  durationMs?: number;
  bytesIn?: number;
}) {
  await prisma.parserRequestLog.create({
    data: {
      source: "dltv",
      mode: data.mode,
      disciplineSlug: "dota2",
      proxyId: data.proxyId || null,
      statusCode: data.statusCode,
      errorClass: data.errorClass || null,
      durationMs: data.durationMs,
      bytesIn: data.bytesIn,
    },
  }).catch(() => {});
}
