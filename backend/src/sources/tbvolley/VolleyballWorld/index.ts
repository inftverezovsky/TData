import { formatMoscowDate, formatMoscowDateTime } from "@backend/matches/scheduleOffset";
import { BoundedBodyReadError, readBoundedBodyText } from "@backend/http/boundedResponse";

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
  upstream: VolleyballWorldUpstreamState;
  matches: VolleyballWorldBeachMatch[];
  summary: {
    total: number;
    upcoming: number;
    live: number;
    finished: number;
    competitions: number;
  };
};

export type VolleyballWorldUpstreamState = {
  cacheStatus: "miss" | "fresh" | "stale";
  fetchedAt: string;
  ageMs: number;
  fallbackErrorCode: VolleyballWorldRequestErrorCode | null;
};

export type VolleyballWorldRequestErrorCode =
  | "invalid_request"
  | "request_limit"
  | "upstream_timeout"
  | "upstream_http"
  | "upstream_network"
  | "invalid_json"
  | "invalid_payload"
  | "unconfirmed_empty";

export class VolleyballWorldRequestError extends Error {
  constructor(
    message: string,
    public readonly code: VolleyballWorldRequestErrorCode,
    public readonly statusCode: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "VolleyballWorldRequestError";
  }
}

export function getVolleyballWorldErrorStatus(error: unknown) {
  return error instanceof VolleyballWorldRequestError ? error.statusCode : 500;
}

export function getVolleyballWorldErrorCode(error: unknown) {
  return error instanceof VolleyballWorldRequestError ? error.code : "unknown_error";
}

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
  upstream: VolleyballWorldUpstreamState;
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
const VOLLEYBALL_WORLD_SCHEDULE_PAGE = `${VOLLEYBALL_WORLD_ORIGIN}/global-schedule`;
const VOLLEYBALL_WORLD_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 300_000;
const SUCCESS_CACHE_TTL_MS = 5 * 60_000;
const STALE_POSITIVE_TTL_MS = 24 * 60 * 60_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_DAYS = 14;
const MAX_DAYS = 60;
const MAX_CACHE_ENTRIES = 16;
const MAX_CONCURRENT_UPSTREAM_REQUESTS = 3;
const MAX_NEW_REQUESTS_PER_MINUTE = 20;
const REQUEST_BUDGET_WINDOW_MS = 60_000;

type RawScheduleCacheEntry = {
  payload: SourcePayload;
  fetchedAt: number;
};

type RawScheduleResult = RawScheduleCacheEntry & {
  cacheStatus: VolleyballWorldUpstreamState["cacheStatus"];
  fallbackErrorCode: VolleyballWorldRequestErrorCode | null;
};

const rawScheduleCache = new Map<string, RawScheduleCacheEntry>();
const rawScheduleInFlight = new Map<string, Promise<RawScheduleResult>>();
let requestBudgetWindowStartedAt = 0;
let requestBudgetCount = 0;

export function clearVolleyballWorldScheduleCache() {
  rawScheduleCache.clear();
  rawScheduleInFlight.clear();
  requestBudgetWindowStartedAt = 0;
  requestBudgetCount = 0;
}

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
  const parsedFromDate = parseApiDate(input.fromDate);
  if (clean(input.fromDate) && !parsedFromDate) {
    throw new VolleyballWorldRequestError("Volleyball World fromDate must use a valid YYYY-MM-DD date.", "invalid_request", 400);
  }
  const fromDate = parsedFromDate || parseApiDate(getDefaultVolleyballWorldFromDate())!;
  const requestedDays = Number(input.days || DEFAULT_DAYS);
  const requestedWindowDays = Number.isFinite(requestedDays) ? Math.min(Math.max(Math.trunc(requestedDays), 1), MAX_DAYS) : DEFAULT_DAYS;
  const explicitToDate = parseApiDate(input.toDate);
  if (clean(input.toDate) && !explicitToDate) {
    throw new VolleyballWorldRequestError("Volleyball World toDate must use a valid YYYY-MM-DD date.", "invalid_request", 400);
  }
  if (explicitToDate && explicitToDate < fromDate) {
    throw new VolleyballWorldRequestError("Volleyball World toDate cannot be earlier than fromDate.", "invalid_request", 400);
  }
  const maximumToDate = addDays(fromDate, MAX_DAYS - 1);
  const toDate = explicitToDate
    ? new Date(Math.min(explicitToDate.getTime(), maximumToDate.getTime()))
    : addDays(fromDate, requestedWindowDays - 1);
  const days = Math.floor((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;

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
  forceFresh?: boolean;
  signal?: AbortSignal;
} = {}): Promise<VolleyballWorldBeachSchedule> {
  const gender = normalizeVolleyballWorldGender(input.gender);
  const range = resolveVolleyballWorldDateRange(input);
  const raw = await fetchRawVolleyballWorldSchedule(range.fromDate, range.toDate, Boolean(input.forceFresh), input.signal);

  return normalizeVolleyballWorldSchedule(raw.payload, {
    gender,
    fromDate: range.fromDate,
    toDate: range.toDate,
    upstream: {
      cacheStatus: raw.cacheStatus,
      fetchedAt: new Date(raw.fetchedAt).toISOString(),
      ageMs: Math.max(0, Date.now() - raw.fetchedAt),
      fallbackErrorCode: raw.fallbackErrorCode,
    },
  });
}

