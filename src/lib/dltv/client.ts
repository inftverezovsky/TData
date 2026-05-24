import crypto from "crypto";
import fs from "fs";
import path from "path";
import nodeFetch from "node-fetch";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import { prisma } from "@/lib/db/db";
import { getLiquipediaUserAgent } from "@/lib/config/env";
import { classifyParserError, isBlockedParserError } from "@/lib/proxy/parserErrors";
import { markProxyFailure, markProxySuccess, maskProxyUrl, selectProxyCandidate } from "@/lib/proxy/proxySelector";
import { extractDltvEventId, filterDltvEvents, parseDltvEventPage, parseDltvEvents, parseDltvMatchPage } from "./parse";
import type { DltvRunResult } from "./types";

export type DltvMode = "events" | "search" | "event" | "health";

const DLTV_BASE_URL = (process.env.DLTV_BASE_URL || "https://ru.dltv.org").replace(/\/+$/, "");
const DLTV_TIMEOUT_MS = Number(process.env.DLTV_TIMEOUT_MS || 40000);
const DLTV_CACHE_TTL_MS = Number(process.env.DLTV_CACHE_TTL_MS || 30 * 60 * 1000);
const DLTV_STALE_TTL_MS = Number(process.env.DLTV_STALE_TTL_MS || 6 * 60 * 60 * 1000);
const DLTV_EVENT_MATCH_CONCURRENCY = Number(process.env.DLTV_EVENT_MATCH_CONCURRENCY || 4);
const DLTV_CACHE_VERSION = 2;

export const DLTV_CACHE_DIR = path.join(process.cwd(), "cache", "dltv");

export async function executeDltv(mode: DltvMode, queryOrUrl?: string, options: { noCache?: boolean } = {}): Promise<DltvRunResult> {
  if (mode === "health") {
    const html = await fetchDltvHtml(`${DLTV_BASE_URL}/events`, "health");
    return { ok: html.includes("DLTV") };
  }

  const cacheKey = `${mode}:${queryOrUrl || "default"}`;
  if (!options.noCache) {
    const fresh = readDltvCache(cacheKey, DLTV_CACHE_TTL_MS);
    if (fresh) return { ...fresh, cacheHit: true, cacheLayer: "file" };
  }

  try {
    const result = await runDltvMode(mode, queryOrUrl);
    writeDltvCache(cacheKey, result);
    return result;
  } catch (error) {
    const stale = readDltvCache(cacheKey, DLTV_STALE_TTL_MS);
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
    const events = parseDltvEvents(html, DLTV_BASE_URL);
    return { ok: true, events: mode === "search" ? filterDltvEvents(events, queryOrUrl || "") : events };
  }

  if (mode === "event") {
    const pageUrl = resolveDltvEventUrl(queryOrUrl || "");
    const html = await fetchDltvHtml(pageUrl, "event");
    const event = parseDltvEventPage(html, pageUrl);
    const matchHtmlItems = await mapWithConcurrency(event.matchUrls, DLTV_EVENT_MATCH_CONCURRENCY, async (matchUrl) => ({
      url: matchUrl,
      html: await fetchDltvHtml(matchUrl, "match"),
    }));
    const matches = matchHtmlItems
      .map((item) => parseDltvMatchPage(item.html, item.url))
      .filter((match) => match.id && match.team1 && match.team2);

    return { ok: true, event, matches };
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
      await markProxyFailure(proxy?.proxyId || null, {
        errorClass,
        errorMessage: `DLTV request failed with ${response.status}`,
        durationMs,
        blocked: isBlockedParserError(errorClass),
      });
      await logDltvRequest({ mode, proxyId: proxy?.proxyId, statusCode: response.status, errorClass, durationMs, bytesIn: text.length });
      throw dltvError(`DLTV request failed with ${response.status}`, errorClass);
    }

    await markProxySuccess(proxy?.proxyId || null, durationMs);
    await logDltvRequest({ mode, proxyId: proxy?.proxyId, statusCode: response.status, durationMs, bytesIn: text.length });
    return text;
  } catch (error) {
    clearTimeout(timeoutId);
    const message = error instanceof Error ? error.message : String(error);
    const errorClass = classifyParserError({ message, timedOut: error instanceof Error && error.name === "AbortError" });
    await markProxyFailure(proxy?.proxyId || null, {
      errorClass,
      errorMessage: message,
      durationMs: Date.now() - startedAt,
      blocked: isBlockedParserError(errorClass),
    });
    await logDltvRequest({ mode, proxyId: proxy?.proxyId, errorClass, durationMs: Date.now() - startedAt });
    throw dltvError(message, errorClass);
  }
}

function resolveDltvEventUrl(value: string) {
  if (/^https?:\/\//i.test(value)) return value;
  const id = extractDltvEventId(value) || value.replace(/^\/?events\//, "");
  return `${DLTV_BASE_URL}/events/${encodeURIComponent(id)}`;
}

function readDltvCache(key: string, ttlMs: number): DltvRunResult | null {
  const filePath = getDltvCachePath(key);
  if (!fs.existsSync(filePath)) return null;
  try {
    const cached = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (cached.version !== DLTV_CACHE_VERSION) return null;
    if (!cached.timestamp || Date.now() - Number(cached.timestamp) > ttlMs) return null;
    return cached.result || null;
  } catch {
    return null;
  }
}

function writeDltvCache(key: string, result: DltvRunResult) {
  fs.mkdirSync(DLTV_CACHE_DIR, { recursive: true });
  fs.writeFileSync(getDltvCachePath(key), JSON.stringify({ version: DLTV_CACHE_VERSION, timestamp: Date.now(), result }, null, 2));
}

function getDltvCachePath(key: string) {
  return path.join(DLTV_CACHE_DIR, `${crypto.createHash("sha1").update(key).digest("hex")}.json`);
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results: R[] = [];
  let index = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (index < items.length) {
      const item = items[index++];
      results.push(await mapper(item));
    }
  }));
  return results;
}

function dltvError(message: string, errorClass: string) {
  const error = new Error(message) as Error & { errorClass?: string };
  error.errorClass = errorClass;
  return error;
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
