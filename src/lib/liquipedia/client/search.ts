import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  ApiRequestOptions,
  LiquipediaSearchResult,
  PageApiResponse,
  SearchApiResponse,
  SearchPageMetadata,
} from "./types";
import { apiRequest, hashQuery } from "./network";
import { makeLiquipediaPageUrl } from "./fetching";

const LIQUIPEDIA_SEARCH_CANDIDATE_LIMIT = Number(process.env.LIQUIPEDIA_SEARCH_CANDIDATE_LIMIT || 20);
const LIQUIPEDIA_SEARCH_VARIATION_LIMIT = Number(process.env.LIQUIPEDIA_SEARCH_VARIATION_LIMIT || 5);
const LIQUIPEDIA_SEARCH_FULLTEXT_VARIATION_LIMIT = Number(process.env.LIQUIPEDIA_SEARCH_FULLTEXT_VARIATION_LIMIT || 2);
const LIQUIPEDIA_SEARCH_TIME_BUDGET_MS = Number(process.env.LIQUIPEDIA_SEARCH_TIME_BUDGET_MS || 45000);
const LIQUIPEDIA_SEARCH_API_TIMEOUT_MS = Number(process.env.LIQUIPEDIA_SEARCH_API_TIMEOUT_MS || 7000);
const LIQUIPEDIA_SEARCH_API_MAX_RETRIES = Number(process.env.LIQUIPEDIA_SEARCH_API_MAX_RETRIES || 0);
const LIQUIPEDIA_SEARCH_METADATA_TTL_MS = Number(process.env.LIQUIPEDIA_SEARCH_METADATA_TTL_SECONDS || 24 * 60 * 60) * 1000;
const LIQUIPEDIA_SEARCH_FUTURE_WINDOW_DAYS = Number(process.env.LIQUIPEDIA_SEARCH_FUTURE_WINDOW_DAYS || 30);
const LIQUIPEDIA_LOL_SEARCH_FUTURE_WINDOW_DAYS = Number(process.env.LIQUIPEDIA_LOL_SEARCH_FUTURE_WINDOW_DAYS || 180);
const SEARCH_PAGE_METADATA_VERSION = 3;

