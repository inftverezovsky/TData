import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import { formatMoscowDate, formatMoscowDateTime } from "@/lib/matches/scheduleOffset";
import { normalizeBeachVolleyballGender, type BeachVolleyballGender } from "@/lib/sources/tbvolley/config";

export type FedervolleyGender = BeachVolleyballGender;
export type FedervolleyCategory = "all" | "assoluto" | "serie";
export type FedervolleyMatchStatus = "upcoming" | "finished";

export type FedervolleyTeam = {
  id: string;
  name: string;
  rawName: string;
  seed: string;
};

export type FedervolleyMatch = {
  id: string;
  nodeId: string;
  matchshareLid: string;
  gender: FedervolleyGender;
  category: Exclude<FedervolleyCategory, "all">;
  stage: string;
  round: string;
  court: string;
  startTimeUtc: string | null;
  startTimeMoscow: string;
  dateKey: string;
  status: FedervolleyMatchStatus;
  teamA: FedervolleyTeam;
  teamB: FedervolleyTeam;
  score: {
    teamA: number | null;
    teamB: number | null;
    sets: Array<{ no: number; teamA: number; teamB: number }>;
  };
  sourceUrl: string;
  rawText: string;
};

export type FedervolleyTournament = {
  id: string;
  nodeId: string;
  matchshareLid: string;
  title: string;
  sourceTitle: string;
  pageUrl: string;
  gender: FedervolleyGender;
  category: Exclude<FedervolleyCategory, "all">;
  categoryLabel: string;
  code: string;
  region: string;
  city: string;
  location: string;
  venue: string;
  dates: string;
  startDate: string | null;
  endDate: string | null;
  status: "finished" | "ongoing" | "upcoming";
  prizePool: string;
  bracketType: string;
  teams: number | null;
  matches?: FedervolleyMatch[];
  matchCount?: number;
};

export type FedervolleyTournamentSearch = {
  ok: true;
  source: "federvolley";
  sourceUrl: string;
  year: number;
  category: FedervolleyCategory;
  gender: FedervolleyGender;
  query: string;
  tournaments: FedervolleyTournament[];
  summary: {
    total: number;
    assoluto: number;
    serie: number;
    matches: number;
  };
};

type MatchshareBracketEntry = {
  init?: {
    teams?: unknown;
    results?: unknown;
  };
  numero?: unknown;
  info?: unknown;
  info2?: unknown;
  tipo?: unknown;
  teams?: unknown;
};

type MatchshareTeamRef = {
  name?: unknown;
  id?: unknown;
  score?: unknown;
};

const FEDERVOLLEY_ORIGIN = "https://beachvolley.federvolley.it";
const MATCHSHARE_ORIGIN = "https://srv.matchshare.it";
const MATCHSHARE_CLIENT_NAME = "bvl_development";
const FEDERVOLLEY_USER_AGENT = "TData TBvolley/1.0 (+https://beachvolley.federvolley.it)";

const CATEGORY_LISTING_PATHS: Record<Exclude<FedervolleyCategory, "all">, string> = {
  assoluto: "/index.php/campionato-assoluto/tornei/precedenti",
  serie: "/index.php/serie-beach/tornei/precedenti",
};

const CATEGORY_LABELS: Record<Exclude<FedervolleyCategory, "all">, string> = {
  assoluto: "Campionato Assoluto",
  serie: "Serie Beach",
};

const MONTHS_IT: Record<string, string> = {
  gen: "01",
  gennaio: "01",
  feb: "02",
  febbraio: "02",
  mar: "03",
  marzo: "03",
  apr: "04",
  aprile: "04",
  mag: "05",
  maggio: "05",
  giu: "06",
  giugno: "06",
  lug: "07",
  luglio: "07",
  ago: "08",
  agosto: "08",
  set: "09",
  settembre: "09",
  ott: "10",
  ottobre: "10",
  nov: "11",
  novembre: "11",
  dic: "12",
  dicembre: "12",
};

