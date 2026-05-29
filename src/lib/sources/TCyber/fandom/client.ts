import { getFandomLolApiUrl, getFandomUserAgent } from "@/lib/config/env";

export type FandomSearchResult = {
  pageId: number;
  title: string;
  pageUrl: string;
  snippet?: string | null;
  score?: number | null;
  wordCount?: number | null;
  dates?: string | null;
};

export type FandomParsedPage = {
  pageId?: number;
  title: string;
  pageUrl: string;
  revisionId?: number | null;
  raw: unknown;
  wikitext: string;
  html: string;
};

export class FandomRequestError extends Error {
  errorClass: string;
  statusCode?: number;

  constructor(message: string, errorClass: string, statusCode?: number) {
    super(message);
    this.name = "FandomRequestError";
    this.errorClass = errorClass;
    this.statusCode = statusCode;
  }
}

const DEFAULT_LIMIT = 10;
const FANDOM_EVENTS_FUTURE_WINDOW_DAYS = Number(process.env.FANDOM_EVENTS_FUTURE_WINDOW_DAYS || 60);

export async function searchFandomTournamentPages(
  query: string,
  apiUrl = getFandomLolApiUrl(),
): Promise<FandomSearchResult[]> {
  const json = await fandomApiRequest(apiUrl, {
    action: "query",
    list: "search",
    srnamespace: "0",
    srlimit: String(DEFAULT_LIMIT),
    srsearch: query,
    format: "json",
  });

  const results = Array.isArray(json?.query?.search) ? json.query.search : [];
  return results
    .filter((item: any) => isLikelyTournamentTitle(item?.title))
    .map((item: any) => ({
      pageId: Number(item.pageid),
      title: String(item.title || ""),
      pageUrl: makeFandomPageUrl(String(item.title || "")),
      snippet: typeof item.snippet === "string" ? item.snippet : null,
      score: typeof item.score === "number" ? item.score : null,
      wordCount: typeof item.wordcount === "number" ? item.wordcount : null,
      dates: inferDatesFromTitle(String(item.title || "")),
    }))
    .filter((item: FandomSearchResult) => item.title && Number.isFinite(item.pageId));
}

export async function fetchFandomParsedPage(input: {
  apiUrl?: string;
  title?: string;
  pageId?: number;
}): Promise<FandomParsedPage> {
  const params: Record<string, string> = {
    action: "parse",
    prop: "wikitext|text|displaytitle|revid",
    disablelimitreport: "1",
    format: "json",
  };

  if (input.pageId) params.pageid = String(input.pageId);
  else if (input.title) params.page = input.title;
  else throw new Error("Fandom page title or pageId is required");

  const raw = await fandomApiRequest(input.apiUrl ?? getFandomLolApiUrl(), params);
  const parsed = raw?.parse;
  if (!parsed?.title) {
    throw new FandomRequestError("Fandom parse response did not include a page", "parse_failed");
  }

  const title = String(parsed.title);
  return {
    pageId: typeof parsed.pageid === "number" ? parsed.pageid : input.pageId,
    title,
    pageUrl: makeFandomPageUrl(title),
    revisionId: typeof parsed.revid === "number" ? parsed.revid : null,
    raw,
    wikitext: String(parsed.wikitext?.["*"] || ""),
    html: String(parsed.text?.["*"] || ""),
  };
}

export async function fetchFandomTournamentCargoEvents(apiUrl = getFandomLolApiUrl()) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const futureLimit = new Date(now.getTime() + FANDOM_EVENTS_FUTURE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const json = await fandomApiRequest(apiUrl, {
    action: "cargoquery",
    tables: "Tournaments",
    fields: "Name,OverviewPage,DateStart,Date,Region,TournamentLevel",
    where: `DateStart >= '${today}' AND DateStart <= '${futureLimit}'`,
    order_by: "DateStart ASC",
    limit: "50",
    format: "json",
  });

  return Array.isArray(json?.cargoquery) ? json.cargoquery : [];
}

export async function fetchFandomMatchScheduleCargo(input: {
  apiUrl?: string;
  overviewPage: string;
  limit?: number;
}) {
  const overviewPage = input.overviewPage.trim();
  if (!overviewPage) return [];

  const apiUrl = input.apiUrl ?? getFandomLolApiUrl();
  const limit = input.limit ?? 500;
  const fields = [
    "MatchId",
    "Team1",
    "Team2",
    "Team1Final",
    "Team2Final",
    "Team1Score",
    "Team2Score",
    "Team1Points",
    "Team2Points",
    "BestOf",
    "DateTime_UTC",
    "HasTime",
    "OverviewPage",
    "Tab",
    "Round",
    "Phase",
    "ShownRound",
    "MatchDay",
    "Stream",
  ];

  try {
    return await fandomCargoExportRequest(apiUrl, {
      tables: "MatchSchedule",
      fields: fields.join(","),
      where: `OverviewPage="${escapeCargoValue(overviewPage)}"`,
      orderBy: "N_Page ASC,N_TabInPage ASC,N_MatchInTab ASC",
      limit,
    });
  } catch {
    // Fallback to the MediaWiki Cargo API for environments where CargoExport is blocked.
  }

  const json = await fandomApiRequest(apiUrl, {
    action: "cargoquery",
    tables: "MatchSchedule",
    fields: fields.join(","),
    where: `OverviewPage="${escapeCargoValue(overviewPage)}"`,
    order_by: "N_Page ASC,N_TabInPage ASC,N_MatchInTab ASC",
    limit: String(limit),
    format: "json",
  });

  return Array.isArray(json?.cargoquery) ? json.cargoquery : [];
}

