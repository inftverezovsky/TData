import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { DateTime } from "luxon";

import type { OfficialSourceMatch, TLineSourceTeam } from "../domain/types";
import type {
  OfficialChampionshipSnapshot,
  OfficialSourceAdapter,
  OfficialSourceDiagnostics,
  TLineChampionshipConfig,
} from "./contracts";

export const HOCKEY_BY_PROVIDER = "hockey-by";
export const HOCKEY_BY_ENDPOINT = "https://hockey.by/bitrix/services/main/ajax.php?mode=class&c=2quick%3Agame.calendar&action=getSelect";

const HOCKEY_BY_SOURCE_URL = "https://hockey.by/calendar/";
const HOCKEY_BY_ORIGIN = "https://hockey.by";
const HOCKEY_BY_SEASON_ID = "11";
const HOCKEY_BY_LEAGUE_ID = "5";
const HOCKEY_BY_SEASON_START_YEAR = 2026;
const HOCKEY_BY_LEAGUE_NAME = "Betera-Высшая лига";
const HOCKEY_BY_SOURCE_TIMEZONE = "Europe/Minsk";
const HOCKEY_BY_TIMEOUT_MS = 15_000;
const HOCKEY_BY_OPERATION_TIMEOUT_MS = 120_000;
const HOCKEY_BY_DELAY_MS = 250;
const HOCKEY_BY_MAX_JSON_BYTES = 5 * 1024 * 1024;
const HOCKEY_BY_MAX_MONTHS = 12;
const HOCKEY_BY_MAX_PAGE_REQUESTS = 50;
const HOCKEY_BY_MAX_MATCH_CARDS = 600;

const MONTH_NAMES = new Map<string, number>([
  ["январь", 1],
  ["февраль", 2],
  ["март", 3],
  ["апрель", 4],
  ["май", 5],
  ["июнь", 6],
  ["июль", 7],
  ["август", 8],
  ["сентябрь", 9],
  ["октябрь", 10],
  ["ноябрь", 11],
  ["декабрь", 12],
] as const);

export interface HockeyByPageRequest {
  readonly seasonId: string;
  readonly leagueId: string;
  readonly divisionId: string | null;
  readonly month: number;
  readonly page: number;
  readonly forceFresh: true;
  readonly signal?: AbortSignal;
}

type HockeyByPageFetcher = (request: HockeyByPageRequest) => Promise<unknown>;
type HockeyByDelay = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

interface HockeyByDivision {
  readonly id: string;
  readonly name: string;
}

interface HockeyByRosterTeam {
  readonly canonicalName: string;
  readonly names: readonly string[];
}

export interface HockeyByParsedPage {
  readonly divisions: readonly HockeyByDivision[];
  readonly rosterTeams: readonly HockeyByRosterTeam[];
  readonly listedTeamCount: number;
  readonly teams: readonly TLineSourceTeam[];
  readonly matches: readonly OfficialSourceMatch[];
  readonly cardCount: number;
  readonly hasNextPage: boolean;
}

export interface HockeyByParseContext {
  readonly championship: TLineChampionshipConfig;
  readonly divisionId: string | null;
  readonly divisionName: string | null;
  readonly month: number;
  readonly page: number;
  readonly seasonStartYear: number;
  readonly now: Date;
  readonly parseMatches?: boolean;
}

interface LoadedHockeyByEvidence {
  readonly listedTeamCount: number;
  readonly allMatches: readonly OfficialSourceMatch[];
  readonly teams: readonly TLineSourceTeam[];
  readonly eligibleMatches: readonly OfficialSourceMatch[];
  readonly diagnostics: OfficialSourceDiagnostics;
}

