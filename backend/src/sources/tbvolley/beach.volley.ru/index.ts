import * as cheerio from "cheerio";
import { formatMoscowDate, formatMoscowDateTime } from "@backend/matches/scheduleOffset";
import { normalizeBeachVolleyballGender, type BeachVolleyballGender } from "@backend/sources/tbvolley/config";

export type BeachVolleyRuGender = BeachVolleyballGender;
export type BeachVolleyRuTournamentKind = "all" | "cup" | "championship";
export type BeachVolleyRuMatchStatus = "upcoming" | "finished";

export type BeachVolleyRuTeam = {
  name: string;
  players: string;
  club: string;
};

export type BeachVolleyRuMatch = {
  id: string;
  eventId: string;
  gender: BeachVolleyRuGender;
  stage: string;
  round: string;
  court: string;
  startTimeUtc: string | null;
  startTimeMoscow: string;
  dateKey: string;
  status: BeachVolleyRuMatchStatus;
  teamA: BeachVolleyRuTeam;
  teamB: BeachVolleyRuTeam;
  score: {
    teamA: number | null;
    teamB: number | null;
    sets: Array<{ no: number; teamA: number; teamB: number }>;
  };
  sourceUrl: string;
  rawText: string;
};

export type BeachVolleyRuTournament = {
  id: string;
  eventId: string;
  title: string;
  sourceTitle: string;
  pageUrl: string;
  gender: BeachVolleyRuGender;
  kind: Exclude<BeachVolleyRuTournamentKind, "all">;
  category: string;
  stageTitle: string;
  city: string;
  location: string;
  dates: string;
  startDate: string | null;
  endDate: string | null;
  status: "finished" | "ongoing" | "upcoming";
  sourceStatus: string;
  prizePool: string;
  matches?: BeachVolleyRuMatch[];
  matchCount?: number;
};

export type BeachVolleyRuTournamentSearch = {
  ok: true;
  source: "beachvolleyru";
  sourceUrl: string;
  year: number;
  fromDate: string;
  toDate: string;
  windowDays: number;
  gender: BeachVolleyRuGender;
  kind: BeachVolleyRuTournamentKind;
  query: string;
  tournaments: BeachVolleyRuTournament[];
  summary: {
    total: number;
    cup: number;
    championship: number;
  };
};

export type BeachVolleyRuUpcomingWindow = {
  fromDate: string;
  toDate: string;
  windowDays: number;
};

const BEACH_VOLLEY_RU_ORIGIN = "https://beach.volley.ru";
const BEACH_VOLLEY_RU_USER_AGENT = "TData TBvolley/1.0 (+https://beach.volley.ru/calendar/)";
const UPCOMING_WINDOW_MONTHS = 1;
const GENDER_TO_SEX: Record<BeachVolleyRuGender, string> = {
  men: "1",
  women: "0",
};

export function normalizeBeachVolleyRuGender(value: unknown): BeachVolleyRuGender {
  return normalizeBeachVolleyballGender(value) || "men";
}

export function normalizeBeachVolleyRuKind(value: unknown): BeachVolleyRuTournamentKind {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["cup", "kubok", "кубок"].includes(normalized)) return "cup";
  if (["championship", "champ", "chempionat", "чемпионат"].includes(normalized)) return "championship";
  return "all";
}

export function getDefaultBeachVolleyRuYear() {
  const value = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Moscow",
    year: "numeric",
  }).format(new Date());
  const year = Number(value);
  return Number.isFinite(year) ? year : new Date().getUTCFullYear();
}