export function normalizeFedervolleyGender(value: unknown): FedervolleyGender {
  const normalized = normalizeSearch(String(value ?? ""));
  if (normalized.includes("femminile") || normalized.includes("female") || normalized.includes("women")) return "women";
  if (normalized.includes("maschile") || normalized.includes("male") || normalized.includes("men")) return "men";
  return normalizeBeachVolleyballGender(value) || "men";
}

export function normalizeFedervolleyCategory(value: unknown): FedervolleyCategory {
  const normalized = normalizeSearch(String(value ?? ""));
  if (normalized.includes("serie")) return "serie";
  if (normalized.includes("assoluto") || normalized.includes("campionato italiano")) return "assoluto";
  return "all";
}

export function getDefaultFedervolleyYear() {
  const value = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Moscow",
    year: "numeric",
  }).format(new Date());
  const year = Number(value);
  return Number.isFinite(year) ? year : new Date().getUTCFullYear();
}

export async function searchFedervolleyTournaments(input: {
  year?: string | number | null;
  gender?: string | null;
  category?: string | null;
  query?: string | null;
} = {}): Promise<FedervolleyTournamentSearch> {
  const year = normalizeYear(input.year);
  const gender = normalizeFedervolleyGender(input.gender);
  const category = normalizeFedervolleyCategory(input.category);
  const query = normalizeSearch(input.query || "");
  const categories = category === "all"
    ? (["assoluto", "serie"] as const)
    : ([category] as Array<Exclude<FedervolleyCategory, "all">>);

  const listings = await Promise.all(categories.map(async (item) => {
    const sourceUrl = buildListingUrl(item);
    const html = await fetchFedervolleyText(sourceUrl, "text/html,application/xhtml+xml");
    return parseFedervolleyListing(html, { category: item, gender, year, query });
  }));
  const tournaments = filterFedervolleyUpcomingTournaments(
    listings.flat().sort(compareFedervolleyTournaments),
  );

  return {
    ok: true,
    source: "federvolley",
    sourceUrl: category === "all" ? FEDERVOLLEY_ORIGIN : buildListingUrl(category),
    year,
    category,
    gender,
    query,
    tournaments,
    summary: {
      total: tournaments.length,
      assoluto: tournaments.filter((tournament) => tournament.category === "assoluto").length,
      serie: tournaments.filter((tournament) => tournament.category === "serie").length,
      matches: tournaments.reduce((sum, tournament) => sum + (tournament.matchCount || 0), 0),
    },
  };
}

export async function fetchFedervolleyTournament(input: {
  federvolleyNodeId?: string | number | null;
  matchshareLid?: string | number | null;
  category?: string | null;
  title?: string | null;
  pageUrl?: string | null;
  gender?: string | null;
}): Promise<FedervolleyTournament> {
  const nodeId = clean(input.federvolleyNodeId)
    || extractFedervolleyNodeId(input.pageUrl)
    || extractFedervolleyNodeId(input.title);
  if (!nodeId) throw new Error("Не удалось определить Federvolley node id");

  const pageUrl = buildTournamentPageUrl(nodeId);
  const html = await fetchFedervolleyText(pageUrl, "text/html,application/xhtml+xml");
  const detail = parseFedervolleyTournamentPage(html, {
    nodeId,
    requestedTitle: input.title || "",
    pageUrl,
    gender: input.gender,
    category: input.category,
    matchshareLid: clean(input.matchshareLid),
  });

  const matches = detail.matchshareLid
    ? await fetchFedervolleyMatches({
        matchshareLid: detail.matchshareLid,
        nodeId: detail.nodeId,
        gender: detail.gender,
        category: detail.category,
        pageUrl: detail.pageUrl,
        startDate: detail.startDate,
        endDate: detail.endDate,
      })
    : [];

  return {
    ...detail,
    matches,
    matchCount: matches.length,
    status: matches.some((match) => match.status === "upcoming")
      ? "upcoming"
      : resolveTournamentStatus(detail.startDate, detail.endDate),
  };
}