export function createHockeyByAdapter(options: {
  readonly fetchPage?: HockeyByPageFetcher;
  readonly delay?: HockeyByDelay;
  readonly now?: () => Date;
  readonly operationTimeoutMs?: number;
} = {}): OfficialSourceAdapter {
  const fetchPage = options.fetchPage ?? requestHockeyByCalendarPage;
  const delay = options.delay ?? abortableDelay;
  const now = options.now ?? (() => new Date());
  const operationTimeoutMs = options.operationTimeoutMs ?? HOCKEY_BY_OPERATION_TIMEOUT_MS;
  if (!Number.isInteger(operationTimeoutMs) || operationTimeoutMs < 1 || operationTimeoutMs > HOCKEY_BY_OPERATION_TIMEOUT_MS) {
    throw new Error("Hockey.by operation timeout is invalid");
  }

  const load = async (input: {
    readonly championship: TLineChampionshipConfig;
    readonly from: Date;
    readonly to: Date;
    readonly signal?: AbortSignal;
  }): Promise<LoadedHockeyByEvidence> => {
    const operationSignal = AbortSignal.timeout(operationTimeoutMs);
    const signal = input.signal ? AbortSignal.any([input.signal, operationSignal]) : operationSignal;
    signal.throwIfAborted();
    const resolved = validateHockeyByChampionship(input.championship);
    const months = monthsInsideHockeySeason(input.from, input.to, resolved.seasonStartYear);
    const discoveryMonth = months[0] ?? 7;
    let requestCount = 0;
    let cardCount = 0;

    const requestAndParse = async (
      month: number,
      page: number,
      division: HockeyByDivision | null,
      parseMatches = true,
    ) => {
      if (requestCount >= HOCKEY_BY_MAX_PAGE_REQUESTS) {
        throw new Error("Hockey.by exceeded the 50 page request limit");
      }
      if (requestCount > 0) await delay(HOCKEY_BY_DELAY_MS, signal);
      requestCount += 1;
      const response = await fetchPage({
        seasonId: resolved.seasonId,
        leagueId: resolved.leagueId,
        divisionId: division?.id ?? null,
        month,
        page,
        forceFresh: true,
        signal,
      });
      const parsed = parseHockeyByCalendarResponse(response, {
        championship: input.championship,
        divisionId: division?.id ?? null,
        divisionName: division?.name ?? null,
        month,
        page,
        seasonStartYear: resolved.seasonStartYear,
        now: now(),
        parseMatches,
      });
      cardCount += parsed.cardCount;
      if (cardCount > HOCKEY_BY_MAX_MATCH_CARDS) {
        throw new Error("Hockey.by exceeded the 600 match card limit");
      }
      return parsed;
    };

    const discovery = await requestAndParse(discoveryMonth, 1, null, false);
    const allMatchesById = new Map<string, OfficialSourceMatch>();
    const teamsById = new Map<string, TLineSourceTeam>();

    for (const division of discovery.divisions) {
      for (const month of months) {
        let page = 1;
        let previousPageFingerprint: string | null = null;
        while (true) {
          const parsed = await requestAndParse(month, page, division);
          if (parsed.matches.length === 0) break;
          const pageFingerprint = JSON.stringify(parsed.matches);
          if (pageFingerprint === previousPageFingerprint) break;
          for (const match of parsed.matches) registerMatch(allMatchesById, match);
          for (const team of parsed.teams) registerTeam(teamsById, team);
          previousPageFingerprint = pageFingerprint;
          page += 1;
        }
      }
    }

    const rangeStart = input.from.getTime();
    const rangeEnd = input.to.getTime();
    const matchesInPeriod = Array.from(allMatchesById.values()).filter((match) => {
      if (!match.startTimeUtc) return false;
      const timestamp = new Date(match.startTimeUtc).getTime();
      return timestamp >= rangeStart && timestamp <= rangeEnd;
    });
    const excludedStageNames = discovery.divisions
      .filter((division) => isExcludedFriendlyStage(division.name))
      .map((division) => division.name);
    const excludedStageKeys = new Set(excludedStageNames.map(normalizeIdentity));
    const excludedMatches = matchesInPeriod.filter((match) => excludedStageKeys.has(normalizeIdentity(match.stage)));
    const eligibleMatches = matchesInPeriod.filter((match) => !excludedStageKeys.has(normalizeIdentity(match.stage)));
    const hasCompetitiveStage = discovery.divisions.some((division) => !isExcludedFriendlyStage(division.name));
    const diagnostics = freezeDiagnostics({
      reasonCodes: hasCompetitiveStage ? [] : ["SOURCE_STAGE_NOT_PUBLISHED"],
      excludedStageNames,
      excludedMatchCount: excludedMatches.length,
      eligibleMatchCount: eligibleMatches.length,
    });

    return Object.freeze({
      listedTeamCount: discovery.listedTeamCount,
      allMatches: Object.freeze([...matchesInPeriod]),
      teams: Object.freeze(Array.from(teamsById.values())),
      eligibleMatches: Object.freeze([...eligibleMatches]),
      diagnostics,
    });
  };

  return Object.freeze({
    provider: HOCKEY_BY_PROVIDER,
    async testConnection(config: TLineChampionshipConfig, options?: { readonly signal?: AbortSignal }) {
      const seasonStart = DateTime.fromObject(
        { year: HOCKEY_BY_SEASON_START_YEAR, month: 7, day: 1 },
        { zone: HOCKEY_BY_SOURCE_TIMEZONE },
      ).startOf("day");
      const seasonEnd = seasonStart.plus({ years: 1 }).minus({ milliseconds: 1 });
      const evidence = await load({
        championship: config,
        from: seasonStart.toUTC().toJSDate(),
        to: seasonEnd.toUTC().toJSDate(),
        signal: options?.signal,
      });
      return Object.freeze({
        ok: true as const,
        provider: HOCKEY_BY_PROVIDER,
        teamCount: evidence.listedTeamCount,
        matchCount: evidence.allMatches.length,
        eligibleMatchCount: evidence.diagnostics.eligibleMatchCount,
        excludedMatchCount: evidence.diagnostics.excludedMatchCount,
        exactTimeCount: evidence.allMatches.filter((match) => match.timePrecision === "EXACT").length,
        dateOnlyTimeCount: evidence.allMatches.filter((match) => match.timePrecision === "DATE_ONLY").length,
        undefinedTimeCount: evidence.allMatches.filter((match) => match.timePrecision === "UNDEFINED").length,
        diagnostics: evidence.diagnostics,
        checkedAt: new Date().toISOString(),
      });
    },
    async fetchChampionship(input: Parameters<OfficialSourceAdapter["fetchChampionship"]>[0]) {
      const evidence = await load({
        championship: input.championship,
        from: input.from,
        to: input.to,
        signal: input.signal,
      });
      return Object.freeze({
        provider: HOCKEY_BY_PROVIDER,
        championshipId: input.championship.id,
        externalId: input.championship.externalId,
        name: input.championship.name,
        sourceUrl: HOCKEY_BY_SOURCE_URL,
        fetchedAt: new Date().toISOString(),
        teams: evidence.teams,
        matches: evidence.eligibleMatches,
        diagnostics: evidence.diagnostics,
      }) satisfies OfficialChampionshipSnapshot;
    },
  });
}