async function fetchRawVolleyballWorldSchedule(fromDate: string, toDate: string, forceFresh: boolean, signal?: AbortSignal): Promise<RawScheduleResult> {
  signal?.throwIfAborted();
  const key = `${fromDate}/${toDate}`;
  const requestKey = key;
  const now = Date.now();
  pruneVolleyballWorldScheduleCache(now);
  const cached = readVolleyballWorldScheduleCache(key);

  if (!forceFresh && cached && now - cached.fetchedAt <= SUCCESS_CACHE_TTL_MS) {
    return {
      ...cached,
      cacheStatus: "fresh",
      fallbackErrorCode: null,
    };
  }

  const activeRequest = rawScheduleInFlight.get(requestKey);
  if (activeRequest) return activeRequest;

  reserveVolleyballWorldUpstreamRequest(now);

  const request = (async (): Promise<RawScheduleResult> => {
    try {
      const payload = await requestRawVolleyballWorldScheduleWithRetry(fromDate, toDate, signal);
      const result = { payload, fetchedAt: Date.now() };
      writeVolleyballWorldScheduleCache(key, result);
      return {
        ...result,
        cacheStatus: "miss",
        fallbackErrorCode: null,
      };
    } catch (error) {
      signal?.throwIfAborted();
      if (cached) {
        return {
          ...cached,
          cacheStatus: "stale",
          fallbackErrorCode: error instanceof VolleyballWorldRequestError ? error.code : "upstream_network",
        };
      }
      throw error;
    }
  })();

  rawScheduleInFlight.set(requestKey, request);
  try {
    return await request;
  } finally {
    if (rawScheduleInFlight.get(requestKey) === request) rawScheduleInFlight.delete(requestKey);
  }
}

function pruneVolleyballWorldScheduleCache(now: number) {
  for (const [key, entry] of rawScheduleCache) {
    if (now - entry.fetchedAt > STALE_POSITIVE_TTL_MS) rawScheduleCache.delete(key);
  }
}

function readVolleyballWorldScheduleCache(key: string) {
  const cached = rawScheduleCache.get(key);
  if (!cached) return undefined;
  rawScheduleCache.delete(key);
  rawScheduleCache.set(key, cached);
  return cached;
}

function writeVolleyballWorldScheduleCache(key: string, entry: RawScheduleCacheEntry) {
  rawScheduleCache.delete(key);
  rawScheduleCache.set(key, entry);
  while (rawScheduleCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = rawScheduleCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    rawScheduleCache.delete(oldestKey);
  }
}

function reserveVolleyballWorldUpstreamRequest(now: number) {
  if (rawScheduleInFlight.size >= MAX_CONCURRENT_UPSTREAM_REQUESTS) {
    throw new VolleyballWorldRequestError(
      "Volleyball World has too many concurrent upstream requests.",
      "request_limit",
      429,
    );
  }
  if (!requestBudgetWindowStartedAt || now - requestBudgetWindowStartedAt >= REQUEST_BUDGET_WINDOW_MS) {
    requestBudgetWindowStartedAt = now;
    requestBudgetCount = 0;
  }
  if (requestBudgetCount >= MAX_NEW_REQUESTS_PER_MINUTE) {
    throw new VolleyballWorldRequestError(
      "Volleyball World request budget is temporarily exhausted.",
      "request_limit",
      429,
    );
  }
  requestBudgetCount += 1;
}

async function requestRawVolleyballWorldScheduleWithRetry(fromDate: string, toDate: string, signal?: AbortSignal) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await requestRawVolleyballWorldSchedule(fromDate, toDate, signal);
    } catch (error) {
      lastError = error;
      if (attempt > 0 || !(error instanceof VolleyballWorldRequestError) || !error.retryable) throw error;
      signal?.throwIfAborted();
      await warmUpVolleyballWorldSchedulePage(signal);
    }
  }

  throw lastError;
}