export async function fandomApiRequest(apiUrl: string, params: Record<string, string>) {
  const url = new URL(apiUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString(), {
    headers: {
      "Accept": "application/json",
      "User-Agent": getFandomUserAgent(),
    },
    cache: "no-store",
  });

  const text = await response.text();
  if (!response.ok) {
    throw new FandomRequestError(
      `Fandom API request failed with ${response.status}`,
      classifyFandomStatus(response.status, text),
      response.status,
    );
  }

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new FandomRequestError("Fandom API returned non-JSON response", "non_json", response.status);
  }

  if (json?.error) {
    throw new FandomRequestError(
      String(json.error.info || json.error.code || "Fandom API error"),
      classifyFandomErrorCode(String(json.error.code || "")),
      response.status,
    );
  }

  return json;
}

async function fandomCargoExportRequest(apiUrl: string, input: {
  tables: string;
  fields: string;
  where: string;
  orderBy?: string;
  limit: number;
}) {
  const url = new URL("/wiki/Special:CargoExport", getFandomOrigin(apiUrl));
  url.searchParams.set("tables", input.tables);
  url.searchParams.set("fields", input.fields);
  url.searchParams.set("where", input.where);
  if (input.orderBy) url.searchParams.set("order by", input.orderBy);
  url.searchParams.set("limit", String(input.limit));
  url.searchParams.set("format", "json");

  const response = await fetch(url.toString(), {
    headers: {
      "Accept": "application/json,text/plain,*/*",
      "User-Agent": getFandomUserAgent(),
    },
    cache: "no-store",
  });

  const text = await response.text();
  if (!response.ok) {
    throw new FandomRequestError(
      `Fandom CargoExport request failed with ${response.status}`,
      classifyFandomStatus(response.status, text),
      response.status,
    );
  }

  try {
    const json = JSON.parse(text);
    return Array.isArray(json) ? json : [];
  } catch {
    throw new FandomRequestError("Fandom CargoExport returned non-JSON response", "non_json", response.status);
  }
}

export function makeFandomPageUrl(title: string) {
  return `https://lol.fandom.com/wiki/${encodeURIComponent(title.trim().replace(/ /g, "_")).replace(/%2F/g, "/")}`;
}

export function titleFromFandomUrl(pageUrl: string) {
  try {
    const parsed = new URL(pageUrl);
    const marker = "/wiki/";
    const markerIndex = parsed.pathname.indexOf(marker);
    if (markerIndex >= 0) {
      return decodeURIComponent(parsed.pathname.slice(markerIndex + marker.length)).replace(/_/g, " ");
    }
  } catch {
    // Fall back below.
  }

  return decodeURIComponent(pageUrl.split("/").filter(Boolean).slice(-1)[0] || "").replace(/_/g, " ");
}

export function classifyFandomError(error: unknown) {
  if (error instanceof FandomRequestError) return error.errorClass;
  const message = error instanceof Error ? error.message : String(error || "");
  if (/rate.?limit|ratelimited|too many/i.test(message)) return "rate_limited";
  if (/non-json|json/i.test(message)) return "non_json";
  if (/parse/i.test(message)) return "parse_failed";
  if (/network|fetch|timeout/i.test(message)) return "network_error";
  return "unknown";
}

function classifyFandomStatus(status: number, body: string) {
  if (status === 429 || /ratelimited/i.test(body)) return "rate_limited";
  if (status === 403) return "forbidden";
  if (status >= 500) return "upstream_error";
  return "http_error";
}

function classifyFandomErrorCode(code: string) {
  if (/ratelimited/i.test(code)) return "rate_limited";
  if (/missingtitle|invalidtitle/i.test(code)) return "not_found";
  return "api_error";
}

function escapeCargoValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function getFandomOrigin(apiUrl: string) {
  try {
    return new URL(apiUrl).origin;
  } catch {
    return "https://lol.fandom.com";
  }
}

function inferDatesFromTitle(title: string) {
  const year = title.match(/\b(20\d{2})\b/)?.[1];
  return year ?? null;
}

function isLikelyTournamentTitle(title: unknown) {
  const value = String(title || "");
  if (!value) return false;
  if (/^(team|file|template|category|user|help):/i.test(value)) return false;
  if (/\/match history|\/statistics|\/vods|\/roster/i.test(value)) return false;
  return true;
}
