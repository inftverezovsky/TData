export type KhlTeamSide = "home" | "away";
export type KhlMatchStatus = "scheduled" | "live" | "finished" | "cancelled" | "unknown";
export type KhlSegment = `P${1 | 2 | 3}` | `OT${number}` | "SO";

export type KhlScore = {
  home: number;
  away: number;
};

export type KhlMetric = {
  segments: Record<string, number>;
  regulationTotal: number;
  fullMatchTotal: number;
};

export type KhlTeamIdentity = {
  apiTeamId: string;
  khlTeamId: string;
  name: string;
  location: string | null;
};

export type KhlPlayerActor = {
  khlPlayerId: string | null;
  apiPlayerId: string | null;
  shirtNumber: number;
  name: string;
};

export type NormalizedKhlPlayer = {
  khlPlayerId: string;
  apiPlayerId: string;
  khlTeamId: string;
  teamSide: KhlTeamSide;
  shirtNumber: number;
  name: string;
  role: string;
  regulation: KhlPlayerPoints;
  fullMatch: KhlPlayerPoints;
};

export type KhlPlayerPoints = {
  goals: number;
  assists: number;
  points: number;
};

export type NormalizedKhlGoal = {
  elapsedSeconds: number;
  period: number | null;
  segment: KhlSegment;
  score: string;
  strength: string;
  strengthAbbreviation: string;
  teamSide: KhlTeamSide;
  scorer: KhlPlayerActor;
  assistants: KhlPlayerActor[];
};

export type NormalizedKhlPenalty = {
  elapsedSeconds: number;
  period: number;
  segment: KhlSegment;
  durationMinutes: number;
  reason: string;
  teamSide: KhlTeamSide;
  player: KhlPlayerActor | null;
  qualifiesForAdmin: boolean;
};

export type NormalizedKhlMatch = {
  identity: {
    apiEventId: string;
    khlGameId: string;
    matchId: string;
    stageId: string;
    khlStageId: string;
    season: string;
  };
  sourceUrl: string;
  status: KhlMatchStatus;
  startsAt: string;
  teams: Record<KhlTeamSide, KhlTeamIdentity>;
  scores: {
    segments: Record<string, KhlScore>;
    regulation: KhlScore;
    official: KhlScore;
  };
  teamStats: Record<KhlTeamSide, {
    shotsOnGoal: KhlMetric;
    faceoffsWon: KhlMetric;
    powerPlayGoals: KhlMetric;
    penaltyMinutesQualifying: KhlMetric;
  }>;
  players: NormalizedKhlPlayer[];
  goals: NormalizedKhlGoal[];
  penalties: NormalizedKhlPenalty[];
  validation: {
    ok: boolean;
    issues: string[];
  };
};

type NormalizeOptions = {
  validate?: boolean;
};

type RawObject = Record<string, unknown>;

type PeriodStats = Record<string, {
  shotsOnGoal: KhlScore;
  faceoffsWon: KhlScore;
}>;

const REGULATION_SEGMENTS: KhlSegment[] = ["P1", "P2", "P3"];

export class KhlSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KhlSchemaError";
  }
}