async function warmUpVolleyballWorldSchedulePage(signal?: AbortSignal) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const timeout = setTimeout(() => controller.abort(), Math.min(resolveVolleyballWorldTimeoutMs(), 30_000));

  try {
    const response = await fetch(VOLLEYBALL_WORLD_SCHEDULE_PAGE, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": VOLLEYBALL_WORLD_USER_AGENT,
      },
    });
    await readBoundedBodyText(response, {
      maxBytes: 2 * 1024 * 1024,
      signal: controller.signal,
      label: "Volleyball World warm-up response",
    });
  } catch {
    signal?.throwIfAborted();
    // The API retry is still authoritative; warm-up is only a best-effort compatibility step.
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function requestRawVolleyballWorldSchedule(fromDate: string, toDate: string, signal?: AbortSignal): Promise<SourcePayload> {
  const url = `${VOLLEYBALL_WORLD_ORIGIN}/api/v1/globalschedule/${fromDate}/${toDate}`;
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const timeout = setTimeout(() => controller.abort(), resolveVolleyballWorldTimeoutMs());

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: VOLLEYBALL_WORLD_SCHEDULE_PAGE,
        "User-Agent": VOLLEYBALL_WORLD_USER_AGENT,
      },
    });

    const text = await readBoundedBodyText(response, {
      maxBytes: MAX_RESPONSE_BYTES,
      signal: controller.signal,
      label: "Volleyball World response",
    });
    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new VolleyballWorldRequestError(
        `Volleyball World HTTP ${response.status}: ${text.slice(0, 220)}`,
        "upstream_http",
        502,
        retryable,
      );
    }
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("json")) {
      throw new VolleyballWorldRequestError("Volleyball World returned a non-JSON response.", "invalid_payload", 502);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new VolleyballWorldRequestError("Volleyball World returned invalid JSON.", "invalid_json", 502);
    }
    return validateVolleyballWorldPayload(payload);
  } catch (error) {
    if (error instanceof VolleyballWorldRequestError) throw error;
    if (error instanceof BoundedBodyReadError) {
      throw new VolleyballWorldRequestError(
        error.code === "body_too_large"
          ? "Volleyball World response is too large."
          : "Volleyball World returned an invalid response body.",
        "invalid_payload",
        502,
      );
    }
    if (controller.signal.aborted || isAbortError(error)) {
      throw new VolleyballWorldRequestError(
        `Volleyball World request timed out after ${resolveVolleyballWorldTimeoutMs()} ms.`,
        "upstream_timeout",
        504,
        true,
      );
    }
    throw new VolleyballWorldRequestError("Volleyball World network request failed.", "upstream_network", 502, true);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

function validateVolleyballWorldPayload(payload: unknown): SourcePayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new VolleyballWorldRequestError("Volleyball World payload has an unexpected shape.", "invalid_payload", 502);
  }

  const candidate = payload as SourcePayload;
  if (!Array.isArray(candidate.matches) || !Array.isArray(candidate.allTeams) || !Array.isArray(candidate.allTournaments)) {
    throw new VolleyballWorldRequestError("Volleyball World payload is missing schedule arrays.", "invalid_payload", 502);
  }
  if (candidate.matches.length === 0 && candidate.allTeams.length === 0 && candidate.allTournaments.length === 0) {
    throw new VolleyballWorldRequestError("Volleyball World returned an invalid empty payload.", "invalid_payload", 502);
  }
  if (candidate.matches.length === 0) {
    throw new VolleyballWorldRequestError(
      "Volleyball World returned an unconfirmed empty match array.",
      "unconfirmed_empty",
      502,
    );
  }

  return candidate;
}

function resolveVolleyballWorldTimeoutMs() {
  const configured = Number(process.env.VOLLEYBALL_WORLD_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(configured)) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(Math.trunc(configured), 1), MAX_TIMEOUT_MS);
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export async function searchVolleyballWorldBeachTournaments(input: {
  gender?: string | null;
  query?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  days?: number | string | null;
  forceFresh?: boolean;
  signal?: AbortSignal;
} = {}): Promise<VolleyballWorldBeachTournamentSearch> {
  const gender = normalizeVolleyballWorldGender(input.gender);
  const range = resolveVolleyballWorldDateRange(input);
  const schedule = await fetchVolleyballWorldBeachSchedule({ ...range, gender, forceFresh: input.forceFresh, signal: input.signal });
  const query = normalizeSearch(input.query || "");
  const tournaments = groupVolleyballWorldBeachTournaments(schedule, query);

  return {
    ok: true,
    source: "volleyballworld",
    fromDate: schedule.fromDate,
    toDate: schedule.toDate,
    gender,
    query,
    upstream: schedule.upstream,
    tournaments,
    summary: {
      total: tournaments.length,
      matches: tournaments.reduce((sum, tournament) => sum + tournament.matchCount, 0),
    },
  };
}

