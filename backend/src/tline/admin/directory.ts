import type { PrismaClient } from "@prisma/client";

import { invalidateAdminTeamSuggestCache } from "../../adminTeams/suggestCache";
import { normalizeFuzzyName } from "../../teams/fuzzyMatch";
import { TLineValidationError } from "../api/validation";

export type TLineAdminTeamImportRecord = {
  readonly platformId: string;
  readonly platformName: string;
  readonly platformNameRu: string | null;
  readonly platformNameEn: string | null;
  readonly normalizedName: string;
  readonly normalizedNameRu: string | null;
  readonly normalizedNameEn: string | null;
};

export function normalizeAdminExternalId(value: unknown) {
  const text = typeof value === "number"
    ? Number.isSafeInteger(value) ? String(value) : ""
    : typeof value === "string" ? value.trim() : "";
  if (!/^[0-9]{1,128}$/.test(text)) throw invalidExternalId();
  const normalized = BigInt(text).toString();
  if (normalized === "0") throw invalidExternalId();
  return normalized;
}

export function buildManualAdminTeamRecord(input: {
  disciplineSlug: string;
  platformId: unknown;
  adminName?: string;
  sourceTeamName: string;
}) {
  const platformId = normalizeAdminExternalId(input.platformId);
  const disciplineSlug = input.disciplineSlug.trim().toLowerCase();
  const platformName = (input.adminName?.trim() || input.sourceTeamName.trim());
  if (!disciplineSlug || !platformName) {
    throw new TLineValidationError("INVALID_ADMIN_TEAM", "A discipline and Admin team name are required.");
  }
  const cyrillic = /\p{Script=Cyrillic}/u.test(platformName);
  const latinOnly = /\p{Script=Latin}/u.test(platformName) && !cyrillic;
  return {
    id: `admin_${disciplineSlug}_${platformId}`,
    disciplineSlug,
    platformId,
    platformName,
    platformNameRu: cyrillic ? platformName : null,
    platformNameEn: latinOnly ? platformName : null,
    normalizedName: normalizeFuzzyName(platformName),
    normalizedNameRu: cyrillic ? normalizeFuzzyName(platformName) : null,
    normalizedNameEn: latinOnly ? normalizeFuzzyName(platformName) : null,
    sourceFileName: "tline-manual",
  };
}

export function summarizeDirectoryImport(input: {
  created: number;
  updated: number;
  linked: number;
  skipped: number;
}) {
  return {
    createdCount: input.created,
    updatedCount: input.updated,
    membershipCount: input.linked,
    skippedCount: input.skipped,
    importedCount: input.created + input.updated,
    removedCount: 0,
  };
}

export async function importTLineAdminDirectory(
  client: PrismaClient,
  input: {
    championshipId: string;
    records: readonly TLineAdminTeamImportRecord[];
    sourceFileName: string;
    skippedCount?: number;
  },
) {
  const championship = await client.tLineChampionship.findUnique({
    where: { id: input.championshipId },
    include: {
      sportConfig: { include: { discipline: { select: { slug: true } } } },
      globalHeader: { select: { id: true, active: true } },
    },
  });
  if (!championship) {
    throw new TLineValidationError("CHAMPIONSHIP_NOT_FOUND", "TLine championship was not found.");
  }
  if (!championship.globalHeader?.active) {
    throw new TLineValidationError(
      "GLOBAL_HEADER_REQUIRED",
      "Assign an active Global Header/Shapka to the championship before importing teams.",
    );
  }

  const uniqueRecords = new Map<string, TLineAdminTeamImportRecord>();
  let skipped = input.skippedCount ?? 0;
  for (const record of input.records) {
    try {
      const platformId = normalizeAdminExternalId(record.platformId);
      if (uniqueRecords.has(platformId)) skipped += 1;
      uniqueRecords.set(platformId, { ...record, platformId });
    } catch {
      skipped += 1;
    }
  }

  let created = 0;
  let updated = 0;
  let linked = 0;
  const disciplineSlug = championship.sportConfig.discipline.slug;
  const globalHeaderId = championship.globalHeader.id;
  await client.$transaction(async (transaction) => {
    for (const record of uniqueRecords.values()) {
      const existing = await transaction.adminTeam.findFirst({
        where: { disciplineSlug, platformId: record.platformId },
        orderBy: { id: "asc" },
        select: { id: true },
      });
      const id = existing?.id ?? `admin_${disciplineSlug}_${record.platformId}`;
      const data = {
        disciplineSlug,
        platformId: record.platformId,
        platformName: record.platformName,
        platformNameRu: record.platformNameRu,
        platformNameEn: record.platformNameEn,
        normalizedName: record.normalizedName,
        normalizedNameRu: record.normalizedNameRu,
        normalizedNameEn: record.normalizedNameEn,
        sourceFileName: input.sourceFileName,
      };
      await transaction.adminTeam.upsert({ where: { id }, create: { id, ...data }, update: data });
      if (existing) updated += 1;
      else created += 1;

      const membership = await transaction.tLineGlobalHeaderAdminTeam.findUnique({
        where: { globalHeaderId_adminTeamId: { globalHeaderId, adminTeamId: id } },
        select: { adminTeamId: true },
      });
      await transaction.tLineGlobalHeaderAdminTeam.upsert({
        where: { globalHeaderId_adminTeamId: { globalHeaderId, adminTeamId: id } },
        create: { globalHeaderId, adminTeamId: id, sourceFileName: input.sourceFileName },
        update: { sourceFileName: input.sourceFileName, lastImportedAt: new Date() },
      });
      if (!membership) linked += 1;
    }
  });
  invalidateAdminTeamSuggestCache(disciplineSlug);
  return summarizeDirectoryImport({ created, updated, linked, skipped });
}

function invalidExternalId() {
  return new TLineValidationError("INVALID_EXTERNAL_ID", "External Admin IDs must be positive integers.");
}
