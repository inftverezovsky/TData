import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import { formatMoscowDate, formatMoscowDateTime } from "@backend/matches/scheduleOffset";
import { normalizeBeachVolleyballGender, type BeachVolleyballGender } from "@backend/sources/tbvolley/config";

export type TwelveNdrSource = "twelvendrcsvp" | "twelvendroevv";
export type TwelveNdrCalendarMode = "csvp" | "oevv";
export type TwelveNdrGender = BeachVolleyballGender;
export type TwelveNdrMatchStatus = "upcoming" | "finished";
export type TwelveNdrField = "main" | "qualification";

export type TwelveNdrTeam = {
  name: string;
  rawName: string;
  country: string;
  seed: string;
};

export type TwelveNdrMatch = {
  id: string;
  tcode: string;
  gender: TwelveNdrGender;
  field: TwelveNdrField;
  stage: string;
  round: string;
  court: string;
  startTimeUtc: string | null;
  startTimeMoscow: string;
  dateKey: string;
  status: TwelveNdrMatchStatus;
  teamA: TwelveNdrTeam;
  teamB: TwelveNdrTeam;
  score: {
    teamA: number | null;
    teamB: number | null;
    sets: Array<{ no: number; teamA: number; teamB: number }>;
  };
  resultText: string;
  sourceUrl: string;
  rawText: string;
};

export type TwelveNdrTournament = {
  id: string;
  source: TwelveNdrSource;
  calendarMode: TwelveNdrCalendarMode;
  tcode: string;
  timezone: string;
  title: string;
  sourceTitle: string;
  pageUrl: string;
  gender: TwelveNdrGender;
  type: string;
  federation: string;
  country: string;
  location: string;
  dates: string;
  startDate: string | null;
  endDate: string | null;
  status: "finished" | "ongoing" | "upcoming";
  matches?: TwelveNdrMatch[];
  matchCount?: number;
};

export type TwelveNdrTournamentSearch = {
  ok: true;
  source: TwelveNdrSource;
  sourceUrl: string;
  season: number;
  calendarMode: TwelveNdrCalendarMode;
  gender: TwelveNdrGender;
  query: string;
  tournaments: TwelveNdrTournament[];
  summary: {
    total: number;
    matches: number;
  };
};

type CalendarRow = {
  Name?: string;
  Men?: string;
  Women?: string;
  TournamentType?: string;
  Season?: string;
  Country?: string;
  Federation?: string;
};

const TWELVE_NDR_ORIGIN = "https://fivb.12ndr.at";
const TWELVE_NDR_USER_AGENT = "TData TBvolley/1.0 (+https://fivb.12ndr.at)";

const FIELD_LABELS: Record<TwelveNdrField, string> = {
  main: "Main Draw",
  qualification: "Qualification",
};

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const TIMEZONE_BY_CODE: Record<string, string> = {
  "14": "America/Lima",
  "18": "America/Asuncion",
  "19": "America/Santo_Domingo",
  "21": "America/La_Paz",
  "22": "America/Santiago",
  "24": "America/Sao_Paulo",
  "38": "Europe/Vienna",
  "39": "Europe/Budapest",
  "40": "Europe/Madrid",
  "41": "Europe/Warsaw",
  "49": "Asia/Nicosia",
  "50": "Africa/Maputo",
  "51": "Europe/Riga",
  "58": "Europe/Bucharest",
  "69": "Asia/Tashkent",
  "72": "Asia/Kolkata",
  "79": "Asia/Bangkok",
  "81": "Asia/Shanghai",
  "87": "Asia/Jayapura",
  "92": "Australia/Brisbane",
  "101": "Pacific/Auckland",
};

export function normalizeTwelveNdrGender(value: unknown): TwelveNdrGender {
  return normalizeBeachVolleyballGender(value) || "men";
}

export function getDefaultTwelveNdrSeason() {
  const value = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Moscow",
    year: "numeric",
  }).format(new Date());
  const year = Number(value);
  return Number.isFinite(year) ? year : new Date().getUTCFullYear();
}