export function parseFedervolleyListing(
  html: string,
  options: {
    category: Exclude<FedervolleyCategory, "all">;
    gender: FedervolleyGender;
    year: number;
    query?: string;
  },
): FedervolleyTournament[] {
  const $ = cheerio.load(html);
  const tournaments: FedervolleyTournament[] = [];

  $("div[class*=\"torneitable-summary-row-\"]").each((_, element) => {
    const $row = $(element);
    const nodeId = extractFedervolleyNodeId($row.find('a[href*="/node/"]').first().attr("href"));
    if (!nodeId) return;

    const columns = readListingColumns($, $row);
    const title = clean(columns.title) || `${CATEGORY_LABELS[options.category]} ${nodeId}`;
    const gender = normalizeFedervolleyGender(columns.gender);
    if (gender !== options.gender) return;

    const startDate = parseCompactItalianDate(columns.startMonth, columns.startDay, columns.startYear);
    const endDate = parseCompactItalianDate(columns.endMonth, columns.endDay, columns.endYear);
    if (yearFromIso(startDate || endDate) !== options.year) return;

    const city = clean(columns.city);
    const region = clean(columns.region);
    const pageUrl = buildTournamentPageUrl(nodeId);
    const tournament: FedervolleyTournament = {
      id: nodeId,
      nodeId,
      matchshareLid: "",
      title,
      sourceTitle: buildFedervolleySourceTitle(title, gender, options.category, nodeId, ""),
      pageUrl,
      gender,
      category: options.category,
      categoryLabel: CATEGORY_LABELS[options.category],
      code: clean(columns.code),
      region,
      city,
      location: [city, region].filter(Boolean).join(", "),
      venue: city,
      dates: formatDateRangeLabel(startDate, endDate),
      startDate,
      endDate,
      status: resolveTournamentStatus(startDate, endDate),
      prizePool: clean(columns.prizePool),
      bracketType: "",
      teams: null,
    };

    if (options.query && !normalizeSearch([
      tournament.title,
      tournament.code,
      tournament.city,
      tournament.region,
      tournament.categoryLabel,
      tournament.dates,
      tournament.nodeId,
    ].join(" ")).includes(options.query)) {
      return;
    }

    tournaments.push(tournament);
  });

  return tournaments.sort(compareFedervolleyTournaments);
}

export function parseFedervolleyTournamentPage(
  html: string,
  options: {
    nodeId: string;
    requestedTitle?: string | null;
    pageUrl: string;
    gender?: string | null;
    category?: string | null;
    matchshareLid?: string | null;
  },
): FedervolleyTournament {
  const $ = cheerio.load(html);
  const title = clean($(".field--name-title").first().text())
    || stripSourceTitleMetadata(options.requestedTitle || "")
    || `Federvolley ${options.nodeId}`;
  const gender = normalizeFedervolleyGender(
    clean(options.gender)
      || $(".field--name-field-sesso-torneo").first().text()
      || options.requestedTitle
      || options.pageUrl,
  );
  const category = normalizeDetailCategory(clean(options.category) || title || options.pageUrl);
  const startDate = parseDrupalDateField($, "field--name-field-data-inizio");
  const endDate = parseDrupalDateField($, "field--name-field-data-fine");
  const matchshareLid = clean(options.matchshareLid)
    || extractMatchshareLid(html)
    || extractMatchshareLid(options.pageUrl)
    || extractMatchshareLid(options.requestedTitle);
  const cityRegion = inferCityRegion(title);
  const prizePool = clean($(".field--name-field-montepremi").first().text());
  const bracketType = clean($(".field--name-field-tipo-tabellone").first().text());
  const teams = toNullableNumber($(".field--name-field-numero-squadre").first().text());

  return {
    id: options.nodeId,
    nodeId: options.nodeId,
    matchshareLid,
    title,
    sourceTitle: buildFedervolleySourceTitle(title, gender, category, options.nodeId, matchshareLid),
    pageUrl: options.pageUrl,
    gender,
    category,
    categoryLabel: CATEGORY_LABELS[category],
    code: "",
    region: cityRegion.region,
    city: cityRegion.city,
    location: [cityRegion.city, cityRegion.region].filter(Boolean).join(", "),
    venue: cityRegion.city,
    dates: formatDateRangeLabel(startDate, endDate),
    startDate,
    endDate,
    status: resolveTournamentStatus(startDate, endDate),
    prizePool,
    bracketType,
    teams,
    matches: [],
    matchCount: 0,
  };
}

