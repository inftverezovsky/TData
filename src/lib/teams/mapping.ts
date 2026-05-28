import { prisma } from "@/lib/db/db";
import { isKnownStageAnnouncementLabel } from "@/lib/matches/scheduleView";
import { buildTeamMappingLookup, findTeamMapping } from "@/lib/teams/mappingLookup";
import { isPlaceholderTeam, normalizeTeamName } from "@/lib/teams/teams";
import { scorePlatformTeamCandidate } from "@/lib/teams/fuzzyMatch";
import { MappingStatus } from "@prisma/client";

const AUTO_MAP_MIN_SCORE = 92;
const AUTO_MAP_SUGGESTED_MIN_SCORE = 82;
const AUTO_MAP_MIN_GAP = 5;

export type AutoMappingAdminTeam = {
  platformId: string;
  platformName: string;
  platformNameRu?: string | null;
  platformNameEn?: string | null;
  normalizedName?: string | null;
  normalizedNameRu?: string | null;
  normalizedNameEn?: string | null;
};

export type AutoMappingSourceMapping = {
  id?: string;
  liquipediaName: string;
  liquipediaNormalizedName?: string | null;
  platformId?: string | null;
  canonicalName?: string | null;
  status?: string | null;
  isManual?: boolean | null;
  isLockedFromAutoMapping?: boolean | null;
  alias?: string | null;
};

export type AutoMappingPreviewItem = {
  liquipediaName: string;
  normalizedName: string;
  platformId?: string | null;
  adminName?: string | null;
  score?: number | null;
  secondPlatformId?: string | null;
  secondAdminName?: string | null;
  secondScore?: number | null;
  existingPlatformId?: string | null;
  existingAdminName?: string | null;
  reason?: string | null;
  matchMethod?: string | null;
};

export type AutoMappingPreview = {
  adminTeamsCount: number;
  liquipediaTeamsFound: number;
  alreadyMappedCount: number;
  auto: AutoMappingPreviewItem[];
  suggested: AutoMappingPreviewItem[];
  ambiguous: AutoMappingPreviewItem[];
  unmapped: AutoMappingPreviewItem[];
  invalid: AutoMappingPreviewItem[];
  conflicts: AutoMappingPreviewItem[];
};

export type AutoMappingSelection = {
  liquipediaName: string;
  platformId: string;
};

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

