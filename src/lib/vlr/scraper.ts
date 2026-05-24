import crypto from "crypto";
import fs from "fs";
import path from "path";
import { HttpsProxyAgent } from "https-proxy-agent";
import fetch from "node-fetch";
import { prisma } from "@/lib/db/db";
import { classifyParserError, emptyValidIfNoItems, normalizeParserErrorClass, type ParserErrorClass } from "@/lib/proxy/parserErrors";
import { markProxyFailure, markProxySuccess, maskProxyUrl, selectProxyCandidate } from "@/lib/proxy/proxySelector";
import { logParserRequest } from "@/lib/hltv/scraper/helpers";
import {
  extractVlrEventId,
  filterVlrEventsByQuery,
  parseVlrEventMatchesHtml,
  parseVlrEventsHtml,
  parseVlrMatchDetailHtml,
  parseVlrMatchesHtml,
  type VlrEvent,
  type VlrMatch,
} from "./parse";

export type VlrMode = "matches" | "events" | "search" | "event" | "health";

type VlrResult = {
  ok: boolean;
  matches?: VlrMatch[];
  events?: VlrEvent[];
  title?: string;
  error?: string;
  errorClass?: string | null;
  cacheHit?: boolean;
  cacheLayer?: string | null;
  stale?: boolean;
  warning?: string | null;
};

const VLR_ORIGIN = "https://www.vlr.gg";
const VLR_CACHE_DIR = path.join(process.cwd(), "cache", "vlr");
const CACHE_VERSION = "vlr-http-v1";
const POSITIVE_CACHE_TTL_BY_MODE: Record<VlrMode, number> = {
  matches: 5 * 60 * 1000,
  events: 10 * 60 * 1000,
  search: 60 * 60 * 1000,
  event: 10 * 60 * 1000,
  health: 5 * 60 * 1000,
};
const NEGATIVE_CACHE_TTL = 5 * 60 * 1000;

let vlrQueue: Promise<any> = Promise.resolve();
const activeRequests = new Map<string, Promise<VlrResult>>();
let lastStartedAt = 0;

export async function runVlrScraper(mode: VlrMode, queryOrId?: string, options: { noCache?: boolean } = {}) {
  const requestKey = `${mode}:${queryOrId || ""}:${options.noCache ? "force" : "cached"}`;
  if (activeRequests.has(requestKey)) return activeRequests.get(requestKey)!;

  const current = vlrQueue;
  const promise = (async () => {
    try {
      await current;
    } catch {}

    const waitMs = Math.max(0, Number(process.env.VLR_QUEUE_DELAY_MS || 750) - (Date.now() - lastStartedAt));
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastStartedAt = Date.now();

    try {
      return await executeVlr(mode, queryOrId, options);
    } finally {
      activeRequests.delete(requestKey);
    }
  })();

  activeRequests.set(requestKey, promise);
  vlrQueue = promise;
  return promise;
}

async function executeVlr(mode: VlrMode, queryOrId?: string, options: { noCache?: boolean } = {}, attempt = 1): Promise<VlrResult> {
  const startedAt = Date.now();
  const cached = options.noCache ? null : readCache(mode, queryOrId);
  if (cached) {
    await logParserRequest({
      source: "vlr",
      mode,
      attempt,
      durationMs: Date.now() - startedAt,
      cacheHit: true,
      cacheLayer: cached.cacheLayer || "file",
      matchesCount: cached.matches?.length ?? null,
      eventsCount: cached.events?.length ?? null,
      errorClass: cached.errorClass || null,
    });
    return cached;
  }

  const directFirst = process.env.VLR_USE_PROXY === "1" ? false : true;
  const proxyCandidate = directFirst ? null : await selectProxyCandidate(attempt);
  const proxyUrl = proxyCandidate?.proxyUrl || "";
  const proxyId = proxyCandidate?.proxyId || null;

  if (proxyId) {
    await prisma.proxyPool.update({ where: { id: proxyId }, data: { lastUsed: new Date() } }).catch(() => {});
    console.log(`[VLR Scraper] mode=${mode} attempt=${attempt} proxy=${maskProxyUrl(proxyUrl)}`);
  }

  try {
    const result = await scrapeVlrMode(mode, queryOrId, proxyUrl);
    const matchesCount = result.matches?.length ?? null;
    const eventsCount = result.events?.length ?? null;
    const errorClass = result.errorClass || (mode === "matches" || mode === "event"
      ? emptyValidIfNoItems([matchesCount])
      : emptyValidIfNoItems([eventsCount]));
    const finalResult = { ...result, errorClass };

    setCache(mode, queryOrId, finalResult);
    await markProxySuccess(proxyId, Date.now() - startedAt);
    await logParserRequest({
      source: "vlr",
      mode,
      proxyId,
      attempt,
      durationMs: Date.now() - startedAt,
      bytesIn: JSON.stringify(finalResult).length,
      matchesCount,
      eventsCount,
      errorClass,
    });
    return finalResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errorClass = classifyParserError({ message });
    await markProxyFailure(proxyId, {
      errorClass,
      errorMessage: message,
      durationMs: Date.now() - startedAt,
    });
    await logParserRequest({
      source: "vlr",
      mode,
      proxyId,
      attempt,
      durationMs: Date.now() - startedAt,
      errorClass,
    });

    if (!directFirst && attempt < 2 && shouldRetry(errorClass)) {
      return executeVlr(mode, queryOrId, options, attempt + 1);
    }

    const finalError = new Error(message) as Error & { errorClass?: ParserErrorClass };
    finalError.errorClass = errorClass;
    throw finalError;
  }
}