export function parseFedervolleyMatchshareBracket(
  payload: unknown,
  options: {
    nodeId: string;
    matchshareLid: string;
    gender: FedervolleyGender;
    category: Exclude<FedervolleyCategory, "all">;
    pageUrl: string;
    startDate?: string | null;
    endDate?: string | null;
  },
): FedervolleyMatch[] {
  const entries = flattenMatchshareEntries(payload);
  const matches: FedervolleyMatch[] = [];

  for (const entry of entries) {
    matches.push(...parseBracketEntryMatches(entry, options));
  }

  return matches
    .filter((match) => match.teamA.name || match.teamB.name)
    .sort(compareFedervolleyMatches);
}

export function buildFedervolleySourceTitle(
  title: string,
  gender: FedervolleyGender,
  category: Exclude<FedervolleyCategory, "all">,
  nodeId: string,
  matchshareLid?: string | null,
) {
  const lid = clean(matchshareLid);
  const tag = lid ? `[FIPAV:${category}:${nodeId}:${lid}]` : `[FIPAV:${category}:${nodeId}]`;
  return `${stripSourceTitleMetadata(title)} — ${gender === "women" ? "Women" : "Men"} ${tag}`;
}

export function buildTournamentPageUrl(nodeId: string | number) {
  return new URL(`/index.php/node/${clean(nodeId)}`, FEDERVOLLEY_ORIGIN).toString();
}

export function buildListingUrl(category: Exclude<FedervolleyCategory, "all">) {
  return new URL(CATEGORY_LISTING_PATHS[category], FEDERVOLLEY_ORIGIN).toString();
}

export function buildMatchshareBracketUrl(matchshareLid: string | number) {
  const lid = clean(matchshareLid);
  const url = new URL(`/bvl_test/rest_api/matches/json_for_bracket/${encodeURIComponent(lid)}`, MATCHSHARE_ORIGIN);
  url.searchParams.set("lid", lid);
  url.searchParams.set("complete", "1");
  url.searchParams.set("client_name", MATCHSHARE_CLIENT_NAME);
  return url.toString();
}

export function buildMatchsharePageUrl(matchshareLid: string | number) {
  const url = new URL("/bvl_test/bracket.php", MATCHSHARE_ORIGIN);
  url.searchParams.set("lid", clean(matchshareLid));
  url.searchParams.set("client_name", MATCHSHARE_CLIENT_NAME);
  return url.toString();
}

export function extractFedervolleyNodeId(value: unknown) {
  const text = clean(value);
  return clean(text.match(/\[FIPAV:[^:\]]+:([^:\]]+)(?::[^\]]+)?]/i)?.[1])
    || clean(text.match(/\/node\/(\d+)/i)?.[1]);
}

export function extractMatchshareLid(value: unknown) {
  const text = clean(value);
  return clean(text.match(/\[FIPAV:[^:\]]+:[^:\]]+:([^\]]+)]/i)?.[1])
    || clean(text.match(/[?&]lid=(\d+)/i)?.[1]);
}

export function filterFedervolleyUpcomingTournaments(tournaments: FedervolleyTournament[], now = new Date()) {
  return tournaments.filter((tournament) => isFedervolleyUpcomingTournament(tournament, now));
}

export function isFedervolleyUpcomingTournament(
  tournament: Pick<FedervolleyTournament, "status" | "startDate" | "endDate">,
  now = new Date(),
) {
  if (tournament.status === "finished") return false;
  const today = formatMoscowDate(now);
  const endDate = tournament.endDate || tournament.startDate;
  if (!endDate) return false;
  return endDate >= today;
}

export function isActiveFedervolleyMatch(match: Pick<FedervolleyMatch, "status" | "startTimeUtc">, now = new Date()) {
  if (match.status === "finished") return false;
  if (!match.startTimeUtc) return true;
  const start = new Date(match.startTimeUtc);
  if (Number.isNaN(start.getTime())) return true;
  return formatMoscowDate(start) >= formatMoscowDate(now);
}