export async function searchTournamentPages(
  query: string,
  apiUrl: string,
  disciplineSlug: string,
  limit = 10
): Promise<LiquipediaSearchResult[]> {
  const currentYear = new Date().getFullYear();
  const variations = buildLiquipediaSearchVariations(query, currentYear).slice(0, LIQUIPEDIA_SEARCH_VARIATION_LIMIT);
  const startedAt = Date.now();
  const isBudgetExpired = () => Date.now() - startedAt > LIQUIPEDIA_SEARCH_TIME_BUDGET_MS;
  const searchRequestOptions: ApiRequestOptions = {
    timeoutMs: LIQUIPEDIA_SEARCH_API_TIMEOUT_MS,
    maxRetries: LIQUIPEDIA_SEARCH_API_MAX_RETRIES,
    mode: "search",
  };
  const futureWindowDays = disciplineSlug === "leagueoflegends"
    ? LIQUIPEDIA_LOL_SEARCH_FUTURE_WINDOW_DAYS
    : LIQUIPEDIA_SEARCH_FUTURE_WINDOW_DAYS;

  const allTitlesSet = new Set<string>();
  const titleToUrl = new Map<string, string>();
  let successfulSearchRequests = 0;
  let lastSearchError: unknown = null;

  for (const v of variations) {
    if (isBudgetExpired()) {
      console.warn(`[Liquipedia Search] Time budget reached for "${query}" before variation "${v}".`);
      break;
    }

    try {
      const openResponse = await apiRequest<SearchApiResponse>(apiUrl, {
        action: "opensearch",
        format: "json",
        search: v,
        limit: "20"
      }, false, 0, searchRequestOptions);
      successfulSearchRequests += 1;
      const openTitles = openResponse[1] ?? [];
      const openUrls = openResponse[3] ?? [];
      openTitles.forEach((t, i) => {
        allTitlesSet.add(t);
        if (openUrls[i]) titleToUrl.set(t, openUrls[i]);
      });

      if (allTitlesSet.size >= LIQUIPEDIA_SEARCH_CANDIDATE_LIMIT) {
        break;
      }
    } catch (err) {
      lastSearchError = err;
      console.error(`Search variation "${v}" failed:`, err);
    }
  }

  const relevantOpenTitles = Array.from(allTitlesSet).filter((title) => isLiquipediaSearchTitleRelevant(query, title));
  if (relevantOpenTitles.length === 0 && allTitlesSet.size < LIQUIPEDIA_SEARCH_CANDIDATE_LIMIT) {
    for (const v of variations.slice(0, LIQUIPEDIA_SEARCH_FULLTEXT_VARIATION_LIMIT)) {
      if (isBudgetExpired()) {
        console.warn(`[Liquipedia Search] Time budget reached for "${query}" before full-text variation "${v}".`);
        break;
      }

      try {
        const searchResponse = await apiRequest<{ query?: { search?: Array<{ title: string }> } }>(apiUrl, {
          action: "query",
          list: "search",
          srsearch: v,
          srlimit: "20",
          format: "json"
        }, false, 0, searchRequestOptions);
        successfulSearchRequests += 1;
        const searchTitles = searchResponse.query?.search?.map(s => s.title) ?? [];
        searchTitles.forEach(t => allTitlesSet.add(t));
      } catch (err) {
        lastSearchError = err;
        console.error(`Full-text search variation "${v}" failed:`, err);
      }
    }
  }

  if (allTitlesSet.size === 0 && successfulSearchRequests === 0 && lastSearchError) {
    throw lastSearchError;
  }

  const allTitles = Array.from(allTitlesSet)
    .filter((title) => isLiquipediaSearchTitleRelevant(query, title))
    .slice(0, LIQUIPEDIA_SEARCH_CANDIDATE_LIMIT);
  if (allTitles.length > 0) {
    try {
      const chunkSize = 40;
      const pages: any[] = [];
      const titlesToFetch: string[] = [];
      const normalizedMap = new Map<string, string>();
      const redirectsMap = new Map<string, string>();
      const activeResults = new Map<string, { title: string, pageId: number, pageUrl: string, dates: string | null }>();

      for (const title of allTitles) {
        const metadata = getCachedSearchPageMetadata(disciplineSlug, title);
        if (metadata) {
          if (metadata.isTournament) {
            activeResults.set(title, {
              title: metadata.title,
              pageId: metadata.pageId,
              pageUrl: metadata.pageUrl,
              dates: metadata.dates,
            });
          }
        } else {
          titlesToFetch.push(title);
        }
      }

      for (let i = 0; i < titlesToFetch.length; i += chunkSize) {
        if (isBudgetExpired()) {
          console.warn(`[Liquipedia Search] Time budget reached for "${query}" before metadata chunk.`);
          break;
        }

        const chunk = titlesToFetch.slice(i, i + chunkSize);
        const infoResponse = await apiRequest<PageApiResponse>(apiUrl, {
          action: "query",
          format: "json",
          formatversion: "2",
          prop: "revisions",
          rvprop: "content",
          rvslots: "main",
          titles: chunk.join("|"),
          redirects: "1"
        }, false, 0, searchRequestOptions);
        if (infoResponse.query?.pages) pages.push(...infoResponse.query.pages);
        if (infoResponse.query?.normalized) {
          infoResponse.query.normalized.forEach(n => normalizedMap.set(n.to, n.from));
        }
        if (infoResponse.query?.redirects) {
          infoResponse.query.redirects.forEach(r => redirectsMap.set(r.to, r.from));
        }
      }
      const now = Date.now();
      const pastLimit = now - 30 * 24 * 60 * 60 * 1000;
      const futureLimit = now + futureWindowDays * 24 * 60 * 60 * 1000;
      
      const cleanDate = (val: string) => {
        const rawDateMatch = val.match(/\b(\d{4}-\d{2}-\d{2})\b/);
        if (rawDateMatch) return rawDateMatch[1];

        let cleaned = val
          .replace(/\{\{[^}]*\}\}/g, '')
          .replace(/\[\[[^\]]*\]\]/g, '')
          .replace(/<[^>]*>/g, '')
          .replace(/\}\}.*$/s, '')
          .trim();
        const dateMatch = cleaned.match(/(\d{4}-\d{2}-\d{2})/);
        return dateMatch ? dateMatch[1] : cleaned;
      };

      for (const p of pages) {
        const wikitext = p.revisions?.[0]?.slots?.main?.content;
        if (!wikitext) continue;

        const isTournament = /\{\{\s*(?:Infobox\s+league|Infobox\s+tournament|LeagueInfobox|TournamentInfobox)/i.test(wikitext);
        if (!isTournament) {
          setCachedSearchPageMetadata(disciplineSlug, p.title, {
            pageId: p.pageid ?? 0,
            title: p.title,
            pageUrl: titleToUrl.get(p.title) ?? makeLiquipediaPageUrl(p.title, disciplineSlug),
            isTournament: false,
            dates: null,
            version: SEARCH_PAGE_METADATA_VERSION,
            fetchedAt: Date.now(),
          });
          continue;
        }

        const enddateRaw = wikitext.match(/\|\s*(?:edate|enddate|end_date|date2|date_end)\s*=\s*([^|\n]*(?:\{\{[^}]*\}\}[^|\n]*)*)/i)?.[1]?.trim();
        const startdateRaw = wikitext.match(/\|\s*(?:sdate|startdate|start_date|date1|date_start)\s*=\s*([^|\n]*(?:\{\{[^}]*\}\}[^|\n]*)*)/i)?.[1]?.trim();
        
        const enddateMatch = enddateRaw ? cleanDate(enddateRaw) : null;
        const startdateMatch = startdateRaw ? cleanDate(startdateRaw) : null;

        let shouldHide = false;
        
        if (enddateMatch) {
          const endDate = new Date(enddateMatch);
          if (!isNaN(endDate.getTime()) && endDate.getTime() < pastLimit) {
            shouldHide = true;
          }
        } 
        else if (startdateMatch) {
          const startDate = new Date(startdateMatch);
          if (!isNaN(startDate.getTime()) && startDate.getTime() < pastLimit) {
            shouldHide = true;
          }
        }

        if (startdateMatch && !shouldHide) {
          const startDate = new Date(startdateMatch);
          if (!isNaN(startDate.getTime()) && startDate.getTime() > futureLimit) {
            shouldHide = true;
          }
        }

        let datesStr = null;
        if (startdateMatch || enddateMatch) {
          datesStr = [startdateMatch, enddateMatch].filter(Boolean).join(" — ");
        }

        if (!shouldHide || queryHasExplicitYear(query)) {
          const pageUrl = titleToUrl.get(p.title) ?? makeLiquipediaPageUrl(p.title, disciplineSlug);
          activeResults.set(p.title, { title: p.title, pageId: p.pageid ?? 0, pageUrl, dates: datesStr });
          setCachedSearchPageMetadata(disciplineSlug, p.title, {
            pageId: p.pageid ?? 0,
            title: p.title,
            pageUrl,
            isTournament: true,
            dates: datesStr,
            version: SEARCH_PAGE_METADATA_VERSION,
            fetchedAt: Date.now(),
          });
        } else {
          setCachedSearchPageMetadata(disciplineSlug, p.title, {
            pageId: p.pageid ?? 0,
            title: p.title,
            pageUrl: titleToUrl.get(p.title) ?? makeLiquipediaPageUrl(p.title, disciplineSlug),
            isTournament: true,
            dates: datesStr,
            version: SEARCH_PAGE_METADATA_VERSION,
            fetchedAt: Date.now(),
          });
        }
      }

      for (const [to, from] of normalizedMap) {
        const info = activeResults.get(to);
        if (info) activeResults.set(from, info);
      }
      for (const [to, from] of redirectsMap) {
        const info = activeResults.get(to);
        if (info) activeResults.set(from, info);
      }

      const results: LiquipediaSearchResult[] = [];
      const yearRegex = new RegExp(`${currentYear}|${currentYear + 1}`);

      for (let i = 0; i < allTitles.length; i++) {
        const title = allTitles[i];
        const titleSpace = title.replace(/_/g, " ");
        const activeInfo = activeResults.get(titleSpace) || activeResults.get(title);
        
        if (activeInfo) {
          let score = allTitles.length - i;
          if (yearRegex.test(title)) score += 1000;

        if (!shouldShowLiquipediaSearchResult(query, title, activeInfo.dates, currentYear, { futureWindowDays })) {
          continue;
        }

          results.push({
            pageId: activeInfo.pageId,
            title: title,
            pageUrl: titleToUrl.get(title) ?? activeInfo.pageUrl ?? makeLiquipediaPageUrl(title, disciplineSlug),
            snippet: "",
            score: score,
            wordCount: null,
            dates: activeInfo.dates
          });
        }
      }

      results.sort((a, b) => (b.score || 0) - (a.score || 0));

      if (results.length > 0) {
        return results.slice(0, limit);
      }

      if (!queryHasExplicitYear(query)) {
        return [];
      }

      const fallbackResults = pages
        .filter((p) => {
          const wikitext = p.revisions?.[0]?.slots?.main?.content;
          return wikitext
            && /\{\{\s*(?:Infobox\s+league|Infobox\s+tournament|LeagueInfobox|TournamentInfobox)/i.test(wikitext)
            && isLiquipediaSearchTitleRelevant(query, p.title);
        })
        .slice(0, limit)
        .map((p, index) => ({
          pageId: p.pageid ?? 0,
          title: p.title,
          pageUrl: titleToUrl.get(p.title) ?? makeLiquipediaPageUrl(p.title, disciplineSlug),
          snippet: "",
          score: allTitles.length - index,
          wordCount: null,
          dates: null,
        }));

      return fallbackResults;
    } catch (err) {
      console.error("Failed to filter search results:", err);
      throw err;
    }
  }

  return [];
}