export function resolveBeachVolleyRuUpcomingWindow(now = new Date()): BeachVolleyRuUpcomingWindow {
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

export function filterBeachVolleyRuUpcomingTournaments(
  tournaments: BeachVolleyRuTournament[],
  window: BeachVolleyRuUpcomingWindow = resolveBeachVolleyRuUpcomingWindow(),
) {
  return tournaments.filter((tournament) => isBeachVolleyRuTournamentInUpcomingWindow(tournament, window));
}

export function isActiveBeachVolleyRuMatch(
  match: Pick<BeachVolleyRuMatch, "status" | "startTimeUtc">,
  window: BeachVolleyRuUpcomingWindow = resolveBeachVolleyRuUpcomingWindow(),
) {
  if (match.status === "finished" || !match.startTimeUtc) return false;
  const dateKey = formatMoscowDate(new Date(match.startTimeUtc));
  return dateKey >= window.fromDate && dateKey <= window.toDate;
}

export async function searchBeachVolleyRuTournaments(input: {
  year?: string | number | null;
  gender?: string | null;
  kind?: string | null;
  query?: string | null;
} = {}): Promise<BeachVolleyRuTournamentSearch> {
  const year = normalizeYear(input.year);
  const gender = normalizeBeachVolleyRuGender(input.gender);
  const kind = normalizeBeachVolleyRuKind(input.kind);
  const query = normalizeSearch(input.query || "");
  const sourceUrl = buildCalendarUrl(year);
  const html = await fetchBeachVolleyRuHtml(sourceUrl);
  const window = resolveBeachVolleyRuUpcomingWindow();
  const tournaments = filterBeachVolleyRuUpcomingTournaments(
    parseBeachVolleyRuCalendar(html, { gender, kind, query }),
    window,
  );

  return {
    ok: true,
    source: "beachvolleyru",
    sourceUrl,
    year,
    fromDate: window.fromDate,
    toDate: window.toDate,
    windowDays: window.windowDays,
    gender,
    kind,
    query,
    tournaments,
    summary: {
      total: tournaments.length,
      cup: tournaments.filter((tournament) => tournament.kind === "cup").length,
      championship: tournaments.filter((tournament) => tournament.kind === "championship").length,
    },
  };
}

export async function fetchBeachVolleyRuTournament(input: {
  eventId?: string | number | null;
  title?: string | null;
  pageUrl?: string | null;
  gender?: string | null;
}): Promise<BeachVolleyRuTournament> {
  const gender = normalizeBeachVolleyRuGender(input.gender || inferGenderFromText(input.title) || inferGenderFromText(input.pageUrl));
  const eventId = clean(input.eventId)
    || extractBeachVolleyRuEventId(input.pageUrl)
    || extractBeachVolleyRuEventId(input.title);

  if (!eventId) {
    throw new Error("Не удалось определить ID турнира beach.volley.ru");
  }

  const pageUrl = buildEventGamesUrl(eventId, gender);
  const html = await fetchBeachVolleyRuHtml(pageUrl);
  const tournament = parseBeachVolleyRuTournamentPage(html, {
    eventId,
    gender,
    requestedTitle: input.title || "",
    pageUrl,
  });

  return tournament;
}

export function parseBeachVolleyRuCalendar(
  html: string,
  options: {
    gender: BeachVolleyRuGender;
    kind: BeachVolleyRuTournamentKind;
    query?: string;
  },
): BeachVolleyRuTournament[] {
  const $ = cheerio.load(html);
  const tournaments: BeachVolleyRuTournament[] = [];

  $(".vl-table-line").each((_, element) => {
    const $line = $(element);
    if ($line.hasClass("vl-table-line--header")) return;

    const cells = $line.find(".vl-table-line__item").map((__, cell) => clean($(cell).text())).get();
    if (cells.length < 6) return;

    const href = clean($line.attr("href")) || clean($line.find("a[href]").first().attr("href"));
    const eventId = extractBeachVolleyRuEventId(href);
    if (!eventId) return;

    const dates = cells[1] || "";
    const category = cells[2] || "";
    const city = cells[3] || "";
    const sourceStatus = stripLabel(cells[4], "Статус");
    const stageTitle = stripLabel(cells[5], "Этап");
    const prizePool = cells[6] || "";
    const kind = resolveTournamentKind(category, stageTitle);
    if (!kind) return;
    if (options.kind !== "all" && kind !== options.kind) return;

    const [startDate, endDate] = parseDateRange(dates);
    const title = buildTournamentTitle(stageTitle || category, city);
    const pageUrl = buildEventGamesUrl(eventId, options.gender);
    const sourceTitle = buildBeachVolleyRuSourceTitle(title, options.gender, eventId);

    const tournament: BeachVolleyRuTournament = {
      id: eventId,
      eventId,
      title,
      sourceTitle,
      pageUrl,
      gender: options.gender,
      kind,
      category,
      stageTitle,
      city,
      location: city,
      dates,
      startDate,
      endDate,
      status: resolveTournamentStatus(sourceStatus, startDate, endDate),
      sourceStatus,
      prizePool,
    };

    if (options.query && !normalizeSearch([
      tournament.title,
      tournament.category,
      tournament.stageTitle,
      tournament.city,
      tournament.dates,
    ].join(" ")).includes(options.query)) {
      return;
    }

    tournaments.push(tournament);
  });

  return tournaments.sort((a, b) => compareDates(a.startDate, b.startDate) || a.title.localeCompare(b.title));
}

export function parseBeachVolleyRuTournamentPage(
  html: string,
  options: {
    eventId: string;
    gender: BeachVolleyRuGender;
    requestedTitle?: string | null;
    pageUrl: string;
  },
): BeachVolleyRuTournament {
  const $ = cheerio.load(html);
  const headerTitle = clean($(".vl-table-header__h1").first().text()) || clean($("h1").first().text());
  const requestedTitle = stripSourceTitleMetadata(options.requestedTitle || "");
  const title = requestedTitle && !isSourceTitleOnly(requestedTitle)
    ? stripGenderSuffix(requestedTitle)
    : headerTitle || `beach.volley.ru ${options.eventId}`;
  const dates = clean($(".vl-table-header__date").first().text()) || clean($("meta[name=\"description\"]").attr("content"));
  const [startDate, endDate] = parseDateRange(dates);
  const city = inferCityFromTitle(title);
  const kind = resolveTournamentKind(title, title) || "championship";
  const matches = parseBeachVolleyRuMatches(html, { eventId: options.eventId, gender: options.gender });
  const sourceTitle = buildBeachVolleyRuSourceTitle(title, options.gender, options.eventId);

  return {
    id: options.eventId,
    eventId: options.eventId,
    title,
    sourceTitle,
    pageUrl: options.pageUrl,
    gender: options.gender,
    kind,
    category: kind === "cup" ? "Кубок России" : "Чемпионат России",
    stageTitle: title.replace(/\.\s*[^.]+$/, ""),
    city,
    location: city,
    dates,
    startDate,
    endDate,
    status: matches.some((match) => match.status === "upcoming")
      ? "upcoming"
      : resolveTournamentStatus("", startDate, endDate),
    sourceStatus: "",
    prizePool: "",
    matches,
    matchCount: matches.length,
  };
}

export function parseBeachVolleyRuMatches(
  html: string,
  options: { eventId: string; gender: BeachVolleyRuGender },
): BeachVolleyRuMatch[] {
  const $ = cheerio.load(html);
  const matches: BeachVolleyRuMatch[] = [];
  let currentStage = "";

  $(".main-content").children().each((_, element) => {
    const $element = $(element);
    if ($element.hasClass("result-cards-title__h3") || /^h[1-6]$/i.test(String(element.tagName || ""))) {
      const heading = clean($element.text());
      if (heading) currentStage = heading;
      return;
    }

    if (!$element.hasClass("result-card")) return;
    const match = parseBeachVolleyRuMatchCard($, $element, {
      eventId: options.eventId,
      gender: options.gender,
      stage: currentStage,
    });
    if (match) matches.push(match);
  });

  if (matches.length === 0) {
    $(".result-card").each((_, element) => {
      const $card = $(element);
      const stage = clean($card.prevAll(".result-cards-title__h3").first().text());
      const match = parseBeachVolleyRuMatchCard($, $card, {
        eventId: options.eventId,
        gender: options.gender,
        stage,
      });
      if (match) matches.push(match);
    });
  }

  return matches.sort((a, b) => compareDates(a.startTimeUtc, b.startTimeUtc) || a.id.localeCompare(b.id));
}

export function buildEventGamesUrl(eventId: string, gender: BeachVolleyRuGender) {
  const url = new URL(`/calendar/${eventId}/allgames`, BEACH_VOLLEY_RU_ORIGIN);
  url.searchParams.set("sex", GENDER_TO_SEX[gender]);
  return url.toString();
}

export function buildBeachVolleyRuSourceTitle(title: string, gender: BeachVolleyRuGender, eventId: string) {
  return `${stripGenderSuffix(title)} — ${gender === "women" ? "Women" : "Men"} [BVRU:${eventId}]`;
}

export function extractBeachVolleyRuEventId(value: unknown) {
  const text = clean(value);
  return clean(text.match(/\[BVRU:([^\]]+)]/i)?.[1])
    || clean(text.match(/(?:^|\/)calendar\/([^/?#\s]+)/i)?.[1]);
}

function parseBeachVolleyRuMatchCard(
  $: cheerio.CheerioAPI,
  $card: cheerio.Cheerio<any>,
  options: { eventId: string; gender: BeachVolleyRuGender; stage: string },
): BeachVolleyRuMatch | null {
  const gameLink = clean($card.attr("data-link")) || clean($card.find("a[href*=\"games/\"]").first().attr("href"));
  const sourceUrl = absoluteBeachVolleyRuUrl(gameLink);
  const id = clean(gameLink.match(/games\/([^/?#\s]+)/i)?.[1]) || clean(sourceUrl.match(/\/games\/([^/?#\s]+)/i)?.[1]);
  if (!id) return null;

  const dateTime = parseMoscowDateTime(clean($card.attr("data-ts")) || `${clean($card.find(".result-card__date").first().text())} ${clean($card.find(".result-card__time").first().text())}`);
  const score = parseScore($, $card);
  const teamA = parseCardTeam($, $card, "left");
  const teamB = parseCardTeam($, $card, "right");
  const round = clean($card.find(".result-card__number").first().text());
  const court = clean($card.find(".result-card__court").first().text());
  const sets = $card.find(".result-table-col__sets-stats-numb").map((index, element) => parseSet(clean($(element).text()), index)).get()
    .filter((set): set is { no: number; teamA: number; teamB: number } => Boolean(set));

  return {
    id,
    eventId: options.eventId,
    gender: options.gender,
    stage: options.stage,
    round,
    court,
    startTimeUtc: dateTime ? dateTime.toISOString() : null,
    startTimeMoscow: dateTime ? formatMoscowDateTime(dateTime) : "",
    dateKey: dateTime ? formatMoscowDate(dateTime) : "",
    status: score.teamA !== null || score.teamB !== null ? "finished" : "upcoming",
    teamA,
    teamB,
    score: {
      teamA: score.teamA,
      teamB: score.teamB,
      sets,
    },
    sourceUrl,
    rawText: [
      options.stage,
      round,
      court,
      dateTime ? formatMoscowDateTime(dateTime) : null,
      `${teamA.name} vs ${teamB.name}`,
      sets.length > 0 ? sets.map((set) => `${set.teamA}:${set.teamB}`).join(", ") : null,
      sourceUrl,
    ].filter(Boolean).join(" | "),
  };
}

function parseCardTeam($: cheerio.CheerioAPI, $card: cheerio.Cheerio<any>, side: "left" | "right"): BeachVolleyRuTeam {
  const $team = $card.find(`.result-card-col__team--${side}`).first();
  const club = clean($team.find(".result-card-col__team-name").first().text());
  const players = normalizePlayersName($team.find(".result-card-col__team-players").first().text());
  return {
    name: players || club || "TBD",
    players,
    club,
  };
}

function parseScore($: cheerio.CheerioAPI, $card: cheerio.Cheerio<any>) {
  const values = $card.find(".result-card-col__score-numb").map((_, element) => toNullableNumber(clean($(element).text()))).get();
  return {
    teamA: values[0] ?? null,
    teamB: values[1] ?? null,
  };
}

function parseSet(value: string, index: number) {
  const match = value.match(/(\d+)\s*:\s*(\d+)/);
  if (!match) return null;
  return {
    no: index + 1,
    teamA: Number(match[1]),
    teamB: Number(match[2]),
  };
}

function buildCalendarUrl(year: number) {
  const url = new URL("/calendar/", BEACH_VOLLEY_RU_ORIGIN);
  url.searchParams.set("year", String(year));
  return url.toString();
}

async function fetchBeachVolleyRuHtml(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": BEACH_VOLLEY_RU_USER_AGENT,
      },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`beach.volley.ru HTTP ${response.status}: ${text.slice(0, 220)}`);
    }
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeYear(value: string | number | null | undefined) {
  const parsed = Number(value || getDefaultBeachVolleyRuYear());
  if (!Number.isFinite(parsed)) return getDefaultBeachVolleyRuYear();
  return Math.min(Math.max(Math.trunc(parsed), 2022), 2035);
}

function resolveTournamentKind(category: string, stageTitle: string): Exclude<BeachVolleyRuTournamentKind, "all"> | null {
  const text = `${category} ${stageTitle}`;
  if (/(^|\s)Кубок России($|\s)/i.test(text)) return "cup";
  if (/(^|\s)Чемпионат России($|\s)/i.test(text)) return "championship";
  return null;
}

function resolveTournamentStatus(sourceStatus: string, startDate: string | null, endDate: string | null): BeachVolleyRuTournament["status"] {
  const status = sourceStatus.toLowerCase();
  if (status.includes("провед")) return "finished";
  if (status.includes("ид")) return "ongoing";
  if (status.includes("заплан")) return "upcoming";

  const today = formatMoscowDate(new Date());
  if (endDate && endDate < today) return "finished";
  if (startDate && startDate <= today && (!endDate || endDate >= today)) return "ongoing";
  return "upcoming";
}

function buildTournamentTitle(stageTitle: string, city: string) {
  const title = clean(stageTitle);
  const place = clean(city);
  if (!place) return title;
  if (title.toLowerCase().endsWith(place.toLowerCase())) return title;
  return `${title}. ${place}`;
}

function stripLabel(value: string, label: string) {
  return clean(value.replace(new RegExp(`^${label}\\s*:`, "i"), ""));
}

function parseDateRange(value: string): [string | null, string | null] {
  const dates = Array.from(value.matchAll(/(\d{2})\.(\d{2})\.(\d{4})/g));
  if (dates.length === 0) return [null, null];
  const first = dateMatchToIso(dates[0]);
  const last = dateMatchToIso(dates[dates.length - 1]);
  return [first, last];
}

function isBeachVolleyRuTournamentInUpcomingWindow(tournament: BeachVolleyRuTournament, window: BeachVolleyRuUpcomingWindow) {
  if (!tournament.startDate) return false;
  if (tournament.status === "finished") return false;

  const endDate = tournament.endDate || tournament.startDate;
  return tournament.startDate <= window.toDate && endDate >= window.fromDate;
}

function dateMatchToIso(match: RegExpMatchArray) {
  return `${match[3]}-${match[2]}-${match[1]}`;
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

function parseMoscowDateTime(value: string) {
  const match = clean(value).match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2})[:.](\d{2})/);
  if (!match) return null;
  return new Date(Date.UTC(
    Number(match[3]),
    Number(match[2]) - 1,
    Number(match[1]),
    Number(match[4]) - 3,
    Number(match[5]),
    0,
  ));
}

function inferCityFromTitle(title: string) {
  return clean(title.match(/\.\s*([^.]+)$/)?.[1]);
}

function stripGenderSuffix(value: string) {
  return clean(value
    .replace(/\s+—\s+(?:Women|Men|Женщины|Мужчины)\s*(?:\[BVRU:[^\]]+])?$/i, "")
    .replace(/\s*\[BVRU:[^\]]+]$/i, ""));
}

function stripSourceTitleMetadata(value: string) {
  return clean(value.replace(/\s*\[BVRU:[^\]]+]$/i, ""));
}

function isSourceTitleOnly(value: string) {
  return /^\s*(?:Women|Men|Женщины|Мужчины)?\s*\[?BVRU:/i.test(value);
}

function inferGenderFromText(value: unknown) {
  const text = String(value ?? "").toLowerCase();
  if (/\bwomen\b|жен/i.test(text)) return "women";
  if (/\bmen\b|муж/i.test(text)) return "men";
  const sex = text.match(/[?&]sex=([01])\b/);
  if (sex?.[1] === "0") return "women";
  if (sex?.[1] === "1") return "men";
  return null;
}

function absoluteBeachVolleyRuUrl(value: string) {
  const url = clean(value);
  if (!url) return BEACH_VOLLEY_RU_ORIGIN;
  return new URL(url, BEACH_VOLLEY_RU_ORIGIN).toString();
}

function normalizePlayersName(value: unknown) {
  return clean(value).replace(/\s*\/\s*/g, " / ");
}

function normalizeSearch(value: string) {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-z0-9а-я]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compareDates(left: string | null, right: string | null) {
  const leftTime = left ? new Date(left).getTime() : Number.MAX_SAFE_INTEGER;
  const rightTime = right ? new Date(right).getTime() : Number.MAX_SAFE_INTEGER;
  return leftTime - rightTime;
}

function toNullableNumber(value: unknown) {
  const text = clean(value);
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
