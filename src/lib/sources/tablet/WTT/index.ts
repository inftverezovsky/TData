import { formatMoscowDate, formatMoscowDateTime } from "@/lib/matches/scheduleOffset";
import {
  normalizeTableTennisCategoryScope,
  type TableTennisCategoryScope,
} from "@/lib/sources/tablet/config";

export type WttMatchStatus = "upcoming" | "live" | "finished";

export type WttSubEvent = {
  subEventId?: number | string | null;
  subEventName?: string | null;
  subEventType?: string | null;
  subEventCode?: string | null;
  numberOfTotalMatches?: number | string | null;
  gender?: string | null;
};

export type WttCategorySummary = {
  scope: TableTennisCategoryScope;
  label: string;
  matchCount: number;
  firstMatchTimeMoscow: string | null;
};

export type WttTournamentEvent = {
  eventId: string;
  title: string;
  pageUrl: string;
  status: "ongoing" | "upcoming";
  startDate: string | null;
  endDate: string | null;
  dates: string;
  location: string;
  countryName: string;
  countryCode: string;
  city: string;
  venueName: string;
  timeZoneId: string | null;
  timeZoneCode: string | null;
  tournamentCategoryId: string | null;
  categoryName: string;
  tierName: string;
  matchCount: number;
  firstMatchTimeMoscow: string | null;
  categories: WttCategorySummary[];
  subEvents: WttSubEvent[];
};

export type WttTournamentSearch = {
  ok: true;
  source: "wtt";
  fromDate: string;
  toDate: string;
  query: string;
  tournaments: WttTournamentEvent[];
  summary: {
    total: number;
    matches: number;
  };
};

export type WttCompetitor = {
  code: string;
  type: string;
  organization: string;
  seed: string;
  name: string;
  ifId: string;
  rawText: string | null;
};

export type WttMatch = {
  id: string;
  eventId: string;
  code: string;
  status: WttMatchStatus;
  startTimeUtc: string | null;
  startTimeMoscow: string;
  dateKey: string;
  endTimeUtc: string | null;
  subEvent: string;
  eventCategory: string;
  round: string;
  draw: string;
  stage: string;
  court: string;
  venueName: string;
  sourceUrl: string;
  teamA: WttCompetitor;
  teamB: WttCompetitor;
  rawText: string | null;
  categoryScope: TableTennisCategoryScope | null;
};

export type WttSchedule = {
  ok: true;
  source: "wtt";
  sourceUrl: string;
  eventId: string;
  timeZoneId: string | null;
  timeZoneCode: string | null;
  generatedAt: string;
  matches: WttMatch[];
  summary: {
    total: number;
    upcoming: number;
    live: number;
    finished: number;
  };
};

type SourceWttEvent = {
  eventId?: number | string | null;
  eventName?: string | null;
  EventId?: number | string | null;
  EventName?: string | null;
  startDateTime?: string | null;
  StartDateTime?: string | null;
  endDateTime?: string | null;
  EndDateTime?: string | null;
  countryCode?: string | null;
  CountryCode?: string | null;
  countryName?: string | null;
  Country?: string | null;
  city?: string | null;
  City?: string | null;
  venueName?: string | null;
  VenueName?: string | null;
  timeZoneId?: number | string | null;
  TimeZoneId?: number | string | null;
  tournamentCategoryId?: number | string | null;
  TournamentCategoryId?: number | string | null;
  categoryName?: string | null;
  tournamentCategoryName?: string | null;
  Name?: string | null;
  event_Tier_name?: string | null;
  Event_Tier_Name?: string | null;
  subEvents?: string | WttSubEvent[] | null;
  SubEvents?: string | WttSubEvent[] | null;
};

type SourceSchedulePayload = Array<{
  Competition?: {
    Unit?: SourceWttUnit[] | null;
  } | null;
}>;

type SourceWttUnit = {
  Code?: string | null;
  EndDate?: string | null;
  HideEndDate?: boolean | null;
  Location?: string | null;
  ScheduleStatus?: string | null;
  StartDate?: string | null;
  HideStartDate?: boolean | null;
  Venue?: string | null;
  SubEvent?: string | null;
  EventCategory?: string | null;
  Round?: string | null;
  Draw?: string | null;
  ItemName?: SourceLocalizedText[] | null;
  ItemDescription?: SourceLocalizedText[] | null;
  VenueDescription?: {
    LocationName?: string | null;
    VenueName?: string | null;
  } | null;
  StartList?: {
    Start?: SourceWttStart[] | null;
  } | null;
  Result?: unknown;
  ActualStartDate?: string | null;
  ActualEndDate?: string | null;
};