async function scrapeVlrMode(mode: VlrMode, queryOrId?: string, proxyUrl?: string): Promise<VlrResult> {
  if (mode === "health") {
    const html = await fetchVlrHtml(VLR_ORIGIN, proxyUrl);
    return { ok: true, title: /VLR\.gg/i.test(html) ? "VLR.gg" : "VLR" };
  }

  if (mode === "events" || mode === "search") {
    const html = await fetchVlrHtml(`${VLR_ORIGIN}/events`, proxyUrl);
    const events = parseVlrEventsHtml(html).filter((event) => event.status === "ongoing" || event.status === "upcoming");
    return {
      ok: true,
      events: mode === "search" ? filterVlrEventsByQuery(events, queryOrId || "") : events,
    };
  }

  if (mode === "event") {
    const eventId = queryOrId || "";
    const eventUrl = eventId.startsWith("http") ? eventId : `${VLR_ORIGIN}/event/${eventId}`;
    const html = await fetchVlrHtml(eventUrl, proxyUrl);
    const parsed = parseVlrEventMatchesHtml(html, eventUrl);
    const enriched = await enrichMatches(parsed.matches, proxyUrl);
    return { ok: true, title: parsed.title, matches: enriched };
  }

  const html = await fetchVlrHtml(`${VLR_ORIGIN}/matches`, proxyUrl);
  const matches = parseVlrMatchesHtml(html);
  return { ok: true, matches: await enrichMatches(matches, proxyUrl, Number(process.env.VLR_MATCHES_ENRICH_LIMIT || 80)) };
}

async function enrichMatches(matches: VlrMatch[], proxyUrl?: string, limit = 50) {
  const enriched: VlrMatch[] = [];
  for (const match of matches.slice(0, limit)) {
    try {
      const html = await fetchVlrHtml(match.url, proxyUrl);
      const detail = parseVlrMatchDetailHtml(html, match.url);
      enriched.push({ ...match, ...detail, id: match.id, url: match.url });
    } catch {
      enriched.push(match);
    }
  }
  return enriched.concat(matches.slice(limit));
}

async function fetchVlrHtml(url: string, proxyUrl?: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.VLR_HTTP_TIMEOUT_MS || 20000));
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": process.env.VLR_USER_AGENT || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      ...(proxyUrl ? { agent: new HttpsProxyAgent(proxyUrl) as any } : {}),
    } as any);

    const text = await response.text();
    if (!response.ok) throw new Error(`VLR HTTP ${response.status}: ${text.slice(0, 200)}`);
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

function readCache(mode: VlrMode, queryOrId?: string): VlrResult | null {
  const cachePath = getCachePath(mode, queryOrId);
  if (!fs.existsSync(cachePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    const age = Date.now() - Number(data.timestamp || 0);
    const ttl = data.cacheKind === "negative" ? NEGATIVE_CACHE_TTL : POSITIVE_CACHE_TTL_BY_MODE[mode];
    if (age >= ttl) return null;
    return { ...data.result, cacheHit: true, cacheLayer: "file", stale: false };
  } catch {
    return null;
  }
}

function setCache(mode: VlrMode, queryOrId: string | undefined, result: VlrResult) {
  try {
    if (!result.ok) return;
    fs.mkdirSync(VLR_CACHE_DIR, { recursive: true });
    const isEmpty = (Array.isArray(result.events) && result.events.length === 0) ||
      (Array.isArray(result.matches) && result.matches.length === 0);
    fs.writeFileSync(getCachePath(mode, queryOrId), JSON.stringify({
      timestamp: Date.now(),
      cacheKind: isEmpty ? "negative" : "positive",
      result,
    }));
  } catch {}
}

function getCachePath(mode: VlrMode, queryOrId = "") {
  const key = crypto.createHash("md5").update(`${CACHE_VERSION}:${mode}:${queryOrId}`).digest("hex");
  return path.join(VLR_CACHE_DIR, `${key}.json`);
}

function shouldRetry(errorClass: string) {
  const normalized = normalizeParserErrorClass(errorClass);
  return normalized === "timeout" || normalized === "network_error" || normalized === "source_5xx" || normalized === "proxy_tunnel";
}

export function getVlrEventId(pageUrl: string) {
  return extractVlrEventId(pageUrl);
}
