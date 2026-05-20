import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/db";
import { getSearchCacheTtlMs } from "@/lib/config/env";
import { filterLiquipediaSearchResultsForQuery, searchTournamentPages } from "@/lib/liquipedia/client";
import { classifyParserError, emptyValidIfNoItems } from "@/lib/proxy/parserErrors";
import crypto from "crypto";

type DisciplineLoader = () => Promise<{ id: string; baseApiUrl: string | null }>;

export function createSearchTournamentPostRoute(config: {
  disciplineSlug: string;
  getDiscipline: DisciplineLoader;
  defaultApiUrl: string;
}) {
  return async function POST(req: Request) {
    const body = await req.json().catch(() => null);
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    const force = Boolean(body?.force);
    return handleSearchRequest(config, query, force);
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
    return handleSearchRequest(config, query, force);
  };
}

async function handleSearchRequest(config: {
  disciplineSlug: string;
  getDiscipline: DisciplineLoader;
  defaultApiUrl: string;
}, query: string, force: boolean) {
  try {
    if (query.length < 2) {
      return NextResponse.json({ error: "Введите минимум 2 символа", query, cacheHit: false, results: [] }, { status: 400 });
    }

    const discipline = await config.getDiscipline();
    const cacheSince = new Date(Date.now() - getSearchCacheTtlMs());
    const staleSince = new Date(Date.now() - 24 * 60 * 60 * 1000);
    let staleRequest: Awaited<ReturnType<typeof findCachedSearchRequest>> = null;

    if (!force) {
      const cachedRequest = await findCachedSearchRequest(discipline.id, query, cacheSince);
      staleRequest = cachedRequest || await findCachedSearchRequest(discipline.id, query, staleSince);

      if (cachedRequest) {
        const cachedResults = filterLiquipediaSearchResultsForQuery(query, cachedRequest.results);
        const cachedResultsCount = cachedResults.length;
        await prisma.searchRequest.create({
          data: {
            disciplineId: discipline.id,
            queryText: query,
            status: "CACHED",
            results: {
              create: cachedResults.map((result) => ({
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
        const staleResults = filterLiquipediaSearchResultsForQuery(query, staleRequest.results);
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
