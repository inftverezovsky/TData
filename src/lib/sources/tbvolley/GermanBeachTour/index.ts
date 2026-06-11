import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import { formatMoscowDate, formatMoscowDateTime } from "@/lib/matches/scheduleOffset";
import { normalizeBeachVolleyballGender, type BeachVolleyballGender } from "@/lib/sources/tbvolley/config";

export type GermanBeachTourGender = BeachVolleyballGender;
export type GermanBeachTourMatchStatus = "upcoming" | "finished";
export type GermanBeachTourField = "main" | "qualification";

export type GermanBeachTourTeam = {
  id: string;
  name: string;
  rawName: string;
  seed: string;
};

export type GermanBeachTourMatch = {
  id: string;
  tournamentId: string;
  gender: GermanBeachTourGender;
  field: GermanBeachTourField;
  stage: string;
  round: string;
  court: string;
  startTimeUtc: string | null;
  startTimeMoscow: string;
  dateKey: string;
  status: GermanBeachTourMatchStatus;
  teamA: GermanBeachTourTeam;
  teamB: GermanBeachTourTeam;
  score: {
    teamA: number | null;
    teamB: number | null;
    sets: Array<{ no: number; teamA: number; teamB: number }>;
  };
  resultText: string;
  sourceUrl: string;
  rawText: string;
};

export type GermanBeachTourTournament = {
  id: string;
  tournamentId: string;
  title: string;
  sourceTitle: string;
  pageUrl: string;
  gender: GermanBeachTourGender;
  category: string;
  type: string;
  city: string;
  location: string;
  venue: string;
  organizer: string;
  dates: string;
  startDate: string | null;
  endDate: string | null;
  status: "finished" | "ongoing" | "upcoming";
  teams: number | null;
  prizePool: string;
  matches?: GermanBeachTourMatch[];
  matchCount?: number;
};

export type GermanBeachTourTournamentSearch = {
  ok: true;
  source: "germanbeachtour";
  sourceUrl: string;
  year: number;
  fromDate: string;
  toDate: string;
  windowDays: number;
  gender: GermanBeachTourGender;
  query: string;
  tournaments: GermanBeachTourTournament[];
  summary: {
    total: number;
    teams: number;
  };
};

export type GermanBeachTourUpcomingWindow = {
  fromDate: string;
  toDate: string;
  windowDays: number;
};

const GERMAN_BEACH_TOUR_ORIGIN = "https://beach.volleyball-verband.de";
const GERMAN_BEACH_TOUR_USER_AGENT = "TData TBvolley/1.0 (+https://beach.volleyball-verband.de/public/tur.php)";
const UPCOMING_WINDOW_MONTHS = 1;

const FIELD_LABELS: Record<GermanBeachTourField, string> = {
  main: "Hauptfeld",
  qualification: "Qualifikation",
};

export function normalizeGermanBeachTourGender(value: unknown): GermanBeachTourGender {
  return readGermanBeachTourGender(value) || normalizeBeachVolleyballGender(value) || "men";
}

export function getDefaultGermanBeachTourYear() {
  const value = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Moscow",
    year: "numeric",
  }).format(new Date());
  const year = Number(value);
  return Number.isFinite(year) ? year : new Date().getUTCFullYear();
}

export function resolveGermanBeachTourUpcomingWindow(now = new Date()): GermanBeachTourUpcomingWindow {
  const fromDate = formatMoscowDate(now);
  const from = parseIsoDate(fromDate);
  const to = new Date(from.getTime());
  to.setUTCMonth(to.getUTCMonth() + UPCOMING_WINDOW_MONTHS);
  const toDate = formatIsoDate(to);

  return {
    fromDate,
    toDate,
    windowDays: daysBetweenIsoDates(fromDate, toDate),
  };
}

export function filterGermanBeachTourUpcomingTournaments(
  tournaments: GermanBeachTourTournament[],
  window: GermanBeachTourUpcomingWindow = resolveGermanBeachTourUpcomingWindow(),
) {
  return tournaments.filter((tournament) => isGermanBeachTourTournamentInUpcomingWindow(tournament, window));
}