export function buildAutoMappingPreviewFromData({
  teamNames,
  mappings,
  adminTeams,
  includeAutoMapped = false,
}: {
  teamNames: string[];
  mappings: AutoMappingSourceMapping[];
  adminTeams: AutoMappingAdminTeam[];
  includeAutoMapped?: boolean;
}): AutoMappingPreview {
  const preview: AutoMappingPreview = {
    adminTeamsCount: adminTeams.length,
    liquipediaTeamsFound: 0,
    alreadyMappedCount: 0,
    auto: [],
    suggested: [],
    ambiguous: [],
    unmapped: [],
    invalid: [],
    conflicts: [],
  };
  const names = normalizeInputTeamNames(teamNames);
  const mappingLookup = buildTeamMappingLookup(mappings);
  const exactMappings = new Map(mappings.map((mapping) => [mapping.liquipediaName.toLowerCase(), mapping]));

  for (const name of names) {
    const normalizedName = normalizeTeamName(name);
    const exactMapping = exactMappings.get(name.toLowerCase());
    const lookupMapping = findTeamMapping(mappingLookup, name);
    const existingMapping = exactMapping || lookupMapping;

    if (existingMapping) preview.liquipediaTeamsFound++;

    if (isInvalidAutoMappingName(name) && !existingMapping?.platformId) {
      preview.invalid.push({
        liquipediaName: name,
        normalizedName,
        reason: "invalid_source_name",
      });
      continue;
    }

    if (existingMapping?.isLockedFromAutoMapping) {
      const conflict = getLockedMappingConflict(name, existingMapping, adminTeams);
      if (conflict) {
        preview.conflicts.push(conflict);
      } else if (existingMapping.platformId) {
        preview.alreadyMappedCount++;
      } else {
        preview.unmapped.push({
          liquipediaName: name,
          normalizedName,
          reason: "manual_locked_without_platform_id",
        });
      }
      continue;
    }

    if (existingMapping?.platformId && !includeAutoMapped) {
      preview.alreadyMappedCount++;
      continue;
    }

    if (adminTeams.length === 0) {
      preview.unmapped.push({
        liquipediaName: name,
        normalizedName,
        reason: "admin_team_source_missing",
      });
      continue;
    }

    const sourceMapping = exactMapping || {
      liquipediaName: name,
      liquipediaNormalizedName: normalizedName,
    };
    const decision = getTeamAutoMappingDecision(sourceMapping, adminTeams);
    const item = toPreviewItem(name, normalizedName, decision, existingMapping);

    if (!decision.bestAdminTeam || decision.bestScore < AUTO_MAP_SUGGESTED_MIN_SCORE) {
      preview.unmapped.push({
        ...item,
        reason: "score_below_threshold",
      });
      continue;
    }

    const scoreGap = decision.bestScore - decision.secondBestScore;
    if (decision.bestScore >= AUTO_MAP_MIN_SCORE && scoreGap >= AUTO_MAP_MIN_GAP) {
      preview.auto.push(item);
    } else if (scoreGap >= AUTO_MAP_MIN_GAP) {
      preview.suggested.push({
        ...item,
        reason: "medium_confidence",
      });
    } else {
      preview.ambiguous.push({
        ...item,
        reason: "candidate_gap_too_small",
      });
    }
  }

  return preview;
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

export function isInvalidAutoMappingName(name: string | null | undefined) {
  const raw = String(name ?? "").trim();
  if (isKnownStageAnnouncementLabel(raw)) return false;
  if (!raw || isPlaceholderTeam(raw)) return true;
  if (raw.includes("{{") || raw.includes("}}") || raw.includes("-->") || raw.includes("<--")) return true;
  if (/^[-–—<>]+$/.test(raw)) return true;
  if (/^\d+$/.test(raw)) return true;

  const normalized = normalizeTeamName(raw);
  const compact = normalized.replace(/\s+/g, "");
  if (!compact) return true;
  return compact.length < 3 && !/\d/.test(compact);
}

function getLockedMappingConflict(
  name: string,
  existingMapping: AutoMappingSourceMapping,
  adminTeams: AutoMappingAdminTeam[]
): AutoMappingPreviewItem | null {
  if (!existingMapping.platformId || adminTeams.length === 0) return null;

  const decision = getTeamAutoMappingDecision(
    {
      liquipediaName: name,
      liquipediaNormalizedName: normalizeTeamName(name),
    },
    adminTeams
  );

  if (
    decision.bestAdminTeam &&
    decision.bestScore >= AUTO_MAP_MIN_SCORE &&
    decision.bestAdminTeam.platformId !== existingMapping.platformId
  ) {
    return {
      ...toPreviewItem(name, normalizeTeamName(name), decision, existingMapping),
      existingPlatformId: existingMapping.platformId,
      existingAdminName: existingMapping.canonicalName || null,
      reason: "manual_mapping_conflict",
    };
  }

  return null;
}

function getTeamAutoMappingDecision(
  mapping: { liquipediaName: string; liquipediaNormalizedName?: string | null },
  adminTeams: AutoMappingAdminTeam[]
) {
  const liqName = mapping.liquipediaNormalizedName || normalizeTeamName(mapping.liquipediaName);
  if (!liqName) {
    return { bestScore: 0, secondBestScore: 0, bestAdminTeam: null, secondAdminTeam: null };
  }

  const candidates = adminTeams
    .map((admin) => ({
      admin,
      score: Math.max(
        scorePlatformTeamCandidate(mapping.liquipediaName, admin),
        scorePlatformTeamCandidate(liqName, admin)
      ) * 100,
    }))
    .sort((a, b) => b.score - a.score);

  const best = candidates[0] ?? null;
  const secondDistinct = best
    ? candidates.find((candidate) => candidate.admin.platformId !== best.admin.platformId) ?? null
    : null;

  return {
    bestScore: best?.score ?? 0,
    secondBestScore: secondDistinct?.score ?? 0,
    bestAdminTeam: best?.admin ?? null,
    secondAdminTeam: secondDistinct?.admin ?? null,
  };
}

function toPreviewItem(
  liquipediaName: string,
  normalizedName: string,
  decision: ReturnType<typeof getTeamAutoMappingDecision>,
  existingMapping?: AutoMappingSourceMapping
): AutoMappingPreviewItem {
  return {
    liquipediaName,
    normalizedName,
    platformId: decision.bestAdminTeam?.platformId || null,
    adminName: decision.bestAdminTeam?.platformName || null,
    score: decision.bestScore,
    secondPlatformId: decision.secondAdminTeam?.platformId || null,
    secondAdminName: decision.secondAdminTeam?.platformName || null,
    secondScore: decision.secondBestScore,
    existingPlatformId: existingMapping?.platformId || null,
    existingAdminName: existingMapping?.canonicalName || null,
    matchMethod: "token_fuzzy",
  };
}

function normalizeInputTeamNames(teamNames: string[]) {
  return Array.from(new Set(teamNames.map((name) => String(name ?? "").trim()).filter(Boolean)));
}

function autoMappingSelectionKey(liquipediaName: string, platformId: string) {
  return `${liquipediaName.trim().toLowerCase()}\u0000${platformId.trim()}`;
}
