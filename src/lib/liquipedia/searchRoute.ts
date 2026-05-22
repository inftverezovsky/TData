import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/db";
import { getSearchCacheTtlMs } from "@/lib/config/env";
import { filterLiquipediaSearchResultsForQuery, searchTournamentPages } from "@/lib/liquipedia/client";
import { classifyParserError, emptyValidIfNoItems } from "@/lib/proxy/parserErrors";
import { getClientRateLimitKey } from "@/lib/http/clientIp";
import crypto from "crypto";

type DisciplineLoader = () => Promise<{ id: string; baseApiUrl: string | null }>;

const MAX_QUERY_LENGTH = 120;
const SEARCH_RATE_LIMIT = 40;
const SEARCH_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

type RateLimitBucket = {
  count: number;
  firstSeenAt: number;
};

const searchRateLimitBuckets = new Map<string, RateLimitBucket>();

export function createSearchTournamentPostRoute(config: {
  disciplineSlug: string;
  getDiscipline: DisciplineLoader;
  defaultApiUrl: string;
}) {
  return async function POST(req: Request) {
    const body = await req.json().catch(() => null);
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    const force = Boolean(body?.force);
    return handleSearchRequest(config, req, query, force);
  };
}

export function createSearchTournamentGetRoute(config: {
  disciplineSlug: string;
  getDiscipline: DisciplineLoader;
  defaultApiUrl: string;
}) {
  return async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const query = (searchParams.get("query") || "").trim();
    const force = searchParams.get("force") === "true";
    return handleSearchRequest(config, req, query, force);
  };
}

async function handleSearchRequest(config: {
  disciplineSlug: string;
  getDiscipline: DisciplineLoader;
  defaultApiUrl: string;
}, request: Request, query: string, force: boolean) {
  try {
    if (query.length < 2) {
      return NextResponse.json({ error: "Введите минимум 2 символа", query, cacheHit: false, results: [] }, { status: 400 });
    }

    if (query.length > MAX_QUERY_LENGTH) {
      return NextResponse.json({ error: "Слишком длинный поисковый запрос", query, cacheHit: false, results: [] }, { status: 400 });
    }

    if (isSearchRateLimited(getClientRateLimitKey(request, "liquipedia-search"))) {
      return NextResponse.json({ error: "Too many search requests" }, { status: 429 });
    }

    const discipline = await config.getDiscipline();
    const cacheSince = new Date(Date.now() - getSearchCacheTtlMs());
    const staleSince = new Date(Date.now() - 24 * 60 * 60 * 1000);
    let staleRequest: Awaited<ReturnType<typeof findCachedSearchRequest>> = null;
    const futureWindowDays = config.disciplineSlug === "leagueoflegends" ? 180 : 30;

    if (!force) {
      const cachedRequest = await findCachedSearchRequest(discipline.id, query, cacheSince);
      staleRequest = cachedRequest || await findCachedSearchRequest(discipline.id, query, staleSince);

      if (cachedRequest) {
        const cachedResults = filterLiquipediaSearchResultsForQuery(query, cachedRequest.results, new Date().getFullYear(), { futureWindowDays });
        const cachedResultsCount = cachedResults.length;
        if (cachedResultsCount > 0) {
          await logSearchRouteRequest({
            disciplineSlug: config.disciplineSlug,
            query,
            cacheHit: true,
            cacheLayer: "db",
            matchesCount: cachedResultsCount,
            errorClass: emptyValidIfNoItems([cachedResultsCount]),
          });

          return NextResponse.json({
            query,
            cacheHit: true,
            results: cachedResults.map((result) => ({
              pageId: result.pageId,
              title: result.title,
              pageUrl: result.pageUrl,
              snippet: result.snippet,
              score: result.score,
              wordCount: result.wordCount,
              dates: result.dates
            }))
          });
        }
      }
    }

    const apiUrl = discipline.baseApiUrl ?? config.defaultApiUrl;
    let results;
    try {
      results = await searchTournamentPages(query, apiUrl, config.disciplineSlug);
    } catch (error) {
      if (staleRequest) {
        const staleResults = filterLiquipediaSearchResultsForQuery(query, staleRequest.results, new Date().getFullYear(), { futureWindowDays });
        if (staleResults.length === 0) {
          throw error;
        }

        await logSearchRouteRequest({
          disciplineSlug: config.disciplineSlug,
          query,
          cacheHit: true,
          cacheLayer: "db-stale",
          matchesCount: staleResults.length,
          errorClass: classifyParserError({ message: error instanceof Error ? error.message : String(error) }),
        });
        return NextResponse.json({
          query,
          cacheHit: true,
          stale: true,
          warning: error instanceof Error ? error.message : "Search failed, returned stale cache",
          results: staleResults.map((result) => ({
            pageId: result.pageId,
            title: result.title,
            pageUrl: result.pageUrl,
            snippet: result.snippet,
            score: result.score,
            wordCount: result.wordCount,
            dates: result.dates
          }))
        });
      }
      throw error;
    }

    await prisma.searchRequest.create({
      data: {
        disciplineId: discipline.id,
        queryText: query,
        status: "SUCCESS",
        results: {
          create: results.map((result) => ({
            pageId: result.pageId,
            title: result.title,
            pageUrl: result.pageUrl,
            snippet: result.snippet,
            score: result.score,
            wordCount: result.wordCount,
            dates: result.dates
          }))
        }
      }
    });
    await logSearchRouteRequest({
      disciplineSlug: config.disciplineSlug,
      query,
      cacheHit: false,
      cacheLayer: null,
      matchesCount: results.length,
      errorClass: emptyValidIfNoItems([results.length]),
    });

    return NextResponse.json({ query, cacheHit: false, results });
  } catch (error) {
    await logSearchRouteRequest({
      disciplineSlug: config.disciplineSlug,
      query,
      cacheHit: false,
      cacheLayer: null,
      errorClass: classifyParserError({ message: error instanceof Error ? error.message : String(error) }),
    });
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось выполнить поиск" },
      { status: 500 }
    );
  }
}

