import { createHash } from "node:crypto";
import { requireResolvedKhlPlayers } from "@backend/sources/results/khl/normalize";

import type {
  KhlMetric,
  KhlTeamSide,
  NormalizedKhlMatch,
} from "@backend/sources/results/khl/normalize";

export const KHL_TEAM_STAT_CODES = [
  "shots_on_goal",
  "faceoffs_won",
  "power_play_goals",
  "penalty_minutes_2_4",
] as const;

export type KhlTeamStatCode = (typeof KHL_TEAM_STAT_CODES)[number];
export type KhlPlayerStatCode = "goals" | "assists" | "points";

type TeamStatBinding = {
  adminStatTypeId: string;
  adminMatchStatId: string;
};

type TeamBinding = {
  adminTeamId: string;
  stats: Record<KhlTeamStatCode, TeamStatBinding>;
};

type PlayerBinding = {
  adminPlayerId: string;
  adminMatchPlayerId: string;
  adminPlayerStatIds: Record<KhlPlayerStatCode, string>;
};

export type KhlAdminBindings = {
  adminMatchId: string;
  teams: Record<KhlTeamSide, TeamBinding>;
  playerStatTypes: Record<KhlPlayerStatCode, string>;
  players: Record<string, PlayerBinding>;
};

export type KhlAdminCanonicalPayload = {
  schemaVersion: "khl-results.v1";
  source: {
    provider: "khl";
    apiEventId: string;
    khlGameId: string;
    stageId: string;
    khlStageId: string;
    revisionId: string;
    sourceContentHash: string;
    parserVersion: string;
    rulesVersion: string;
  };
  match: {
    adminMatchId: string;
    status: "finished";
    startsAt: string;
    officialScore: { home: number; away: number };
    regulationScore: { home: number; away: number };
  };
  teamStatistics: Array<{
    statCode: KhlTeamStatCode;
    adminStatTypeId: string;
    home: TeamStatPayloadSide;
    away: TeamStatPayloadSide;
  }>;
  playerStatTypes: Record<KhlPlayerStatCode, string>;
  players: Array<{
    externalPlayerId: string;
    adminPlayerId: string;
    adminMatchPlayerId: string;
    adminTeamId: string;
    adminPlayerStatIds: Record<KhlPlayerStatCode, string>;
    goals: number;
    assists: number;
    points: number;
  }>;
};

type TeamStatPayloadSide = {
  adminTeamId: string;
  adminMatchStatId: string;
  total: number;
  p1: number;
  p2: number;
  p3: number;
};

type BuildInput = {
  match: NormalizedKhlMatch;
  bindings: KhlAdminBindings;
  revisionId: string;
  sourceContentHash: string;
  parserVersion: string;
  rulesVersion: string;
};

export class KhlAdminPayloadError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`KHL Admin payload is blocked: ${issues.join("; ")}`);
    this.name = "KhlAdminPayloadError";
    this.issues = issues;
  }
}

export function buildKhlAdminCanonicalPayload(input: BuildInput) {
  const issues = validateInput(input);
  let players;
  try {
    players = requireResolvedKhlPlayers(input.match.players);
  } catch (error) {
    throw new KhlAdminPayloadError([...issues, error instanceof Error ? error.message : "Unresolved KHL player identities."]);
  }
  if (issues.length > 0) throw new KhlAdminPayloadError(issues);

  const payload: KhlAdminCanonicalPayload = {
    schemaVersion: "khl-results.v1",
    source: {
      provider: "khl",
      apiEventId: input.match.identity.apiEventId,
      khlGameId: input.match.identity.khlGameId,
      stageId: input.match.identity.stageId,
      khlStageId: input.match.identity.khlStageId,
      revisionId: input.revisionId,
      sourceContentHash: input.sourceContentHash,
      parserVersion: input.parserVersion,
      rulesVersion: input.rulesVersion,
    },
    match: {
      adminMatchId: cleanId(input.bindings.adminMatchId),
      status: "finished",
      startsAt: input.match.startsAt,
      officialScore: input.match.scores.official,
      regulationScore: input.match.scores.regulation,
    },
    teamStatistics: KHL_TEAM_STAT_CODES.map((statCode) => {
      const homeBinding = input.bindings.teams.home.stats[statCode];
      const awayBinding = input.bindings.teams.away.stats[statCode];
      return {
        statCode,
        adminStatTypeId: cleanId(homeBinding.adminStatTypeId),
        home: buildTeamStatSide(
          input.bindings.teams.home,
          homeBinding,
          metricFor(input.match, "home", statCode)
        ),
        away: buildTeamStatSide(
          input.bindings.teams.away,
          awayBinding,
          metricFor(input.match, "away", statCode)
        ),
      };
    }),
    playerStatTypes: {
      goals: cleanId(input.bindings.playerStatTypes.goals),
      assists: cleanId(input.bindings.playerStatTypes.assists),
      points: cleanId(input.bindings.playerStatTypes.points),
    },
    players: players
      .slice()
      .sort((a, b) =>
        a.teamSide.localeCompare(b.teamSide) ||
        a.shirtNumber - b.shirtNumber ||
        a.khlPlayerId.localeCompare(b.khlPlayerId)
      )
      .map((player) => {
        const binding = input.bindings.players[player.khlPlayerId];
        return {
          externalPlayerId: player.khlPlayerId,
          adminPlayerId: cleanId(binding.adminPlayerId),
          adminMatchPlayerId: cleanId(binding.adminMatchPlayerId),
          adminTeamId: cleanId(input.bindings.teams[player.teamSide].adminTeamId),
          adminPlayerStatIds: {
            goals: cleanId(binding.adminPlayerStatIds.goals),
            assists: cleanId(binding.adminPlayerStatIds.assists),
            points: cleanId(binding.adminPlayerStatIds.points),
          },
          goals: player.regulation.goals,
          assists: player.regulation.assists,
          points: player.regulation.points,
        };
      }),
  };

  const canonicalJson = canonicalStringify(payload);
  return {
    payload,
    canonicalJson,
    payloadHash: createHash("sha256").update(canonicalJson).digest("hex"),
  };
}

