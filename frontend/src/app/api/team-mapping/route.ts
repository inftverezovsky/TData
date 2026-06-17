import { NextResponse } from "next/server";
import { prisma } from "@backend/db/db";
import { queueIdentitySync } from "@backend/sync/identitySync";
import { normalizeTeamName } from "@backend/teams/teams";
import {
  buildAdminTeamDisplayLookup,
  resolveTeamMappingDisplay,
  type AdminTeamDisplayRecord,
} from "@backend/teams/mappingDisplay";

export const dynamic = "force-dynamic";

// GET — все маппинги или по списку имён
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const names = searchParams.get("names");
  const disciplineSlug = searchParams.get("discipline") || "counterstrike";

  if (names) {
    const nameList = names.split(",").map((n) => n.trim()).filter(Boolean);
    const mappings = await prisma.teamMapping.findMany({
      where: { 
        disciplineSlug,
        liquipediaName: { in: nameList } 
      }
    });
    return NextResponse.json({ mappings });
  }

  const mappings = await prisma.teamMapping.findMany({
    where: { disciplineSlug },
    orderBy: { liquipediaName: "asc" }
  });
  return NextResponse.json({ mappings });
}

// POST — создать или обновить маппинг
export async function POST(request: Request) {
  // API remains callable directly; password gate is UI-only for settings visibility.

  const body = await request.json();
  const { liquipediaName, disciplineSlug, alias, platformId, canonicalName, status, logoUrl, isManual, isLockedFromAutoMapping, mappings } = body as any;

  const slug = String(disciplineSlug || "counterstrike").trim().toLowerCase();

  if (Array.isArray(mappings)) {
    const result = await saveBulkManualMappings(slug, mappings);
    const identitySync = queueIdentitySync("team-mapping:bulk-upsert");
    return NextResponse.json({ ...result, identitySync });
  }

  if (!liquipediaName || liquipediaName.trim().length < 1) {
    return NextResponse.json({ error: "liquipediaName обязателен" }, { status: 400 });
  }

  const normalizedName = liquipediaName.trim();
  const normalizedPlatformId = normalizePlatformId(platformId);
  const adminTeam = normalizedPlatformId ? await findAdminTeamByPlatformId(slug, normalizedPlatformId) : null;
  const canonicalNameToSave = adminTeam?.platformName || canonicalName?.trim() || null;

  const mapping = await prisma.teamMapping.upsert({
    where: { 
      disciplineSlug_liquipediaName: {
        disciplineSlug: slug,
        liquipediaName: normalizedName
      }
    },
    update: {
      alias: alias?.trim() || null,
      canonicalName: canonicalNameToSave,
      platformId: normalizedPlatformId || null,
      logoUrl: logoUrl?.trim() || undefined,
      status: status || 'manual_mapped',
      isManual: isManual !== undefined ? isManual : true,
      isLockedFromAutoMapping: isLockedFromAutoMapping !== undefined ? isLockedFromAutoMapping : true
    },
    create: {
      disciplineSlug: slug,
      liquipediaName: normalizedName,
      liquipediaNormalizedName: normalizeTeamName(normalizedName),
      alias: alias?.trim() || null,
      canonicalName: canonicalNameToSave,
      platformId: normalizedPlatformId || null,
      logoUrl: logoUrl?.trim() || null,
      status: status || 'manual_mapped',
      isManual: isManual !== undefined ? isManual : true,
      isLockedFromAutoMapping: isLockedFromAutoMapping !== undefined ? isLockedFromAutoMapping : true
    }
  });

  // Cascade update: find all tournaments for this discipline and update participants with this name
  await prisma.tournamentParticipant.updateMany({
    where: {
      name: normalizedName,
      tournament: {
        disciplineSlug: slug
      }
    },
    data: {
      platformId: normalizedPlatformId || null
    }
  });

  const identitySync = queueIdentitySync("team-mapping:upsert");
  return NextResponse.json({
    mapping: {
      ...mapping,
      ...resolveTeamMappingDisplay(
        {
          liquipediaName: mapping.liquipediaName,
          canonicalName: mapping.canonicalName,
          platformId: mapping.platformId,
          status: mapping.status,
        },
        buildAdminTeamDisplayLookup(adminTeam ? [adminTeam] : [])
      ),
    },
    identitySync,
  });
}