export function resolveHockeyByCalendarUrl(value: string) {
  validateExactHockeyByCalendarUrl(value);
  return Object.freeze({
    sourceUrl: HOCKEY_BY_SOURCE_URL,
    seasonId: HOCKEY_BY_SEASON_ID,
    leagueId: HOCKEY_BY_LEAGUE_ID,
    seasonStartYear: HOCKEY_BY_SEASON_START_YEAR,
  });
}

export function parseHockeyByCalendarResponse(
  payload: unknown,
  context: HockeyByParseContext,
): HockeyByParsedPage {
  validateExactHockeyByCalendarUrl(context.championship.sourceUrl);
  const identity = parseExternalIdentity(context.championship.externalId);
  const root = record(payload, "Hockey.by response structure is invalid");
  if (root.status !== "success") {
    throw new Error(`Hockey.by API returned an error${extractApiError(root)}`);
  }
  const data = record(root.data, "Hockey.by response structure is invalid");
  assertSeasonAndLeagueIdentity(data, identity, context.seasonStartYear);
  const divisions = parseDivisions(data.DIVISIONS);
  if (context.divisionId !== null) {
    const selected = divisions.find((division) => division.id === context.divisionId);
    const selectedDivisions = array(data.DIVISIONS, "Hockey.by response structure is invalid")
      .map((entry) => record(entry, "Hockey.by division structure is invalid"))
      .filter((entry) => entry.selected === true);
    const selectedRaw = selectedDivisions[0];
    if (
      selectedDivisions.length !== 1
      || !selected
      || selected.name !== context.divisionName
      || String(selectedRaw?.ID) !== context.divisionId
    ) {
      throw new Error("Hockey.by division identity does not match the requested stage");
    }
  }
  const rosterTeams = parseRosterTeams(data.TEAMS);
  const listedTeamCount = rosterTeams.length;
  if (context.parseMatches === false) {
    return Object.freeze({
      divisions,
      rosterTeams,
      listedTeamCount,
      teams: Object.freeze([]),
      matches: Object.freeze([]),
      cardCount: 0,
      hasNextPage: false,
    });
  }
  if (!context.divisionId || !context.divisionName) {
    throw new Error("Hockey.by match parsing requires an explicit division");
  }

  const matchesById = new Map<string, OfficialSourceMatch>();
  const teamsById = new Map<string, TLineSourceTeam>();
  let cardCount = 0;
  const htmlItems = parseHtmlItems(data);
  for (const html of htmlItems) {
    const $ = cheerio.load(html);
    const cards = $(".future-game-game").toArray();
    cardCount += cards.length;
    if (cards.length === 0) {
      const text = clean($.root().text());
      if (text === "" || normalizeIdentity(text) === normalizeIdentity("Матчей не найдено")) continue;
      throw new Error("Hockey.by parser found no match cards; the response structure may have changed");
    }
    for (const card of cards) {
      const $card = $(card);
      const nestedEvidence = $card.find(".future-game-right").first();
      const $right = nestedEvidence.length > 0 ? nestedEvidence : $card.next(".future-game-right").first();
      const match = parseMatchCard($card, $right, context);
      registerMatch(matchesById, match);
      registerTeamRef(teamsById, context.championship.id, match.home.sourceTeamId, match.home.name);
      registerTeamRef(teamsById, context.championship.id, match.away.sourceTeamId, match.away.name);
    }
  }

  return Object.freeze({
    divisions,
    rosterTeams,
    listedTeamCount,
    teams: Object.freeze(Array.from(teamsById.values()).map((team) => enrichTeamFromRoster(team, rosterTeams))),
    matches: Object.freeze(Array.from(matchesById.values())),
    cardCount,
    hasNextPage: parseHasNextPage(data.NAV, context.page),
  });
}

