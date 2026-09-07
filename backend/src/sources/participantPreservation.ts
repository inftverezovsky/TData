import type { Prisma } from "@prisma/client";

export type TournamentParticipantManualFields = {
  platformId?: string | null;
  seed?: string | null;
  region?: string | null;
  status?: string | null;
  logoUrl?: string | null;
  rawText?: string | null;
};

type TeamMappingParticipantFields = Pick<TournamentParticipantManualFields, "platformId" | "logoUrl">;

/**
 * Participant fields can be edited after an import. Refreshing source data must
 * never overwrite those edits, including when the request bypasses caches.
 */
export function mergeTournamentParticipantManualFields(input: {
  incoming?: TournamentParticipantManualFields | null;
  existing?: TournamentParticipantManualFields | null;
  mapping?: TeamMappingParticipantFields | null;
}) {
  const incoming = input.incoming || {};
  const existing = input.existing || {};
  const mapping = input.mapping || {};

  return {
    platformId: existing.platformId ?? incoming.platformId ?? mapping.platformId ?? null,
    seed: existing.seed ?? incoming.seed ?? null,
    region: existing.region ?? incoming.region ?? null,
    status: existing.status ?? incoming.status ?? null,
    logoUrl: existing.logoUrl ?? incoming.logoUrl ?? mapping.logoUrl ?? null,
    rawText: existing.rawText ?? incoming.rawText ?? null,
  };
}

export type TournamentParticipantRefreshRow = TournamentParticipantManualFields & {
  id?: string;
  tournamentId: string;
  name: string;
};

/**
 * Refresh source participants without replacing rows that can be edited by an
 * administrator. The caller must run in a Serializable transaction; a
 * concurrent manual row update then causes a retry, whose fresh read wins.
 */
export async function refreshTournamentParticipantsPreservingState(params: {
  tx: Prisma.TransactionClient;
  tournamentId: string;
  participants: TournamentParticipantRefreshRow[];
}) {
  await params.tx.$queryRaw`
    SELECT 1 AS "lockAcquired"
    FROM pg_advisory_xact_lock(hashtext(${`tournament-participants:${params.tournamentId}`}))
  `;

  const existingParticipants = await params.tx.tournamentParticipant.findMany({
    where: { tournamentId: params.tournamentId },
    select: {
      id: true,
      name: true,
      platformId: true,
      seed: true,
      region: true,
      status: true,
      logoUrl: true,
      rawText: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const existingByName = new Map<string, typeof existingParticipants>();
  for (const participant of existingParticipants) {
    const key = normalizeParticipantName(participant.name);
    existingByName.set(key, [...(existingByName.get(key) ?? []), participant]);
  }

  const incomingByName = new Map<string, TournamentParticipantRefreshRow>();
  for (const participant of params.participants) {
    if (participant.tournamentId !== params.tournamentId) {
      throw new Error("Participant refresh cannot write into another tournament");
    }
    const key = normalizeParticipantName(participant.name);
    if (!key || incomingByName.has(key)) continue;
    incomingByName.set(key, { ...participant, name: participant.name.trim() });
  }

  const retainedIds = new Set<string>();
  for (const [key, incoming] of incomingByName) {
    const existing = existingByName.get(key)?.[0] ?? null;
    const manualFields = mergeTournamentParticipantManualFields({ incoming, existing });
    if (existing) {
      retainedIds.add(existing.id);
      await params.tx.tournamentParticipant.update({
        where: { id: existing.id },
        data: { name: incoming.name, ...manualFields },
      });
      continue;
    }

    const created = await params.tx.tournamentParticipant.create({
      data: {
        ...(incoming.id ? { id: incoming.id } : {}),
        tournamentId: params.tournamentId,
        name: incoming.name,
        ...manualFields,
      },
      select: { id: true },
    });
    retainedIds.add(created.id);
  }

  const removableIds = existingParticipants
    .filter((participant) => !retainedIds.has(participant.id) && participant.platformId === null)
    .map((participant) => participant.id);
  if (removableIds.length > 0) {
    await params.tx.tournamentParticipant.deleteMany({
      where: {
        id: { in: removableIds },
        tournamentId: params.tournamentId,
        platformId: null,
      },
    });
  }
}

function normalizeParticipantName(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}