export async function searchTwelveNdrCsvpTournaments(input: {
  season?: string | number | null;
  gender?: string | null;
  query?: string | null;
} = {}) {
  return searchTwelveNdrTournaments({ ...input, source: "twelvendrcsvp", calendarMode: "csvp" });
}

export async function searchTwelveNdrOevvTournaments(input: {
  season?: string | number | null;
  gender?: string | null;
  query?: string | null;
} = {}) {
  return searchTwelveNdrTournaments({ ...input, source: "twelvendroevv", calendarMode: "oevv" });
}

export async function searchTwelveNdrTournaments(input: {
  source: TwelveNdrSource;
  calendarMode: TwelveNdrCalendarMode;
  season?: string | number | null;
  gender?: string | null;
  query?: string | null;
}): Promise<TwelveNdrTournamentSearch> {
  const season = normalizeSeason(input.season);
  const gender = normalizeTwelveNdrGender(input.gender);
  const query = normalizeSearch(input.query || "");
  const sourceUrl = buildCalendarUrl(input.calendarMode, season);
  const text = await fetchTwelveNdrText(sourceUrl, "application/json,text/html,*/*");
  const tournaments = filterTwelveNdrUpcomingTournaments(
    parseTwelveNdrCalendarJson(text, {
      source: input.source,
      calendarMode: input.calendarMode,
      season,
      gender,
      query,
    }),
  );

  return {
    ok: true,
    source: input.source,
    sourceUrl,
    season,
    calendarMode: input.calendarMode,
    gender,
    query,
    tournaments,
    summary: {
      total: tournaments.length,
      matches: tournaments.reduce((sum, tournament) => sum + (tournament.matchCount || 0), 0),
    },
  };
}

export async function fetchTwelveNdrTournament(input: {
  source: TwelveNdrSource;
  calendarMode: TwelveNdrCalendarMode;
  tcode?: string | number | null;
  timezone?: string | number | null;
  title?: string | null;
  pageUrl?: string | null;
  gender?: string | null;
}): Promise<TwelveNdrTournament> {
  const tcode = clean(input.tcode)
    || extractTwelveNdrTcode(input.pageUrl)
    || extractTwelveNdrTcode(input.title);
  if (!tcode) throw new Error("Не удалось определить tcode турнира 12ndr");

  const timezone = clean(input.timezone)
    || extractTwelveNdrTimezone(input.pageUrl)
    || extractTwelveNdrTimezone(input.title);
  const pageUrl = buildTournamentPageUrl(tcode, timezone);
  const html = await fetchTwelveNdrText(buildTournamentScriptUrl(tcode), "text/html,application/xhtml+xml");
  const gender = normalizeTwelveNdrGender(input.gender || inferGenderFromTcode(tcode) || input.title || input.pageUrl);

  return parseTwelveNdrTournamentPage(html, {
    source: input.source,
    calendarMode: input.calendarMode,
    tcode,
    timezone,
    gender,
    requestedTitle: input.title || "",
    pageUrl,
  });
}