export function isActiveGermanBeachTourMatch(
  match: Pick<GermanBeachTourMatch, "status" | "startTimeUtc">,
  window: GermanBeachTourUpcomingWindow = resolveGermanBeachTourUpcomingWindow(),
) {
  if (match.status === "finished" || !match.startTimeUtc) return false;
  const dateKey = formatMoscowDate(new Date(match.startTimeUtc));
  return dateKey >= window.fromDate && dateKey <= window.toDate;
}

export async function searchGermanBeachTourTournaments(input: {
  year?: string | number | null;
  gender?: string | null;
  query?: string | null;
} = {}): Promise<GermanBeachTourTournamentSearch> {
  const year = normalizeYear(input.year);
  const gender = normalizeGermanBeachTourGender(input.gender);
  const query = normalizeSearch(input.query || "");
  const sourceUrl = buildCalendarUrl(year);
  const html = await fetchGermanBeachTourHtml(sourceUrl);
  const window = resolveGermanBeachTourUpcomingWindow();
  const tournaments = filterGermanBeachTourUpcomingTournaments(
    parseGermanBeachTourCalendar(html, { gender, query }),
    window,
  );

  return {
    ok: true,
    source: "germanbeachtour",
    sourceUrl,
    year,
    fromDate: window.fromDate,
    toDate: window.toDate,
    windowDays: window.windowDays,
    gender,
    query,
    tournaments,
    summary: {
      total: tournaments.length,
      teams: tournaments.reduce((sum, tournament) => sum + (tournament.teams || 0), 0),
    },
  };
}

export async function fetchGermanBeachTourTournament(input: {
  tournamentId?: string | number | null;
  title?: string | null;
  pageUrl?: string | null;
  gender?: string | null;
}): Promise<GermanBeachTourTournament> {
  const tournamentId = clean(input.tournamentId)
    || extractGermanBeachTourTournamentId(input.pageUrl)
    || extractGermanBeachTourTournamentId(input.title);

  if (!tournamentId) {
    throw new Error("Не удалось определить ID турнира German Beach Tour");
  }

  const pageUrl = buildTournamentPageUrl(tournamentId);
  const detailHtml = await fetchGermanBeachTourHtml(pageUrl);
  const gender = normalizeGermanBeachTourGender(input.gender || inferGenderFromText(input.title) || inferGenderFromText(detailHtml));
  const [qualificationHtml, mainHtml] = await Promise.all([
    fetchOptionalGermanBeachTourHtml(buildTournamentScheduleUrl(tournamentId, "qualification")),
    fetchOptionalGermanBeachTourHtml(buildTournamentScheduleUrl(tournamentId, "main")),
  ]);
  const matches = [
    ...parseGermanBeachTourMatches(qualificationHtml, { tournamentId, gender, field: "qualification" }),
    ...parseGermanBeachTourMatches(mainHtml, { tournamentId, gender, field: "main" }),
  ].sort(compareGermanBeachTourMatches);

  return parseGermanBeachTourTournamentPage(detailHtml, {
    tournamentId,
    gender,
    requestedTitle: input.title || "",
    pageUrl,
    matches,
  });
}

export function parseGermanBeachTourCalendar(
  html: string,
  options: {
    gender: GermanBeachTourGender;
    query?: string;
  },
): GermanBeachTourTournament[] {
  const $ = cheerio.load(html);
  const tournaments: GermanBeachTourTournament[] = [];

  $(".contenttable tr").each((_, element) => {
    const $row = $(element);
    const cells = $row.find("td").map((__, cell) => clean($(cell).text())).get();
    if (cells.length < 5 || !/\d{2}\.\d{2}\./.test(cells[0])) return;

    const dates = cells[0];
    const category = cells[1] || "";
    if (!isGermanBeachTourCategory(category)) return;

    const city = cells[2] || "";
    const gender = readGermanBeachTourGender(cells[3]);
    if (!gender || gender !== options.gender) return;

    const href = clean($row.find('a[href*="tur-show.php"]').first().attr("href"));
    const tournamentId = extractGermanBeachTourTournamentId(href);
    if (!tournamentId) return;

    const [startDate, endDate] = parseCalendarDateRange(dates);
    const type = inferTournamentType(category);
    const title = buildTournamentTitle(type, city);
    const pageUrl = buildTournamentPageUrl(tournamentId);
    const sourceTitle = buildGermanBeachTourSourceTitle(title, gender, tournamentId);

    const tournament: GermanBeachTourTournament = {
      id: tournamentId,
      tournamentId,
      title,
      sourceTitle,
      pageUrl,
      gender,
      category,
      type,
      city,
      location: city,
      venue: "",
      organizer: "",
      dates,
      startDate,
      endDate,
      status: resolveTournamentStatus(startDate, endDate),
      teams: toNullableNumber(cells[4]),
      prizePool: "",
    };

    if (options.query && !normalizeSearch([
      tournament.title,
      tournament.category,
      tournament.type,
      tournament.city,
      tournament.dates,
    ].join(" ")).includes(options.query)) {
      return;
    }

    tournaments.push(tournament);
  });

  return tournaments.sort((a, b) => compareDates(a.startDate, b.startDate) || a.title.localeCompare(b.title));
}

