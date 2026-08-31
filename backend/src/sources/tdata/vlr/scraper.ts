import crypto from "crypto";
import fs from "fs";
import path from "path";
import { HttpsProxyAgent } from "https-proxy-agent";
import fetch from "node-fetch";
import { prisma } from "@backend/db/db";
import { readBoundedBodyText } from "@backend/http/boundedResponse";
import { classifyParserError, emptyValidIfNoItems, normalizeParserErrorClass, type ParserErrorClass } from "@backend/proxy/parserErrors";
import { markProxyFailure, markProxySuccess, maskProxyUrl, selectProxyCandidate } from "@backend/proxy/proxySelector";
import { buildMonitorRequestPlan } from "@backend/sources/monitorCanary";
import { logParserRequest } from "@backend/sources/tdata/hltv/scraper/helpers";
import {
  buildVlrEventMatchesUrl,
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

export type VlrRunOptions = {
  noCache?: boolean;
  signal?: AbortSignal;
  monitorMode?: boolean;
};

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
  diagnostics?: {
    vlr?: VlrDiagnosticsStats;
  };
};

export type VlrDiagnosticsStats = {
  matchUrlsFound: number;
  matchPagesFetched: number;
  matchPagesFailed: number;
  cacheHit?: boolean;
  stale?: boolean;
};

const VLR_ORIGIN = "https://www.vlr.gg";
const VLR_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const VLR_MAX_REDIRECTS = 3;
const VLR_CACHE_DIR = path.join(process.cwd(), "cache", "vlr");
const CACHE_VERSION = "vlr-http-v2";
const POSITIVE_CACHE_TTL_BY_MODE: Record<VlrMode, number> = {
  matches: 5 * 60 * 1000,
  events: 10 * 60 * 1000,
  search: 60 * 60 * 1000,
  event: 10 * 60 * 1000,
  health: 5 * 60 * 1000,
};
const NEGATIVE_CACHE_TTL_BY_MODE: Record<VlrMode, number> = {
  matches: Number(process.env.VLR_MATCHES_NEGATIVE_CACHE_TTL_MS || 5 * 60 * 1000),
  events: Number(process.env.VLR_EVENTS_NEGATIVE_CACHE_TTL_MS || 60 * 1000),
  search: Number(process.env.VLR_SEARCH_NEGATIVE_CACHE_TTL_MS || 0),
  event: Number(process.env.VLR_EVENT_NEGATIVE_CACHE_TTL_MS || 5 * 60 * 1000),
  health: Number(process.env.VLR_HEALTH_NEGATIVE_CACHE_TTL_MS || 5 * 60 * 1000),
};

let vlrQueue: Promise<any> = Promise.resolve();
const activeRequests = new Map<string, Promise<VlrResult>>();
let lastStartedAt = 0;