export function getCachedSearchPageMetadata(disciplineSlug: string, title: string): SearchPageMetadata | null {
  try {
    const cachePath = getSearchPageMetadataPath(disciplineSlug, title);
    if (!fs.existsSync(cachePath)) return null;

    const metadata = JSON.parse(fs.readFileSync(cachePath, "utf8")) as SearchPageMetadata;
    if (metadata.version !== SEARCH_PAGE_METADATA_VERSION) {
      return null;
    }
    if (!metadata?.fetchedAt || Date.now() - metadata.fetchedAt > LIQUIPEDIA_SEARCH_METADATA_TTL_MS) {
      return null;
    }

    return metadata;
  } catch {
    return null;
  }
}

export function buildLiquipediaSearchVariations(query: string, currentYear = new Date().getFullYear()) {
  const cleanQuery = query.trim().replace(/\s+/g, " ");
  const variations = new Set<string>([cleanQuery]);

  if (cleanQuery.includes(" ")) {
    variations.add(cleanQuery.replace(/ /g, "/"));
    variations.add(cleanQuery.replace(/\s+/g, ""));
  }

  addYearPathVariations(cleanQuery, variations);

  const leagueExpanded = expandTrailingLeagueAbbreviation(cleanQuery);
  if (leagueExpanded) {
    variations.add(leagueExpanded.withSpace);
    variations.add(leagueExpanded.compact);
  }

  const baseVariations = Array.from(variations);
  if (cleanQuery.length >= 3 && !queryHasExplicitYear(cleanQuery)) {
    for (const value of baseVariations) {
      variations.add(`${value} ${currentYear}`);
      variations.add(`${value} ${currentYear + 1}`);
    }
  }

  return Array.from(variations).filter(Boolean);
}

