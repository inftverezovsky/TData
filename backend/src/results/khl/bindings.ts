import {
  KhlBindingMode,
  KhlBindingStatus,
  KhlRevisionState,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import {
  resolveAdminMatch,
  type AdminMatchCandidate,
} from "@backend/results/khl/matchResolver";
import type { NormalizedKhlMatch } from "@backend/sources/results/khl/normalize";

export type KhlBindingConflictCode =
  | "TEAM_NOT_FOUND"
  | "MATCH_NOT_FOUND"
  | "UNMAPPED_TEAM"
  | "ADMIN_TEAM_ALREADY_BOUND"
  | "ADMIN_MATCH_ALREADY_BOUND"
  | "MATCH_ALREADY_BOUND"
  | "MATCH_RESOLUTION_BLOCKED"
  | "BOUND_MATCH_DEPENDS_ON_TEAM"
  | "INVALID_BINDING";

export class KhlBindingConflictError extends Error {
  constructor(
    public readonly code: KhlBindingConflictCode,
    message: string
  ) {
    super(message);
    this.name = "KhlBindingConflictError";
  }
}

type TeamBindingInput = {
  khlTeamId: string;
  adminTeamId: string;
  confirmedBy: string;
};

type MatchBindingInput = {
  khlGameId: string;
  adminMatchId: string;
  candidates: AdminMatchCandidate[];
  confirmedBy: string;
};

export async function confirmKhlTeamBinding(
  prisma: PrismaClient,
  input: TeamBindingInput
) {
  const khlTeamId = validateExternalId(input.khlTeamId, "KHL team id");
  const adminTeamId = validateIdentifier(input.adminTeamId, "Admin team id");
  const confirmedBy = validateActor(input.confirmedBy);

  try {
    return await prisma.$transaction(async (tx) => {
      const team = await tx.khlTeam.findUnique({ where: { khlTeamId } });
      if (!team) {
        throw new KhlBindingConflictError("TEAM_NOT_FOUND", "KHL team was not ingested.");
      }
      if (
        team.adminBindingStatus === KhlBindingStatus.CONFIRMED
        && team.adminTeamId === adminTeamId
      ) {
        return team;
      }
      if (team.adminTeamId && team.adminTeamId !== adminTeamId) {
        const dependentMatches = await tx.khlMatch.count({
          where: {
            adminBindingStatus: KhlBindingStatus.CONFIRMED,
            OR: [{ homeTeamId: team.id }, { awayTeamId: team.id }],
          },
        });
        if (dependentMatches > 0) {
          throw new KhlBindingConflictError(
            "BOUND_MATCH_DEPENDS_ON_TEAM",
            "A confirmed match depends on the current team binding."
          );
        }
      }
      const collision = await tx.khlTeam.findFirst({
        where: { adminTeamId, NOT: { id: team.id } },
        select: { id: true },
      });
      if (collision) {
        throw new KhlBindingConflictError(
          "ADMIN_TEAM_ALREADY_BOUND",
          "The Admin team id is already bound to another KHL team."
        );
      }
      return tx.khlTeam.update({
        where: { id: team.id },
        data: {
          adminTeamId,
          adminBindingStatus: KhlBindingStatus.CONFIRMED,
          adminConfirmedAt: new Date(),
          adminConfirmedBy: confirmedBy,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    throw translateUniqueConflict(error, "ADMIN_TEAM_ALREADY_BOUND");
  }
}

export async function confirmKhlMatchBinding(
  prisma: PrismaClient,
  input: MatchBindingInput
) {
  const khlGameId = validateExternalId(input.khlGameId, "KHL game id");
  const adminMatchId = validateIdentifier(input.adminMatchId, "Admin match id");
  const confirmedBy = validateActor(input.confirmedBy);
  const candidates = validateCandidates(input.candidates);

  try {
    return await prisma.$transaction(async (tx) => {
      let match = await tx.khlMatch.findUnique({
        where: { khlGameId },
        include: { homeTeam: true, awayTeam: true, activeRevision: true },
      });
      if (!match) {
        throw new KhlBindingConflictError("MATCH_NOT_FOUND", "KHL match was not ingested.");
      }
      const normalized = match.activeRevision?.normalizedJson as unknown as
        | NormalizedKhlMatch
        | undefined;
      const normalizedStartsAt = new Date(normalized?.startsAt || "");
      if (
        match.activeRevision?.state !== KhlRevisionState.VALIDATED
        || normalized?.identity?.khlGameId !== match.khlGameId
        || normalized.identity.apiEventId !== match.apiEventId
        || normalized.identity.matchId !== match.sourceMatchId
        || String(normalized.identity.stageId) !== match.stageId
        || String(normalized.identity.khlStageId) !== match.khlStageId
        || normalized.identity.season !== match.season
        || !Number.isFinite(normalizedStartsAt.getTime())
        || normalizedStartsAt.getTime() !== match.startsAt.getTime()
        || String(normalized?.teams?.home?.khlTeamId) !== match.homeTeam.khlTeamId
        || String(normalized?.teams?.away?.khlTeamId) !== match.awayTeam.khlTeamId
      ) {
        throw new KhlBindingConflictError(
          "MATCH_RESOLUTION_BLOCKED",
          "A matching active validated KHL revision is required before Admin match confirmation."
        );
      }
      if (
        match.homeTeam.adminBindingStatus !== KhlBindingStatus.CONFIRMED
        || !match.homeTeam.adminTeamId
        || match.awayTeam.adminBindingStatus !== KhlBindingStatus.CONFIRMED
        || !match.awayTeam.adminTeamId
      ) {
        throw new KhlBindingConflictError(
          "UNMAPPED_TEAM",
          "Both KHL teams must have confirmed Admin team ids before matching."
        );
      }
      const resolution = resolveAdminMatch({
        khlGameId: normalized.identity.khlGameId,
        season: normalized.identity.season,
        stageId: normalized.identity.stageId,
        startsAt: normalized.startsAt,
        homeAdminTeamId: match.homeTeam.adminTeamId,
        awayAdminTeamId: match.awayTeam.adminTeamId,
        confirmedAdminMatchId: adminMatchId,
      }, candidates);
      if (resolution.status !== "ready") {
        throw new KhlBindingConflictError(
          "MATCH_RESOLUTION_BLOCKED",
          `Admin match resolver blocked confirmation: ${resolution.reason}.`
        );
      }
      const mode = resolution.mode === "MANUAL"
        ? KhlBindingMode.MANUAL
        : KhlBindingMode.AUTO;
      if (
        match.adminBindingStatus === KhlBindingStatus.CONFIRMED
        && match.adminMatchId
        && match.adminMatchId !== adminMatchId
      ) {
        throw new KhlBindingConflictError(
          "MATCH_ALREADY_BOUND",
          "The KHL match already has a different confirmed Admin match id."
        );
      }
      const collision = await tx.khlMatch.findFirst({
        where: { adminMatchId, NOT: { id: match.id } },
        select: { id: true },
      });
      if (collision) {
        throw new KhlBindingConflictError(
          "ADMIN_MATCH_ALREADY_BOUND",
          "The Admin match id is already bound to another KHL match."
        );
      }
      if (
        match.adminBindingStatus !== KhlBindingStatus.CONFIRMED
        || match.adminMatchId !== adminMatchId
        || match.adminBindingMode !== mode
      ) {
        match = await tx.khlMatch.update({
          where: { id: match.id },
          data: {
            adminMatchId,
            adminBindingStatus: KhlBindingStatus.CONFIRMED,
            adminBindingMode: mode,
            adminConfirmedAt: new Date(),
            adminConfirmedBy: confirmedBy,
          },
          include: { homeTeam: true, awayTeam: true, activeRevision: true },
        });
      }

      return {
        match,
        matchKey: resolution.matchKey,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    throw translateUniqueConflict(error, "ADMIN_MATCH_ALREADY_BOUND");
  }
}

function validateExternalId(value: string, label: string) {
  if (typeof value !== "string" || !/^[1-9]\d{0,127}$/.test(value.trim())) {
    throw new KhlBindingConflictError("INVALID_BINDING", `${label} must be a positive decimal string.`);
  }
  return value.trim();
}

function validateIdentifier(value: string, label: string) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 128) {
    throw new KhlBindingConflictError(
      "INVALID_BINDING",
      `${label} must contain between 1 and 128 characters.`
    );
  }
  return value.trim();
}

function validateActor(value: string) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 128) {
    throw new KhlBindingConflictError(
      "INVALID_BINDING",
      "Binding confirmation actor is invalid."
    );
  }
  return value.trim();
}

function validateCandidates(value: unknown): AdminMatchCandidate[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new KhlBindingConflictError(
      "INVALID_BINDING",
      "Admin match candidates must be an array of at most 100 items."
    );
  }
  return value as AdminMatchCandidate[];
}

function translateUniqueConflict(
  error: unknown,
  fallbackCode: "ADMIN_TEAM_ALREADY_BOUND" | "ADMIN_MATCH_ALREADY_BOUND"
) {
  if (error instanceof KhlBindingConflictError) return error;
  if (String((error as { code?: string })?.code || "") === "P2002") {
    return new KhlBindingConflictError(fallbackCode, "Admin id binding conflicts with another row.");
  }
  return error;
}
