import { formatMoscowDate, formatMoscowDateTime } from "@backend/matches/scheduleOffset";

export type VolleyballWorldGender = "men" | "women";
export type VolleyballWorldMatchStatus = "upcoming" | "live" | "finished";

export type VolleyballWorldBeachTeam = {
  no: string;
  name: string;
  players: string[];
  country: string;
  code: string;
  flagUrl: string | null;
};

export type VolleyballWorldBeachMatch = {
  id: string;
  tournamentNo: string;
  tournamentName: string;
  competitionSlug: string;
  gender: VolleyballWorldGender;
  status: VolleyballWorldMatchStatus;
  startTimeUtc: string | null;
  startTimeMoscow: string;
  dateKey: string;
  isTbd: boolean;
  city: string;
  country: string;
  court: string;
  phase: string;
  round: string;
  matchNoInTournament: string;
  teamA: VolleyballWorldBeachTeam;
  teamB: VolleyballWorldBeachTeam;
  score: {
    teamA: number | null;
    teamB: number | null;
    sets: Array<{ no: number; teamA: number; teamB: number }>;
  };
  links: {
    matchCenter: string | null;
    watch: string | null;
    tickets: string | null;
    youtube: string | null;
  };
};

export type VolleyballWorldBeachSchedule = {
  ok: true;
  source: "volleyballworld";
  sourceUrl: string;
  fromDate: string;
  toDate: string;
  gender: VolleyballWorldGender;
  generatedAt: string;
  matches: VolleyballWorldBeachMatch[];
  summary: {
    total: number;
    upcoming: number;
    live: number;
    finished: number;
    competitions: number;
  };
};

export type VolleyballWorldBeachTournament = {
  id: string;
  title: string;
  pageUrl: string;
  gender: VolleyballWorldGender;
  city: string;
  country: string;
  location: string;
  dates: string;
  startDate: string | null;
  endDate: string | null;
  status: "ongoing" | "upcoming";
  matchCount: number;
  firstMatchTimeMoscow: string | null;
  tournamentNo: string;
  competitionSlug: string;
  subCompetitionType: string;
  matches: VolleyballWorldBeachMatch[];
};

export type VolleyballWorldBeachTournamentSearch = {
  ok: true;
  source: "volleyballworld";
  fromDate: string;
  toDate: string;
  gender: VolleyballWorldGender;
  query: string;
  tournaments: VolleyballWorldBeachTournament[];
  summary: {
    total: number;
    matches: number;
  };
};

type SourceTeam = {
  no?: number | string | null;
  code?: string | null;
  country?: string | null;
  name?: string | null;
  img?: string | null;
  imgSquared?: string | null;
  translatedName?: string | null;
};

type SourceMatch = {
  competitionSlug?: string | null;
  matchDateUtc?: string | null;
  discipline?: string | null;
  isMatchTBD?: boolean | null;
  gender?: string | null;
  matchNo?: number | string | null;
  matchNoInTournament?: number | string | null;
  matchStatus?: number | string | null;
  ticketLink?: string | null;
  tournamentNo?: number | string | null;
  city?: string | null;
  country?: string | null;
  volleyBallTvLink?: string | null;
  youTubeLink?: string | null;
  matchCenterUrl?: string | null;
  sets?: Array<{ no?: number | string | null; pointsTeamA?: number | string | null; pointsTeamB?: number | string | null }> | null;
  teamAReplacementTBD?: string | null;
  teamANo?: number | string | null;
  teamBReplacementTBD?: string | null;
  teamBNo?: number | string | null;
  teamAScore?: number | string | null;
  teamBScore?: number | string | null;
  competitionShortName?: string | null;
  competitionFullName?: string | null;
  roundName?: string | null;
  phase?: { name?: string | null } | null;
  court?: string | null;
  courtText?: string | null;
};

type SourceTournament = {
  startDate?: string | null;
  endDate?: string | null;
  name?: string | null;
  no?: number | string | null;
  discipline?: string | null;
  city?: string | null;
  country?: string | null;
  gender?: string | null;
  competitionShortName?: string | null;
  competitionFullName?: string | null;
  competitionSlug?: string | null;
  url?: string | null;
  subCompetitionType?: string | null;
};

type SourcePayload = {
  matches?: SourceMatch[] | null;
  allTeams?: SourceTeam[] | null;
  allTournaments?: SourceTournament[] | null;
};

const VOLLEYBALL_WORLD_ORIGIN = "https://en.volleyballworld.com";
const DEFAULT_DAYS = 14;
const MAX_DAYS = 60;

