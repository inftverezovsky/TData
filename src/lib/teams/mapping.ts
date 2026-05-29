import { prisma } from "@/lib/db/db";
import { isPlaceholderTeam, normalizeTeamName } from "@/lib/teams/teams";
import {
  autoMappingSelectionKey,
  buildAutoMappingPreviewFromData,
  isInvalidAutoMappingName,
  normalizeInputTeamNames,
  type AutoMappingPreviewItem,
  type AutoMappingSelection,
} from "@/lib/teams/autoMappingPreview";
import { MappingStatus } from "@prisma/client";

export {
  buildAutoMappingPreviewFromData,
  isInvalidAutoMappingName,
  type AutoMappingAdminTeam,
  type AutoMappingPreview,
  type AutoMappingPreviewItem,
  type AutoMappingSelection,
  type AutoMappingSourceMapping,
} from "@/lib/teams/autoMappingPreview";

export async function ensureTeamMappingsForTournament(tournamentId: string, disciplineSlug: string = "dota2") {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      participants: true,
      matches: true,
    },
  });

  if (!tournament) return;

  const teamNames = new Set<string>();
  tournament.participants.forEach((participant) => {
    if (participant.name) teamNames.add(participant.name);
  });
  tournament.matches.forEach((match) => {
    if (match.teamAName) teamNames.add(match.teamAName);
    if (match.teamBName) teamNames.add(match.teamBName);
  });

  const realTeams = Array.from(teamNames).filter((name) => !isPlaceholderTeam(name));

  await ensureTeamMappingsForNames(realTeams, disciplineSlug);

  return await runAutoMappingForDiscipline(disciplineSlug, { liquipediaNames: realTeams });
}

export async function ensureTeamMappingsForNames(teamNames: string[], disciplineSlug: string) {
  const slug = disciplineSlug.trim().toLowerCase();
  const normalizedNames = normalizeInputTeamNames(teamNames).filter((name) => !isInvalidAutoMappingName(name));

  if (!slug || normalizedNames.length === 0) {
    return { ensuredCount: 0, createdCount: 0 };
  }

  const existing = await prisma.teamMapping.findMany({
    where: {
      disciplineSlug: slug,
      liquipediaName: { in: normalizedNames },
    },
    select: { liquipediaName: true },
  });
  const existingNames = new Set(existing.map((mapping) => mapping.liquipediaName));
  const missingNames = normalizedNames.filter((name) => !existingNames.has(name));

  if (missingNames.length > 0) {
    await prisma.teamMapping.createMany({
      data: missingNames.map((name) => ({
        disciplineSlug: slug,
        liquipediaName: name,
        liquipediaNormalizedName: normalizeTeamName(name),
      })),
      skipDuplicates: true,
    });
  }

  return {
    ensuredCount: normalizedNames.length,
    createdCount: missingNames.length,
  };
}

export async function buildAutoMappingPreviewForDiscipline(
  disciplineSlug: string,
  options: { liquipediaNames?: string[]; includeAutoMapped?: boolean } = {}
) {
  const slug = disciplineSlug.trim().toLowerCase();
  const requestedNames = normalizeInputTeamNames(options.liquipediaNames ?? []);
  const [adminTeams, mappings] = await Promise.all([
    prisma.adminTeam.findMany({
      where: { disciplineSlug: slug },
      select: {
        platformId: true,
        platformName: true,
        platformNameRu: true,
        platformNameEn: true,
        normalizedName: true,
        normalizedNameRu: true,
        normalizedNameEn: true,
      },
    }),
    prisma.teamMapping.findMany({
      where: {
        disciplineSlug: slug,
        ...(requestedNames.length > 0
          ? {
              OR: [
                { liquipediaName: { in: requestedNames } },
                { platformId: { not: null } },
                { isLockedFromAutoMapping: true },
              ],
            }
          : {}),
      },
    }),
  ]);

  return buildAutoMappingPreviewFromData({
    teamNames: requestedNames.length > 0 ? requestedNames : mappings.map((mapping) => mapping.liquipediaName),
    mappings,
    adminTeams,
    includeAutoMapped: options.includeAutoMapped,
  });
}