function parseMatchCard(
  $card: cheerio.Cheerio<AnyNode>,
  $right: cheerio.Cheerio<AnyNode>,
  context: HockeyByParseContext,
): OfficialSourceMatch {
  const dateNode = $card.find(".current-game-date").first();
  const visibleDate = clean(dateNode.text());
  const dayMatch = visibleDate.match(/^(\d{1,2})/u);
  const monthRaw = clean(dateNode.find(".current-game-date-month").first().text());
  const month = MONTH_NAMES.get(normalizeIdentity(monthRaw));
  if (!dayMatch || !month || month !== context.month) {
    throw new Error(`Hockey.by match date does not match the requested month (${visibleDate || "missing"}; requested ${context.month})`);
  }

  const timeEvidence = clean($right.find(".future-game-start").first().text());
  const timeMatch = timeEvidence.match(/(?:Начало матча в\s*)?(\d{1,2}):(\d{2})\s*\(([^)]+)\)/u);
  if (!timeMatch) throw new Error(`Hockey.by match time or weekday is missing (${visibleDate}; ${timeEvidence || "missing"})`);
  const year = month >= 7 ? context.seasonStartYear : context.seasonStartYear + 1;
  const local = DateTime.fromObject({
    year,
    month,
    day: Number(dayMatch[1]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
  }, { zone: context.championship.sourceTimezone, locale: "ru" });
  if (!local.isValid) throw new Error("Hockey.by returned an invalid match date");
  const publishedWeekday = normalizeIdentity(timeMatch[3]);
  const actualWeekday = normalizeIdentity(local.setLocale("ru").weekdayLong);
  if (publishedWeekday !== actualWeekday) {
    throw new Error(`Hockey.by published weekday does not match the inferred date (${timeMatch[3]} != ${local.weekdayLong})`);
  }

  const teamNodes = $card.find(".current-game-body .current-game-team").toArray();
  if (teamNodes.length !== 2) throw new Error("Hockey.by official team ID is missing from a match card");
  const [home, away] = teamNodes.map((node) => parseTeamNode($card._make(node)));
  if (home.sourceTeamId === away.sourceTeamId) throw new Error("Hockey.by match contains the same official team twice");

  const gameUrls = [...$card.find("a[href]").toArray(), ...$right.find("a[href]").toArray()]
    .map((node) => clean($card._make(node).attr("href")))
    .filter((href) => /gamecenter/iu.test(href))
    .map(parseGamecenterUrl);
  if (gameUrls.length === 0) throw new Error("Hockey.by official match ID is missing from a match card");
  const matchIds = new Set(gameUrls.map((item) => item.id));
  if (matchIds.size !== 1) throw new Error("Hockey.by match card contains conflicting official match IDs");
  const source = gameUrls[0];

  const scoreText = clean($card.find(".current-game-points").first().text());
  const scoreMatch = scoreText.match(/^(\d+)\s*[-:]\s*(\d+)$/u);
  if (!scoreMatch && scoreText !== "" && scoreText !== ":") {
    throw new Error(`Hockey.by returned an unsupported score: ${scoreText}`);
  }
  const score = Object.freeze({
    home: scoreMatch ? Number(scoreMatch[1]) : null,
    away: scoreMatch ? Number(scoreMatch[2]) : null,
  });
  const scoreNote = clean($card.find(".game-ending").first().text()) || null;
  const status = score.home !== null && score.away !== null
    ? "FINISHED"
    : local.toMillis() > context.now.getTime() ? "SCHEDULED" : "UNKNOWN";
  const rawDay = dayMatch[1].padStart(2, "0");
  const rawTime = `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`;

  return Object.freeze({
    id: source.id,
    championshipId: context.championship.id,
    externalId: source.id,
    home: Object.freeze({ ...home, adminTeamId: null }),
    away: Object.freeze({ ...away, adminTeamId: null }),
    startTimeRaw: `${rawDay} ${monthRaw} ${rawTime} (${clean(timeMatch[3])})`,
    sourceTimezone: context.championship.sourceTimezone,
    startTimeUtc: local.toUTC().toISO({ suppressMilliseconds: false }),
    startTimeMoscow: local.setZone("Europe/Moscow").toISO({ suppressMilliseconds: false }),
    timePrecision: "EXACT",
    status,
    matchNumber: null,
    score,
    scoreNote,
    venue: clean($right.find(".future-game-place").first().text()) || null,
    stage: context.divisionName,
    round: null,
    sourceUrl: source.url,
  } satisfies OfficialSourceMatch);
}