export type VolleyballWorldTournamentGenderSummary = {
  rawTotal: number;
  total: number;
  matches: number;
};

export type VolleyballWorldBeachTournamentSearchAll = Omit<VolleyballWorldBeachTournamentSearch, "gender" | "summary"> & {
  gender: "all";
  summary: VolleyballWorldBeachTournamentSearch["summary"] & {
    rawTotal: number;
    filteredOut: number;
    emptyReason: "date_window" | null;
    byGender: Record<VolleyballWorldGender, VolleyballWorldTournamentGenderSummary>;
  };
};

export async function searchAllVolleyballWorldBeachTournaments(input: {
  query?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  days?: number | string | null;
  forceFresh?: boolean;
  signal?: AbortSignal;
} = {}): Promise<VolleyballWorldBeachTournamentSearchAll> {
  const range = resolveVolleyballWorldDateRange(input);
  const raw = await fetchRawVolleyballWorldSchedule(
    range.fromDate,
    range.toDate,
    Boolean(input.forceFresh),
    input.signal,
  );
  const upstream: VolleyballWorldUpstreamState = {
    cacheStatus: raw.cacheStatus,
    fetchedAt: new Date(raw.fetchedAt).toISOString(),
    ageMs: Math.max(0, Date.now() - raw.fetchedAt),
    fallbackErrorCode: raw.fallbackErrorCode,
  };
  const query = normalizeSearch(input.query || "");
  const schedules = (["men", "women"] as const)
    .map((gender) => normalizeVolleyballWorldSchedule(raw.payload, {
        gender,
        fromDate: range.fromDate,
        toDate: range.toDate,
        upstream,
      }));
  const tournaments = schedules
    .flatMap((schedule) => groupVolleyballWorldBeachTournaments(schedule, query))
    .sort((a, b) => {
      const aTime = a.startDate ? new Date(a.startDate).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.startDate ? new Date(b.startDate).getTime() : Number.MAX_SAFE_INTEGER;
      return aTime - bTime || a.title.localeCompare(b.title) || a.gender.localeCompare(b.gender);
    });

  return {
    ok: true,
    source: "volleyballworld",
    fromDate: range.fromDate,
    toDate: range.toDate,
    gender: "all",
    query,
    upstream,
    tournaments,
    summary: buildVolleyballWorldTournamentSearchAllSummary(schedules, tournaments),
  };
}

export function buildVolleyballWorldTournamentSearchAllSummary(
  schedules: ReadonlyArray<Pick<VolleyballWorldBeachSchedule, "gender" | "matches">>,
  tournaments: ReadonlyArray<Pick<VolleyballWorldBeachTournament, "gender" | "matchCount">>,
): VolleyballWorldBeachTournamentSearchAll["summary"] {
  const byGender = Object.fromEntries((["men", "women"] as const).map((gender) => {
    const schedule = schedules.find((candidate) => candidate.gender === gender);
    const rawTournamentKeys = new Set((schedule?.matches || [])
      .map((match) => clean(match.tournamentNo) || clean(match.competitionSlug))
      .filter(Boolean));
    const filtered = tournaments.filter((tournament) => tournament.gender === gender);
    return [gender, {
      rawTotal: rawTournamentKeys.size,
      total: filtered.length,
      matches: filtered.reduce((sum, tournament) => sum + tournament.matchCount, 0),
    }];
  })) as Record<VolleyballWorldGender, VolleyballWorldTournamentGenderSummary>;
  const rawTotal = byGender.men.rawTotal + byGender.women.rawTotal;
  const total = tournaments.length;
  return {
    total,
    matches: tournaments.reduce((sum, tournament) => sum + tournament.matchCount, 0),
    rawTotal,
    filteredOut: rawTotal - total,
    emptyReason: total === 0 && rawTotal > 0 ? "date_window" : null,
    byGender,
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
  options: {
    gender: VolleyballWorldGender;
    fromDate: string;
    toDate: string;
    upstream?: VolleyballWorldUpstreamState;
  },
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
    upstream: options.upstream || {
      cacheStatus: "miss",
      fetchedAt: new Date().toISOString(),
      ageMs: 0,
      fallbackErrorCode: null,
    },
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
  const normalized = clean(value);
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return formatApiDate(date) === normalized ? date : null;
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