export function parseGermanBeachTourTournamentPage(
  html: string,
  options: {
    tournamentId: string;
    gender: GermanBeachTourGender;
    requestedTitle?: string | null;
    pageUrl: string;
    matches?: GermanBeachTourMatch[];
  },
): GermanBeachTourTournament {
  const $ = cheerio.load(html);
  const headerTitle = clean($(".pageheader").first().text()) || clean($("meta[name=\"description\"]").attr("content"));
  const title = stripGermanGenderSuffix(headerTitle) || stripSourceTitleMetadata(options.requestedTitle || "") || `German Beach Tour ${options.tournamentId}`;
  const detail = readDetailMap($);
  const gender = readGermanBeachTourGender(detail.get("Geschlecht")) || options.gender;
  const startDate = parseGermanDate(detail.get("Datum von") || "");
  const endDate = parseGermanDate(detail.get("Datum bis") || "");
  const type = clean(detail.get("Typ")) || inferTournamentType(title);
  const city = clean(detail.get("Ort")) || inferCityFromTitle(title);
  const venue = clean(detail.get("Gelände"));
  const organizer = clean(detail.get("Ausrichter"));
  const matches = options.matches || [];

  return {
    id: options.tournamentId,
    tournamentId: options.tournamentId,
    title,
    sourceTitle: buildGermanBeachTourSourceTitle(title, gender, options.tournamentId),
    pageUrl: options.pageUrl,
    gender,
    category: type,
    type,
    city,
    location: city,
    venue,
    organizer,
    dates: formatDateRangeLabel(startDate, endDate),
    startDate,
    endDate,
    status: matches.some((match) => match.status === "upcoming")
      ? "upcoming"
      : resolveTournamentStatus(startDate, endDate),
    teams: toNullableNumber(detail.get("Teams Hauptfeld")),
    prizePool: clean(detail.get("Preisgeld")),
    matches,
    matchCount: matches.length,
  };
}

export function parseGermanBeachTourMatches(
  html: string,
  options: { tournamentId: string; gender: GermanBeachTourGender; field: GermanBeachTourField },
): GermanBeachTourMatch[] {
  const $ = cheerio.load(html);
  const matches: GermanBeachTourMatch[] = [];
  let currentRound = "";

  $(".content center").children().each((_, element) => {
    const $element = $(element);
    if ($element.hasClass("sectionheader")) {
      currentRound = clean($element.text());
      return;
    }

    if (!$element.is("table")) return;
    const headerCells = $element.find("tr.bez2").first().children("td").map((__, cell) => clean($(cell).text())).get();
    if (!headerCells.includes("Spiel") || !headerCells.includes("Team 1") || !headerCells.includes("Team 2")) return;

    const indexes = {
      no: findHeaderIndex(headerCells, "Spiel"),
      date: findHeaderIndex(headerCells, "Tag"),
      time: findHeaderIndex(headerCells, "Zeit"),
      court: findHeaderIndex(headerCells, "Court"),
      teamA: findHeaderIndex(headerCells, "Team 1"),
      teamB: findHeaderIndex(headerCells, "Team 2"),
      result: findHeaderIndex(headerCells, "Ergebnis"),
    };

    $element.find("tr").each((__, row) => {
      const match = parseGermanBeachTourMatchRow($, $(row), {
        tournamentId: options.tournamentId,
        gender: options.gender,
        field: options.field,
        round: currentRound,
        indexes,
      });
      if (match) matches.push(match);
    });
  });

  return matches.sort(compareGermanBeachTourMatches);
}

