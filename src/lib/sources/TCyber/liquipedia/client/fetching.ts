import {
  ApiRequestOptions,
  LiquipediaPageContent,
  LiquipediaPageRevision,
  PageApiResponse,
} from "./types";
import { apiRequest } from "./network";

const LIQUIPEDIA_IMPORT_API_TIMEOUT_MS = Number(process.env.LIQUIPEDIA_IMPORT_API_TIMEOUT_MS || 12000);
const LIQUIPEDIA_IMPORT_API_MAX_RETRIES = Number(process.env.LIQUIPEDIA_IMPORT_API_MAX_RETRIES || 0);

export function getLiquipediaImportRequestOptions(): ApiRequestOptions {
  return {
    timeoutMs: LIQUIPEDIA_IMPORT_API_TIMEOUT_MS,
    maxRetries: LIQUIPEDIA_IMPORT_API_MAX_RETRIES,
    mode: "import",
  };
}

export async function fetchPagesWikitext(
  apiUrl: string,
  disciplineSlug: string,
  titles: string[],
  options: ApiRequestOptions = {}
): Promise<LiquipediaPageContent[]> {
  if (titles.length === 0) return [];
  
  const chunkSize = 50;
  const results: LiquipediaPageContent[] = [];

  for (let i = 0; i < titles.length; i += chunkSize) {
    const chunk = titles.slice(i, i + chunkSize);
    const params: Record<string, string> = {
      action: "query",
      format: "json",
      formatversion: "2",
      prop: "info|revisions",
      inprop: "url",
      rvprop: "content|timestamp|ids",
      rvslots: "main",
      redirects: "1",
      titles: chunk.join("|")
    };

    const response = await apiRequest<PageApiResponse>(apiUrl, params, false, 0, options);
    const pages = response.query?.pages ?? [];

    for (const page of pages) {
      if (!page || page.missing) continue;
      const revision = page.revisions?.[0];
      const wikitext = revision?.slots?.main?.content ?? revision?.slots?.main?.["*"] ?? revision?.["*"] ?? "";
      if (!wikitext) continue;

      results.push({
        pageId: page.pageid,
        title: page.title,
        fullUrl: page.fullurl ?? makeLiquipediaPageUrl(page.title, disciplineSlug),
        wikitext,
        raw: response
      });
    }
  }

  return results;
}

export async function fetchPageWikitext(
  apiUrl: string,
  disciplineSlug: string,
  input: { pageId?: number; title?: string },
  options: ApiRequestOptions = {}
): Promise<LiquipediaPageContent> {
  const pages = await fetchPagesWikitext(apiUrl, disciplineSlug, input.title ? [input.title] : [], options);
  if (pages.length > 0) return pages[0];
  
  if (input.pageId) {
    const params: Record<string, string> = {
      action: "query",
      format: "json",
      formatversion: "2",
      prop: "info|revisions",
      inprop: "url",
      rvprop: "content|timestamp|ids",
      rvslots: "main",
      redirects: "1",
      pageids: String(input.pageId)
    };
    const response = await apiRequest<PageApiResponse>(apiUrl, params, false, 0, options);
    const page = response.query?.pages?.[0];
    if (!page || page.missing) throw new Error("Liquipedia page not found");
    const revision = page.revisions?.[0];
    return {
      pageId: page.pageid,
      title: page.title,
      fullUrl: page.fullurl ?? makeLiquipediaPageUrl(page.title, disciplineSlug),
      wikitext: revision?.slots?.main?.content ?? revision?.slots?.main?.["*"] ?? revision?.["*"] ?? "",
      raw: response
    };
  }

  throw new Error("Liquipedia page not found");
}

export async function fetchPageRevision(
  apiUrl: string,
  disciplineSlug: string,
  input: { pageId?: number; title?: string },
  options: ApiRequestOptions = {}
): Promise<LiquipediaPageRevision> {
  const params: Record<string, string> = {
    action: "query",
    format: "json",
    formatversion: "2",
    prop: "info|revisions",
    inprop: "url",
    rvprop: "timestamp|ids",
    redirects: "1",
  };

  if (input.pageId) {
    params.pageids = String(input.pageId);
  } else if (input.title) {
    params.titles = input.title;
  } else {
    throw new Error("Liquipedia page not found");
  }

  const response = await apiRequest<PageApiResponse>(apiUrl, params, false, 0, options);
  const page = response.query?.pages?.[0];
  if (!page || page.missing) throw new Error("Liquipedia page not found");

  const revision = page.revisions?.[0];
  const revisionTimestamp = revision?.timestamp ? new Date(revision.timestamp) : null;

  return {
    pageId: page.pageid,
    title: page.title,
    fullUrl: page.fullurl ?? makeLiquipediaPageUrl(page.title, disciplineSlug),
    revisionId: typeof revision?.revid === "number" ? revision.revid : null,
    revisionTimestamp: revisionTimestamp && Number.isFinite(revisionTimestamp.getTime()) ? revisionTimestamp : null,
    raw: response,
  };
}

export function makeLiquipediaPageUrl(title: string, disciplineSlug: string) {
  const normalized = title.trim().replace(/ /g, "_");
  return `https://liquipedia.net/${disciplineSlug}/${encodeURIComponent(normalized).replace(/%2F/g, "/")}`;
}

export async function fetchPageParsed(apiUrl: string, title: string, options: ApiRequestOptions = {}): Promise<string> {
  const response = await apiRequest<{ parse?: { text?: { "*"?: string } } }>(
    apiUrl,
    {
      action: "parse",
      format: "json",
      page: title,
      prop: "text",
      disabletoc: "1",
      redirects: "1"
    },
    true,
    0,
    options
  );

  return response.parse?.text?.["*"] ?? "";
}

export function stripHtml(value: string) {
  return value
    .replace(/<span class=\"searchmatch\">/g, "")
    .replace(/<\/span>/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .trim();
}