async function fetchFedervolleyMatches(input: {
  matchshareLid: string;
  nodeId: string;
  gender: FedervolleyGender;
  category: Exclude<FedervolleyCategory, "all">;
  pageUrl: string;
  startDate: string | null;
  endDate: string | null;
}) {
  try {
    const text = await fetchFedervolleyText(buildMatchshareBracketUrl(input.matchshareLid), "application/json,text/plain,*/*");
    const trimmed = text.trim();
    if (!trimmed || /^Tabellone non pubblicato/i.test(trimmed)) return [];
    return parseFedervolleyMatchshareBracket(JSON.parse(trimmed), input);
  } catch (error) {
    if (error instanceof Error && /Tabellone non pubblicato|Federvolley Matchshare HTTP (?:400|500)/i.test(error.message)) {
      return [];
    }
    throw error;
  }
}

async function fetchFedervolleyText(url: string, accept: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: accept,
        "User-Agent": FEDERVOLLEY_USER_AGENT,
      },
    });
    const text = await response.text();
    if (!response.ok) {
      const source = url.includes("matchshare") || url.includes("srv.matchshare") ? "Federvolley Matchshare" : "Federvolley";
      throw new Error(`${source} HTTP ${response.status}: ${text.slice(0, 220)}`);
    }
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

function readListingColumns($: cheerio.CheerioAPI, $row: cheerio.Cheerio<any>) {
  const code = clean($row.find(".torneo-code").first().text());
  const title = clean($row.find(".col-6.col-sm-4.col-md-5, .col-lg-4").first().text());
  const locationColumn = $row.find(".col-6.col-sm-4.col-md-4, .col-lg-2").first();
  const cityRegion = splitCityRegion(locationColumn.html() || locationColumn.text());
  const dateColumn = $row.find(".torneo-day").first().closest(".col-6, .col-sm-4, .col-md-3");
  const dateBlocks = readListingDateBlocks($, dateColumn);
  const gender = clean($row.find(".col-6.col-md-2.d-none.d-lg-block").first().text());
  const prizePool = clean($row.find(".col-6.col-md-2.d-none.d-lg-block").eq(1).text());

  return {
    code,
    title,
    city: cityRegion.city,
    region: cityRegion.region,
    startMonth: dateBlocks[0]?.month || "",
    startDay: dateBlocks[0]?.day || "",
    startYear: dateBlocks[0]?.year || "",
    endMonth: dateBlocks[1]?.month || dateBlocks[0]?.month || "",
    endDay: dateBlocks[1]?.day || dateBlocks[0]?.day || "",
    endYear: dateBlocks[1]?.year || dateBlocks[0]?.year || "",
    gender,
    prizePool,
  };
}

function readListingDateBlocks($: cheerio.CheerioAPI, dateColumn: cheerio.Cheerio<any>) {
  const blocks = dateColumn.children().map((_, element) => parseListingDateBlock($(element).html() || $(element).text())).get();
  if (blocks.length > 0) return blocks.filter((block): block is { month: string; day: string; year: string } => Boolean(block));

  const fallback = parseListingDateBlock(dateColumn.html() || dateColumn.text());
  return fallback ? [fallback] : [];
}

function parseListingDateBlock(value: string) {
  const text = cheerio.load(`<div>${String(value || "").replace(/<br\s*\/?>/gi, "\n")}</div>`).text();
  const parts = text.split(/\n+/).map(clean).filter(Boolean);
  if (parts.length >= 3) {
    return {
      month: parts[0],
      day: parts[1],
      year: parts[2],
    };
  }

  const compact = clean(text);
  const match = compact.match(/^([A-Za-zÀ-ÿ]{3,})(\d{1,2})(20\d{2})$/);
  if (!match) return null;
  return {
    month: match[1],
    day: match[2],
    year: match[3],
  };
}

