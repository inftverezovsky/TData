import { Prisma } from "@prisma/client";
import { acquireTransactionLock } from "@backend/db/advisoryLock";

const PRESERVED_MATCH_FIELDS = new Set([
  "id",
  "matchId",
  "tournamentId",
  "platformId",
  "syncedAt",
  "lpNumericalId",
  "createdAt",
]);

export type TournamentMatchRefreshRow = {
  matchId: string;
  create: Prisma.TournamentMatchUncheckedCreateInput;
  update: Prisma.TournamentMatchUncheckedUpdateInput;
};

type PreservedTournamentMatchState = {
  matchId: string;
  tournamentId: string;
  platformId: string | null;
  syncedAt: Date | null;
  lpNumericalId: bigint | null;
};

/**
 * Refresh source-owned fields without destroying IDs assigned by the admin
 * platform or the delivery pipeline. Incoming match IDs are globally unique,
 * so a collision with another tournament is rejected instead of moving data.
 */
export async function refreshTournamentMatchesPreservingState(params: {
  tx: Prisma.TransactionClient;
  tournamentId: string;
  matches: TournamentMatchRefreshRow[];
  snapshotCompleteness?: "complete" | "partial";
}): Promise<void> {
  const incomingMatchIds = params.matches.map((match) => match.matchId);
  // A PostgreSQL upsert can otherwise follow a concurrent insert into its
  // update branch after the ownership read and silently modify a foreign row.
  const ownershipLockIds = Array.from(new Set(incomingMatchIds)).sort();
  for (const matchId of ownershipLockIds) {
    await acquireTransactionLock(params.tx, `tournament-match:${matchId}`);
  }

  const existingMatches = await params.tx.tournamentMatch.findMany({
    where: {
      OR: [
        { tournamentId: params.tournamentId },
        { matchId: { in: incomingMatchIds } },
      ],
    },
    select: {
      matchId: true,
      tournamentId: true,
      platformId: true,
      syncedAt: true,
      lpNumericalId: true,
    },
  });
  const existingByMatchId = new Map(
    existingMatches.map((match) => [match.matchId, match]),
  );

  for (const match of params.matches) {
    const existing = existingByMatchId.get(match.matchId);
    if (existing && existing.tournamentId !== params.tournamentId) {
      throw new Error(
        `TournamentMatch ${match.matchId} belongs to another tournament; refresh was aborted.`,
      );
    }

    await params.tx.tournamentMatch.upsert({
      where: { matchId: match.matchId },
      create: buildCreateData(match, params.tournamentId, existing),
      update: omitPreservedMatchFields(match.update),
    });
  }

  if ((params.snapshotCompleteness ?? "complete") === "complete") {
    await params.tx.tournamentMatch.deleteMany({
      where: {
        tournamentId: params.tournamentId,
        matchId: { notIn: incomingMatchIds },
      },
    });
  }
}

function buildCreateData(
  match: TournamentMatchRefreshRow,
  tournamentId: string,
  existing: PreservedTournamentMatchState | undefined,
): Prisma.TournamentMatchUncheckedCreateInput {
  const sourceData = omitPreservedMatchFields(match.create);
  const incoming = match.create;
  const preservedState = {
    platformId: existing?.platformId ?? incoming.platformId ?? null,
    syncedAt: existing?.syncedAt ?? incoming.syncedAt ?? null,
    lpNumericalId: existing?.lpNumericalId ?? incoming.lpNumericalId ?? null,
  };

  return {
    ...sourceData,
    ...preservedState,
    matchId: match.matchId,
    tournamentId,
  } as Prisma.TournamentMatchUncheckedCreateInput;
}

function omitPreservedMatchFields<T extends object>(data: T) {
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => !PRESERVED_MATCH_FIELDS.has(key)),
  );
}