export function buildTournamentPageUrl(tournamentId: string) {
  const url = new URL("/public/tur-show.php", GERMAN_BEACH_TOUR_ORIGIN);
  url.searchParams.set("id", tournamentId);
  return url.toString();
}

export function buildTournamentScheduleUrl(tournamentId: string, field: GermanBeachTourField) {
  const url = new URL("/public/tur-sp.php", GERMAN_BEACH_TOUR_ORIGIN);
  url.searchParams.set("id", tournamentId);
  if (field === "qualification") url.searchParams.set("feld", "2");
  return url.toString();
}

export function buildGermanBeachTourSourceTitle(title: string, gender: GermanBeachTourGender, tournamentId: string) {
  return `${stripGermanGenderSuffix(title)} — ${gender === "women" ? "Women" : "Men"} [GBT:${tournamentId}]`;
}

export function extractGermanBeachTourTournamentId(value: unknown) {
  const text = clean(value);
  return clean(text.match(/\[GBT:([^\]]+)]/i)?.[1])
    || clean(text.match(/[?&]id=(\d+)/i)?.[1]);
}

function parseGermanBeachTourMatchRow(
  $: cheerio.CheerioAPI,
  $row: cheerio.Cheerio<any>,
  options: {
    tournamentId: string;
    gender: GermanBeachTourGender;
    field: GermanBeachTourField;
    round: string;
    indexes: Record<"no" | "date" | "time" | "court" | "teamA" | "teamB" | "result", number>;
  },
): GermanBeachTourMatch | null {
  if ($row.hasClass("bez2")) return null;

  const cells = $row.children("td").toArray().map((cell) => $(cell));
  if (cells.length < 7) return null;

  const matchNo = clean(cells[options.indexes.no]?.text());
  const dateText = clean(cells[options.indexes.date]?.text());
  const timeText = clean(cells[options.indexes.time]?.text());
  const teamA = parseTeamCell(cells[options.indexes.teamA]);
  const teamB = parseTeamCell(cells[options.indexes.teamB]);
  if (!matchNo || (!teamA.name && !teamB.name)) return null;

  const resultCell = cells[options.indexes.result];
  const resultAnchor = resultCell?.find('a[href*="tur-spiel.php"]').first();
  const resultText = clean(resultAnchor?.text() || resultCell?.text());
  const sourceUrl = absoluteGermanBeachTourUrl(clean(resultAnchor?.attr("href"))) || buildTournamentScheduleUrl(options.tournamentId, options.field);
  const startDate = parseBerlinDateTime(dateText, timeText);
  const score = parseResultScore(resultText);
  const hasResult = isCompletedGermanBeachTourResult(resultText, score);
  const id = extractMatchIdFromUrl(sourceUrl) || `${options.tournamentId}-${options.field}-${matchNo}`;
  const court = clean(cells[options.indexes.court]?.text());

  return {
    id,
    tournamentId: options.tournamentId,
    gender: options.gender,
    field: options.field,
    stage: FIELD_LABELS[options.field],
    round: options.round,
    court: court ? `Court ${court}` : "",
    startTimeUtc: startDate ? startDate.toISOString() : null,
    startTimeMoscow: startDate ? formatMoscowDateTime(startDate) : "",
    dateKey: startDate ? formatMoscowDate(startDate) : "",
    status: hasResult ? "finished" : "upcoming",
    teamA,
    teamB,
    score,
    resultText,
    sourceUrl,
    rawText: [
      FIELD_LABELS[options.field],
      options.round,
      matchNo ? `Spiel ${matchNo}` : null,
      court ? `Court ${court}` : null,
      startDate ? formatMoscowDateTime(startDate) : null,
      `${teamA.name} vs ${teamB.name}`,
      resultText || null,
      sourceUrl,
    ].filter(Boolean).join(" | "),
  };
}

function parseTeamCell($cell: cheerio.Cheerio<any> | undefined): GermanBeachTourTeam {
  const $link = $cell?.find('a[href*="team.php"]').first();
  const rawName = clean($link?.text() || $cell?.text());
  const seed = clean(rawName.match(/\((\d+)\)\s*$/)?.[1]);
  const name = normalizeTeamName(rawName.replace(/\s*\(\d+\)\s*$/, ""));
  const id = clean(($link?.attr("href") || "").match(/[?&]id=(\d+)/i)?.[1]);

  return {
    id,
    name: name || "TBD",
    rawName,
    seed,
  };
}