function splitCityRegion(value: string) {
  const html = String(value || "").replace(/<br\s*\/?>/gi, "\n");
  const text = cheerio.load(html).text().replace(/\s*\n\s*/g, "\n").trim();
  const lines = text.split(/\n+/).map(clean).filter(Boolean);
  if (lines.length >= 2) return { city: lines[0], region: lines.slice(1).join(" ") };

  const compact = clean(text);
  const match = compact.match(/^(.+?)([A-Z][A-Z -]{4,})$/);
  if (match) return { city: clean(match[1]), region: clean(match[2]) };
  return { city: compact, region: "" };
}

function parseCompactItalianDate(monthValue: string | null | undefined, dayValue: string | null | undefined, yearValue: string | null | undefined) {
  const month = MONTHS_IT[normalizeSearch(monthValue || "").slice(0, 3)] || MONTHS_IT[normalizeSearch(monthValue || "")];
  const day = clean(dayValue).padStart(2, "0");
  const year = clean(yearValue);
  if (!month || !/^\d{2}$/.test(day) || !/^20\d{2}$/.test(year)) return null;
  return `${year}-${month}-${day}`;
}

function parseDrupalDateField($: cheerio.CheerioAPI, fieldClass: string) {
  const field = $(`.${fieldClass}`).first();
  const datetime = clean(field.find("time[datetime]").first().attr("datetime"));
  if (/^\d{4}-\d{2}-\d{2}/.test(datetime)) return datetime.slice(0, 10);

  const text = clean(field.text().replace(/^Data\s+(?:inizio|fine)\s*/i, ""));
  const match = text.match(/(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(20\d{2})/i);
  if (!match) return null;
  return parseCompactItalianDate(match[2], match[1], match[3]);
}

function parseBracketEntryMatches(
  entry: MatchshareBracketEntry,
  options: {
    nodeId: string;
    matchshareLid: string;
    gender: FedervolleyGender;
    category: Exclude<FedervolleyCategory, "all">;
    pageUrl: string;
    startDate?: string | null;
    endDate?: string | null;
  },
) {
  const teamRefs = toArray(entry.teams) as MatchshareTeamRef[];
  const teamPairs = readMatchshareTeamPairs(entry, teamRefs);
  const matchNumbers = toArray(entry.numero);
  const infoItems = toArray(entry.info);
  const type = clean(entry.tipo) || "Maindraw";
  const matches: FedervolleyMatch[] = [];

  for (let index = 0; index < teamPairs.length; index += 1) {
    const [teamARaw, teamBRaw] = teamPairs[index];
    const teamA = parseFedervolleyTeam(teamARaw, teamRefs[index * 2]);
    const teamB = parseFedervolleyTeam(teamBRaw, teamRefs[index * 2 + 1]);
    const info = parseMatchInfo(infoItems[index]);
    const matchNo = clean(matchNumbers[index]) || String(index + 1);
    const startDate = parseMatchshareDateTime(info.date, options.startDate, options.endDate);
    const score = parseFedervolleyScore(info.result, info.sets);
    const stage = normalizeStage(type);
    const round = clean(info.phase) || inferRoundFromMatchNo(matchNo, stage);
    const sourceUrl = buildMatchsharePageUrl(options.matchshareLid);

    if (!teamA.name && !teamB.name) continue;

    matches.push({
      id: `${options.matchshareLid}-${matchNo}`,
      nodeId: options.nodeId,
      matchshareLid: options.matchshareLid,
      gender: options.gender,
      category: options.category,
      stage,
      round,
      court: info.court ? `Court ${info.court}` : "",
      startTimeUtc: startDate ? startDate.toISOString() : null,
      startTimeMoscow: startDate ? formatMoscowDateTime(startDate) : "",
      dateKey: startDate ? formatMoscowDate(startDate) : "",
      status: score.teamA !== null || score.teamB !== null ? "finished" : "upcoming",
      teamA,
      teamB,
      score,
      sourceUrl,
      rawText: [
        stage,
        round,
        matchNo ? `Match ${matchNo}` : null,
        info.court ? `Court ${info.court}` : null,
        startDate ? formatMoscowDateTime(startDate) : null,
        `${teamA.name} vs ${teamB.name}`,
        info.result || null,
        info.sets || null,
        sourceUrl,
      ].filter(Boolean).join(" | "),
    });
  }

  return matches;
}

function readMatchshareTeamPairs(entry: MatchshareBracketEntry, teamRefs: MatchshareTeamRef[]) {
  const initTeams = toArray(asRecord(entry.init)?.teams);
  if (teamRefs.length >= 2) {
    const pairs: Array<[unknown, unknown]> = [];
    for (let index = 0; index < teamRefs.length; index += 2) {
      pairs.push([teamRefs[index]?.name, teamRefs[index + 1]?.name]);
    }
    return pairs;
  }

  if (initTeams.length > 0) {
    return initTeams
      .map((pair) => toArray(pair))
      .filter((pair) => pair.length >= 2)
      .map((pair): [unknown, unknown] => [pair[0], pair[1]]);
  }

  const flattened = flattenResultPairs(asRecord(entry.init)?.results);
  return flattened;
}

function flattenMatchshareEntries(payload: unknown): MatchshareBracketEntry[] {
  const entries: MatchshareBracketEntry[] = [];

  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    const record = asRecord(value);
    if (!record) return;
    if (record.init || record.teams || record.numero || record.tipo) {
      entries.push(record as MatchshareBracketEntry);
    }
  };

  visit(payload);
  return entries;
}