type SourceLocalizedText = {
  Language?: string | null;
  Value?: string | null;
};

type SourceWttStart = {
  StartOrder?: number | string | null;
  SortOrder?: number | string | null;
  PreviousWLT?: string | null;
  PreviousUnit?: string | null;
  Competitor?: {
    Code?: string | null;
    Type?: string | null;
    Organization?: string | null;
    Seed?: number | string | null;
    Qualifier?: boolean | null;
    Description?: {
      TeamName?: string | null;
      IfId?: string | null;
    } | null;
    Composition?: {
      Athlete?: Array<{
        Code?: string | null;
        Order?: number | string | null;
        Description?: {
          GivenName?: string | null;
          FamilyName?: string | null;
          TeamName?: string | null;
          Organization?: string | null;
          IfId?: string | null;
        } | null;
      }> | null;
    } | null;
  } | null;
};

type SourceWttAthlete = NonNullable<
  NonNullable<NonNullable<SourceWttStart["Competitor"]>["Composition"]>["Athlete"]
>[number];

export const WTT_ORIGIN = "https://www.worldtabletennis.com";
export const WTT_EVENTS_ENDPOINT =
  "https://wtt-web-frontdoor-cthahjeqhbh6aqe3.a01.azurefd.net/websitestaticapifiles/general/wtt_upcoming_only_events_list.json";
export const WTT_EVENTS_TITLE_FALLBACK_ENDPOINT =
  "https://wtt-web-frontdoor-cthahjeqhbh6aqe3.a01.azurefd.net/websitestaticapifiles/general/wtt_all_events_only_name.json";
export const WTT_FRONTDOOR_ORIGIN = "https://wtt-web-frontdoor-cthahjeqhbh6aqe3.a01.azurefd.net";
export const WTT_SCORE_API_ORIGIN = "https://liveeventsapi.worldtabletennis.com/api";

const DEFAULT_DAYS = 14;
const MAX_DAYS = 90;
const SCHEDULE_SUMMARY_LIMIT = 30;

const WTT_TIME_ZONE_CODES: Record<string, string> = {
  "3": "UTC-12:00",
  "4": "UTC-11:00",
  "5": "UTC-10:00",
  "6": "UTC-09:00",
  "7": "UTC-08:00",
  "8": "UTC-07:00",
  "9": "UTC-08:00",
  "10": "UTC-07:00",
  "11": "UTC-07:00",
  "12": "UTC-07:00",
  "13": "UTC-06:00",
  "14": "UTC-06:00",
  "15": "UTC-06:00",
  "16": "UTC-06:00",
  "17": "UTC-05:00",
  "18": "UTC-05:00",
  "19": "UTC-05:00",
  "20": "UTC-04:30",
  "21": "UTC-04:00",
  "22": "UTC-04:00",
  "23": "UTC-04:00",
  "24": "UTC-04:00",
  "25": "UTC-04:00",
  "26": "UTC-03:30",
  "27": "UTC-03:00",
  "28": "UTC-03:00",
  "29": "UTC-03:00",
  "30": "UTC-03:00",
  "31": "UTC-03:00",
  "32": "UTC-03:00",
  "33": "UTC-02:00",
  "34": "UTC-02:00",
  "35": "UTC-01:00",
  "36": "UTC-01:00",
  "37": "UTC",
  "38": "UTC",
  "39": "UTC",
  "40": "UTC+01:00",
  "41": "UTC",
  "42": "UTC",
  "43": "UTC+01:00",
  "44": "UTC+01:00",
  "45": "UTC+01:00",
  "46": "UTC+01:00",
  "47": "UTC+01:00",
  "48": "UTC+01:00",
  "49": "UTC+02:00",
  "50": "UTC+02:00",
  "51": "UTC+02:00",
  "52": "UTC+02:00",
  "53": "UTC+02:00",
  "54": "UTC+02:00",
  "55": "UTC+02:00",
  "56": "UTC+03:00",
  "57": "UTC+02:00",
  "58": "UTC+02:00",
  "59": "UTC+03:00",
  "60": "UTC+03:00",
  "61": "UTC+02:00",
  "62": "UTC+03:00",
  "63": "UTC+03:00",
  "64": "UTC+03:00",
  "65": "UTC+04:00",
  "66": "UTC+03:30",
  "67": "UTC+04:00",
  "68": "UTC+04:00",
  "69": "UTC+04:00",
  "70": "UTC+04:00",
  "71": "UTC+04:00",
  "72": "UTC+04:30",
  "73": "UTC+05:00",
  "74": "UTC+05:00",
  "75": "UTC+05:00",
  "76": "UTC+05:30",
  "77": "UTC+05:30",
  "78": "UTC+05:45",
  "79": "UTC+06:00",
  "80": "UTC+06:00",
  "81": "UTC+06:30",
  "82": "UTC+07:00",
  "83": "UTC+07:00",
  "84": "UTC+08:00",
  "85": "UTC+08:00",
  "86": "UTC+08:00",
  "87": "UTC+08:00",
  "88": "UTC+08:00",
  "89": "UTC+08:00",
  "90": "UTC+08:00",
  "91": "UTC+09:00",
  "92": "UTC+09:00",
  "93": "UTC+09:30",
  "94": "UTC+09:30",
  "95": "UTC+10:00",
  "96": "UTC+10:00",
  "97": "UTC+10:00",
  "98": "UTC+10:00",
  "99": "UTC+09:00",
  "100": "UTC+11:00",
  "101": "UTC+11:00",
  "102": "UTC+12:00",
  "103": "UTC+12:00",
  "104": "UTC+12:00",
  "105": "UTC+12:00",
  "106": "UTC+12:00",
  "107": "UTC+13:00",
  "108": "UTC+13:00",
};