export function parseTwelveNdrCalendarJson(
  text: string,
  options: {
    source: TwelveNdrSource;
    calendarMode: TwelveNdrCalendarMode;
    season: number;
    gender: TwelveNdrGender;
    query?: string;
    now?: Date;
  },
): TwelveNdrTournament[] {
  let rows: CalendarRow[];
  try {
    rows = JSON.parse(text.replace(/^\uFEFF/, "")) as CalendarRow[];
  } catch {
    throw new Error("12ndr calendar returned invalid JSON.");
  }

  const tournaments: TwelveNdrTournament[] = [];
  for (const row of rows) {
    const type = stripHtml(row.TournamentType);
    const federation = stripHtml(row.Federation);
    if (options.calendarMode === "csvp" && type.toUpperCase() !== "CSV" && federation.toUpperCase() !== "CSV") continue;

    const title = stripHtml(row.Name);
    const country = stripHtml(row.Country);
    const cell = options.gender === "women" ? row.Women : row.Men;
    const href = extractFirstHref(cell);
    const tcode = extractTwelveNdrTcode(href);
    if (!tcode) continue;

    const timezone = extractTwelveNdrTimezone(href);
    const dates = stripHtml(cell);
    const [startDate, endDate] = parseCalendarDateRange(dates, options.season);
    const tournament: TwelveNdrTournament = {
      id: tcode,
      source: options.source,
      calendarMode: options.calendarMode,
      tcode,
      timezone,
      title,
      sourceTitle: buildTwelveNdrSourceTitle(options.source, title, options.gender, tcode),
      pageUrl: buildTournamentPageUrl(tcode, timezone),
      gender: options.gender,
      type,
      federation,
      country,
      location: country,
      dates,
      startDate,
      endDate,
      status: resolveTournamentStatus(startDate, endDate, options.now),
    };

    if (options.query && !normalizeSearch([
      tournament.title,
      tournament.type,
      tournament.federation,
      tournament.country,
      tournament.dates,
      tournament.tcode,
    ].join(" ")).includes(options.query)) {
      continue;
    }

    tournaments.push(tournament);
  }

  return tournaments.sort((a, b) => compareDates(a.startDate, b.startDate) || a.title.localeCompare(b.title));
}

export function parseTwelveNdrTournamentPage(
  html: string,
  options: {
    source: TwelveNdrSource;
    calendarMode: TwelveNdrCalendarMode;
    tcode: string;
    timezone?: string | null;
    gender: TwelveNdrGender;
    requestedTitle?: string | null;
    pageUrl: string;
  },
): TwelveNdrTournament {
  const $ = cheerio.load(html);
  const header = clean($("h3").first().text());
  const title = stripHeaderDates(header)
    || stripSourceTitleMetadata(options.requestedTitle || "")
    || `12ndr ${options.tcode}`;
  const [startDate, endDate] = parseHeaderDateRange(header);
  const matches = parseTwelveNdrMatches(html, {
    tcode: options.tcode,
    timezone: options.timezone || "",
    gender: options.gender,
    season: inferSeason(startDate, endDate),
  });

  return {
    id: options.tcode,
    source: options.source,
    calendarMode: options.calendarMode,
    tcode: options.tcode,
    timezone: clean(options.timezone),
    title,
    sourceTitle: buildTwelveNdrSourceTitle(options.source, title, options.gender, options.tcode),
    pageUrl: options.pageUrl,
    gender: options.gender,
    type: options.calendarMode === "oevv" ? "Austrian Beach Tour" : "CSVP",
    federation: options.calendarMode === "oevv" ? "AUT" : "CSV",
    country: options.calendarMode === "oevv" ? "Austria" : "",
    location: inferLocationFromTitle(title),
    dates: formatDateRangeLabel(startDate, endDate),
    startDate,
    endDate,
    status: matches.some((match) => match.status === "upcoming")
      ? "upcoming"
      : resolveTournamentStatus(startDate, endDate),
    matches,
    matchCount: matches.length,
  };
}

export function parseTwelveNdrMatches(
  html: string,
  options: { tcode: string; timezone?: string | null; gender: TwelveNdrGender; season?: number | null },
): TwelveNdrMatch[] {
  const $ = cheerio.load(html);
  const matches: TwelveNdrMatch[] = [];

  for (const field of ["main", "qualification"] as const) {
    const id = field === "main" ? "results_md" : "results_qu";
    const table = $(`#${id}`).nextAll("div.table-responsive").first().find("table").first();
    if (table.length === 0) continue;

    let currentRound = "";
    table.find("tr").each((_, row) => {
      const $row = $(row);
      const cells = $row.children("td").toArray().map((cell) => $(cell));
      if (cells.length === 0) return;

      if (cells.length === 1 || clean(cells[0].attr("colspan"))) {
        const round = clean(cells[0].text());
        if (round) currentRound = round;
        return;
      }

      const match = parseTwelveNdrMatchRow(cells, {
        tcode: options.tcode,
        timezone: clean(options.timezone),
        gender: options.gender,
        field,
        round: currentRound,
        season: options.season || getDefaultTwelveNdrSeason(),
      });
      if (match) matches.push(match);
    });
  }

  return matches.sort(compareTwelveNdrMatches);
}