function flattenResultPairs(value: unknown): Array<[unknown, unknown]> {
  const pairs: Array<[unknown, unknown]> = [];
  const visit = (item: unknown) => {
    if (!Array.isArray(item)) return;
    if (item.length === 2 && !Array.isArray(item[0]) && !Array.isArray(item[1])) {
      pairs.push([item[0], item[1]]);
      return;
    }
    for (const child of item) visit(child);
  };
  visit(value);
  return pairs;
}

function parseFedervolleyTeam(value: unknown, ref: MatchshareTeamRef | undefined): FedervolleyTeam {
  const rawName = clean(value || ref?.name);
  const seed = clean(rawName.match(/^\(([^)]+)\)/)?.[1]);
  const name = normalizeFedervolleyTeamName(rawName.replace(/^\([^)]+\)\s*/, ""));

  return {
    id: clean(ref?.id),
    name: name || "TBD",
    rawName,
    seed,
  };
}

function parseMatchInfo(value: unknown) {
  const text = cheerio.load(String(value ?? "").replace(/<br\s*\/?>/gi, "\n")).text();
  const lines = text.split(/\n+/).map(clean).filter(Boolean);
  const fields = new Map<string, string>();

  for (const line of lines) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) fields.set(normalizeSearch(match[1]), clean(match[2]));
  }

  return {
    date: fields.get("data") || "",
    court: fields.get("campo") || "",
    phase: fields.get("fase") || "",
    result: fields.get("risultato") || "",
    sets: fields.get("parziali") || "",
  };
}

function parseFedervolleyScore(resultText: string, setsText: string) {
  const matchScore = clean(resultText).match(/^(\d+)\s*[-:]\s*(\d+)/);
  const sets = clean(setsText)
    .split(/\s*,\s*/)
    .map((set, index) => {
      const match = set.match(/(\d+)\s*[-:]\s*(\d+)/);
      if (!match) return null;
      return { no: index + 1, teamA: Number(match[1]), teamB: Number(match[2]) };
    })
    .filter((set): set is { no: number; teamA: number; teamB: number } => Boolean(set));

  return {
    teamA: matchScore ? Number(matchScore[1]) : null,
    teamB: matchScore ? Number(matchScore[2]) : null,
    sets,
  };
}

