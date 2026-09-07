import { Prisma, type PrismaClient } from "@prisma/client";

import { prisma } from "@backend/db/db";
import { acquireTransactionLock } from "@backend/db/advisoryLock";

export type TournamentImportFreshness = {
  id: string;
  startedAt: Date;
};

export class StaleTournamentImportError extends Error {
  readonly code = "stale_tournament_import";

  constructor(
    readonly candidate: TournamentImportFreshness,
    readonly current: TournamentImportFreshness,
  ) {
    super(`Tournament import ${candidate.id} is older than current import ${current.id}`);
    this.name = "StaleTournamentImportError";
  }
}

export function compareTournamentImportFreshness(
  left: TournamentImportFreshness,
  right: TournamentImportFreshness,
) {
  const startedAtDelta = left.startedAt.getTime() - right.startedAt.getTime();
  if (startedAtDelta !== 0) return startedAtDelta < 0 ? -1 : 1;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

export function isRetryableTournamentImportTransactionError(error: unknown) {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as { code?: unknown }).code === "P2034",
  );
}

export async function runSerializableTournamentImport<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  options: {
    client?: Pick<PrismaClient, "$transaction">;
    maxAttempts?: number;
    maxWaitMs?: number;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const client = options.client ?? prisma;
  const maxAttempts = Math.max(1, Math.min(5, options.maxAttempts ?? 3));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await client.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: options.maxWaitMs ?? 10_000,
        timeout: options.timeoutMs ?? 60_000,
      });
    } catch (error) {
      if (!isRetryableTournamentImportTransactionError(error) || attempt === maxAttempts) throw error;
    }
  }

  throw new Error("Serializable tournament import exhausted its retry budget");
}

export async function assertTournamentImportFresh(params: {
  tx: Prisma.TransactionClient;
  importRecordId: string;
  disciplineSlug: string;
  sourceIdentity: string;
  tournamentId?: string | null;
  sourceTitle?: string | null;
  sourceUrl?: string | null;
  lookupBy?: "sourceTitle" | "sourceUrl";
}) {
  const sourceIdentity = normalizeSourceIdentity(params.sourceIdentity);
  await acquireTransactionLock(params.tx, `tournament-import:${params.disciplineSlug}:${sourceIdentity}`);

  const candidate = await params.tx.tournamentImport.findUniqueOrThrow({
    where: { id: params.importRecordId },
    select: {
      id: true,
      startedAt: true,
      discipline: { select: { slug: true } },
    },
  });
  if (candidate.discipline.slug !== params.disciplineSlug) {
    throw new Error(`Tournament import ${candidate.id} belongs to another discipline`);
  }

  const byId = params.tournamentId
    ? await params.tx.tournament.findUnique({
        where: { id: params.tournamentId },
        select: tournamentFreshnessSelect,
      })
    : null;
  const lookupBy = params.lookupBy ?? (params.sourceTitle ? "sourceTitle" : "sourceUrl");
  const lookupValue = lookupBy === "sourceTitle" ? params.sourceTitle : params.sourceUrl;
  if (!byId && !lookupValue) throw new Error(`Tournament import ${lookupBy} lookup value is required`);
  const tournament = byId ?? await params.tx.tournament.findFirst({
    where: {
      disciplineSlug: params.disciplineSlug,
      [lookupBy]: lookupValue,
    },
    orderBy: { updatedAt: "desc" },
    select: tournamentFreshnessSelect,
  });

  const current = tournament?.lastImport;
  if (current && compareTournamentImportFreshness(candidate, current) < 0) {
    throw new StaleTournamentImportError(candidate, current);
  }

  return {
    candidate: { id: candidate.id, startedAt: candidate.startedAt },
    tournamentId: tournament?.id ?? null,
    currentLastImportId: tournament?.lastImportId ?? null,
  };
}

const tournamentFreshnessSelect = {
  id: true,
  lastImportId: true,
  lastImport: { select: { id: true, startedAt: true } },
} satisfies Prisma.TournamentSelect;

function normalizeSourceIdentity(value: string) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) throw new Error("Tournament import source identity is required");
  return normalized;
}