function parseTeamNode($team: cheerio.Cheerio<AnyNode>) {
  const rawHref = clean($team.attr("href"));
  let url: URL;
  try {
    url = new URL(rawHref, HOCKEY_BY_ORIGIN);
  } catch {
    throw new Error("Hockey.by official team ID is missing or invalid");
  }
  const id = url.pathname.match(/^\/new-admin\/clubs\/([1-9]\d*)\/$/u)?.[1];
  if (!id || !isSafeHockeyByUrl(url)) throw new Error("Hockey.by official team ID is missing or invalid");
  const name = clean($team.find(".current-game-team-name").first().text());
  if (!name) throw new Error(`Hockey.by official team ${id} name is missing`);
  return Object.freeze({ sourceTeamId: id, name });
}

function parseGamecenterUrl(rawHref: string) {
  let url: URL;
  try {
    url = new URL(rawHref, HOCKEY_BY_ORIGIN);
  } catch {
    throw new Error("Hockey.by match has an invalid gamecenter URL");
  }
  const id = url.pathname.match(/^\/gamecenter\/([1-9]\d*)\/$/u)?.[1];
  if (!id || !isSafeHockeyByUrl(url)) throw new Error("Hockey.by match has an invalid gamecenter URL");
  return Object.freeze({ id, url: url.toString() });
}

function isSafeHockeyByUrl(url: URL) {
  return url.protocol === "https:"
    && url.hostname === "hockey.by"
    && url.port === ""
    && url.username === ""
    && url.password === ""
    && url.search === ""
    && url.hash === "";
}