function addYearPathVariations(query: string, variations: Set<string>) {
  const match = query.match(/\b(19\d{2}|20\d{2})\b/);
  if (!match || match.index === undefined) return;

  const year = match[1];
  const beforeYear = query.slice(0, match.index).trim();
  const afterYear = query.slice(match.index + year.length).trim();
  if (!beforeYear) return;

  if (afterYear) {
    variations.add(`${beforeYear}/${year}/${afterYear.replace(/\s+/g, "/")}`);
  } else {
    variations.add(`${beforeYear}/${year}`);
  }

  const beforeParts = beforeYear.split(/\s+/).filter(Boolean);
  if (beforeParts.length > 1) {
    const [seriesRoot, ...eventParts] = beforeParts;
    const tail = [...eventParts, ...afterYear.split(/\s+/).filter(Boolean)].join("/");
    if (tail) {
      variations.add(`${seriesRoot}/${year}/${tail}`);
    }
  }
}

export function filterLiquipediaSearchResultsForQuery<T extends { title: string; dates?: string | null }>(
  query: string,
  results: T[],
  currentYear = new Date().getFullYear(),
  options: { futureWindowDays?: number } = {}
) {
  return results.filter((result) =>
    isLiquipediaSearchValueRelevant(query, result.title, result.dates ?? null)
    && shouldShowLiquipediaSearchResult(query, result.title, result.dates ?? null, currentYear, options)
  );
}