function parseMatchshareDateTime(value: string, startDate?: string | null, endDate?: string | null) {
  const match = clean(value).match(/^(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const year = inferMatchshareYear(Number(match[1]), startDate, endDate);
  const parsed = DateTime.fromObject({
    year,
    month: Number(match[1]),
    day: Number(match[2]),
    hour: Number(match[3]),
    minute: Number(match[4]),
  }, { zone: "Europe/Rome" });

  if (!parsed.isValid) return null;
  return parsed.toUTC().toJSDate();
}

function inferMatchshareYear(month: number, startDate?: string | null, endDate?: string | null) {
  const startYear = yearFromIso(startDate);
  const endYear = yearFromIso(endDate);
  if (startDate && Number(startDate.slice(5, 7)) === month && startYear) return startYear;
  if (endDate && Number(endDate.slice(5, 7)) === month && endYear) return endYear;
  return startYear || endYear || getDefaultFedervolleyYear();
}

function inferRoundFromMatchNo(matchNo: string, stage: string) {
  if (stage === "Qualification") return "Qualification";
  return matchNo ? `Match ${matchNo}` : stage;
}

function normalizeStage(value: string) {
  const normalized = normalizeSearch(value);
  if (normalized.includes("qualification")) return "Qualification";
  if (normalized.includes("maindraw") || normalized.includes("main draw")) return "Main Draw";
  return clean(value) || "Main Draw";
}

function normalizeDetailCategory(value: string): Exclude<FedervolleyCategory, "all"> {
  const category = normalizeFedervolleyCategory(value);
  return category === "serie" ? "serie" : "assoluto";
}

function inferCityRegion(title: string) {
  const city = clean(title.split(/\s+-\s+/).pop());
  return { city, region: "" };
}

function resolveTournamentStatus(startDate: string | null, endDate: string | null): FedervolleyTournament["status"] {
  const today = formatMoscowDate(new Date());
  if (endDate && endDate < today) return "finished";
  if (startDate && startDate <= today && (!endDate || endDate >= today)) return "ongoing";
  return "upcoming";
}

function stripSourceTitleMetadata(value: string) {
  return clean(value
    .replace(/\s+—\s+(?:Women|Men|Женщины|Мужчины)\s*(?:\[FIPAV:[^\]]+])?$/i, "")
    .replace(/\s*\[FIPAV:[^\]]+]$/i, ""));
}

function normalizeFedervolleyTeamName(value: string) {
  const name = clean(value)
    .replace(/\s+-\s+/g, " / ")
    .replace(/\s*\/\s*/g, " / ");
  if (/^bye(?:\s+\d+)?$/i.test(name)) return "TBD";
  return name;
}

function formatDateRangeLabel(startDate: string | null, endDate: string | null) {
  if (!startDate && !endDate) return "";
  const start = startDate ? formatDateLabel(startDate) : "";
  const end = endDate ? formatDateLabel(endDate) : "";
  if (!start || start === end) return start || end;
  return `${start} - ${end}`;
}

function formatDateLabel(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function compareFedervolleyTournaments(a: FedervolleyTournament, b: FedervolleyTournament) {
  return compareDates(a.startDate, b.startDate)
    || a.title.localeCompare(b.title)
    || compareGender(a.gender, b.gender);
}

function compareFedervolleyMatches(a: FedervolleyMatch, b: FedervolleyMatch) {
  return compareDates(a.startTimeUtc, b.startTimeUtc) || a.id.localeCompare(b.id);
}

function compareDates(left: string | null, right: string | null) {
  const leftTime = left ? new Date(left).getTime() : Number.MAX_SAFE_INTEGER;
  const rightTime = right ? new Date(right).getTime() : Number.MAX_SAFE_INTEGER;
  return leftTime - rightTime;
}

function compareGender(left: FedervolleyGender, right: FedervolleyGender) {
  return (left === "men" ? 0 : 1) - (right === "men" ? 0 : 1);
}

function normalizeYear(value: string | number | null | undefined) {
  const parsed = Number(value || getDefaultFedervolleyYear());
  if (!Number.isFinite(parsed)) return getDefaultFedervolleyYear();
  return Math.min(Math.max(Math.trunc(parsed), 2020), 2035);
}

function yearFromIso(value: string | null | undefined) {
  const year = Number(String(value || "").slice(0, 4));
  return Number.isFinite(year) ? year : 0;
}

function normalizeSearch(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9а-яё]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function toNullableNumber(value: unknown) {
  const text = clean(value).replace(/[^\d.-]/g, "");
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
