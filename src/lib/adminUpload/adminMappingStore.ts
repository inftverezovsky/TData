import { prisma } from "@/lib/db/db";

type UpsertAdminMappingInput = {
  tournamentId: string;
  disciplineSlug?: string | null;
  sourceTournamentName?: string | null;
  adminShapkaId?: string | number | null;
  adminShapkaName?: string | null;
};

export async function findTournamentAdminMapping(tournamentId: string) {
  const direct = await prisma.tournamentAdminMapping.findUnique({
    where: { tournamentId },
  });
  if (direct) return direct;

  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      id: true,
      disciplineSlug: true,
      sourceTitle: true,
      sourceUrl: true,
      name: true,
    },
  });
  if (!tournament) return null;

  const fallback = await prisma.tournamentAdminMapping.findFirst({
    where: {
      disciplineSlug: tournament.disciplineSlug,
      OR: [
        { sourceTournamentId: tournament.sourceUrl },
        { sourceTournamentId: tournament.sourceTitle },
        { sourceTournamentName: tournament.sourceTitle },
        { sourceTournamentName: tournament.name },
      ],
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!fallback) return null;

  return prisma.tournamentAdminMapping.upsert({
    where: { tournamentId },
    update: {
      sourceTournamentId: tournament.sourceUrl || tournament.sourceTitle,
      sourceTournamentName: fallback.sourceTournamentName || tournament.sourceTitle || tournament.name,
      adminShapkaId: fallback.adminShapkaId,
      adminShapkaName: fallback.adminShapkaName,
    },
    create: {
      tournamentId,
      disciplineSlug: tournament.disciplineSlug,
      sourceTournamentId: tournament.sourceUrl || tournament.sourceTitle,
      sourceTournamentName: fallback.sourceTournamentName || tournament.sourceTitle || tournament.name,
      adminShapkaId: fallback.adminShapkaId,
      adminShapkaName: fallback.adminShapkaName,
    },
  });
}

export async function upsertTournamentAdminMapping(input: UpsertAdminMappingInput) {
  const tournament = await prisma.tournament.findUnique({
    where: { id: input.tournamentId },
    select: {
      disciplineSlug: true,
      sourceTitle: true,
      sourceUrl: true,
      name: true,
    },
  });

  const disciplineSlug = input.disciplineSlug || tournament?.disciplineSlug || "counterstrike";
  const sourceTournamentName =
    input.sourceTournamentName ||
    tournament?.sourceTitle ||
    tournament?.name ||
    input.tournamentId;

  return prisma.tournamentAdminMapping.upsert({
    where: { tournamentId: input.tournamentId },
    update: {
      disciplineSlug,
      sourceTournamentId: tournament?.sourceUrl || tournament?.sourceTitle || null,
      sourceTournamentName,
      adminShapkaId: input.adminShapkaId?.toString() || null,
      adminShapkaName: input.adminShapkaName || null,
    },
    create: {
      tournamentId: input.tournamentId,
      disciplineSlug,
      sourceTournamentId: tournament?.sourceUrl || tournament?.sourceTitle || null,
      sourceTournamentName,
      adminShapkaId: input.adminShapkaId?.toString() || null,
      adminShapkaName: input.adminShapkaName || null,
    },
  });
}