export function isLiquipediaSearchTitleRelevant(query: string, title: string) {
  const tokens = getMeaningfulSearchTokens(query, { includeYears: false });
  if (tokens.length === 0) return true;

  const normalizedTitle = normalizeSearchText(title);
  const compactTitle = normalizedTitle.replace(/\s+/g, "");
  return tokens.every((token) => normalizedTitle.includes(token) || compactTitle.includes(token));
}

export function isLiquipediaSearchValueRelevant(query: string, title: string, dates: string | null | undefined) {
  if (!isLiquipediaSearchTitleRelevant(query, title)) return false;

  const explicitYears = getExplicitSearchYears(query);
  if (explicitYears.length === 0) return true;

  const normalizedValue = normalizeSearchText(`${title} ${dates || ""}`);
  return explicitYears.every((year) => normalizedValue.includes(String(year)));
}

export function shouldShowLiquipediaSearchResult(
  query: string,
  title: string,
  dates: string | null | undefined,
  currentYear: number,
  options: { futureWindowDays?: number } = {}
) {
  if (queryHasExplicitYear(query)) {
    return isLiquipediaSearchValueRelevant(query, title, dates);
  }

  const titleYears = Array.from(title.matchAll(/\b(19\d{2}|20\d{2})\b/g)).map((match) => Number(match[1]));
  if (titleYears.some((year) => year < currentYear)) return false;

  if (!dates) return true;

  const resultYears = Array.from(dates.matchAll(/\b(19\d{2}|20\d{2})\b/g)).map((match) => Number(match[1]));
  if (resultYears.some((year) => year < currentYear)) return false;

  const firstDate = dates.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  if (firstDate) {
    const startDate = new Date(firstDate);
    const futureWindowDays = options.futureWindowDays ?? LIQUIPEDIA_SEARCH_FUTURE_WINDOW_DAYS;
    const futureLimit = Date.now() + futureWindowDays * 24 * 60 * 60 * 1000;
    if (!Number.isNaN(startDate.getTime()) && startDate.getTime() > futureLimit) return false;
  }

  return true;
}

export function getMeaningfulSearchTokens(query: string, options: { includeYears?: boolean } = {}) {
  return normalizeSearchText(expandTrailingLeagueAbbreviation(query)?.withSpace ?? query)
    .split(" ")
    .filter((token) => token.length >= 2)
    .filter((token) => options.includeYears || !/^(19\d{2}|20\d{2})$/.test(token));
}

export function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function queryHasExplicitYear(query: string) {
  return /\b(19\d{2}|20\d{2})\b/.test(query);
}

export function getExplicitSearchYears(query: string) {
  return Array.from(query.matchAll(/\b(19\d{2}|20\d{2})\b/g)).map((match) => Number(match[1]));
}

export function expandTrailingLeagueAbbreviation(query: string) {
  const match = query.trim().match(/^(.+?)\s+l$/i);
  if (!match) return null;

  const prefix = match[1].trim();
  if (!prefix) return null;
  return {
    withSpace: `${prefix} League`,
    compact: `${prefix}League`,
  };
}

export function setCachedSearchPageMetadata(disciplineSlug: string, title: string, metadata: SearchPageMetadata) {
  try {
    const cachePath = getSearchPageMetadataPath(disciplineSlug, title);
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(metadata));
  } catch {}
}

export function clearCachedSearchPageMetadata(disciplineSlug: string, title: string) {
  try {
    const cachePath = getSearchPageMetadataPath(disciplineSlug, title);
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
      return 1;
    }
  } catch {}

  return 0;
}

export function getSearchPageMetadataPath(disciplineSlug: string, title: string) {
  const key = crypto.createHash("sha1").update(`${disciplineSlug}:${title}`).digest("hex");
  return path.join(process.cwd(), "cache", "liquipedia", "page-meta", `${key}.json`);
}