export async function runVlrScraper(mode: VlrMode, queryOrId?: string, options: VlrRunOptions = {}) {
  const requestKey = `${mode}:${queryOrId || ""}:${options.noCache ? "force" : "cached"}:${options.signal ? "abortable" : "shared"}:${options.monitorMode ? "monitor" : "full"}`;
  if (activeRequests.has(requestKey)) return activeRequests.get(requestKey)!;

  const current = vlrQueue;
  const promise = (async () => {
    try {
      await current;
    } catch {}
    options.signal?.throwIfAborted();

    const waitMs = Math.max(0, Number(process.env.VLR_QUEUE_DELAY_MS || 750) - (Date.now() - lastStartedAt));
    if (waitMs > 0) await abortableDelay(waitMs, options.signal);
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

async function executeVlr(mode: VlrMode, queryOrId?: string, options: VlrRunOptions = {}, attempt = 1): Promise<VlrResult> {
  options.signal?.throwIfAborted();
  const startedAt = Date.now();
  const cached = options.noCache ? null : readCache(mode, queryOrId);
  if (cached) {
    if (cached.diagnostics?.vlr) {
      cached.diagnostics = {
        ...cached.diagnostics,
        vlr: { ...cached.diagnostics.vlr, cacheHit: true, stale: false },
      };
    }
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
    const result = await scrapeVlrMode(mode, queryOrId, proxyUrl, options.signal, Boolean(options.monitorMode));
    const matchesCount = result.matches?.length ?? null;
    const eventsCount = result.events?.length ?? null;
    const errorClass = result.errorClass || (mode === "matches" || mode === "event"
      ? emptyValidIfNoItems([matchesCount])
      : emptyValidIfNoItems([eventsCount]));
    const finalResult = { ...result, errorClass };

    if (!options.monitorMode) setCache(mode, queryOrId, finalResult);
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

    const maxAttempts = Number(process.env.VLR_MAX_ATTEMPTS || 2);
    if (attempt < maxAttempts && shouldRetry(errorClass)) {
      return executeVlr(mode, queryOrId, options, attempt + 1);
    }

    const finalError = new Error(message) as Error & { errorClass?: ParserErrorClass };
    finalError.errorClass = errorClass;
    throw finalError;
  }
}

async function scrapeVlrMode(mode: VlrMode, queryOrId?: string, proxyUrl?: string, signal?: AbortSignal, monitorMode = false): Promise<VlrResult> {
  if (mode === "health") {
    const html = await fetchVlrHtml(VLR_ORIGIN, proxyUrl, signal);
    return { ok: true, title: /VLR\.gg/i.test(html) ? "VLR.gg" : "VLR" };
  }

  if (mode === "events" || mode === "search") {
    const html = await fetchVlrHtml(`${VLR_ORIGIN}/events`, proxyUrl, signal);
    const events = parseVlrEventsHtml(html).filter((event) => event.status === "ongoing" || event.status === "upcoming");
    return {
      ok: true,
      events: mode === "search" ? filterVlrEventsByQuery(events, queryOrId || "") : events,
    };
  }

  if (mode === "event") {
    const eventId = queryOrId || "";
    const eventUrl = resolveVlrEventUrl(eventId);
    const html = await fetchVlrHtml(eventUrl, proxyUrl, signal);
    const parsed = parseVlrEventMatchesHtml(html, eventUrl);
    const matchesUrl = buildVlrEventMatchesUrl(eventUrl);
    let matches = parsed.matches;
    let warning: string | null = null;

    if (matchesUrl) {
      try {
        const matchesHtml = await fetchVlrHtml(matchesUrl, proxyUrl, signal);
        const scheduleMatches = parseVlrMatchesHtml(matchesHtml, matchesUrl);
        matches = mergeVlrMatches([
          ...scheduleMatches,
          ...parsed.matches,
        ]);
      } catch (error) {
        signal?.throwIfAborted();
        warning = `Не удалось загрузить полное расписание VLR: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    const requestedLimit = positiveInteger(process.env.VLR_EVENT_ENRICH_LIMIT, 120);
    const detailCandidates = monitorMode ? matches : matches.slice(0, requestedLimit);
    const detailPlan = buildMonitorRequestPlan(detailCandidates, 1, monitorMode);
    const enriched = await enrichMatches(matches, proxyUrl, detailPlan.items.length, signal);
    return { ok: true, title: parsed.title, matches: enriched.matches, warning, diagnostics: { vlr: enriched.diagnostics } };
  }

  const html = await fetchVlrHtml(`${VLR_ORIGIN}/matches`, proxyUrl, signal);
  const matches = parseVlrMatchesHtml(html);
  const requestedLimit = positiveInteger(process.env.VLR_MATCHES_ENRICH_LIMIT, 80);
  const detailCandidates = monitorMode ? matches : matches.slice(0, requestedLimit);
  const detailPlan = buildMonitorRequestPlan(detailCandidates, 1, monitorMode);
  const enriched = await enrichMatches(matches, proxyUrl, detailPlan.items.length, signal);
  return { ok: true, matches: enriched.matches, diagnostics: { vlr: enriched.diagnostics } };
}

function mergeVlrMatches(matches: VlrMatch[]) {
  const seen = new Map<string, VlrMatch>();

  for (const match of matches) {
    if (!match.id) continue;
    const existing = seen.get(match.id);
    if (!existing) {
      seen.set(match.id, match);
      continue;
    }

    seen.set(match.id, {
      ...existing,
      ...match,
      tournament: match.tournament || existing.tournament,
      stage: match.stage || existing.stage || null,
      team1: match.team1 || existing.team1,
      team2: match.team2 || existing.team2,
      utcTimestamp: match.utcTimestamp || existing.utcTimestamp || null,
      unix_time: match.unix_time ?? existing.unix_time ?? null,
      format: match.format || existing.format || null,
      status: match.isLive || existing.isLive ? "live" : (match.status || existing.status || "upcoming"),
      isLive: Boolean(match.isLive || existing.isLive),
      dateLabel: match.dateLabel || existing.dateLabel || null,
      rawText: match.rawText || existing.rawText || null,
    });
  }

  return Array.from(seen.values());
}

async function enrichMatches(matches: VlrMatch[], proxyUrl?: string, limit = 50, signal?: AbortSignal): Promise<{ matches: VlrMatch[]; diagnostics: VlrDiagnosticsStats }> {
  const enriched: VlrMatch[] = [];
  const diagnostics: VlrDiagnosticsStats = {
    matchUrlsFound: matches.length,
    matchPagesFetched: 0,
    matchPagesFailed: 0,
  };
  for (const match of matches.slice(0, limit)) {
    signal?.throwIfAborted();
    try {
      const html = await fetchVlrHtml(match.url, proxyUrl, signal);
      const detail = parseVlrMatchDetailHtml(html, match.url);
      diagnostics.matchPagesFetched += 1;
      enriched.push({ ...match, ...detail, id: match.id, url: match.url });
    } catch {
      signal?.throwIfAborted();
      diagnostics.matchPagesFailed += 1;
      enriched.push(match);
    }
  }
  return { matches: enriched.concat(matches.slice(limit)), diagnostics };
}

async function fetchVlrHtml(url: string, proxyUrl?: string, signal?: AbortSignal) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.VLR_HTTP_TIMEOUT_MS || 20000));
  try {
    let currentUrl = validateVlrFetchUrl(url);
    for (let redirectCount = 0; redirectCount <= VLR_MAX_REDIRECTS; redirectCount += 1) {
      const response = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          "User-Agent": process.env.VLR_USER_AGENT || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        ...(proxyUrl ? { agent: new HttpsProxyAgent(proxyUrl) as any } : {}),
      } as any);

      validateVlrFetchUrl(response.url || currentUrl);
      if (isRedirectStatus(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new Error(`VLR HTTP ${response.status} redirect is missing Location`);
        if (redirectCount >= VLR_MAX_REDIRECTS) throw new Error("VLR redirect limit exceeded");
        const nextUrl = resolveVlrRedirectUrl(currentUrl, location);
        await readBoundedBodyText(response, {
          maxBytes: 64 * 1024,
          signal: controller.signal,
          label: "VLR redirect response",
        });
        currentUrl = nextUrl;
        continue;
      }

      const text = await readBoundedBodyText(response, {
        maxBytes: VLR_MAX_RESPONSE_BYTES,
        signal: controller.signal,
        label: "VLR response",
      });
      if (!response.ok) throw new Error(`VLR HTTP ${response.status}: ${text.slice(0, 200)}`);
      return text;
    }
    throw new Error("VLR redirect limit exceeded");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

function abortableDelay(milliseconds: number, signal?: AbortSignal) {
  if (!signal) return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function readCache(mode: VlrMode, queryOrId?: string): VlrResult | null {
  const cachePath = getCachePath(mode, queryOrId);
  if (!fs.existsSync(cachePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    const age = Date.now() - Number(data.timestamp || 0);
    const ttl = data.cacheKind === "negative" ? getNegativeCacheTtl(mode) : POSITIVE_CACHE_TTL_BY_MODE[mode];
    if (data.cacheKind === "negative" && ttl <= 0) return null;
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
    if (isEmpty && getNegativeCacheTtl(mode) <= 0) return;
    fs.writeFileSync(getCachePath(mode, queryOrId), JSON.stringify({
      timestamp: Date.now(),
      cacheKind: isEmpty ? "negative" : "positive",
      result,
    }));
  } catch {}
}

function getNegativeCacheTtl(mode: VlrMode) {
  const value = NEGATIVE_CACHE_TTL_BY_MODE[mode];
  return Number.isFinite(value) ? value : 5 * 60 * 1000;
}

function getCachePath(mode: VlrMode, queryOrId = "") {
  const key = crypto.createHash("md5").update(`${CACHE_VERSION}:${mode}:${queryOrId}`).digest("hex");
  return path.join(VLR_CACHE_DIR, `${key}.json`);
}

function shouldRetry(errorClass: string) {
  const normalized = normalizeParserErrorClass(errorClass);
  return normalized === "timeout" || normalized === "network_error" || normalized === "source_5xx" || normalized === "proxy_tunnel";
}

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

export function getVlrEventId(pageUrl: string) {
  return extractVlrEventId(pageUrl);
}

export function resolveVlrEventUrl(value: string) {
  const raw = String(value || "").trim();
  if (/^[1-9]\d{0,15}$/.test(raw)) return `${VLR_ORIGIN}/event/${raw}`;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid VLR event URL");
  }
  if (url.hostname.toLowerCase() === "vlr.gg") url.hostname = "www.vlr.gg";
  if (!/^\/event\/[1-9]\d{0,15}(?:\/[^/?#]+(?:\/[^/?#]+)*)?\/?$/iu.test(url.pathname)) {
    throw new Error("Invalid VLR event URL");
  }
  validateVlrFetchUrl(url.toString());
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function validateVlrFetchUrl(value: string) {
  let url: URL;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("VLR outbound URL must be a same-origin HTTPS URL");
  }
  if (url.hostname.toLowerCase() === "vlr.gg") url.hostname = "www.vlr.gg";
  if (
    url.origin !== VLR_ORIGIN
    || url.protocol !== "https:"
    || url.port !== ""
    || url.username !== ""
    || url.password !== ""
  ) {
    throw new Error("VLR outbound URL must be a same-origin HTTPS URL");
  }
  url.hash = "";
  return url.toString();
}

export function resolveVlrRedirectUrl(currentUrl: string, location: string) {
  let nextUrl: URL;
  try {
    nextUrl = new URL(location, validateVlrFetchUrl(currentUrl));
  } catch (error) {
    if (error instanceof Error && /same-origin HTTPS/u.test(error.message)) throw error;
    throw new Error("VLR redirect URL must be a same-origin HTTPS URL");
  }
  return validateVlrFetchUrl(nextUrl.toString());
}

function isRedirectStatus(status: number) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}
