import type {
  KhlMetric,
  KhlPlayerActor,
  KhlPlayerPoints,
  KhlScore,
  KhlTeamSide,
  NormalizedKhlMatch,
} from "@backend/sources/results/khl/normalize";

const METRIC_DEFINITIONS = [
  { source: "shotsOnGoal", code: "shots_on_goal", label: "Броски в створ" },
  { source: "faceoffsWon", code: "faceoffs_won", label: "Выигранные вбрасывания" },
  { source: "powerPlayGoals", code: "power_play_goals", label: "Голы в большинстве" },
  {
    source: "penaltyMinutesQualifying",
    code: "penalty_minutes_2_4",
    label: "Штрафные минуты (только 2/4)",
  },
] as const;

export type KhlProtocolMetricCode = typeof METRIC_DEFINITIONS[number]["code"];

export type KhlMatchProtocolView = {
  status: NormalizedKhlMatch["status"];
  startsAt: string;
  segments: string[];
  scores: {
    segments: Array<{ segment: string; home: number; away: number }>;
    regulation: KhlScore;
    official: KhlScore;
  };
  teams: Record<KhlTeamSide, {
    khlTeamId: string;
    name: string;
    location: string | null;
    metrics: Array<{
      code: KhlProtocolMetricCode;
      label: string;
      segments: Record<string, number>;
      regulationTotal: number;
      fullMatchTotal: number;
    }>;
  }>;
  players: Array<{
    khlPlayerId: string;
    khlTeamId: string;
    teamSide: KhlTeamSide;
    shirtNumber: number;
    name: string;
    role: string;
    regulation: KhlPlayerPoints;
    fullMatch: KhlPlayerPoints;
  }>;
  goals: Array<{
    elapsedSeconds: number;
    segment: string;
    score: string;
    strength: string;
    strengthAbbreviation: string;
    teamSide: KhlTeamSide;
    scorer: KhlPlayerActor;
    assistants: KhlPlayerActor[];
  }>;
  penalties: Array<{
    elapsedSeconds: number;
    segment: string;
    durationMinutes: number;
    reason: string;
    teamSide: KhlTeamSide;
    player: KhlPlayerActor | null;
    qualifiesForAdmin: boolean;
    includedInRegulationAdminTotal: boolean;
  }>;
  validation: { ok: boolean; issues: string[] };
};

export function buildKhlMatchProtocolView(
  match: NormalizedKhlMatch
): KhlMatchProtocolView {
  const segments = collectSegments(match);

  return {
    status: match.status,
    startsAt: match.startsAt,
    segments,
    scores: {
      segments: segments.map((segment) => ({
        segment,
        home: match.scores.segments[segment]?.home || 0,
        away: match.scores.segments[segment]?.away || 0,
      })),
      regulation: { ...match.scores.regulation },
      official: { ...match.scores.official },
    },
    teams: {
      home: buildTeamView(match, "home"),
      away: buildTeamView(match, "away"),
    },
    players: [...match.players]
      .sort(comparePlayers)
      .map((player) => ({
        khlPlayerId: player.khlPlayerId,
        khlTeamId: player.khlTeamId,
        teamSide: player.teamSide,
        shirtNumber: player.shirtNumber,
        name: player.name,
        role: player.role,
        regulation: { ...player.regulation },
        fullMatch: { ...player.fullMatch },
      })),
    goals: match.goals.map((goal) => ({
      elapsedSeconds: goal.elapsedSeconds,
      segment: goal.segment,
      score: goal.score,
      strength: goal.strength,
      strengthAbbreviation: goal.strengthAbbreviation,
      teamSide: goal.teamSide,
      scorer: copyActor(goal.scorer),
      assistants: goal.assistants.map(copyActor),
    })),
    penalties: match.penalties.map((penalty) => ({
      elapsedSeconds: penalty.elapsedSeconds,
      segment: penalty.segment,
      durationMinutes: penalty.durationMinutes,
      reason: penalty.reason,
      teamSide: penalty.teamSide,
      player: penalty.player ? copyActor(penalty.player) : null,
      qualifiesForAdmin: penalty.qualifiesForAdmin,
      includedInRegulationAdminTotal:
        penalty.qualifiesForAdmin && /^P[123]$/.test(penalty.segment),
    })),
    validation: {
      ok: match.validation.ok,
      issues: [...match.validation.issues],
    },
  };
}

function buildTeamView(match: NormalizedKhlMatch, side: KhlTeamSide) {
  const team = match.teams[side];
  return {
    khlTeamId: team.khlTeamId,
    name: team.name,
    location: team.location,
    metrics: METRIC_DEFINITIONS.map((definition) => ({
      code: definition.code,
      label: definition.label,
      ...copyMetric(match.teamStats[side][definition.source]),
    })),
  };
}

function copyMetric(metric: KhlMetric) {
  return {
    segments: { ...metric.segments },
    regulationTotal: metric.regulationTotal,
    fullMatchTotal: metric.fullMatchTotal,
  };
}

function copyActor(actor: KhlPlayerActor): KhlPlayerActor {
  return { ...actor };
}

function collectSegments(match: NormalizedKhlMatch) {
  const values = new Set(Object.keys(match.scores.segments));
  for (const side of ["home", "away"] as const) {
    for (const definition of METRIC_DEFINITIONS) {
      Object.keys(match.teamStats[side][definition.source].segments).forEach((segment) => {
        values.add(segment);
      });
    }
  }
  match.goals.forEach((goal) => values.add(goal.segment));
  match.penalties.forEach((penalty) => values.add(penalty.segment));
  return [...values].sort(compareSegments);
}

function compareSegments(left: string, right: string) {
  const leftRank = segmentRank(left);
  const rightRank = segmentRank(right);
  return leftRank === rightRank ? left.localeCompare(right) : leftRank - rightRank;
}

function segmentRank(segment: string) {
  const period = /^P([123])$/.exec(segment);
  if (period) return Number(period[1]);
  const overtime = /^OT(\d+)$/.exec(segment);
  if (overtime) return 100 + Number(overtime[1]);
  if (segment === "SO") return 1_000;
  return 2_000;
}

function comparePlayers(
  left: NormalizedKhlMatch["players"][number],
  right: NormalizedKhlMatch["players"][number]
) {
  if (left.teamSide !== right.teamSide) return left.teamSide === "home" ? -1 : 1;
  if (left.shirtNumber !== right.shirtNumber) return left.shirtNumber - right.shirtNumber;
  return left.name.localeCompare(right.name, "ru");
}