function buildTeamStatSide(
  teamBinding: TeamBinding,
  statBinding: TeamStatBinding,
  metric: KhlMetric
): TeamStatPayloadSide {
  return {
    adminTeamId: cleanId(teamBinding.adminTeamId),
    adminMatchStatId: cleanId(statBinding.adminMatchStatId),
    total: metric.regulationTotal,
    p1: metric.segments.P1 || 0,
    p2: metric.segments.P2 || 0,
    p3: metric.segments.P3 || 0,
  };
}

function metricFor(
  match: NormalizedKhlMatch,
  side: KhlTeamSide,
  statCode: KhlTeamStatCode
): KhlMetric {
  if (statCode === "shots_on_goal") return match.teamStats[side].shotsOnGoal;
  if (statCode === "faceoffs_won") return match.teamStats[side].faceoffsWon;
  if (statCode === "power_play_goals") return match.teamStats[side].powerPlayGoals;
  return match.teamStats[side].penaltyMinutesQualifying;
}

function validateInput(input: BuildInput) {
  const issues: string[] = [];
  if (input.match.status !== "finished") {
    issues.push("KHL match must be finished before Admin delivery.");
  }
  if (!input.match.validation.ok) {
    issues.push(...input.match.validation.issues.map((issue) => `Source validation: ${issue}`));
  }
  requireId(input.bindings.adminMatchId, "Admin match id", issues);
  requireId(input.revisionId, "KHL revision id", issues);
  requireId(input.parserVersion, "KHL parser version", issues);
  requireId(input.rulesVersion, "KHL rules version", issues);
  if (!/^[a-f0-9]{64}$/i.test(input.sourceContentHash)) {
    issues.push("KHL source content hash must be a SHA-256 hex string.");
  }

  for (const side of ["home", "away"] as const) {
    const team = input.bindings.teams[side];
    if (!team) {
      issues.push(`Missing ${side} Admin team binding.`);
      continue;
    }
    requireId(team.adminTeamId, `${side} Admin team id`, issues);
    for (const statCode of KHL_TEAM_STAT_CODES) {
      const binding = team.stats?.[statCode];
      if (!binding) {
        issues.push(`Missing ${side} ${statCode} Admin stat binding.`);
        continue;
      }
      requireId(binding.adminStatTypeId, `${side} ${statCode} Admin stat type id`, issues);
      requireId(binding.adminMatchStatId, `${side} ${statCode} Admin match stat id`, issues);
      const metric = metricFor(input.match, side, statCode);
      const regulationSum = (metric.segments.P1 || 0) +
        (metric.segments.P2 || 0) +
        (metric.segments.P3 || 0);
      if (metric.regulationTotal !== regulationSum) {
        issues.push(`${side} ${statCode} total does not equal P1+P2+P3.`);
      }
    }
  }

  for (const statCode of ["goals", "assists", "points"] as const) {
    requireId(
      input.bindings.playerStatTypes?.[statCode],
      `Admin player ${statCode} type id`,
      issues
    );
  }

  for (const player of input.match.players) {
    if (!player.khlPlayerId) {
      issues.push(`KHL API player ${player.apiPlayerId}: missing KHL player id.`);
      continue;
    }
    const binding = input.bindings.players[player.khlPlayerId];
    if (!binding) {
      issues.push(`Missing Admin participant binding for KHL player ${player.khlPlayerId}.`);
      continue;
    }
    requireId(binding.adminPlayerId, `KHL player ${player.khlPlayerId} Admin player id`, issues);
    requireId(
      binding.adminMatchPlayerId,
      `KHL player ${player.khlPlayerId} Admin match player id`,
      issues
    );
    for (const statCode of ["goals", "assists", "points"] as const) {
      requireId(
        binding.adminPlayerStatIds?.[statCode],
        `KHL player ${player.khlPlayerId} Admin ${statCode} record id`,
        issues
      );
    }
    if (player.regulation.points !== player.regulation.goals + player.regulation.assists) {
      issues.push(`KHL player ${player.khlPlayerId} points do not equal goals+assists.`);
    }
  }

  for (const statCode of KHL_TEAM_STAT_CODES) {
    const homeType = input.bindings.teams.home?.stats?.[statCode]?.adminStatTypeId;
    const awayType = input.bindings.teams.away?.stats?.[statCode]?.adminStatTypeId;
    if (homeType && awayType && cleanId(homeType) !== cleanId(awayType)) {
      issues.push(`Admin ${statCode} type differs between home and away teams.`);
    }
  }

  return issues;
}

function requireId(value: unknown, label: string, issues: string[]) {
  if (typeof value !== "string" || !value.trim()) issues.push(`${label} is required.`);
}

function cleanId(value: string) {
  return value.trim();
}

function canonicalStringify(value: unknown) {
  return JSON.stringify(sortRecursively(value));
}

function sortRecursively(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortRecursively);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortRecursively(nested)])
  );
}