export function normalizeVolleyballWorldGender(value: string | null | undefined): VolleyballWorldGender {
  return readVolleyballWorldGender(value) || "men";
}

function readVolleyballWorldGender(value: string | null | undefined): VolleyballWorldGender | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "women" || normalized === "woman" || normalized === "female" || normalized.startsWith("жен")) {
    return "women";
  }
  if (normalized === "men" || normalized === "man" || normalized === "male" || normalized.startsWith("муж")) {
    return "men";
  }
  return null;
}

export function getDefaultVolleyballWorldFromDate() {
  return formatMoscowDate(new Date());
}

export function resolveVolleyballWorldDateRange(input: { fromDate?: string | null; toDate?: string | null; days?: number | string | null }) {
  const fromDate = parseApiDate(input.fromDate) || parseApiDate(getDefaultVolleyballWorldFromDate())!;
  const requestedDays = Number(input.days || DEFAULT_DAYS);
  const days = Number.isFinite(requestedDays) ? Math.min(Math.max(Math.trunc(requestedDays), 1), MAX_DAYS) : DEFAULT_DAYS;
  const explicitToDate = parseApiDate(input.toDate);
  const toDate = explicitToDate || addDays(fromDate, days - 1);

  return {
    fromDate: formatApiDate(fromDate),
    toDate: formatApiDate(toDate),
    days,
  };
}