const WTT_CATEGORY_NAMES_BY_ID: Record<string, string> = {
  "34": "WTT Contender",
  "35": "WTT Star Contender",
  "64": "WTT Grand Smash",
  "65": "WTT Champions",
  "68": "WTT Youth Star Contender",
  "69": "WTT Youth Contender",
  "75": "WTT Finals",
  "81": "WTT Feeder",
};

export function getDefaultWttFromDate() {
  return formatMoscowDate(new Date());
}

export function resolveWttDateRange(input: { fromDate?: string | null; toDate?: string | null; days?: number | string | null }) {
  const fromDate = parseApiDate(input.fromDate) || parseApiDate(getDefaultWttFromDate())!;
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

export async function fetchWttEvents(): Promise<SourceWttEvent[]> {
  try {
    const events = await fetchWttPrimaryEvents();
    if (events.length > 0) return events as SourceWttEvent[];
  } catch {
    // Fall through to the title-only WTT blob. The caller still gets a useful tournament list.
  }

  const dateKey = new Date().toISOString().slice(0, 10);
  const payload = await fetchJson<unknown>(
    `${WTT_EVENTS_TITLE_FALLBACK_ENDPOINT}?q=${encodeURIComponent(dateKey)}`,
    "TData TableT/WTT (+https://www.worldtabletennis.com/eventslist)",
  );
  return unwrapRows(payload) as SourceWttEvent[];
}

async function fetchWttPrimaryEvents(): Promise<SourceWttEvent[]> {
  const payload = await fetchJson<unknown>(WTT_EVENTS_ENDPOINT, "TData TableT/WTT (+https://www.worldtabletennis.com/eventslist)");
  return unwrapRows(payload) as SourceWttEvent[];
}

export async function searchWttTournaments(input: {
  query?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  days?: number | string | null;
} = {}): Promise<WttTournamentSearch> {
  const range = resolveWttDateRange(input);
  const query = normalizeSearch(input.query || "");
  const events = normalizeWttTournamentEvents(await fetchWttEvents())
    .filter((event) => isTournamentInRange(event, range.fromDate, range.toDate))
    .filter((event) => {
      if (!query) return true;
      return normalizeSearch(`${event.title} ${event.location} ${event.categoryName} ${event.tierName}`).includes(query);
    })
    .sort(compareWttTournamentEvents);

  const tournaments = await enrichWttTournamentsWithScheduleSummaries(events);

  return {
    ok: true,
    source: "wtt",
    fromDate: range.fromDate,
    toDate: range.toDate,
    query,
    tournaments,
    summary: {
      total: tournaments.length,
      matches: tournaments.reduce((sum, tournament) => sum + tournament.matchCount, 0),
    },
  };
}

export function normalizeWttTournamentEvents(events: SourceWttEvent[]): WttTournamentEvent[] {
  return events
    .map((event) => normalizeWttTournamentEvent(event))
    .filter((event): event is WttTournamentEvent => Boolean(event))
    .filter((event) => !isYouthTournament(event));
}

export async function fetchWttSchedule(eventId: string | number, input: { allowApiFallback?: boolean } = {}): Promise<SourceSchedulePayload> {
  const id = clean(eventId);
  if (!id) throw new Error("WTT eventId is required.");

  const staticUrls = [
    `${WTT_FRONTDOOR_ORIGIN}/websitecacheddata/${encodeURIComponent(id)}/schedule/schedule_filtered.json`,
    `${WTT_FRONTDOOR_ORIGIN}/websitecacheddata/${encodeURIComponent(id)}/schedule/schedule.json`,
  ];

  const errors: string[] = [];
  const staticPayloads: SourceSchedulePayload[] = [];
  for (const url of staticUrls) {
    try {
      const payload = await fetchJson<unknown>(url, "TData TableT/WTT schedule (+https://www.worldtabletennis.com/eventslist)");
      const rows = unwrapRows(payload);
      if (rows.length > 0) staticPayloads.push(rows as SourceSchedulePayload);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const apiPayloads: SourceSchedulePayload[] = [];

  if (input.allowApiFallback) {
    const apiUrl = `${WTT_SCORE_API_ORIGIN}/cms/GetEventSchedule/${encodeURIComponent(id)}`;
    try {
      const payload = await fetchJson<unknown>(apiUrl, "TData TableT/WTT schedule (+https://www.worldtabletennis.com/eventslist)");
      const rows = unwrapRows(payload);
      if (rows.length > 0) apiPayloads.push(rows as SourceSchedulePayload);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const payloads = [...staticPayloads, ...apiPayloads];
  if (payloads.length > 0) return payloads.flat();

  throw new Error(`Не удалось загрузить расписание WTT eventId=${id}: ${errors[0] || "пустой ответ"}`);
}

export function normalizeWttSchedule(
  payload: SourceSchedulePayload,
  context: {
    eventId: string | number;
    timeZoneId?: string | number | null;
  },
): WttSchedule {
  const eventId = clean(context.eventId);
  const timeZoneId = clean(context.timeZoneId);
  const timeZoneCode = getWttTimeZoneCode(timeZoneId);
  if (!timeZoneCode) {
    throw new Error(`Неизвестный часовой пояс WTT timeZoneId=${timeZoneId || "empty"}`);
  }

  const byMatchId = new Map<string, WttMatch>();

  for (const row of payload || []) {
    for (const unit of row.Competition?.Unit || []) {
      if (isYouthText(`${unit.SubEvent || ""} ${unit.EventCategory || ""} ${getLocalizedValue(unit.ItemName)} ${getLocalizedValue(unit.ItemDescription)}`)) {
        continue;
      }

      const match = normalizeWttUnit(unit, { eventId, timeZoneId, timeZoneCode });
      if (!match) continue;

      const existing = byMatchId.get(match.id);
      byMatchId.set(match.id, existing ? pickPreferredWttMatch(existing, match) : match);
    }
  }

  const matches = Array.from(byMatchId.values()).sort(compareWttMatches);
  const summary = matches.reduce(
    (acc, match) => {
      acc.total += 1;
      acc[match.status] += 1;
      return acc;
    },
    { total: 0, upcoming: 0, live: 0, finished: 0 },
  );

  return {
    ok: true,
    source: "wtt",
    sourceUrl: buildWttEventUrl(eventId),
    eventId,
    timeZoneId,
    timeZoneCode,
    generatedAt: new Date().toISOString(),
    matches,
    summary,
  };
}

export function parseWttLocalDateTime(value: string | null | undefined, timeZoneId: string | number | null | undefined) {
  const timeZoneCode = getWttTimeZoneCode(timeZoneId);
  if (!timeZoneCode) return null;

  const parts = clean(value).match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?/);
  if (!parts) return null;

  const offsetMinutes = parseWttUtcOffsetMinutes(timeZoneCode);
  if (offsetMinutes === null) return null;

  const utcLike = Date.UTC(
    Number(parts[1]),
    Number(parts[2]) - 1,
    Number(parts[3]),
    Number(parts[4]),
    Number(parts[5]),
    Number(parts[6] || "0"),
  );
  const date = new Date(utcLike - offsetMinutes * 60_000);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function getWttTimeZoneCode(timeZoneId: string | number | null | undefined) {
  const key = clean(timeZoneId);
  return key ? WTT_TIME_ZONE_CODES[key] || null : null;
}

export function buildWttEventUrl(eventId: string | number) {
  return `${WTT_ORIGIN}/eventInfo?selectedTab=Matches&eventId=${encodeURIComponent(clean(eventId))}`;
}

export function isActiveWttMatch(match: Pick<WttMatch, "status" | "startTimeUtc">, now = new Date()) {
  if (match.status === "finished") return false;
  if (!match.startTimeUtc) return true;
  const start = new Date(match.startTimeUtc);
  if (Number.isNaN(start.getTime())) return true;
  return formatMoscowDate(start) >= formatMoscowDate(now) || match.status === "live";
}

function normalizeWttTournamentEvent(event: SourceWttEvent): WttTournamentEvent | null {
  const eventId = clean(event.eventId ?? event.EventId);
  const rawTitle = clean(event.eventName ?? event.EventName);
  if (!eventId || !rawTitle) return null;

  const titleDates = parseDatesFromEventTitle(rawTitle);
  const title = stripTitleDateRange(rawTitle);
  const timeZoneId = clean(event.timeZoneId ?? event.TimeZoneId) || null;
  const timeZoneCode = getWttTimeZoneCode(timeZoneId);
  const startDate = toMoscowIsoDateKey(event.startDateTime ?? event.StartDateTime, timeZoneId) || titleDates.startDate;
  const endDate = toMoscowIsoDateKey(event.endDateTime ?? event.EndDateTime, timeZoneId) || titleDates.endDate;
  const countryName = clean(event.countryName ?? event.Country);
  const countryCode = clean(event.countryCode ?? event.CountryCode);
  const city = clean(event.city ?? event.City);
  const venueName = clean(event.venueName ?? event.VenueName);
  const tournamentCategoryId = clean(event.tournamentCategoryId ?? event.TournamentCategoryId) || null;
  const categoryName = clean(event.tournamentCategoryName ?? event.categoryName ?? event.Name)
    || (tournamentCategoryId ? WTT_CATEGORY_NAMES_BY_ID[tournamentCategoryId] : "")
    || "";
  const tierName = clean(event.event_Tier_name ?? event.Event_Tier_Name);
  const subEvents = parseWttSubEvents(event.subEvents ?? event.SubEvents);
  const location = [city, countryName].filter(Boolean).join(", ") || countryName || venueName;
  const inferredMatchCount = subEvents.reduce((sum, subEvent) => sum + toNumber(subEvent.numberOfTotalMatches), 0);

  return {
    eventId,
    title,
    pageUrl: buildWttEventUrl(eventId),
    status: isOngoing(startDate, endDate) ? "ongoing" : "upcoming",
    startDate,
    endDate,
    dates: formatDateRange(startDate, endDate),
    location,
    countryName,
    countryCode,
    city,
    venueName,
    timeZoneId,
    timeZoneCode,
    tournamentCategoryId,
    categoryName,
    tierName,
    matchCount: inferredMatchCount,
    firstMatchTimeMoscow: null,
    categories: inferWttCategoriesFromSubEvents(subEvents),
    subEvents,
  };
}

async function enrichWttTournamentsWithScheduleSummaries(tournaments: WttTournamentEvent[]) {
  return Promise.all(tournaments.map(async (tournament, index) => {
    if (index >= SCHEDULE_SUMMARY_LIMIT) return tournament;

    const enrichedTournament = getWttTimeZoneCode(tournament.timeZoneId)
      ? tournament
      : await recoverWttTournamentDetails(tournament);
    if (!getWttTimeZoneCode(enrichedTournament.timeZoneId)) return enrichedTournament;

    try {
      const schedule = normalizeWttSchedule(
        await fetchWttSchedule(enrichedTournament.eventId, { allowApiFallback: true }),
        { eventId: enrichedTournament.eventId, timeZoneId: enrichedTournament.timeZoneId },
      );
      const activeMatches = schedule.matches.filter((match) => isActiveWttMatch(match));
      const categories = summarizeWttMatchCategories(activeMatches);
      return {
        ...enrichedTournament,
        matchCount: activeMatches.length || enrichedTournament.matchCount,
        firstMatchTimeMoscow: activeMatches[0]?.startTimeMoscow || enrichedTournament.firstMatchTimeMoscow,
        categories: categories.length > 0 ? categories : enrichedTournament.categories,
        status: activeMatches.some((match) => match.status === "live") ? "ongoing" : enrichedTournament.status,
      };
    } catch {
      return enrichedTournament;
    }
  }));
}

async function recoverWttTournamentDetails(tournament: WttTournamentEvent): Promise<WttTournamentEvent> {
  try {
    const events = normalizeWttTournamentEvents(await fetchWttPrimaryEvents());
    const fullEvent = events.find((event) => event.eventId === tournament.eventId);
    if (!fullEvent || !getWttTimeZoneCode(fullEvent.timeZoneId)) return tournament;

    return {
      ...tournament,
      ...fullEvent,
      pageUrl: tournament.pageUrl || fullEvent.pageUrl,
    };
  } catch {
    return tournament;
  }
}

function normalizeWttUnit(unit: SourceWttUnit, context: { eventId: string; timeZoneId: string; timeZoneCode: string }): WttMatch | null {
  const code = clean(unit.Code);
  if (!code) return null;

  const startDate = parseWttLocalDateTime(unit.StartDate, context.timeZoneId);
  const endDate = parseWttLocalDateTime(unit.EndDate, context.timeZoneId);
  const starts = [...(unit.StartList?.Start || [])].sort((left, right) => Number(left.SortOrder || left.StartOrder || 0) - Number(right.SortOrder || right.StartOrder || 0));
  const teamA = normalizeWttCompetitor(starts[0]);
  const teamB = normalizeWttCompetitor(starts[1]);
  const itemDescription = getLocalizedValue(unit.ItemDescription);
  const subEvent = clean(unit.SubEvent);
  const categoryScope = inferWttCategoryScope(subEvent, unit.EventCategory);
  const round = clean(itemDescription) || clean(unit.Round);
  const stage = [subEvent, normalizeRoundLabel(unit.Round, unit.Draw)].filter(Boolean).join(" · ");
  const court = clean(unit.VenueDescription?.LocationName) || clean(unit.Location);
  const venueName = clean(unit.VenueDescription?.VenueName);
  const status = resolveWttMatchStatus(unit);

  return {
    id: `wtt-${context.eventId}-${code}`,
    eventId: context.eventId,
    code,
    status,
    startTimeUtc: startDate ? startDate.toISOString() : null,
    startTimeMoscow: startDate ? formatMoscowDateTime(startDate) : "TBD",
    dateKey: startDate ? formatMoscowDate(startDate) : "TBD",
    endTimeUtc: endDate ? endDate.toISOString() : null,
    subEvent,
    eventCategory: clean(unit.EventCategory),
    round,
    draw: clean(unit.Draw),
    stage,
    court,
    venueName,
    sourceUrl: buildWttEventUrl(context.eventId),
    teamA,
    teamB,
    rawText: [
      itemDescription || getLocalizedValue(unit.ItemName),
      unit.ScheduleStatus ? `status=${unit.ScheduleStatus}` : null,
      unit.StartDate ? `local=${unit.StartDate} ${context.timeZoneCode}` : null,
      court ? `table=${court}` : null,
      venueName ? `venue=${venueName}` : null,
      `${teamA.name} vs ${teamB.name}`,
    ].filter(Boolean).join(" | ") || null,
    categoryScope,
  };
}

export function inferWttCategoryScope(...values: Array<unknown>): TableTennisCategoryScope | null {
  for (const value of values) {
    const text = clean(value);
    if (!text) continue;

    const direct = normalizeTableTennisCategoryScope(text);
    if (direct) return direct;

    const normalized = text.toLowerCase().replace(/[_-]+/g, " ");
    if (/\b(?:x|mixed)\s*doubles\b/i.test(normalized) || /\bxdoubles\b/i.test(normalized)) return "mixed";
    if (/\bmen'?s?\s*doubles\b/i.test(normalized) || /\bmdoubles\b/i.test(normalized)) return "men-doubles";
    if (/\bwomen'?s?\s*doubles\b/i.test(normalized) || /\bwdoubles\b/i.test(normalized)) return "women-doubles";
    if (/\bmen'?s?\s*singles\b/i.test(normalized) || /\bmsingles\b/i.test(normalized)) return "men";
    if (/\bwomen'?s?\s*singles\b/i.test(normalized) || /\bwsingles\b/i.test(normalized)) return "women";
  }

  return null;
}

export function getWttCategoryLabel(scope: TableTennisCategoryScope) {
  switch (scope) {
    case "men":
      return "Мужчины";
    case "women":
      return "Женщины";
    case "men-doubles":
      return "Муж. пары";
    case "women-doubles":
      return "Жен. пары";
    case "mixed":
      return "Микст";
  }
}

export function summarizeWttMatchCategories(matches: Array<Pick<WttMatch, "categoryScope" | "subEvent" | "eventCategory" | "startTimeUtc" | "startTimeMoscow">>): WttCategorySummary[] {
  const byScope = new Map<TableTennisCategoryScope, WttCategorySummary & { firstSortKey: string }>();

  for (const match of matches) {
    const scope = match.categoryScope || inferWttCategoryScope(match.subEvent, match.eventCategory);
    if (!scope) continue;

    const existing = byScope.get(scope);
    const sortKey = match.startTimeUtc || "9999-12-31T23:59:59.999Z";
    if (!existing) {
      byScope.set(scope, {
        scope,
        label: getWttCategoryLabel(scope),
        matchCount: 1,
        firstMatchTimeMoscow: match.startTimeMoscow && match.startTimeMoscow !== "TBD" ? match.startTimeMoscow : null,
        firstSortKey: sortKey,
      });
      continue;
    }

    existing.matchCount += 1;
    if (sortKey < existing.firstSortKey && match.startTimeMoscow && match.startTimeMoscow !== "TBD") {
      existing.firstSortKey = sortKey;
      existing.firstMatchTimeMoscow = match.startTimeMoscow;
    }
  }

  return Array.from(byScope.values())
    .sort((left, right) => getWttCategoryOrder(left.scope) - getWttCategoryOrder(right.scope))
    .map(({ firstSortKey: _firstSortKey, ...category }) => category);
}

function inferWttCategoriesFromSubEvents(subEvents: WttSubEvent[]): WttCategorySummary[] {
  const summaries = new Map<TableTennisCategoryScope, WttCategorySummary>();

  for (const subEvent of subEvents) {
    const scope = inferWttCategoryScope(subEvent.subEventCode, subEvent.subEventName, subEvent.subEventType, subEvent.gender);
    if (!scope) continue;
    const existing = summaries.get(scope);
    summaries.set(scope, {
      scope,
      label: getWttCategoryLabel(scope),
      matchCount: (existing?.matchCount || 0) + toNumber(subEvent.numberOfTotalMatches),
      firstMatchTimeMoscow: null,
    });
  }

  return Array.from(summaries.values())
    .sort((left, right) => getWttCategoryOrder(left.scope) - getWttCategoryOrder(right.scope));
}

function getWttCategoryOrder(scope: TableTennisCategoryScope) {
  return ["men", "women", "men-doubles", "women-doubles", "mixed"].indexOf(scope);
}

function normalizeWttCompetitor(start: SourceWttStart | null | undefined): WttCompetitor {
  const competitor = start?.Competitor;
  const code = clean(competitor?.Code);
  const description = competitor?.Description;
  const compositionName = buildCompositionName(competitor?.Composition?.Athlete);
  const rawName = clean(description?.TeamName) || compositionName || (code && code !== "TBD" ? code : "TBD");
  const placeholder = isWttPlaceholderTeam(rawName) || isWttPlaceholderTeam(code);
  const name = placeholder ? "TBD" : rawName;

  return {
    code,
    type: clean(competitor?.Type),
    organization: placeholder ? "" : clean(competitor?.Organization),
    seed: placeholder ? "" : clean(competitor?.Seed),
    name,
    ifId: placeholder ? "" : clean(description?.IfId),
    rawText: placeholder ? null : [
      competitor?.Organization ? `org=${competitor.Organization}` : null,
      competitor?.Seed !== null && competitor?.Seed !== undefined ? `seed=${competitor.Seed}` : null,
      description?.IfId ? `ifId=${description.IfId}` : null,
      code ? `code=${code}` : null,
    ].filter(Boolean).join("; "),
  };
}

function buildCompositionName(athletes: SourceWttAthlete[] | null | undefined) {
  return (athletes || [])
    .sort((left, right) => Number(left.Order || 0) - Number(right.Order || 0))
    .map((athlete) => {
      const description = athlete.Description;
      return clean(description?.TeamName)
        || [clean(description?.FamilyName), clean(description?.GivenName)].filter(Boolean).join(" ")
        || clean(athlete.Code);
    })
    .filter(Boolean)
    .join(" / ");
}

function resolveWttMatchStatus(unit: SourceWttUnit): WttMatchStatus {
  const status = clean(unit.ScheduleStatus).toLowerCase();
  if (/\b(?:intermediate|live|running|in progress)\b/i.test(status)) return "live";
  if (hasWttResult(unit.Result) || /\b(?:official|finished|complete|completed|result)\b/i.test(status)) return "finished";
  if (/\b(?:scheduled|getting_ready|not started|upcoming)\b/i.test(status)) return "upcoming";
  if (unit.ActualEndDate) return "finished";
  return "upcoming";
}

function hasWttResult(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return clean(value).length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function pickPreferredWttMatch(left: WttMatch, right: WttMatch) {
  const statusDiff = getWttStatusPriority(right.status) - getWttStatusPriority(left.status);
  if (statusDiff !== 0) return statusDiff > 0 ? right : left;
  return scoreWttMatch(right) > scoreWttMatch(left) ? right : left;
}

function getWttStatusPriority(status: WttMatchStatus) {
  switch (status) {
    case "finished":
      return 3;
    case "live":
      return 2;
    case "upcoming":
      return 1;
  }
}

function scoreWttMatch(match: WttMatch) {
  let score = 0;
  if (match.startTimeUtc) score += 100;
  if (match.teamA.name !== "TBD") score += 50;
  if (match.teamB.name !== "TBD") score += 50;
  if (match.court) score += 20;
  if (match.status === "upcoming") score += 10;
  if (match.status === "live") score += 15;
  return score;
}

function compareWttMatches(left: WttMatch, right: WttMatch) {
  const leftTime = left.startTimeUtc ? new Date(left.startTimeUtc).getTime() : Number.MAX_SAFE_INTEGER;
  const rightTime = right.startTimeUtc ? new Date(right.startTimeUtc).getTime() : Number.MAX_SAFE_INTEGER;
  return leftTime - rightTime || left.id.localeCompare(right.id);
}

function compareWttTournamentEvents(left: WttTournamentEvent, right: WttTournamentEvent) {
  return (left.startDate || "9999-12-31").localeCompare(right.startDate || "9999-12-31")
    || left.title.localeCompare(right.title);
}

function isTournamentInRange(event: WttTournamentEvent, fromDate: string, toDate: string) {
  const start = event.startDate || event.endDate;
  const end = event.endDate || event.startDate;
  if (!start && !end) return false;
  return (end || start)! >= fromDate && (start || end)! <= toDate;
}

function isYouthTournament(event: WttTournamentEvent) {
  return isYouthText([
    event.title,
    event.categoryName,
    event.tierName,
    ...event.subEvents.map((subEvent) => `${subEvent.subEventName || ""} ${subEvent.subEventType || ""}`),
  ].join(" "));
}

function isYouthText(value: string) {
  return /\byouth\b/i.test(value) || /\bU\s?(?:11|13|15|17|19)\b/i.test(value);
}

function isWttPlaceholderTeam(value: string | null | undefined) {
  const normalized = clean(value).toLowerCase();
  return !normalized || normalized === "tbd" || normalized === "bye" || normalized === "null";
}

function normalizeRoundLabel(round: string | null | undefined, draw: string | null | undefined) {
  const drawLabel = clean(draw);
  const roundLabel = clean(round);
  if (!drawLabel) return roundLabel;
  if (!roundLabel) return drawLabel;
  return `${drawLabel} ${roundLabel}`;
}

function getLocalizedValue(values: SourceLocalizedText[] | null | undefined) {
  const english = (values || []).find((item) => clean(item.Language).toUpperCase() === "ENG");
  return clean(english?.Value) || clean(values?.[0]?.Value);
}

function parseWttSubEvents(value: SourceWttEvent["subEvents"]): WttSubEvent[] {
  if (Array.isArray(value)) return value;
  const text = clean(value);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? parsed as WttSubEvent[] : [];
  } catch {
    return [];
  }
}

function parseDatesFromEventTitle(title: string): { startDate: string | null; endDate: string | null } {
  const match = title.match(/\((\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\s*-\s*(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\)\s*$/);
  if (!match) return { startDate: null, endDate: null };
  return {
    startDate: parseEnglishDateKey(match[1]),
    endDate: parseEnglishDateKey(match[2]),
  };
}

function stripTitleDateRange(title: string) {
  return title.replace(/\s*\(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\s*-\s*\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\)\s*$/, "").trim();
}

function parseEnglishDateKey(value: string) {
  const date = new Date(`${value} 00:00:00 UTC`);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

function toMoscowIsoDateKey(value: string | null | undefined, timeZoneId: string | number | null | undefined) {
  const date = parseWttLocalDateTime(value, timeZoneId);
  return date ? formatMoscowDate(date) : null;
}

function formatDateRange(startDate: string | null, endDate: string | null) {
  if (!startDate && !endDate) return "";
  if (!startDate || startDate === endDate) return startDate || endDate || "";
  return `${startDate} - ${endDate}`;
}

function isOngoing(startDate: string | null, endDate: string | null, now = new Date()) {
  const today = formatMoscowDate(now);
  return Boolean(startDate && endDate && startDate <= today && today <= endDate);
}

function parseWttUtcOffsetMinutes(timeZoneCode: string) {
  const normalized = timeZoneCode.trim().toUpperCase();
  if (normalized === "UTC") return 0;

  const match = normalized.match(/^UTC([+-])(\d{2}):(\d{2})$/);
  if (!match) return null;

  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

async function fetchJson<T>(url: string, userAgent: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Origin: WTT_ORIGIN,
        Referer: `${WTT_ORIGIN}/`,
        "User-Agent": userAgent,
      },
    });
    const raw = await response.text();
    const text = raw.replace(/^\uFEFF/, "").trim();

    if (!response.ok) {
      throw new Error(`WTT HTTP ${response.status}: ${text.slice(0, 220)}`);
    }
    if (!text.startsWith("{") && !text.startsWith("[")) {
      throw new Error(`WTT returned non-JSON content from ${url}`);
    }

    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function unwrapRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    if (payload.length === 1 && isRecord(payload[0]) && Array.isArray(payload[0].rows)) {
      return payload[0].rows;
    }
    return payload;
  }
  if (isRecord(payload) && Array.isArray(payload.rows)) return payload.rows;
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
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

function toNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
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