function assertSeasonAndLeagueIdentity(
  data: Record<string, unknown>,
  identity: { readonly seasonId: string; readonly leagueId: string },
  seasonStartYear: number,
) {
  const seasons = array(data.SEASONS, "Hockey.by response structure is invalid")
    .map((entry) => record(entry, "Hockey.by season structure is invalid"));
  const selectedSeasons = seasons.filter((entry) => entry.selected === true);
  const selectedSeason = selectedSeasons[0];
  const expectedSeasonName = `${seasonStartYear}-${seasonStartYear + 1}`;
  if (
    selectedSeasons.length !== 1
    || String(selectedSeason?.ID) !== identity.seasonId
    || clean(String(selectedSeason?.UF_NAME ?? "")) !== expectedSeasonName
  ) {
    throw new Error("Hockey.by season identity does not match the configured championship");
  }

  const leagues = array(data.LEAGUES, "Hockey.by response structure is invalid")
    .map((entry) => record(entry, "Hockey.by league structure is invalid"));
  const selectedLeagues = leagues.filter((entry) => entry.selected === true);
  const selectedLeague = selectedLeagues[0];
  if (
    selectedLeagues.length !== 1
    || String(selectedLeague?.ID) !== identity.leagueId
    || clean(String(selectedLeague?.UF_NAME ?? "")) !== HOCKEY_BY_LEAGUE_NAME
  ) {
    throw new Error("Hockey.by league identity does not match the configured championship");
  }
}

function parseDivisions(value: unknown): readonly HockeyByDivision[] {
  const seen = new Set<string>();
  return Object.freeze(array(value, "Hockey.by response structure is invalid").map((entry) => {
    const division = record(entry, "Hockey.by division structure is invalid");
    const id = clean(String(division.ID ?? ""));
    const name = clean(String(division.UF_NAME ?? ""));
    if (!/^[1-9]\d*$/u.test(id) || !name || seen.has(id)) {
      throw new Error("Hockey.by division structure is invalid");
    }
    seen.add(id);
    return Object.freeze({ id, name });
  }));
}

function parseRosterTeams(value: unknown): readonly HockeyByRosterTeam[] {
  const seen = new Set<string>();
  const roster: HockeyByRosterTeam[] = [];
  for (const entry of array(value, "Hockey.by response structure is invalid")) {
    const team = record(entry, "Hockey.by roster team structure is invalid");
    const id = clean(String(team.ID ?? ""));
    const name = clean(String(team.UF_NAME ?? ""));
    if (id === "all") continue;
    if (!/^[1-9]\d*$/u.test(id) || !name || seen.has(id)) {
      throw new Error("Hockey.by roster team structure is invalid");
    }
    seen.add(id);
    const shortName = clean(String(team.UF_SHORT_NAME ?? ""));
    roster.push(Object.freeze({
      canonicalName: name,
      names: Object.freeze([...new Set([name, shortName].filter(Boolean))]),
    }));
  }
  return Object.freeze(roster);
}

function enrichTeamFromRoster(team: TLineSourceTeam, rosterTeams: readonly HockeyByRosterTeam[]) {
  const cardNameKey = normalizeIdentity(team.nameRu);
  const candidates = rosterTeams.filter((roster) => roster.names.some((name) => normalizeIdentity(name) === cardNameKey));
  if (candidates.length > 1) throw new Error(`Hockey.by roster name is ambiguous: ${team.nameRu ?? team.id}`);
  const roster = candidates[0];
  if (!roster) return team;
  const aliases = new Set([...team.aliases, ...roster.names]);
  aliases.delete(roster.canonicalName);
  return Object.freeze({
    ...team,
    nameRu: roster.canonicalName,
    aliases: Object.freeze(Array.from(aliases)),
  });
}

function parseHtmlItems(data: Record<string, unknown>) {
  if (!Object.hasOwn(data, "FUTURE_GAMES") && !Object.hasOwn(data, "CURRENT_GAMES")) {
    throw new Error("Hockey.by response structure is invalid");
  }
  const items: string[] = [];
  for (const key of ["FUTURE_GAMES", "CURRENT_GAMES"] as const) {
    const value = data[key];
    if (value === null || value === undefined || value === "") continue;
    if (!Array.isArray(value)) throw new Error("Hockey.by response structure is invalid");
    for (const item of value) {
      const html = record(item, "Hockey.by game item structure is invalid").HTML;
      if (typeof html !== "string") throw new Error("Hockey.by game item structure is invalid");
      items.push(html);
    }
  }
  return items;
}

function parseHasNextPage(value: unknown, currentPage: number) {
  if (value === null || value === undefined || value === "") return false;
  if (typeof value !== "string") throw new Error("Hockey.by pagination structure is invalid");
  const $ = cheerio.load(value);
  const next = $(".pgn-next[data-page]").first();
  if (next.length === 0) return false;
  const nextPage = Number(next.attr("data-page"));
  if (!Number.isInteger(nextPage) || nextPage !== currentPage + 1) {
    throw new Error("Hockey.by pagination structure is invalid");
  }
  return true;
}