function parseResultScore(resultText: string) {
  const normalized = clean(resultText);
  const matchScore = normalized.match(/^(\d+)\s*:\s*(\d+)/);
  const setsText = clean(resultText.match(/\(([^)]+)\)/)?.[1]);
  const sets = Array.from(setsText.matchAll(/(\d+)\s*:\s*(\d+)/g)).map((match, index) => ({
    no: index + 1,
    teamA: Number(match[1]),
    teamB: Number(match[2]),
  }));
  const isPlaceholderScore = isGermanBeachTourPlaceholderResult(normalized, matchScore, sets.length);

  return {
    teamA: matchScore && !isPlaceholderScore ? Number(matchScore[1]) : null,
    teamB: matchScore && !isPlaceholderScore ? Number(matchScore[2]) : null,
    sets,
  };
}

function isCompletedGermanBeachTourResult(
  resultText: string,
  score: ReturnType<typeof parseResultScore>,
) {
  const normalized = clean(resultText);
  if (!normalized) return false;
  if (score.teamA !== null || score.teamB !== null || score.sets.length > 0) return true;
  const matchScore = normalized.match(/^(\d+)\s*:\s*(\d+)/);
  return !isGermanBeachTourPlaceholderResult(normalized, matchScore, score.sets.length);
}

function isGermanBeachTourPlaceholderResult(
  normalizedResultText: string,
  matchScore: RegExpMatchArray | null,
  setCount: number,
) {
  return Boolean(
    matchScore
      && Number(matchScore[1]) === 0
      && Number(matchScore[2]) === 0
      && setCount === 0
      && /^0\s*:\s*0\s*(?:\(\s*\))?$/.test(normalizedResultText),
  );
}

function readDetailMap($: cheerio.CheerioAPI) {
  const detail = new Map<string, string>();
  $("td.bez2").each((_, element) => {
    const key = clean($(element).text());
    const value = clean($(element).next("td").text());
    if (key) detail.set(key, value);
  });
  return detail;
}

async function fetchGermanBeachTourHtml(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "de,en;q=0.8",
        "User-Agent": GERMAN_BEACH_TOUR_USER_AGENT,
      },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`German Beach Tour HTTP ${response.status}: ${text.slice(0, 220)}`);
    }
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOptionalGermanBeachTourHtml(url: string) {
  try {
    return await fetchGermanBeachTourHtml(url);
  } catch {
    return "";
  }
}

function buildCalendarUrl(year: number) {
  const url = new URL("/public/tur.php", GERMAN_BEACH_TOUR_ORIGIN);
  url.searchParams.set("kat", "1");
  url.searchParams.set("bytyp", "0");
  url.searchParams.set("saison", String(year % 100));
  return url.toString();
}

function isGermanBeachTourCategory(category: string) {
  const normalized = normalizeSearch(category);
  return normalized.includes("deutsche beach volleyball tour") || normalized.includes("german beach tour");
}

function inferTournamentType(value: string) {
  const text = clean(value);
  const parts = text.split("\\").map(clean).filter(Boolean);
  return parts[parts.length - 1] || text || "German Beach Tour";
}

function readGermanBeachTourGender(value: unknown): GermanBeachTourGender | null {
  const normalized = normalizeSearch(String(value ?? ""));
  if (normalized.includes("frauen") || normalized.includes("women") || normalized.includes("female")) return "women";
  if (normalized.includes("manner") || normalized.includes("maenner") || normalized.includes("men") || normalized.includes("male")) return "men";
  return null;
}

function inferGenderFromText(value: unknown) {
  return readGermanBeachTourGender(value);
}

