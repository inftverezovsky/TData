import fs from "fs";
import path from "path";
import { prisma } from "@/lib/db/db";
import { emptyValidIfNoItems } from "@/lib/proxy/parserErrors";
import { HltvMode } from "../scraper";

export const HLTV_CACHE_DIR = path.join(process.cwd(), "cache", "hltv");
const HLTV_RELATED_CACHE_TTL_MS = Number(process.env.HLTV_RELATED_CACHE_TTL_MS || 6 * 60 * 60 * 1000);

export function classifyHltvEmptyResult(mode: HltvMode, data: any, matchesCount: number | null, eventsCount: number | null) {
  if (data.cacheKind === "negative") return "empty_valid";
  if (mode === "search" || mode === "events") return emptyValidIfNoItems([eventsCount]);
  if (mode === "scrape" || mode === "event") return emptyValidIfNoItems([matchesCount]);
  return null;
}

export function pickHltvErrorLine(stderr: string, stdout: string) {
  const lines = `${stderr}\n${stdout}`
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/Using Browser Proxy|Executing request|New request|Request .*STARTING/i.test(line));

  return lines.reverse().find((line) =>
    /ERR_|error|failed|timeout|timed out|cloudflare|captcha|403|407|429|tunnel|selector|parse/i.test(line)
  ) || lines.at(-1) || null;
}

export function readRelatedHltvSearchCache(query?: string) {
  if (!query || !fs.existsSync(HLTV_CACHE_DIR)) return null;

  const scored: Array<{ events: any[]; score: number; timestamp: number }> = [];
  for (const entry of fs.readdirSync(HLTV_CACHE_DIR)) {
    if (!entry.endsWith(".json")) continue;

    try {
      const cachePath = path.join(HLTV_CACHE_DIR, entry);
      const data = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      const timestamp = Number(data.timestamp || 0);
      if (!timestamp || Date.now() - timestamp > HLTV_RELATED_CACHE_TTL_MS) continue;

      const events = Array.isArray(data?.result?.events) ? data.result.events : [];
      if (events.length === 0) continue;

      const matchingEvents = events
        .map((event: any) => ({ event, score: getSearchMatchScore(query, `${event.title || ""} ${event.url || ""}`) }))
        .filter((item: { score: number }) => item.score > 0)
        .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
        .map((item: { event: any }) => item.event);

      if (matchingEvents.length > 0) {
        scored.push({
          events: matchingEvents,
          score: getSearchMatchScore(query, matchingEvents.map((event: any) => `${event.title || ""} ${event.url || ""}`).join(" ")),
          timestamp,
        });
      }
    } catch {}
  }

  scored.sort((a, b) => b.score - a.score || b.timestamp - a.timestamp);
  const best = scored[0];
  return best ? { events: best.events.slice(0, Number(process.env.HLTV_SEARCH_MAX_EVENTS || 10)) } : null;
}

export function getSearchMatchScore(query: string, value: string) {
  const queryTokens = normalizeSearchTokens(query);
  if (queryTokens.length === 0) return 0;

  const haystack = normalizeSearchText(value);
  let score = 0;
  for (const token of queryTokens) {
    if (!haystack.includes(token)) return 0;
    score += token.length >= 4 ? 3 : 1;
  }
  return score;
}

export function normalizeSearchTokens(value: string) {
  return normalizeSearchText(value)
    .split(" ")
    .filter((token) => token.length >= 2);
}

export function normalizeSearchText(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function logParserRequest(data: {
  source: string;
  mode?: string;
  route?: string;
  disciplineSlug?: string;
  queryHash?: string;
  proxyId?: string | null;
  attempt?: number;
  statusCode?: number;
  errorClass?: string | null;
  durationMs?: number;
  bytesIn?: number;
  bytesOut?: number;
  cacheLayer?: string | null;
  cacheHit?: boolean;
  matchesCount?: number | null;
  eventsCount?: number | null;
}) {
  await prisma.parserRequestLog.create({
    data: {
      source: data.source,
      mode: data.mode,
      route: data.route,
      disciplineSlug: data.disciplineSlug,
      queryHash: data.queryHash,
      proxyId: data.proxyId || null,
      attempt: data.attempt,
      statusCode: data.statusCode,
      errorClass: data.errorClass || null,
      durationMs: data.durationMs,
      bytesIn: data.bytesIn,
      bytesOut: data.bytesOut,
      cacheLayer: data.cacheLayer || null,
      cacheHit: data.cacheHit ?? false,
      matchesCount: data.matchesCount ?? null,
      eventsCount: data.eventsCount ?? null,
    },
  }).catch(() => {});
}