export async function fetchVolleyballWorldBeachSchedule(input: {
  gender?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  days?: number | string | null;
} = {}): Promise<VolleyballWorldBeachSchedule> {
  const gender = normalizeVolleyballWorldGender(input.gender);
  const range = resolveVolleyballWorldDateRange(input);
  const url = `${VOLLEYBALL_WORLD_ORIGIN}/api/v1/globalschedule/${range.fromDate}/${range.toDate}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "TData TBvolley/1.0 (+https://en.volleyballworld.com/global-schedule)",
      },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Volleyball World HTTP ${response.status}: ${text.slice(0, 220)}`);
    }

    let payload: SourcePayload;
    try {
      payload = JSON.parse(text) as SourcePayload;
    } catch {
      throw new Error("Volleyball World returned invalid JSON.");
    }

    return normalizeVolleyballWorldSchedule(payload, {
      gender,
      fromDate: range.fromDate,
      toDate: range.toDate,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchVolleyballWorldBeachTournaments(input: {
  gender?: string | null;
  query?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  days?: number | string | null;
} = {}): Promise<VolleyballWorldBeachTournamentSearch> {
  const gender = normalizeVolleyballWorldGender(input.gender);
  const range = resolveVolleyballWorldDateRange(input);
  const schedule = await fetchVolleyballWorldBeachSchedule({ ...range, gender });
  const query = normalizeSearch(input.query || "");
  const tournaments = groupVolleyballWorldBeachTournaments(schedule, query);

  return {
    ok: true,
    source: "volleyballworld",
    fromDate: schedule.fromDate,
    toDate: schedule.toDate,
    gender,
    query,
    tournaments,
    summary: {
      total: tournaments.length,
      matches: tournaments.reduce((sum, tournament) => sum + tournament.matchCount, 0),
    },
  };
}

export function groupVolleyballWorldBeachTournaments(
  schedule: VolleyballWorldBeachSchedule,
  normalizedQuery = "",
): VolleyballWorldBeachTournament[] {
  const activeMatches = schedule.matches.filter((match) => isActiveVolleyballWorldMatch(match));
  const tournamentGroups = new Map<string, VolleyballWorldBeachMatch[]>();

  for (const match of activeMatches) {
    const key = match.tournamentNo || `${match.competitionSlug}:${match.gender}`;
    tournamentGroups.set(key, [...(tournamentGroups.get(key) || []), match]);
  }

  return Array.from(tournamentGroups.entries())
    .map(([id, matches]): VolleyballWorldBeachTournament => {
      const first = matches[0];
      const sortedMatches = [...matches].sort(compareVolleyballWorldMatches);
      const startDate = sortedMatches[0]?.startTimeUtc || null;
      const endDate = sortedMatches[sortedMatches.length - 1]?.startTimeUtc || null;
      const location = [first.city, first.country].filter(Boolean).join(", ");

      return {
        id,
        title: first.tournamentName,
        pageUrl: inferTournamentUrl(first),
        gender: first.gender,
        city: first.city,
        country: first.country,
        location,
        dates: formatTournamentDates(startDate, endDate),
        startDate,
        endDate,
        status: sortedMatches.some((match) => match.status === "live") ? "ongoing" : "upcoming",
        matchCount: sortedMatches.length,
        firstMatchTimeMoscow: sortedMatches[0]?.startTimeMoscow || null,
        tournamentNo: first.tournamentNo,
        competitionSlug: first.competitionSlug,
        subCompetitionType: inferSubCompetitionType(first.tournamentName),
        matches: sortedMatches,
      };
    })
    .filter((tournament) => {
      if (!normalizedQuery) return true;
      return normalizeSearch(`${tournament.title} ${tournament.location} ${tournament.subCompetitionType}`).includes(normalizedQuery);
    })
    .sort((a, b) => {
      const aTime = a.startDate ? new Date(a.startDate).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.startDate ? new Date(b.startDate).getTime() : Number.MAX_SAFE_INTEGER;
      return aTime - bTime || a.title.localeCompare(b.title);
    });
}

export function normalizeVolleyballWorldSchedule(
  payload: SourcePayload,
  options: { gender: VolleyballWorldGender; fromDate: string; toDate: string },
): VolleyballWorldBeachSchedule {
  const teamsByNo = new Map<string, SourceTeam>();
  for (const team of payload.allTeams || []) {
    if (team.no !== undefined && team.no !== null) teamsByNo.set(String(team.no), team);
  }

  const matches = (payload.matches || [])
    .filter((match) => String(match.discipline || "").toLowerCase() === "beach")
    .filter((match) => readVolleyballWorldGender(match.gender) === options.gender)
    .map((match) => normalizeMatch(match, teamsByNo, options.gender))
    .sort((a, b) => {
      const aTime = a.startTimeUtc ? new Date(a.startTimeUtc).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.startTimeUtc ? new Date(b.startTimeUtc).getTime() : Number.MAX_SAFE_INTEGER;
      return aTime - bTime || Number(a.id) - Number(b.id);
    });

  const summary = matches.reduce(
    (acc, match) => {
      acc.total += 1;
      acc[match.status] += 1;
      return acc;
    },
    { total: 0, upcoming: 0, live: 0, finished: 0, competitions: 0 },
  );
  summary.competitions = new Set(matches.map((match) => match.tournamentNo || match.competitionSlug)).size;

  return {
    ok: true,
    source: "volleyballworld",
    sourceUrl: `${VOLLEYBALL_WORLD_ORIGIN}/global-schedule#fromDate=${options.fromDate}&discipline=beach&gender=${options.gender}`,
    fromDate: options.fromDate,
    toDate: options.toDate,
    gender: options.gender,
    generatedAt: new Date().toISOString(),
    matches,
    summary,
  };
}

export function isActiveVolleyballWorldMatch(match: Pick<VolleyballWorldBeachMatch, "status" | "startTimeUtc">, now = new Date()) {
  if (match.status === "finished") return false;
  if (!match.startTimeUtc) return true;
  const start = new Date(match.startTimeUtc);
  if (Number.isNaN(start.getTime())) return true;
  return formatMoscowDate(start) >= formatMoscowDate(now) || match.status === "live";
}

function normalizeMatch(
  match: SourceMatch,
  teamsByNo: Map<string, SourceTeam>,
  gender: VolleyballWorldGender,
): VolleyballWorldBeachMatch {
  const startDate = parseUtcDate(match.matchDateUtc || "");
  const competitionSlug = clean(match.competitionSlug) || "volleyballworld";
  const matchNo = clean(match.matchNo) || `${competitionSlug}-${clean(match.teamANo)}-${clean(match.teamBNo)}`;
  const teamA = resolveTeam(match.teamANo, teamsByNo, match.teamAReplacementTBD);
  const teamB = resolveTeam(match.teamBNo, teamsByNo, match.teamBReplacementTBD);

  return {
    id: matchNo,
    tournamentNo: clean(match.tournamentNo),
    tournamentName: clean(match.competitionShortName) || clean(match.competitionFullName) || competitionSlug,
    competitionSlug,
    gender,
    status: resolveStatus(match.matchStatus),
    startTimeUtc: startDate ? startDate.toISOString() : null,
    startTimeMoscow: startDate ? formatMoscowDateTime(startDate) : "TBD",
    dateKey: startDate ? formatMoscowDate(startDate) : "TBD",
    isTbd: Boolean(match.isMatchTBD),
    city: clean(match.city),
    country: clean(match.country),
    court: clean(match.courtText) || clean(match.court),
    phase: clean(match.phase?.name),
    round: clean(match.roundName),
    matchNoInTournament: clean(match.matchNoInTournament),
    teamA,
    teamB,
    score: {
      teamA: toNullableNumber(match.teamAScore),
      teamB: toNullableNumber(match.teamBScore),
      sets: normalizeSets(match.sets),
    },
    links: {
      matchCenter: absoluteVolleyballWorldUrl(match.matchCenterUrl),
      watch: absoluteVolleyballWorldUrl(match.volleyBallTvLink),
      tickets: absoluteVolleyballWorldUrl(match.ticketLink),
      youtube: absoluteVolleyballWorldUrl(match.youTubeLink),
    },
  };
}

function resolveTeam(no: number | string | null | undefined, teamsByNo: Map<string, SourceTeam>, replacement?: string | null): VolleyballWorldBeachTeam {
  const key = clean(no);
  const source = teamsByNo.get(key);
  const rawName = clean(replacement) || clean(source?.name) || (key && key !== "-1" ? `Team ${key}` : "TBD");
  const placeholder = isVolleyballWorldPlaceholderTeam(rawName);
  const name = placeholder ? "TBD" : rawName;

  return {
    no: key,
    name,
    players: placeholder ? ["TBD"] : name.split("/").map((part) => part.trim()).filter(Boolean),
    country: placeholder ? "" : clean(source?.country) || clean(source?.translatedName),
    code: placeholder ? "" : clean(source?.code),
    flagUrl: placeholder ? null : clean(source?.imgSquared) || clean(source?.img) || null,
  };
}

function isVolleyballWorldPlaceholderTeam(name: string) {
  const normalized = name.toLowerCase().replace(/\s+/g, " ").trim();
  return (
    normalized === "tbd" ||
    normalized === "team -1" ||
    normalized === "draw" ||
    normalized === "main draw" ||
    normalized === "qualification draw" ||
    normalized === "qualifying draw" ||
    /^seed(?:\s*#?\s*\d+)?$/.test(normalized) ||
    /^qualification\s+seed(?:\s*#?\s*\d+)?$/.test(normalized)
  );
}

function compareVolleyballWorldMatches(a: VolleyballWorldBeachMatch, b: VolleyballWorldBeachMatch) {
  const aTime = a.startTimeUtc ? new Date(a.startTimeUtc).getTime() : Number.MAX_SAFE_INTEGER;
  const bTime = b.startTimeUtc ? new Date(b.startTimeUtc).getTime() : Number.MAX_SAFE_INTEGER;
  return aTime - bTime || Number(a.id) - Number(b.id);
}

function inferTournamentUrl(match: VolleyballWorldBeachMatch) {
  const matchUrl = match.links.matchCenter;
  if (matchUrl) {
    const scheduleIndex = matchUrl.indexOf("/schedule/");
    if (scheduleIndex > 0) return matchUrl.slice(0, scheduleIndex + 1);
  }
  return `${VOLLEYBALL_WORLD_ORIGIN}/global-schedule#fromDate=${match.dateKey}&discipline=beach&gender=${match.gender}`;
}

function inferSubCompetitionType(title: string) {
  const normalized = title.toLowerCase();
  if (normalized.includes("elite16")) return "Elite16";
  if (normalized.includes("challenge")) return "Challenge";
  if (normalized.includes("future")) return "Futures";
  if (normalized.includes("final")) return "Finals";
  return "Beach Pro Tour";
}

function formatTournamentDates(startDate: string | null, endDate: string | null) {
  if (!startDate && !endDate) return "";
  const start = startDate ? formatMoscowDate(new Date(startDate)) : "";
  const end = endDate ? formatMoscowDate(new Date(endDate)) : "";
  if (!start || start === end) return start || end;
  return `${start} — ${end}`;
}

function resolveStatus(value: number | string | null | undefined): VolleyballWorldMatchStatus {
  const status = Number(value);
  if (status === 1) return "live";
  if (status === 2) return "finished";
  return "upcoming";
}

function normalizeSets(sets: SourceMatch["sets"]) {
  return (sets || [])
    .map((set, index) => ({
      no: index + 1,
      teamA: Number(set.pointsTeamA || 0),
      teamB: Number(set.pointsTeamB || 0),
    }))
    .filter((set) => set.teamA > 0 || set.teamB > 0);
}

function absoluteVolleyballWorldUrl(value: string | null | undefined) {
  const url = clean(value);
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("~/")) return `${VOLLEYBALL_WORLD_ORIGIN}/${url.slice(2)}`;
  if (url.startsWith("/")) return `${VOLLEYBALL_WORLD_ORIGIN}${url}`;
  return `${VOLLEYBALL_WORLD_ORIGIN}/${url}`;
}

function parseUtcDate(value: string) {
  const cleanValue = clean(value);
  if (!cleanValue) return null;
  const date = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(cleanValue) ? cleanValue : `${cleanValue}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseApiDate(value: string | null | undefined) {
  const match = clean(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function addDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatApiDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