export function normalizeKhlEventDetail(
  input: unknown,
  options: NormalizeOptions = {}
): NormalizedKhlMatch {
  const raw = asObject(input, "KHL event detail");
  const homeRaw = asObject(raw.team_a, "KHL home team");
  const awayRaw = asObject(raw.team_b, "KHL away team");
  const rawScores = asObject(raw.scores, "KHL scores");
  const issues: string[] = [];

  const teams: Record<KhlTeamSide, KhlTeamIdentity> = {
    home: parseTeam(homeRaw, "home"),
    away: parseTeam(awayRaw, "away"),
  };

  const players = [
    ...parseRoster(homeRaw, teams.home, "home"),
    ...parseRoster(awayRaw, teams.away, "away"),
  ];
  const playerIndex = buildPlayerIndex(players);

  const goals = parseGoals(raw.goals, teams, playerIndex, issues);
  const penalties = parsePenalties(raw.violations, teams, playerIndex, issues);
  applyPlayerPoints(players, goals);

  const periodStats = parsePeriodStats(raw.text_events);
  const metricSegments = collectMetricSegments(periodStats, goals, penalties);

  const shotsOnGoal = buildPeriodMetric(periodStats, metricSegments, "shotsOnGoal");
  const faceoffsWon = buildPeriodMetric(periodStats, metricSegments, "faceoffsWon");
  const powerPlayGoals = buildEventMetric(metricSegments, goals.filter(isPowerPlayGoal), () => 1);
  const qualifyingPenalties = buildEventMetric(
    metricSegments,
    penalties.filter((penalty) => penalty.qualifiesForAdmin),
    (penalty) => penalty.durationMinutes
  );

  const scoreSegments = parseScoreSegments(rawScores, goals);
  const regulation = sumScores(scoreSegments, REGULATION_SEGMENTS);
  const official = parseScore(requiredString(raw.score, "KHL official score"), "KHL official score");

  const teamStats: NormalizedKhlMatch["teamStats"] = {
    home: {
      shotsOnGoal: shotsOnGoal.home,
      faceoffsWon: faceoffsWon.home,
      powerPlayGoals: powerPlayGoals.home,
      penaltyMinutesQualifying: qualifyingPenalties.home,
    },
    away: {
      shotsOnGoal: shotsOnGoal.away,
      faceoffsWon: faceoffsWon.away,
      powerPlayGoals: powerPlayGoals.away,
      penaltyMinutesQualifying: qualifyingPenalties.away,
    },
  };

  if (options.validate !== false) {
    validateRequiredRegulationSegments(periodStats, issues);
    validateSourceTotals(homeRaw, awayRaw, teamStats, issues);
    validateRegulationGoals(players, regulation, issues);
  }

  return {
    identity: {
      apiEventId: requiredExternalId(raw.id, "KHL event id"),
      khlGameId: requiredExternalId(raw.khl_id, "KHL game id"),
      matchId: requiredString(raw.match_id, "KHL match id"),
      stageId: requiredExternalId(raw.stage_id, "KHL stage id"),
      khlStageId: requiredExternalId(raw.outer_stage_id, "KHL outer stage id"),
      season: requiredString(raw.season, "KHL season"),
    },
    sourceUrl: optionalString(raw.outer_url) || "",
    status: normalizeStatus(optionalString(raw.game_state_key)),
    startsAt: new Date(requiredNumber(raw.start_at, "KHL start_at")).toISOString(),
    teams,
    scores: {
      segments: scoreSegments,
      regulation,
      official,
    },
    teamStats,
    players,
    goals,
    penalties,
    validation: {
      ok: issues.length === 0,
      issues,
    },
  };
}

function parseTeam(raw: RawObject, side: KhlTeamSide): KhlTeamIdentity {
  return {
    apiTeamId: requiredExternalId(raw.id, `KHL ${side} API team id`),
    khlTeamId: requiredExternalId(raw.khl_id, `KHL ${side} team id`),
    name: requiredString(raw.name, `KHL ${side} team name`),
    location: optionalString(raw.location),
  };
}

function parseRoster(
  rawTeam: RawObject,
  team: KhlTeamIdentity,
  side: KhlTeamSide
): NormalizedKhlPlayer[] {
  const roster = asArray(rawTeam.players, `KHL ${side} roster`);
  return roster.map((value, index) => {
    const raw = asObject(value, `KHL ${side} roster player ${index}`);
    return {
      khlPlayerId: requiredExternalId(raw.khl_id, `KHL ${side} player khl_id`),
      apiPlayerId: requiredExternalId(raw.id, `KHL ${side} player id`),
      khlTeamId: team.khlTeamId,
      teamSide: side,
      shirtNumber: requiredNumber(raw.shirt_number, `KHL ${side} player shirt number`),
      name: requiredString(raw.name, `KHL ${side} player name`),
      role: optionalString(raw.role_key) || "unknown",
      regulation: emptyPlayerPoints(),
      fullMatch: emptyPlayerPoints(),
    };
  });
}