export async function DELETE(request: Request) {
  // API remains callable directly; password gate is UI-only for settings visibility.

  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name");
  const disciplineSlug = searchParams.get("discipline") || "counterstrike";

  if (!name) {
    return NextResponse.json({ error: "Параметр name обязателен" }, { status: 400 });
  }

  const normalizedName = name.trim();

  // Don't physically delete, instead mark as unmapped and locked.
  // Some rows are shown through saved aliases (for example Liquid -> Team Liquid),
  // so create an explicit locked row if this exact source name was not stored yet.
  await prisma.teamMapping.upsert({
    where: {
      disciplineSlug_liquipediaName: {
        disciplineSlug,
        liquipediaName: normalizedName
      }
    },
    create: {
      disciplineSlug,
      liquipediaName: normalizedName,
      liquipediaNormalizedName: normalizeTeamName(normalizedName),
      platformId: null,
      canonicalName: null,
      alias: null,
      status: 'manual_unmapped',
      isManual: true,
      isLockedFromAutoMapping: true,
      matchMethod: null,
      confidenceScore: null
    },
    update: {
      platformId: null,
      canonicalName: null,
      alias: null,
      status: 'manual_unmapped',
      isManual: true,
      isLockedFromAutoMapping: true,
      matchMethod: null,
      confidenceScore: null
    },
  });

  // Clear participant platformId
  await prisma.tournamentParticipant.updateMany({
    where: {
      name: normalizedName,
      tournament: {
        disciplineSlug
      }
    },
    data: {
      platformId: null
    }
  });

  const identitySync = queueIdentitySync("team-mapping:delete");
  return NextResponse.json({ success: true, identitySync });
}

async function saveBulkManualMappings(slug: string, rawMappings: unknown[]) {
  const candidates = rawMappings
    .map((item) => readBulkManualMapping(item))
    .filter((item): item is { liquipediaName: string; platformId: string; canonicalName: string | null } => Boolean(item));

  if (candidates.length === 0) {
    return { success: false, error: "Нет валидных строк для сохранения.", savedCount: 0, skippedCount: rawMappings.length, mappings: [] };
  }

  const platformIds = Array.from(new Set(candidates.map((candidate) => candidate.platformId)));
  const adminTeams = await prisma.adminTeam.findMany({
    where: {
      disciplineSlug: slug,
      platformId: { in: platformIds },
    },
    select: { platformId: true, platformName: true },
  });
  const adminLookup = buildAdminTeamDisplayLookup(adminTeams);
  const savedMappings = [];

  for (const candidate of candidates) {
    const adminTeam = adminLookup.get(candidate.platformId);
    const canonicalNameToSave = adminTeam?.platformName || candidate.canonicalName || candidate.liquipediaName;
    const saved = await prisma.teamMapping.upsert({
      where: {
        disciplineSlug_liquipediaName: {
          disciplineSlug: slug,
          liquipediaName: candidate.liquipediaName,
        },
      },
      create: {
        disciplineSlug: slug,
        liquipediaName: candidate.liquipediaName,
        liquipediaNormalizedName: normalizeTeamName(candidate.liquipediaName),
        platformId: candidate.platformId,
        canonicalName: canonicalNameToSave,
        status: "manual_mapped",
        isManual: true,
        isLockedFromAutoMapping: true,
      },
      update: {
        platformId: candidate.platformId,
        canonicalName: canonicalNameToSave,
        status: "manual_mapped",
        isManual: true,
        isLockedFromAutoMapping: true,
        confidenceScore: null,
        matchMethod: "manual_bulk",
      },
    });

    await prisma.tournamentParticipant.updateMany({
      where: { name: candidate.liquipediaName, tournament: { disciplineSlug: slug } },
      data: { platformId: candidate.platformId },
    });

    savedMappings.push({
      ...saved,
      ...resolveTeamMappingDisplay(
        {
          liquipediaName: saved.liquipediaName,
          canonicalName: saved.canonicalName,
          platformId: saved.platformId,
          status: saved.status,
        },
        adminLookup
      ),
    });
  }

  return {
    success: true,
    savedCount: savedMappings.length,
    skippedCount: rawMappings.length - candidates.length,
    mappings: savedMappings,
  };
}

function readBulkManualMapping(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const item = value as { liquipediaName?: unknown; teamName?: unknown; platformId?: unknown; canonicalName?: unknown };
  const liquipediaName = readString(item.liquipediaName) || readString(item.teamName);
  const platformId = normalizePlatformId(item.platformId);
  const canonicalName = readString(item.canonicalName) || null;

  if (!liquipediaName || !platformId) return null;
  return { liquipediaName, platformId, canonicalName };
}

async function findAdminTeamByPlatformId(slug: string, platformId: string): Promise<AdminTeamDisplayRecord | null> {
  return prisma.adminTeam.findFirst({
    where: { disciplineSlug: slug, platformId },
    select: { platformId: true, platformName: true },
  });
}

function normalizePlatformId(value: unknown) {
  const text = readString(value).replace(/[^\d]/g, "");
  if (!/^[1-9]\d*$/.test(text)) return "";
  return text;
}

function readString(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}
