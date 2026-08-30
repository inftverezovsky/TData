import type { PrismaClient } from "@prisma/client";

import { buildManualAdminTeamRecord, normalizeAdminExternalId } from "../admin/directory";
import { TLineValidationError } from "../api/validation";

export async function saveManualTLineTeamMapping(
  client: PrismaClient,
  input: {
    championshipId: string;
    sourceTeamId: string;
    platformId: unknown;
    adminName?: string | null;
    locked?: boolean;
  },
) {
  const sourceTeam = await client.tLineSourceTeam.findUnique({
    where: { id: input.sourceTeamId },
    include: {
      championship: {
        include: {
          globalHeader: { select: { id: true, active: true } },
          sportConfig: { include: { discipline: { select: { slug: true } } } },
        },
      },
    },
  });
  if (!sourceTeam || sourceTeam.championshipId !== input.championshipId) {
    throw new TLineValidationError(
      "CROSS_CHAMPIONSHIP_MAPPING",
      "Source team must belong to the selected championship.",
    );
  }

  const platformId = normalizeAdminExternalId(input.platformId);
  const disciplineSlug = sourceTeam.championship.sportConfig.discipline.slug;
  let adminTeam = await client.adminTeam.findFirst({
    where: { disciplineSlug, platformId },
    orderBy: { id: "asc" },
  });
  if (!adminTeam) {
    const record = buildManualAdminTeamRecord({
      disciplineSlug,
      platformId,
      adminName: input.adminName ?? undefined,
      sourceTeamName: sourceTeam.name,
    });
    adminTeam = await client.adminTeam.upsert({
      where: { id: record.id },
      create: record,
      update: input.adminName?.trim()
        ? {
            platformName: record.platformName,
            platformNameRu: record.platformNameRu,
            platformNameEn: record.platformNameEn,
            normalizedName: record.normalizedName,
            normalizedNameRu: record.normalizedNameRu,
            normalizedNameEn: record.normalizedNameEn,
          }
        : {},
    });
  }

  const inDirectory = Boolean(
    sourceTeam.championship.globalHeader?.active
    && await client.tLineGlobalHeaderAdminTeam.findUnique({
      where: {
        globalHeaderId_adminTeamId: {
          globalHeaderId: sourceTeam.championship.globalHeader.id,
          adminTeamId: adminTeam.id,
        },
      },
      select: { adminTeamId: true },
    }),
  );
  const mapping = await client.tLineTeamMapping.upsert({
    where: { sourceTeamId: sourceTeam.id },
    update: {
      championshipId: input.championshipId,
      adminTeamId: adminTeam.id,
      status: "MANUAL_MAPPED",
      confidenceScore: 1,
      matchMethod: "manual",
      isLocked: input.locked ?? true,
      confirmedAt: new Date(),
    },
    create: {
      championshipId: input.championshipId,
      sourceTeamId: sourceTeam.id,
      adminTeamId: adminTeam.id,
      status: "MANUAL_MAPPED",
      confidenceScore: 1,
      matchMethod: "manual",
      isLocked: input.locked ?? true,
      confirmedAt: new Date(),
    },
  });
  return { mapping, adminTeam, inDirectory };
}

export async function clearManualTLineTeamMapping(client: PrismaClient, id: string) {
  return client.tLineTeamMapping.update({
    where: { id },
    data: {
      status: "MANUAL_UNMAPPED",
      confidenceScore: null,
      matchMethod: "manual_unmapped",
      isLocked: true,
      confirmedAt: new Date(),
    },
  });
}

export async function unlockTLineTeamMapping(client: PrismaClient, id: string) {
  const mapping = await client.tLineTeamMapping.findUniqueOrThrow({ where: { id } });
  return client.tLineTeamMapping.update({
    where: { id },
    data: {
      isLocked: false,
      status: mapping.status === "MANUAL_UNMAPPED" ? "UNMAPPED" : mapping.status,
      matchMethod: mapping.status === "MANUAL_UNMAPPED" ? null : mapping.matchMethod,
      confirmedAt: null,
    },
  });
}