function buildPlayerIndex(players: NormalizedKhlPlayer[]) {
  const index = new Map<string, NormalizedKhlPlayer[]>();
  for (const player of players) {
    const key = playerKey(player.teamSide, player.shirtNumber);
    const entries = index.get(key) || [];
    entries.push(player);
    index.set(key, entries);
  }
  return index;
}

function parseGoals(
  input: unknown,
  teams: Record<KhlTeamSide, KhlTeamIdentity>,
  playerIndex: Map<string, NormalizedKhlPlayer[]>,
  issues: string[]
): NormalizedKhlGoal[] {
  return asArray(input, "KHL goals").map((value, index) => {
    const raw = asObject(value, `KHL goal ${index}`);
    const author = asObject(raw.author, `KHL goal ${index} author`);
    const teamSide = resolveTeamSide(
      requiredExternalId(author.team_id, `KHL goal ${index} author team id`),
      teams
    );
    const elapsedSeconds = requiredNumber(raw.time, `KHL goal ${index} time`);
    const period = raw.period === null || raw.period === undefined
      ? null
      : requiredNumber(raw.period, `KHL goal ${index} period`);
    const shootout = period === null && isShootoutGoal(raw);
    if (period === null && !shootout) {
      throw new KhlSchemaError(`KHL goal ${index} has no period and is not a shootout goal.`);
    }
    const scorer = resolveActor(author, teamSide, playerIndex, `goal ${index} scorer`, issues);
    const assistants = asArray(raw.assistants, `KHL goal ${index} assistants`).map(
      (assistant, assistantIndex) => resolveActor(
        asObject(assistant, `KHL goal ${index} assistant ${assistantIndex}`),
        teamSide,
        playerIndex,
        `goal ${index} assistant ${assistantIndex}`,
        issues
      )
    );

    return {
      elapsedSeconds,
      period,
      segment: shootout ? "SO" : segmentFromEvent(period!, elapsedSeconds),
      score: optionalString(raw.score) || "",
      strength: optionalString(raw.status) || "",
      strengthAbbreviation: optionalString(raw.status_abbr) || "",
      teamSide,
      scorer,
      assistants,
    };
  });
}

function parsePenalties(
  input: unknown,
  teams: Record<KhlTeamSide, KhlTeamIdentity>,
  playerIndex: Map<string, NormalizedKhlPlayer[]>,
  issues: string[]
): NormalizedKhlPenalty[] {
  if (input === null || input === undefined) return [];
  return asArray(input, "KHL violations").map((value, index) => {
    const raw = asObject(value, `KHL violation ${index}`);
    const violator = raw.violator && typeof raw.violator === "object" && !Array.isArray(raw.violator)
      ? raw.violator as RawObject
      : null;
    const teamSide = violator
      ? resolveTeamSide(requiredExternalId(violator.team_id, `KHL violation ${index} team id`), teams)
      : resolveTeamPenaltySide(raw, teams, index);
    const elapsedSeconds = requiredNumber(raw.time, `KHL violation ${index} time`);
    const period = requiredNumber(raw.period, `KHL violation ${index} period`);
    const durationMinutes = requiredNumber(
      raw.penalty_time,
      `KHL violation ${index} penalty time`
    );

    return {
      elapsedSeconds,
      period,
      segment: segmentFromEvent(period, elapsedSeconds),
      durationMinutes,
      reason: optionalString(raw.penalty_reason) || "",
      teamSide,
      player: violator
        ? resolveActor(violator, teamSide, playerIndex, `violation ${index}`, issues)
        : null,
      qualifiesForAdmin: durationMinutes === 2 || durationMinutes === 4,
    };
  });
}

function resolveActor(
  raw: RawObject,
  teamSide: KhlTeamSide,
  playerIndex: Map<string, NormalizedKhlPlayer[]>,
  label: string,
  issues: string[]
): KhlPlayerActor {
  const shirtNumber = requiredNumber(raw.shirt_number, `${label} shirt number`);
  const name = requiredString(raw.name, `${label} name`);
  const candidates = playerIndex.get(playerKey(teamSide, shirtNumber)) || [];
  const normalizedName = normalizePersonName(name);
  const nameMatches = candidates.filter(
    (candidate) => normalizePersonName(candidate.name) === normalizedName
  );
  const selected = nameMatches.length === 1
    ? nameMatches[0]
    : candidates.length === 1
      ? candidates[0]
      : null;

  if (!selected) {
    issues.push(`Unresolved KHL ${label}: ${teamSide} #${shirtNumber} ${name}`);
  }

  return {
    khlPlayerId: selected?.khlPlayerId || null,
    apiPlayerId: selected?.apiPlayerId || null,
    shirtNumber,
    name,
  };
}

