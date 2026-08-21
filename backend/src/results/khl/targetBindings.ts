import {
  KhlBindingStatus,
  KhlStatScope,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import {
  KHL_TEAM_STAT_CODES,
  type KhlPlayerStatCode,
  type KhlTeamStatCode,
} from "@backend/results/khl/adminPayload";

export const KHL_PLAYER_STAT_CODES = ["goals", "assists", "points"] as const satisfies readonly KhlPlayerStatCode[];
const STAT_BINDING_TRANSACTION_ATTEMPTS = 3;

type TeamTargets = {
  stats: Record<KhlTeamStatCode, { adminMatchStatId: string }>;
};

type PlayerTargets = {
  khlPlayerId: string;
  adminPlayerId: string;
  adminMatchPlayerId: string;
  stats: Record<KhlPlayerStatCode, string>;
};

export type ConfirmKhlResultTargetsInput = {
  khlGameId: string;
  teamStatTypes: Record<KhlTeamStatCode, string>;
  playerStatTypes: Record<KhlPlayerStatCode, string>;
  teams: Record<"home" | "away", TeamTargets>;
  players: PlayerTargets[];
  confirmedBy: string;
};

export type ConfirmKhlStatTypesInput = {
  teamStatTypes: Record<KhlTeamStatCode, string>;
  playerStatTypes: Record<KhlPlayerStatCode, string>;
  confirmedBy: string;
};

export class KhlTargetBindingError extends Error {
  constructor(
    public readonly code:
      | "INVALID_TARGET_BINDINGS"
      | "MATCH_NOT_FOUND"
      | "MATCH_NOT_BOUND"
      | "PLAYER_SET_MISMATCH"
      | "CONFIRMED_BINDING_IMMUTABLE"
      | "ADMIN_ID_COLLISION",
    message: string
  ) {
    super(message);
    this.name = "KhlTargetBindingError";
  }
}

export async function confirmKhlResultTargets(
  prisma: PrismaClient,
  input: ConfirmKhlResultTargetsInput
) {
  const validated = validateInput(input);
  try {
    return await prisma.$transaction(async (tx) => {
      const match = await tx.khlMatch.findUnique({
        where: { khlGameId: validated.khlGameId },
        include: {
          homeTeam: true,
          awayTeam: true,
          participants: {
            where: { isListed: true },
            include: { player: true },
          },
        },
      });
      if (!match) {
        throw new KhlTargetBindingError("MATCH_NOT_FOUND", "KHL match was not ingested.");
      }
      if (
        match.adminBindingStatus !== KhlBindingStatus.CONFIRMED
        || !match.adminMatchId
        || match.homeTeam.adminBindingStatus !== KhlBindingStatus.CONFIRMED
        || !match.homeTeam.adminTeamId
        || match.awayTeam.adminBindingStatus !== KhlBindingStatus.CONFIRMED
        || !match.awayTeam.adminTeamId
      ) {
        throw new KhlTargetBindingError(
          "MATCH_NOT_BOUND",
          "Admin match and both team mappings must be confirmed first."
        );
      }

      const expectedPlayerIds = new Set(
        match.participants.map((participant) => participant.player.khlPlayerId)
      );
      const suppliedPlayerIds = new Set(validated.players.map((player) => player.khlPlayerId));
      if (
        expectedPlayerIds.size !== suppliedPlayerIds.size
        || [...expectedPlayerIds].some((id) => !suppliedPlayerIds.has(id))
      ) {
        throw new KhlTargetBindingError(
          "PLAYER_SET_MISMATCH",
          `Bindings must contain exactly all ${expectedPlayerIds.size} listed KHL players.`
        );
      }

      const now = new Date();
      const statMappingIds = new Map<string, string>();
      for (const code of KHL_TEAM_STAT_CODES) {
        const mapping = await upsertImmutableStatMapping(
          tx,
          KhlStatScope.TEAM,
          code,
          validated.teamStatTypes[code],
          validated.confirmedBy,
          now
        );
        statMappingIds.set(`TEAM:${code}`, mapping.id);
      }
      for (const code of KHL_PLAYER_STAT_CODES) {
        const mapping = await upsertImmutableStatMapping(
          tx,
          KhlStatScope.PLAYER,
          code,
          validated.playerStatTypes[code],
          validated.confirmedBy,
          now
        );
        statMappingIds.set(`PLAYER:${code}`, mapping.id);
      }

      for (const [side, team] of [
        ["home", match.homeTeam],
        ["away", match.awayTeam],
      ] as const) {
        for (const code of KHL_TEAM_STAT_CODES) {
          const adminMatchStatId = validated.teams[side].stats[code].adminMatchStatId;
          const statMappingId = statMappingIds.get(`TEAM:${code}`)!;
          const current = await tx.khlTeamStatTarget.findUnique({
            where: {
              matchId_teamId_statMappingId: {
                matchId: match.id,
                teamId: team.id,
                statMappingId,
              },
            },
          });
          assertImmutable(
            current?.adminBindingStatus,
            current?.adminMatchStatId,
            adminMatchStatId,
            `${side} ${code} Admin match-stat record`
          );
          await tx.khlTeamStatTarget.upsert({
            where: {
              matchId_teamId_statMappingId: {
                matchId: match.id,
                teamId: team.id,
                statMappingId,
              },
            },
            create: {
              matchId: match.id,
              teamId: team.id,
              statMappingId,
              adminMatchStatId,
              adminBindingStatus: KhlBindingStatus.CONFIRMED,
              adminConfirmedAt: now,
              adminConfirmedBy: validated.confirmedBy,
            },
            update: {
              adminMatchStatId,
              adminBindingStatus: KhlBindingStatus.CONFIRMED,
              adminConfirmedAt: now,
              adminConfirmedBy: validated.confirmedBy,
            },
          });
        }
      }

      const participantByPlayerId = new Map(
        match.participants.map((participant) => [participant.player.khlPlayerId, participant])
      );
      for (const supplied of validated.players) {
        const participant = participantByPlayerId.get(supplied.khlPlayerId)!;
        assertImmutable(
          participant.player.adminBindingStatus,
          participant.player.adminPlayerId,
          supplied.adminPlayerId,
          `KHL player ${supplied.khlPlayerId} Admin player`
        );
        assertImmutable(
          participant.adminBindingStatus,
          participant.adminMatchPlayerId,
          supplied.adminMatchPlayerId,
          `KHL player ${supplied.khlPlayerId} Admin match-player`
        );
        await tx.khlPlayer.update({
          where: { id: participant.playerId },
          data: {
            adminPlayerId: supplied.adminPlayerId,
            adminBindingStatus: KhlBindingStatus.CONFIRMED,
            adminConfirmedAt: now,
            adminConfirmedBy: validated.confirmedBy,
          },
        });
        await tx.khlMatchParticipant.update({
          where: { id: participant.id },
          data: {
            adminMatchPlayerId: supplied.adminMatchPlayerId,
            adminBindingStatus: KhlBindingStatus.CONFIRMED,
            adminConfirmedAt: now,
            adminConfirmedBy: validated.confirmedBy,
          },
        });
        for (const code of KHL_PLAYER_STAT_CODES) {
          const statMappingId = statMappingIds.get(`PLAYER:${code}`)!;
          const adminPlayerStatId = supplied.stats[code];
          const current = await tx.khlPlayerStatTarget.findUnique({
            where: {
              participantId_statMappingId: {
                participantId: participant.id,
                statMappingId,
              },
            },
          });
          assertImmutable(
            current?.adminBindingStatus,
            current?.adminPlayerStatId,
            adminPlayerStatId,
            `KHL player ${supplied.khlPlayerId} Admin ${code} record`
          );
          await tx.khlPlayerStatTarget.upsert({
            where: {
              participantId_statMappingId: {
                participantId: participant.id,
                statMappingId,
              },
            },
            create: {
              participantId: participant.id,
              statMappingId,
              adminPlayerStatId,
              adminBindingStatus: KhlBindingStatus.CONFIRMED,
              adminConfirmedAt: now,
              adminConfirmedBy: validated.confirmedBy,
            },
            update: {
              adminPlayerStatId,
              adminBindingStatus: KhlBindingStatus.CONFIRMED,
              adminConfirmedAt: now,
              adminConfirmedBy: validated.confirmedBy,
            },
          });
        }
      }

      return {
        khlGameId: match.khlGameId,
        adminMatchId: match.adminMatchId,
        teamTargets: KHL_TEAM_STAT_CODES.length * 2,
        players: match.participants.length,
        playerTargets: match.participants.length * KHL_PLAYER_STAT_CODES.length,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof KhlTargetBindingError) throw error;
    if (String((error as { code?: string })?.code || "") === "P2002") {
      throw new KhlTargetBindingError(
        "ADMIN_ID_COLLISION",
        "One of the Admin target ids is already bound to another KHL record."
      );
    }
    throw error;
  }
}

export async function confirmKhlStatTypes(
  prisma: PrismaClient,
  input: ConfirmKhlStatTypesInput
) {
  const validated = validateStatTypesInput(input);
  for (let attempt = 1; attempt <= STAT_BINDING_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const now = new Date();
        const mappings = [];
        for (const code of KHL_TEAM_STAT_CODES) {
          mappings.push(await upsertImmutableStatMapping(
            tx,
            KhlStatScope.TEAM,
            code,
            validated.teamStatTypes[code],
            validated.confirmedBy,
            now
          ));
        }
        for (const code of KHL_PLAYER_STAT_CODES) {
          mappings.push(await upsertImmutableStatMapping(
            tx,
            KhlStatScope.PLAYER,
            code,
            validated.playerStatTypes[code],
            validated.confirmedBy,
            now
          ));
        }
        return { mappings };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof KhlTargetBindingError) throw error;
      const code = String((error as { code?: string })?.code || "");
      if ((code === "P2002" || code === "P2034") && attempt < STAT_BINDING_TRANSACTION_ATTEMPTS) {
        continue;
      }
      if (code === "P2002") {
        throw new KhlTargetBindingError(
          "ADMIN_ID_COLLISION",
          "One of the Admin stat type ids is already bound to another semantic code."
        );
      }
      throw error;
    }
  }
  throw new Error("Unreachable stat binding retry state.");
}

async function upsertImmutableStatMapping(
  tx: Prisma.TransactionClient,
  scope: KhlStatScope,
  semanticCode: string,
  adminStatTypeId: string,
  confirmedBy: string,
  now: Date
) {
  const current = await tx.khlStatMapping.findUnique({
    where: { scope_semanticCode: { scope, semanticCode } },
  });
  assertImmutable(
    current?.adminBindingStatus,
    current?.adminStatTypeId,
    adminStatTypeId,
    `${scope} ${semanticCode} Admin stat type`
  );
  if (
    current?.adminBindingStatus === KhlBindingStatus.CONFIRMED
    && current.adminStatTypeId === adminStatTypeId
  ) {
    return current;
  }
  return tx.khlStatMapping.upsert({
    where: { scope_semanticCode: { scope, semanticCode } },
    create: {
      scope,
      semanticCode,
      adminStatTypeId,
      adminBindingStatus: KhlBindingStatus.CONFIRMED,
      adminConfirmedAt: now,
      adminConfirmedBy: confirmedBy,
    },
    update: {
      adminStatTypeId,
      adminBindingStatus: KhlBindingStatus.CONFIRMED,
      adminConfirmedAt: now,
      adminConfirmedBy: confirmedBy,
    },
  });
}

function assertImmutable(
  status: KhlBindingStatus | undefined,
  current: string | null | undefined,
  proposed: string,
  label: string
) {
  if (status === KhlBindingStatus.CONFIRMED && current && current !== proposed) {
    throw new KhlTargetBindingError(
      "CONFIRMED_BINDING_IMMUTABLE",
      `${label} is already confirmed with a different id.`
    );
  }
}

function validateInput(input: ConfirmKhlResultTargetsInput): ConfirmKhlResultTargetsInput {
  const khlGameId = externalId(input?.khlGameId, "KHL game id");
  const confirmedBy = identifier(input.confirmedBy, "confirmation actor");
  const teamStatTypes = Object.fromEntries(KHL_TEAM_STAT_CODES.map((code) => [
    code,
    identifier(input.teamStatTypes?.[code], `team ${code} stat type id`),
  ])) as Record<KhlTeamStatCode, string>;
  const playerStatTypes = Object.fromEntries(KHL_PLAYER_STAT_CODES.map((code) => [
    code,
    identifier(input.playerStatTypes?.[code], `player ${code} stat type id`),
  ])) as Record<KhlPlayerStatCode, string>;
  const teams = Object.fromEntries((["home", "away"] as const).map((side) => [side, {
    stats: Object.fromEntries(KHL_TEAM_STAT_CODES.map((code) => [code, {
      adminMatchStatId: identifier(
        input.teams?.[side]?.stats?.[code]?.adminMatchStatId,
        `${side} ${code} match-stat id`
      ),
    }])) as Record<KhlTeamStatCode, { adminMatchStatId: string }>,
  }])) as Record<"home" | "away", TeamTargets>;
  if (!Array.isArray(input.players) || input.players.length === 0 || input.players.length > 100) {
    invalid("Player bindings must be a non-empty array of at most 100 items.");
  }
  const seen = new Set<string>();
  const players = input.players.map((player) => {
    const khlPlayerId = externalId(player?.khlPlayerId, "KHL player id");
    if (seen.has(khlPlayerId)) invalid("Every KHL player id must be unique.");
    seen.add(khlPlayerId);
    return {
      khlPlayerId,
      adminPlayerId: identifier(player?.adminPlayerId, `player ${khlPlayerId} Admin player id`),
      adminMatchPlayerId: identifier(
        player?.adminMatchPlayerId,
        `player ${khlPlayerId} Admin match-player id`
      ),
      stats: Object.fromEntries(KHL_PLAYER_STAT_CODES.map((code) => [
        code,
        identifier(player?.stats?.[code], `player ${khlPlayerId} ${code} record id`),
      ])) as Record<KhlPlayerStatCode, string>,
    };
  });
  return { khlGameId, teamStatTypes, playerStatTypes, teams, players, confirmedBy };
}

function validateStatTypesInput(input: unknown): ConfirmKhlStatTypesInput {
  const root = exactObject(input, ["teamStatTypes", "playerStatTypes", "confirmedBy"], "request");
  const team = exactObject(root.teamStatTypes, KHL_TEAM_STAT_CODES, "teamStatTypes");
  const player = exactObject(root.playerStatTypes, KHL_PLAYER_STAT_CODES, "playerStatTypes");
  return {
    teamStatTypes: Object.fromEntries(KHL_TEAM_STAT_CODES.map((code) => [
      code,
      identifier(team[code], `team ${code} stat type id`),
    ])) as Record<KhlTeamStatCode, string>,
    playerStatTypes: Object.fromEntries(KHL_PLAYER_STAT_CODES.map((code) => [
      code,
      identifier(player[code], `player ${code} stat type id`),
    ])) as Record<KhlPlayerStatCode, string>,
    confirmedBy: identifier(root.confirmedBy, "confirmation actor"),
  };
}

function exactObject(
  value: unknown,
  expectedKeys: readonly string[],
  label: string
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(`${label} must be a JSON object.`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    invalid(`${label} must contain exactly: ${expectedKeys.join(", ")}.`);
  }
  return record;
}

function externalId(value: unknown, label: string) {
  if (typeof value !== "string" || !/^[1-9]\d{0,127}$/.test(value.trim())) {
    invalid(`${label} must be a positive decimal string.`);
  }
  return value.trim();
}

function identifier(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 128) {
    invalid(`${label} must contain between 1 and 128 characters.`);
  }
  return value.trim();
}

function invalid(message: string): never {
  throw new KhlTargetBindingError("INVALID_TARGET_BINDINGS", message);
}