function parseCalendarDateRange(value: string): [string | null, string | null] {
  const match = clean(value).match(/^(\d{2})\.(\d{2})\.\s*-\s*(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return [null, null];
  const year = match[5];
  return [`${year}-${match[2]}-${match[1]}`, `${year}-${match[4]}-${match[3]}`];
}

function parseGermanDate(value: string) {
  const match = clean(value).match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function parseBerlinDateTime(dateText: string, timeText: string) {
  const value = `${clean(dateText)} ${clean(timeText)}`.trim();
  const parsed = DateTime.fromFormat(value, "dd.MM.yyyy HH:mm", { zone: "Europe/Berlin" });
  if (!parsed.isValid) return null;
  return parsed.toUTC().toJSDate();
}

function resolveTournamentStatus(startDate: string | null, endDate: string | null): GermanBeachTourTournament["status"] {
  const today = formatMoscowDate(new Date());
  if (endDate && endDate < today) return "finished";
  if (startDate && startDate <= today && (!endDate || endDate >= today)) return "ongoing";
  return "upcoming";
}

function isGermanBeachTourTournamentInUpcomingWindow(tournament: GermanBeachTourTournament, window: GermanBeachTourUpcomingWindow) {
  if (!tournament.startDate) return false;

  const endDate = tournament.endDate || tournament.startDate;
  return tournament.startDate <= window.toDate && endDate >= window.fromDate;
}

function buildTournamentTitle(type: string, city: string) {
  const cleanType = clean(type) || "German Beach Tour";
  const cleanCity = clean(city);
  return cleanCity ? `${cleanType}. ${cleanCity}` : cleanType;
}

function stripGermanGenderSuffix(value: string) {
  return clean(value
    .replace(/\s+—\s+(?:Women|Men|Frauen|Männer)\s*(?:\[GBT:[^\]]+])?$/i, "")
    .replace(/\s+(?:Frauen|Männer)\s*$/i, "")
    .replace(/\s*\[GBT:[^\]]+]$/i, ""));
}

function stripSourceTitleMetadata(value: string) {
  return stripGermanGenderSuffix(clean(value).replace(/\s*\[GBT:[^\]]+]$/i, ""));
}

function inferCityFromTitle(title: string) {
  const cleanTitle = stripGermanGenderSuffix(title);
  return clean(cleanTitle.match(/\b(?:Tour|Cup)\s+(.+)$/i)?.[1]);
}

function normalizeTeamName(value: string) {
  const cleanValue = clean(value);
  if (!cleanValue) return "";
  return cleanValue.replace(/\s+-\s+/g, " / ");
}

function formatDateRangeLabel(startDate: string | null, endDate: string | null) {
  if (!startDate && !endDate) return "";
  const start = startDate ? formatGermanDateLabel(startDate) : "";
  const end = endDate ? formatGermanDateLabel(endDate) : "";
  if (!start || start === end) return start || end;
  return `${start} - ${end}`;
}

function formatGermanDateLabel(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function compareGermanBeachTourMatches(a: GermanBeachTourMatch, b: GermanBeachTourMatch) {
  return compareDates(a.startTimeUtc, b.startTimeUtc) || a.id.localeCompare(b.id);
}

function compareDates(left: string | null, right: string | null) {
  const leftTime = left ? new Date(left).getTime() : Number.MAX_SAFE_INTEGER;
  const rightTime = right ? new Date(right).getTime() : Number.MAX_SAFE_INTEGER;
  return leftTime - rightTime;
}

function normalizeYear(value: string | number | null | undefined) {
  const parsed = Number(value || getDefaultGermanBeachTourYear());
  if (!Number.isFinite(parsed)) return getDefaultGermanBeachTourYear();
  return Math.min(Math.max(Math.trunc(parsed), 2003), 2035);
}

function parseIsoDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function daysBetweenIsoDates(fromDate: string, toDate: string) {
  return Math.max(1, Math.round((parseIsoDate(toDate).getTime() - parseIsoDate(fromDate).getTime()) / 86_400_000));
}

function findHeaderIndex(headers: string[], header: string) {
  return headers.findIndex((value) => value === header);
}

function absoluteGermanBeachTourUrl(value: string) {
  const url = clean(value);
  if (!url) return "";
  return new URL(url, `${GERMAN_BEACH_TOUR_ORIGIN}/public/`).toString();
}

function extractMatchIdFromUrl(value: string) {
  const id = clean(value.match(/[?&]id=(\d+)/i)?.[1]);
  const field = clean(value.match(/[?&]feld=(\d+)/i)?.[1]) || "1";
  const match = clean(value.match(/[?&]spiel=(\d+)/i)?.[1]);
  if (!id || !match) return "";
  return `${id}-${field}-${match}`;
}

function normalizeSearch(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9а-яё]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
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