function applyPlayerPoints(players: NormalizedKhlPlayer[], goals: NormalizedKhlGoal[]) {
  const byKhlId = new Map(players.map((player) => [player.khlPlayerId, player]));
  for (const goal of goals) {
    if (goal.segment === "SO") continue;
    incrementPlayer(byKhlId, goal.scorer.khlPlayerId, "goals", false);
    if (goal.period !== null && goal.period <= 3) {
      incrementPlayer(byKhlId, goal.scorer.khlPlayerId, "goals", true);
    }
    for (const assistant of goal.assistants) {
      incrementPlayer(byKhlId, assistant.khlPlayerId, "assists", false);
      if (goal.period !== null && goal.period <= 3) {
        incrementPlayer(byKhlId, assistant.khlPlayerId, "assists", true);
      }
    }
  }

  for (const player of players) {
    player.regulation.points = player.regulation.goals + player.regulation.assists;
    player.fullMatch.points = player.fullMatch.goals + player.fullMatch.assists;
  }
}

function incrementPlayer(
  players: Map<string, NormalizedKhlPlayer>,
  khlPlayerId: string | null,
  field: "goals" | "assists",
  regulation: boolean
) {
  if (!khlPlayerId) return;
  const player = players.get(khlPlayerId);
  if (!player) return;
  const target = regulation ? player.regulation : player.fullMatch;
  target[field] += 1;
}

function parsePeriodStats(input: unknown): PeriodStats {
  const result: PeriodStats = {};
  for (const value of asArray(input, "KHL text events")) {
    const event = asObject(value, "KHL text event");
    if (optionalString(event.type) !== "info") continue;
    const text = optionalString(event.text);
    if (!text) continue;
    const segment = segmentFromStatsText(text);
    if (!segment) continue;
    const shotsOnGoal = parseMetricPair(text, "Броски в створ");
    const faceoffsWon = parseMetricPair(text, "Вбрасывания");
    if (!shotsOnGoal || !faceoffsWon) continue;
    result[segment] = { shotsOnGoal, faceoffsWon };
  }
  return result;
}

function segmentFromStatsText(text: string): KhlSegment | null {
  const period = text.match(/^Статистика\s+([123])-го периода:/i);
  if (period) return `P${Number(period[1])}` as KhlSegment;
  const overtime = text.match(/^Статистика\s+(\d+)-го овертайма:/i);
  if (overtime) return `OT${Number(overtime[1])}`;
  if (/^Статистика\s+овертайма:/i.test(text)) return "OT1";
  return null;
}

function parseMetricPair(text: string, label: string): KhlScore | null {
  const pattern = new RegExp(`${escapeRegExp(label)}:\\s*(\\d+)\\s*-\\s*(\\d+)`, "i");
  const match = text.match(pattern);
  if (!match) return null;
  return { home: Number(match[1]), away: Number(match[2]) };
}

function collectMetricSegments(
  periodStats: PeriodStats,
  goals: NormalizedKhlGoal[],
  penalties: NormalizedKhlPenalty[]
): KhlSegment[] {
  const values = new Set<KhlSegment>(REGULATION_SEGMENTS);
  for (const segment of Object.keys(periodStats)) values.add(segment as KhlSegment);
  for (const event of goals) values.add(event.segment);
  for (const event of penalties) values.add(event.segment);
  return Array.from(values).sort(compareSegments);
}

function buildPeriodMetric(
  stats: PeriodStats,
  segments: KhlSegment[],
  field: "shotsOnGoal" | "faceoffsWon"
): Record<KhlTeamSide, KhlMetric> {
  const home: Record<string, number> = {};
  const away: Record<string, number> = {};
  for (const segment of segments) {
    home[segment] = stats[segment]?.[field].home ?? 0;
    away[segment] = stats[segment]?.[field].away ?? 0;
  }
  return {
    home: metricFromSegments(home),
    away: metricFromSegments(away),
  };
}

