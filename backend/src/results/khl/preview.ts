import {
  KhlBindingStatus,
  KhlStatScope,
  type PrismaClient,
} from "@prisma/client";

import {
  KHL_TEAM_STAT_CODES,
  KhlAdminPayloadError,
  buildKhlAdminCanonicalPayload,
  type KhlAdminBindings,
  type KhlPlayerStatCode,
  type KhlTeamStatCode,
} from "@backend/results/khl/adminPayload";
import type { NormalizedKhlMatch } from "@backend/sources/results/khl/normalize";

const PLAYER_CODES: KhlPlayerStatCode[] = ["goals", "assists", "points"];

export type KhlAdminPreview =
  | {
      ready: false;
      issues: string[];
      match: { khlGameId: string; revisionNumber: number | null };
    }
  | {
      ready: true;
      issues: [];
      match: { khlGameId: string; revisionNumber: number };
      revisionId: string;
      payload: ReturnType<typeof buildKhlAdminCanonicalPayload>["payload"];
      canonicalJson: string;
      payloadHash: string;
    };

export async function buildKhlAdminPreview(
  prisma: PrismaClient,
  khlGameId: string
): Promise<KhlAdminPreview> {
  if (typeof khlGameId !== "string" || !/^[1-9]\d{0,127}$/.test(khlGameId.trim())) {
    return blocked(String(khlGameId ?? ""), null, ["KHL game id must be a positive decimal string."]);
  }
  khlGameId = khlGameId.trim();
  const match = await prisma.khlMatch.findUnique({
    where: { khlGameId },
    include: {
      homeTeam: true,
      awayTeam: true,
      activeRevision: { include: { snapshot: true } },
      teamStatTargets: { include: { statMapping: true } },
      participants: {
        where: { isListed: true },
        include: {
          player: true,
          playerStatTargets: { include: { statMapping: true } },
        },
      },
    },
  });
  if (!match) return blocked(khlGameId, null, ["KHL match was not ingested."]);
  if (!match.activeRevision) {
    return blocked(khlGameId, null, ["KHL match has no active validated revision."]);
  }

  const normalized = match.activeRevision.normalizedJson as unknown as NormalizedKhlMatch;
  const normalizedStartsAt = new Date(normalized?.startsAt || "");
  if (
    normalized?.identity?.khlGameId !== String(match.khlGameId)
    || normalized.identity.apiEventId !== match.apiEventId
    || normalized.identity.matchId !== match.sourceMatchId
    || String(normalized?.identity?.stageId) !== match.stageId
    || String(normalized.identity.khlStageId) !== match.khlStageId
    || normalized.identity.season !== match.season
    || !Number.isFinite(normalizedStartsAt.getTime())
    || normalizedStartsAt.getTime() !== match.startsAt.getTime()
    || String(normalized?.teams?.home?.khlTeamId) !== match.homeTeam.khlTeamId
    || String(normalized?.teams?.away?.khlTeamId) !== match.awayTeam.khlTeamId
  ) {
    return blocked(khlGameId, match.activeRevision.revisionNumber, [
      "Stored active revision identity does not match the KHL match projection.",
    ]);
  }
  const playerTypes = await prisma.khlStatMapping.findMany({
    where: { scope: KhlStatScope.PLAYER },
  });
  const bindings: KhlAdminBindings = {
    adminMatchId: confirmedId(match.adminBindingStatus, match.adminMatchId),
    teams: {
      home: buildTeamBindings(match.homeTeam, match.teamStatTargets),
      away: buildTeamBindings(match.awayTeam, match.teamStatTargets),
    },
    playerStatTypes: {
      goals: statTypeId(playerTypes, "goals"),
      assists: statTypeId(playerTypes, "assists"),
      points: statTypeId(playerTypes, "points"),
    },
    players: {},
  };

  for (const participant of match.participants) {
    const statIds = Object.fromEntries(PLAYER_CODES.map((code) => {
      const target = participant.playerStatTargets.find(
        (candidate) => candidate.statMapping.semanticCode === code
      );
      return [code, target && target.adminBindingStatus === KhlBindingStatus.CONFIRMED
        ? target.adminPlayerStatId || ""
        : ""];
    })) as Record<KhlPlayerStatCode, string>;
    if (
      participant.player.adminBindingStatus === KhlBindingStatus.CONFIRMED
      && participant.adminBindingStatus === KhlBindingStatus.CONFIRMED
    ) {
      bindings.players[String(participant.player.khlPlayerId)] = {
        adminPlayerId: participant.player.adminPlayerId || "",
        adminMatchPlayerId: participant.adminMatchPlayerId || "",
        adminPlayerStatIds: statIds,
      };
    }
  }

  try {
    const result = buildKhlAdminCanonicalPayload({
      match: normalized,
      bindings,
      revisionId: match.activeRevision.id,
      sourceContentHash: match.activeRevision.snapshot.contentHash,
      parserVersion: match.activeRevision.parserVersion,
      rulesVersion: match.activeRevision.rulesVersion,
    });
    return {
      ready: true,
      issues: [],
      match: { khlGameId, revisionNumber: match.activeRevision.revisionNumber },
      revisionId: match.activeRevision.id,
      ...result,
    };
  } catch (error) {
    if (error instanceof KhlAdminPayloadError) {
      return blocked(khlGameId, match.activeRevision.revisionNumber, error.issues);
    }
    throw error;
  }
}

function buildTeamBindings(
  team: { id: string; adminTeamId: string | null; adminBindingStatus: KhlBindingStatus },
  targets: Array<{
    teamId: string;
    adminMatchStatId: string | null;
    adminBindingStatus: KhlBindingStatus;
    statMapping: {
      semanticCode: string;
      adminStatTypeId: string | null;
      adminBindingStatus: KhlBindingStatus;
    };
  }>
) {
  const stats = Object.fromEntries(KHL_TEAM_STAT_CODES.map((code) => {
    const target = targets.find((candidate) => (
      candidate.teamId === team.id && candidate.statMapping.semanticCode === code
    ));
    const confirmed = target
      && target.adminBindingStatus === KhlBindingStatus.CONFIRMED
      && target.statMapping.adminBindingStatus === KhlBindingStatus.CONFIRMED;
    return [code, {
      adminStatTypeId: confirmed ? target.statMapping.adminStatTypeId || "" : "",
      adminMatchStatId: confirmed ? target.adminMatchStatId || "" : "",
    }];
  })) as Record<KhlTeamStatCode, { adminStatTypeId: string; adminMatchStatId: string }>;
  return {
    adminTeamId: confirmedId(team.adminBindingStatus, team.adminTeamId),
    stats,
  };
}

function statTypeId(
  mappings: Array<{
    semanticCode: string;
    adminStatTypeId: string | null;
    adminBindingStatus: KhlBindingStatus;
  }>,
  code: KhlPlayerStatCode
) {
  const mapping = mappings.find((candidate) => candidate.semanticCode === code);
  return mapping?.adminBindingStatus === KhlBindingStatus.CONFIRMED
    ? mapping.adminStatTypeId || ""
    : "";
}

function confirmedId(status: KhlBindingStatus, value: string | null) {
  return status === KhlBindingStatus.CONFIRMED ? value || "" : "";
}

function blocked(
  khlGameId: string,
  revisionNumber: number | null,
  issues: string[]
): KhlAdminPreview {
  return { ready: false, issues, match: { khlGameId, revisionNumber } };
}