function isSearchRateLimited(key: string) {
  const now = Date.now();
  const current = searchRateLimitBuckets.get(key);

  if (!current || now - current.firstSeenAt > SEARCH_RATE_LIMIT_WINDOW_MS) {
    searchRateLimitBuckets.set(key, { count: 1, firstSeenAt: now });
    cleanupSearchRateLimitBuckets(now);
    return false;
  }

  current.count += 1;
  return current.count > SEARCH_RATE_LIMIT;
}

function cleanupSearchRateLimitBuckets(now: number) {
  for (const [key, bucket] of searchRateLimitBuckets) {
    if (now - bucket.firstSeenAt > SEARCH_RATE_LIMIT_WINDOW_MS) {
      searchRateLimitBuckets.delete(key);
    }
  }
}

function findCachedSearchRequest(disciplineId: string, query: string, since: Date) {
  return prisma.searchRequest.findFirst({
    where: {
      disciplineId,
      queryText: query,
      createdAt: { gte: since },
      status: { in: ["SUCCESS", "CACHED"] }
    },
    orderBy: { createdAt: "desc" },
    include: { results: { orderBy: { createdAt: "asc" } } }
  });
}

async function logSearchRouteRequest(data: {
  disciplineSlug: string;
  query: string;
  cacheHit: boolean;
  cacheLayer?: string | null;
  matchesCount?: number | null;
  errorClass?: string | null;
}) {
  await prisma.parserRequestLog.create({
    data: {
      source: "liquipedia",
      mode: "search",
      route: `/api/${data.disciplineSlug}/search-tournament`,
      disciplineSlug: data.disciplineSlug,
      queryHash: crypto.createHash("sha1").update(data.query).digest("hex"),
      errorClass: data.errorClass || null,
      cacheHit: data.cacheHit,
      cacheLayer: data.cacheLayer || null,
      matchesCount: data.matchesCount ?? null,
    },
  }).catch(() => {});
}