function buildEventMetric<T extends { segment: KhlSegment; teamSide: KhlTeamSide }>(
  segments: KhlSegment[],
  events: T[],
  value: (event: T) => number
): Record<KhlTeamSide, KhlMetric> {
  const home = Object.fromEntries(segments.map((segment) => [segment, 0]));
  const away = Object.fromEntries(segments.map((segment) => [segment, 0]));
  for (const event of events) {
    const target = event.teamSide === "home" ? home : away;
    target[event.segment] = (target[event.segment] || 0) + value(event);
  }
  return {
    home: metricFromSegments(home),
    away: metricFromSegments(away),
  };
}

function metricFromSegments(segments: Record<string, number>): KhlMetric {
  return {
    segments,
    regulationTotal: REGULATION_SEGMENTS.reduce(
      (sum, segment) => sum + (segments[segment] || 0),
      0
    ),
    fullMatchTotal: Object.values(segments).reduce((sum, value) => sum + value, 0),
  };
}

function parseScoreSegments(
  rawScores: RawObject,
  goals: NormalizedKhlGoal[]
): Record<string, KhlScore> {
  const result: Record<string, KhlScore> = {
    P1: parseNullableScore(rawScores.first_period),
    P2: parseNullableScore(rawScores.second_period),
    P3: parseNullableScore(rawScores.third_period),
  };
  for (const goal of goals) {
    if (!goal.segment.startsWith("OT")) continue;
    const current = result[goal.segment] || { home: 0, away: 0 };
    current[goal.teamSide] += 1;
    result[goal.segment] = current;
  }
  const shootout = optionalString(rawScores.bullitt);
  if (shootout) result.SO = parseScore(shootout, "KHL shootout score");
  return result;
}

function parseNullableScore(value: unknown): KhlScore {
  const text = optionalString(value);
  return text ? parseScore(text, "KHL period score") : { home: 0, away: 0 };
}

function parseScore(value: string, label: string): KhlScore {
  const match = value.trim().match(/^(\d+)\s*:\s*(\d+)$/);
  if (!match) throw new KhlSchemaError(`${label} must be home:away.`);
  return { home: Number(match[1]), away: Number(match[2]) };
}

function sumScores(scores: Record<string, KhlScore>, segments: KhlSegment[]): KhlScore {
  return segments.reduce(
    (total, segment) => ({
      home: total.home + (scores[segment]?.home || 0),
      away: total.away + (scores[segment]?.away || 0),
    }),
    { home: 0, away: 0 }
  );
}

function isPowerPlayGoal(goal: NormalizedKhlGoal) {
  const status = `${goal.strength} ${goal.strengthAbbreviation}`.toLocaleLowerCase("ru");
  return status.includes("большин") || /(^|\s)бол($|\s)/.test(status);
}

function isShootoutGoal(raw: RawObject) {
  const status = `${optionalString(raw.status) || ""} ${optionalString(raw.status_abbr) || ""}`
    .toLocaleLowerCase("ru");
  return status.includes("буллит") || /(^|\s)шб($|\s)/.test(status);
}

function validateRequiredRegulationSegments(stats: PeriodStats, issues: string[]) {
  for (const segment of REGULATION_SEGMENTS) {
    if (!stats[segment]) {
      issues.push(`Missing KHL period statistics for ${segment}.`);
    }
  }
}

function validateSourceTotals(
  homeRaw: RawObject,
  awayRaw: RawObject,
  stats: NormalizedKhlMatch["teamStats"],
  issues: string[]
) {
  for (const side of ["home", "away"] as const) {
    const raw = side === "home" ? homeRaw : awayRaw;
    compareOptionalTotal(raw.shots, stats[side].shotsOnGoal.fullMatchTotal, `${side} shots on goal`, issues);
    compareOptionalTotal(raw.vbr, stats[side].faceoffsWon.fullMatchTotal, `${side} faceoffs won`, issues);
  }
}