export function buildTwelveNdrSourceTitle(source: TwelveNdrSource, title: string, gender: TwelveNdrGender, tcode: string) {
  const tag = source === "twelvendroevv" ? "12NDR-OEVV" : "12NDR-CSVP";
  return `${stripSourceTitleMetadata(title)} — ${gender === "women" ? "Women" : "Men"} [${tag}:${tcode}]`;
}

export function buildTournamentPageUrl(tcode: string, timezone?: string | number | null) {
  const url = new URL("/tournament", TWELVE_NDR_ORIGIN);
  url.searchParams.set("tcode", clean(tcode));
  const timezoneValue = clean(timezone);
  if (timezoneValue) url.searchParams.set("timezone", timezoneValue);
  return url.toString();
}

export function buildTournamentScriptUrl(tcode: string) {
  const url = new URL("/scripts/tournament.php", TWELVE_NDR_ORIGIN);
  url.searchParams.set("tcode", clean(tcode));
  return url.toString();
}

export function extractTwelveNdrTcode(value: unknown) {
  const text = clean(value);
  return clean(text.match(/\[(?:12NDR-(?:CSVP|OEVV)):([^\]]+)]/i)?.[1])
    || clean(text.match(/[?&]tcode=([^&#\s]+)/i)?.[1]);
}

export function extractTwelveNdrTimezone(value: unknown) {
  const text = clean(value);
  return clean(text.match(/[?&]timezone=([^&#\s]+)/i)?.[1]);
}

export function isActiveTwelveNdrMatch(match: Pick<TwelveNdrMatch, "status" | "startTimeUtc">, now = new Date()) {
  if (match.status === "finished") return false;
  if (!match.startTimeUtc) return true;
  const start = new Date(match.startTimeUtc);
  if (Number.isNaN(start.getTime())) return true;
  return formatMoscowDate(start) >= formatMoscowDate(now);
}

export function filterTwelveNdrUpcomingTournaments(tournaments: TwelveNdrTournament[], now = new Date()) {
  return tournaments.filter((tournament) => isTwelveNdrUpcomingTournament(tournament, now));
}

export function isTwelveNdrUpcomingTournament(
  tournament: Pick<TwelveNdrTournament, "status" | "startDate" | "endDate">,
  now = new Date(),
) {
  if (tournament.status === "finished") return false;
  const today = formatMoscowDate(now);
  const endDate = tournament.endDate || tournament.startDate;
  if (!endDate) return false;
  return endDate >= today;
}

function parseTwelveNdrMatchRow(
  cells: Array<cheerio.Cheerio<any>>,
  options: {
    tcode: string;
    timezone: string;
    gender: TwelveNdrGender;
    field: TwelveNdrField;
    round: string;
    season: number;
  },
): TwelveNdrMatch | null {
  if (cells.length < 7) return null;

  const matchNo = clean(cells[0].text());
  const dateText = clean(cells[1].text());
  const timeText = clean(cells[2].text());
  const court = clean(cells[3].text());
  const teamA = parseTwelveNdrTeam(cells[4]);
  const teamB = parseTwelveNdrTeam(cells[5]);
  const resultText = clean(cells[6].text());
  if (!matchNo || (!teamA.name && !teamB.name)) return null;

  const detailLink = cells.find((cell) => clean(cell.find('a[href*="match?match="]').attr("href")))?.find('a[href*="match?match="]').attr("href");
  const sourceUrl = absoluteTwelveNdrUrl(clean(detailLink)) || buildTournamentPageUrl(options.tcode, options.timezone);
  const id = clean(sourceUrl.match(/[?&]match=(\d+)/i)?.[1]) || `${options.tcode}-${options.field}-${matchNo}`;
  const startDate = parseTwelveNdrDateTime(dateText, timeText, options.season, options.timezone);
  const score = parseScore(resultText);

  return {
    id,
    tcode: options.tcode,
    gender: options.gender,
    field: options.field,
    stage: FIELD_LABELS[options.field],
    round: options.round,
    court: court ? `Court ${court}` : "",
    startTimeUtc: startDate ? startDate.toISOString() : null,
    startTimeMoscow: startDate ? formatMoscowDateTime(startDate) : "",
    dateKey: startDate ? formatMoscowDate(startDate) : dateText,
    status: score.teamA !== null || score.teamB !== null ? "finished" : "upcoming",
    teamA,
    teamB,
    score,
    resultText,
    sourceUrl,
    rawText: [
      FIELD_LABELS[options.field],
      options.round,
      matchNo ? `Match ${matchNo}` : null,
      court ? `Court ${court}` : null,
      startDate ? formatMoscowDateTime(startDate) : null,
      `${teamA.name} vs ${teamB.name}`,
      resultText || null,
      sourceUrl,
    ].filter(Boolean).join(" | "),
  };
}

function parseTwelveNdrTeam($cell: cheerio.Cheerio<any>): TwelveNdrTeam {
  const rawName = clean($cell.text());
  if (!rawName) {
    return { name: "TBD", rawName, country: "", seed: "" };
  }

  const seed = clean(rawName.match(/\[(\d+)]/)?.[1]);
  const withoutSeed = clean(rawName.replace(/\[[^\]]+]/g, ""));
  const country = clean(withoutSeed.match(/\s([A-Z]{3})$/)?.[1]);
  const name = normalizeTeamName(country ? withoutSeed.slice(0, -country.length).trim() : withoutSeed);

  return {
    name: name || "TBD",
    rawName,
    country,
    seed,
  };
}

function parseScore(value: string) {
  const text = clean(value).replace(/[–—]/g, "-");
  const matchScore = text.match(/^(\d+)\s*-\s*(\d+)/);
  const setsText = clean(text.match(/\(([^)]+)\)/)?.[1]);
  const sets = setsText.split(/\s*,\s*/).map((set, index) => {
    const match = set.match(/(\d+)\s*-\s*(\d+)/);
    if (!match) return null;
    return { no: index + 1, teamA: Number(match[1]), teamB: Number(match[2]) };
  }).filter((set): set is { no: number; teamA: number; teamB: number } => Boolean(set));

  return {
    teamA: matchScore ? Number(matchScore[1]) : null,
    teamB: matchScore ? Number(matchScore[2]) : null,
    sets,
  };
}

async function fetchTwelveNdrText(url: string, accept: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: accept,
        "User-Agent": TWELVE_NDR_USER_AGENT,
      },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`12ndr HTTP ${response.status}: ${text.slice(0, 220)}`);
    }
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

function buildCalendarUrl(mode: TwelveNdrCalendarMode, season: number) {
  const url = new URL(mode === "oevv" ? "/scripts/calendar.php" : "/scripts/calendar.php", TWELVE_NDR_ORIGIN);
  url.searchParams.set("season", String(season));
  url.searchParams.set("international", mode === "oevv" ? "oevv" : "int");
  url.searchParams.set("week", "");
  url.searchParams.set("json", "x");
  return url.toString();
}

function extractFirstHref(value: unknown) {
  const $ = cheerio.load(String(value ?? ""));
  return clean($("a[href]").first().attr("href"));
}

function stripHtml(value: unknown) {
  return clean(cheerio.load(String(value ?? "")).text());
}

function parseCalendarDateRange(value: string, season: number): [string | null, string | null] {
  const match = clean(value).match(/(\d{2})\.(\d{2})\.\s*-\s*(\d{2})\.(\d{2})\./);
  if (!match) return [null, null];
  return [`${season}-${match[2]}-${match[1]}`, `${season}-${match[4]}-${match[3]}`];
}

function parseHeaderDateRange(value: string): [string | null, string | null] {
  const match = clean(value).match(/\((\d{2})\.(\d{2})\.\s*-\s*(\d{2})\.(\d{2})\.(\d{4})\)/);
  if (!match) return [null, null];
  const year = match[5];
  return [`${year}-${match[2]}-${match[1]}`, `${year}-${match[4]}-${match[3]}`];
}

function parseTwelveNdrDateTime(dateText: string, timeText: string, season: number, timezoneCode: string) {
  const dateMatch = clean(dateText).match(/^(\d{1,2})-([A-Za-z]{3})$/);
  const timeMatch = clean(timeText).match(/^(\d{1,2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) return null;

  const month = MONTHS[dateMatch[2].toLowerCase()];
  if (!month) return null;

  const zone = TIMEZONE_BY_CODE[timezoneCode] || "UTC";
  const parsed = DateTime.fromObject({
    year: season,
    month,
    day: Number(dateMatch[1]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
  }, { zone });
  if (!parsed.isValid) return null;
  return parsed.toUTC().toJSDate();
}

function resolveTournamentStatus(
  startDate: string | null,
  endDate: string | null,
  now = new Date(),
): TwelveNdrTournament["status"] {
  const today = formatMoscowDate(now);
  if (endDate && endDate < today) return "finished";
  if (startDate && startDate <= today && (!endDate || endDate >= today)) return "ongoing";
  return "upcoming";
}

function stripHeaderDates(value: string) {
  return clean(value.replace(/\s*\([^)]*\)\s*$/, ""));
}

function stripSourceTitleMetadata(value: string) {
  return clean(value
    .replace(/\s+—\s+(?:Women|Men|Женщины|Мужчины)\s*(?:\[12NDR-(?:CSVP|OEVV):[^\]]+])?$/i, "")
    .replace(/\s*\[12NDR-(?:CSVP|OEVV):[^\]]+]$/i, ""));
}

function inferGenderFromTcode(tcode: string) {
  const first = clean(tcode).charAt(0).toUpperCase();
  if (first === "W" || first === "F" || first === "G") return "women";
  if (first === "M" || first === "B") return "men";
  return null;
}

function inferSeason(startDate: string | null, endDate: string | null) {
  const value = startDate || endDate;
  const year = Number(value?.slice(0, 4));
  return Number.isFinite(year) ? year : getDefaultTwelveNdrSeason();
}

function inferLocationFromTitle(title: string) {
  return clean(title.split(/\s+-\s+/).pop() || title);
}

function normalizeTeamName(value: string) {
  return clean(value)
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s+/g, " ");
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

function compareTwelveNdrMatches(a: TwelveNdrMatch, b: TwelveNdrMatch) {
  return compareDates(a.startTimeUtc, b.startTimeUtc) || a.id.localeCompare(b.id);
}

function compareDates(left: string | null, right: string | null) {
  const leftTime = left ? new Date(left).getTime() : Number.MAX_SAFE_INTEGER;
  const rightTime = right ? new Date(right).getTime() : Number.MAX_SAFE_INTEGER;
  return leftTime - rightTime;
}

function absoluteTwelveNdrUrl(value: string) {
  const url = clean(value);
  if (!url) return "";
  return new URL(url, TWELVE_NDR_ORIGIN).toString();
}

function normalizeSeason(value: string | number | null | undefined) {
  const parsed = Number(value || getDefaultTwelveNdrSeason());
  if (!Number.isFinite(parsed)) return getDefaultTwelveNdrSeason();
  return Math.min(Math.max(Math.trunc(parsed), 2020), 2035);
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

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