function registerMatch(matches: Map<string, OfficialSourceMatch>, match: OfficialSourceMatch) {
  const existing = matches.get(match.id);
  if (!existing) {
    matches.set(match.id, match);
    return;
  }
  if (JSON.stringify(existing) !== JSON.stringify(match)) {
    throw new Error(`Hockey.by returned a conflicting duplicate match ${match.id}`);
  }
}

function registerTeamRef(
  teams: Map<string, TLineSourceTeam>,
  championshipId: string,
  id: string,
  name: string,
) {
  const existing = teams.get(id);
  if (!existing) {
    teams.set(id, Object.freeze({
      id,
      championshipId,
      externalId: id,
      nameRu: name,
      nameEn: null,
      aliases: Object.freeze([]),
    }));
    return;
  }
  if (existing.nameRu === name || existing.aliases.includes(name)) return;
  teams.set(id, Object.freeze({ ...existing, aliases: Object.freeze([...existing.aliases, name]) }));
}

function registerTeam(teams: Map<string, TLineSourceTeam>, team: TLineSourceTeam) {
  const existing = teams.get(team.id);
  if (!existing) {
    teams.set(team.id, team);
    return;
  }
  const aliases = new Set([...existing.aliases, ...team.aliases]);
  if (team.nameRu && team.nameRu !== existing.nameRu) aliases.add(team.nameRu);
  teams.set(team.id, Object.freeze({ ...existing, aliases: Object.freeze(Array.from(aliases)) }));
}

function validateHockeyByChampionship(config: TLineChampionshipConfig) {
  const resolved = resolveHockeyByCalendarUrl(config.sourceUrl);
  if (config.externalId !== `${resolved.seasonId}:${resolved.leagueId}`) {
    throw new Error("Hockey.by pilot requires external ID 11:5");
  }
  if (config.sourceTimezone !== HOCKEY_BY_SOURCE_TIMEZONE) {
    throw new Error("Hockey.by pilot requires source timezone Europe/Minsk");
  }
  return resolved;
}

function validateExactHockeyByCalendarUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The exact HTTPS hockey.by calendar URL is required");
  }
  if (url.toString() !== HOCKEY_BY_SOURCE_URL || !isSafeHockeyByUrl(url) || url.pathname !== "/calendar/") {
    throw new Error("The exact HTTPS hockey.by calendar URL is required");
  }
}

function parseExternalIdentity(value: string) {
  const match = value.match(/^([1-9]\d*):([1-9]\d*)$/u);
  if (!match) throw new Error("Hockey.by external ID must contain positive Season and League IDs");
  return Object.freeze({ seasonId: match[1], leagueId: match[2] });
}

function monthsInsideHockeySeason(from: Date, to: Date, seasonStartYear: number) {
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from.getTime() > to.getTime()) {
    throw new Error("Hockey.by requires a valid ascending period");
  }
  const requestedStart = DateTime.fromJSDate(from, { zone: "utc" }).setZone(HOCKEY_BY_SOURCE_TIMEZONE);
  const requestedEnd = DateTime.fromJSDate(to, { zone: "utc" }).setZone(HOCKEY_BY_SOURCE_TIMEZONE);
  const requestedMonthCount = Math.floor(requestedEnd.startOf("month").diff(requestedStart.startOf("month"), "months").months) + 1;
  if (requestedMonthCount > HOCKEY_BY_MAX_MONTHS) throw new Error("Hockey.by periods are limited to 12 months");

  const seasonStart = DateTime.fromObject({ year: seasonStartYear, month: 7, day: 1 }, { zone: HOCKEY_BY_SOURCE_TIMEZONE });
  const seasonEnd = seasonStart.plus({ years: 1 }).minus({ milliseconds: 1 });
  const clippedStart = requestedStart.toMillis() > seasonStart.toMillis() ? requestedStart : seasonStart;
  const clippedEnd = requestedEnd.toMillis() < seasonEnd.toMillis() ? requestedEnd : seasonEnd;
  if (clippedStart.toMillis() > clippedEnd.toMillis()) return Object.freeze([] as number[]);

  const months: number[] = [];
  let cursor = clippedStart.startOf("month");
  const last = clippedEnd.startOf("month");
  while (cursor.toMillis() <= last.toMillis()) {
    months.push(cursor.month);
    cursor = cursor.plus({ months: 1 });
  }
  if (months.length > HOCKEY_BY_MAX_MONTHS) throw new Error("Hockey.by periods are limited to 12 months");
  return Object.freeze(months);
}