function compareOptionalTotal(
  rawValue: unknown,
  calculated: number,
  label: string,
  issues: string[]
) {
  if (rawValue === null || rawValue === undefined) return;
  const source = Number(rawValue);
  if (Number.isFinite(source) && source !== calculated) {
    issues.push(
      `KHL ${label} source aggregate mismatch: source=${source}, segments=${calculated}. `
        + "Period segments were retained; validation remains fail-closed."
    );
  }
}

function validateRegulationGoals(
  players: NormalizedKhlPlayer[],
  score: KhlScore,
  issues: string[]
) {
  for (const side of ["home", "away"] as const) {
    const playerGoals = players
      .filter((player) => player.teamSide === side)
      .reduce((sum, player) => sum + player.regulation.goals, 0);
    if (playerGoals !== score[side]) {
      issues.push(
        `KHL ${side} regulation goals mismatch: players=${playerGoals}, score=${score[side]}.`
      );
    }
  }
}

function segmentFromEvent(period: number, elapsedSeconds: number): KhlSegment {
  if (period >= 1 && period <= 3) return `P${period}` as KhlSegment;
  const overtimeNumber = Math.max(1, Math.ceil((elapsedSeconds - 3600) / 1200));
  return `OT${overtimeNumber}`;
}

function resolveTeamSide(
  apiTeamId: string,
  teams: Record<KhlTeamSide, KhlTeamIdentity>
): KhlTeamSide {
  if (teams.home.apiTeamId === apiTeamId) return "home";
  if (teams.away.apiTeamId === apiTeamId) return "away";
  throw new KhlSchemaError(`KHL event references unknown API team id ${apiTeamId}.`);
}

function resolveTeamPenaltySide(
  raw: RawObject,
  teams: Record<KhlTeamSide, KhlTeamIdentity>,
  index: number
): KhlTeamSide {
  const quote = raw.quote && typeof raw.quote === "object" && !Array.isArray(raw.quote)
    ? raw.quote as RawObject
    : null;
  const description = optionalString(quote?.description);
  if (!description) {
    throw new KhlSchemaError(`KHL team penalty ${index} has no resolvable team.`);
  }
  const normalizedDescription = normalizePersonName(description);
  const matches = (["home", "away"] as const).filter((side) =>
    normalizedDescription.includes(normalizePersonName(teams[side].name))
  );
  if (matches.length !== 1) {
    throw new KhlSchemaError(`KHL team penalty ${index} has ambiguous team description.`);
  }
  return matches[0];
}

function normalizeStatus(value: string | null): KhlMatchStatus {
  if (value === "finished") return "finished";
  if (value === "in_progress") return "live";
  if (value === "not_yet_started") return "scheduled";
  if (value === "cancelled" || value === "postponed") return "cancelled";
  return "unknown";
}

function emptyPlayerPoints(): KhlPlayerPoints {
  return { goals: 0, assists: 0, points: 0 };
}

function playerKey(side: KhlTeamSide, shirtNumber: number) {
  return `${side}:${shirtNumber}`;
}

function normalizePersonName(value: string) {
  return value
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, "")
    .trim();
}

function compareSegments(a: KhlSegment, b: KhlSegment) {
  return segmentRank(a) - segmentRank(b);
}

function segmentRank(segment: KhlSegment) {
  if (segment.startsWith("P")) return Number(segment.slice(1));
  if (segment === "SO") return 100;
  return 10 + Number(segment.slice(2));
}

function asObject(value: unknown, label: string): RawObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new KhlSchemaError(`${label} must be an object.`);
  }
  return value as RawObject;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new KhlSchemaError(`${label} must be an array.`);
  }
  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new KhlSchemaError(`${label} is required.`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredNumber(value: unknown, label: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) {
    throw new KhlSchemaError(`${label} must be a number.`);
  }
  return number;
}

function requiredExternalId(value: unknown, label: string): string {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new KhlSchemaError(`${label} must be a positive safe integer or decimal string.`);
    }
    return String(value);
  }
  if (typeof value === "string" && /^[1-9]\d{0,127}$/.test(value.trim())) {
    return value.trim();
  }
  throw new KhlSchemaError(`${label} must be a positive safe integer or decimal string.`);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