export async function applyAutoMappingForDiscipline({
  disciplineSlug,
  liquipediaNames,
  selections,
  replaceConflicts = false,
}: {
  disciplineSlug: string;
  liquipediaNames?: string[];
  selections?: AutoMappingSelection[];
  replaceConflicts?: boolean;
}) {
  const slug = disciplineSlug.trim().toLowerCase();
  const preview = await buildAutoMappingPreviewForDiscipline(slug, { liquipediaNames });
  const selectable = replaceConflicts ? preview.conflicts : [...preview.auto, ...preview.suggested];
  const selectedKeys = selections?.length
    ? new Set(selections.map((selection) => autoMappingSelectionKey(selection.liquipediaName, selection.platformId)))
    : new Set(preview.auto.map((item) => autoMappingSelectionKey(item.liquipediaName, item.platformId || "")));
  const toApply = selectable.filter((item) => item.platformId && selectedKeys.has(autoMappingSelectionKey(item.liquipediaName, item.platformId)));
  const appliedMappings = [];
  const skipped: AutoMappingPreviewItem[] = [];

  for (const item of toApply) {
    if (!item.platformId || !item.adminName) {
      skipped.push({ ...item, reason: "missing_platform_candidate" });
      continue;
    }

    const existing = await prisma.teamMapping.findUnique({
      where: {
        disciplineSlug_liquipediaName: {
          disciplineSlug: slug,
          liquipediaName: item.liquipediaName,
        },
      },
    });

    if (existing?.isLockedFromAutoMapping && existing.platformId && existing.platformId !== item.platformId && !replaceConflicts) {
      skipped.push({ ...item, existingPlatformId: existing.platformId, reason: "manual_mapping_conflict" });
      continue;
    }
    const confirmedConflictReplacement = replaceConflicts && item.reason === "manual_mapping_conflict";

    const saved = await prisma.teamMapping.upsert({
      where: {
        disciplineSlug_liquipediaName: {
          disciplineSlug: slug,
          liquipediaName: item.liquipediaName,
        },
      },
      create: {
        disciplineSlug: slug,
        liquipediaName: item.liquipediaName,
        liquipediaNormalizedName: item.normalizedName,
        platformId: item.platformId,
        canonicalName: item.adminName,
        confidenceScore: item.score ?? null,
        matchMethod: confirmedConflictReplacement ? "manual_conflict_replace" : item.matchMethod || "token_fuzzy",
        status: confirmedConflictReplacement ? MappingStatus.manual_mapped : MappingStatus.auto_mapped,
        isManual: confirmedConflictReplacement,
        isLockedFromAutoMapping: confirmedConflictReplacement,
      },
      update: {
        platformId: item.platformId,
        canonicalName: item.adminName,
        confidenceScore: confirmedConflictReplacement ? null : item.score ?? null,
        matchMethod: confirmedConflictReplacement ? "manual_conflict_replace" : item.matchMethod || "token_fuzzy",
        status: confirmedConflictReplacement ? MappingStatus.manual_mapped : MappingStatus.auto_mapped,
        isManual: confirmedConflictReplacement ? true : false,
        isLockedFromAutoMapping: confirmedConflictReplacement ? true : false,
      },
    });

    await prisma.tournamentParticipant.updateMany({
      where: { name: item.liquipediaName, tournament: { disciplineSlug: slug } },
      data: { platformId: item.platformId },
    });

    appliedMappings.push(saved);
  }

  return {
    preview,
    appliedMappings,
    appliedCount: appliedMappings.length,
    skippedCount: skipped.length,
    skipped,
    newlyMappedNames: appliedMappings.map((mapping) => mapping.liquipediaName),
  };
}

export async function runAutoMappingForDiscipline(
  disciplineSlug: string,
  options: { liquipediaNames?: string[]; includeAutoMapped?: boolean } = {}
) {
  const result = await applyAutoMappingForDiscipline({
    disciplineSlug,
    liquipediaNames: options.liquipediaNames,
  });

  return {
    adminTeamsCount: result.preview.adminTeamsCount,
    liquipediaTeamsFound: result.preview.liquipediaTeamsFound,
    autoMappedCount: result.appliedCount,
    ambiguousCount: result.preview.ambiguous.length,
    unmappedCount: result.preview.unmapped.length,
    suggestedCount: result.preview.suggested.length,
    invalidCount: result.preview.invalid.length,
    conflictCount: result.preview.conflicts.length,
    newlyMappedNames: result.newlyMappedNames,
  };
}