function isExcludedFriendlyStage(value: string) {
  return normalizeIdentity(value) === normalizeIdentity("Товарищеские матчи");
}

function freezeDiagnostics(value: OfficialSourceDiagnostics): OfficialSourceDiagnostics {
  return Object.freeze({
    reasonCodes: Object.freeze([...value.reasonCodes]),
    excludedStageNames: Object.freeze([...new Set(value.excludedStageNames)]),
    excludedMatchCount: value.excludedMatchCount,
    eligibleMatchCount: value.eligibleMatchCount,
  });
}

function normalizeIdentity(value: string | null | undefined) {
  return clean(value).normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/ё/gu, "е");
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function array(value: unknown, message: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(message);
  return value;
}

function extractApiError(root: Record<string, unknown>) {
  if (!Array.isArray(root.errors)) return "";
  const messages = root.errors.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const message = clean((entry as Record<string, unknown>).message);
    return message ? [message] : [];
  });
  return messages.length > 0 ? `: ${messages.join("; ")}` : "";
}

export async function requestHockeyByCalendarPage(
  input: HockeyByPageRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  if (!/^[1-9]\d*$/u.test(input.seasonId) || !/^[1-9]\d*$/u.test(input.leagueId)) {
    throw new Error("Hockey.by request requires positive Season and League IDs");
  }
  if (input.divisionId !== null && !/^[1-9]\d*$/u.test(input.divisionId)) {
    throw new Error("Hockey.by request requires a positive Division ID");
  }
  if (!Number.isInteger(input.month) || input.month < 1 || input.month > 12) {
    throw new Error("Hockey.by request month is invalid");
  }
  if (!Number.isInteger(input.page) || input.page < 1 || input.page > HOCKEY_BY_MAX_PAGE_REQUESTS) {
    throw new Error("Hockey.by request page is invalid");
  }
  const body = createHockeyByForm(input);
  const timeout = AbortSignal.timeout(HOCKEY_BY_TIMEOUT_MS);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  const response = await fetchImpl(HOCKEY_BY_ENDPOINT, {
    method: "POST",
    cache: "no-store",
    redirect: "error",
    signal,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Referer: HOCKEY_BY_SOURCE_URL,
      "X-Requested-With": "XMLHttpRequest",
    },
    body,
  });
  if (!response.ok) throw new Error(`Hockey.by request failed with HTTP ${response.status}`);
  return readHockeyByJsonResponse(response);
}

function createHockeyByForm(input: HockeyByPageRequest) {
  const body = new URLSearchParams();
  const fields = [
    ["SEASON", input.seasonId],
    ["LEAGUE", input.leagueId],
    ["DIVISION", input.divisionId ?? ""],
    ["TEAM", "all"],
    ["MONTH", String(input.month)],
  ] as const;
  fields.forEach(([name, value], index) => {
    body.append(`arFilter[${index}][name]`, name);
    body.append(`arFilter[${index}][value]`, value);
  });
  body.append("status", "all");
  body.append("place", "all");
  body.append("view", "list");
  body.append("page", String(input.page));
  body.append("month", String(input.month));
  return body;
}

export async function readHockeyByJsonResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLocaleLowerCase("en-US") ?? "";
  if (!/^application\/json(?:;|$)/u.test(contentType)) {
    throw new Error("Hockey.by did not return a JSON response");
  }
  const declaredLength = Number(response.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > HOCKEY_BY_MAX_JSON_BYTES) {
    throw new Error("Hockey.by response exceeded the TLine size limit");
  }
  if (!response.body) throw new Error("Hockey.by returned an empty JSON response body");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > HOCKEY_BY_MAX_JSON_BYTES) {
        await reader.cancel("TLine response size limit exceeded");
        throw new Error("Hockey.by response exceeded the TLine size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: false }).decode(bytes)) as unknown;
  } catch {
    throw new Error("Hockey.by did not return valid JSON");
  }
}

async function abortableDelay(milliseconds: number, signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
