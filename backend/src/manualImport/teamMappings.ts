import { prisma } from "@backend/db/db";
import { isPlaceholderTeam, normalizeTeamName } from "@backend/teams/teams";

export type ManualImportTeamMappingCandidate = {
  teamName: string;
  normalizedTeamName: string;
  platformId: string;
  canonicalName?: string | null;
};

export type ManualImportTeamMappingConflict = {
  teamName: string;
  normalizedTeamName: string;
  existingPlatformId: string;
  incomingPlatformId: string;
};

export type ManualImportTeamMappingExisting = {
  normalizedTeamName: string;
  platformId: string;
  teamName?: string | null;
  canonicalName?: string | null;
};

export type ManualImportTeamMappingSavePlan = {
  toSave: Array<{
    candidate: ManualImportTeamMappingCandidate;
    isOverwrite: boolean;
  }>;
  conflicts: ManualImportTeamMappingConflict[];
  overwrittenCount: number;
};

export type ManualImportTeamMappingsSaveResult = {
  savedCount: number;
  skippedCount: number;
  conflictCount: number;
  overwrittenCount: number;
  conflicts: ManualImportTeamMappingConflict[];
  savedMappings: ManualImportTeamMappingCandidate[];
};

export type ManualImportSingleTeamMappingInput = {
  disciplineSlug: string;
  adminSportId: string;
  teamName: string;
  platformId: string;
  canonicalName?: string | null;
  overwriteConflict?: boolean;
};

type RawManualMatch = {
  team1?: unknown;
  team2?: unknown;
  team1PlatformId?: unknown;
  team2PlatformId?: unknown;
};

export function normalizeAdminSportId(value: unknown) {
  const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!/^[1-9]\d*$/.test(text)) return "";
  return text;
}

export function collectManualImportTeamMappingCandidates(matches: RawManualMatch[]) {
  const candidatesByName = new Map<string, ManualImportTeamMappingCandidate>();
  const conflictedNames = new Set<string>();
  const conflicts: ManualImportTeamMappingConflict[] = [];
  let skippedCount = 0;

  for (const match of matches) {
    for (const side of ["team1", "team2"] as const) {
      const teamName = readTeamName(match[side]);
      const normalizedTeamName = normalizeTeamName(teamName);
      const platformId = normalizeAdminSportId(
        side === "team1" ? match.team1PlatformId || readTeamPlatformId(match.team1) : match.team2PlatformId || readTeamPlatformId(match.team2)
      );

      if (!teamName || !normalizedTeamName || isPlaceholderTeam(teamName) || !platformId) {
        skippedCount++;
        continue;
      }

      const candidate: ManualImportTeamMappingCandidate = {
        teamName,
        normalizedTeamName,
        platformId,
        canonicalName: readTeamCanonicalName(match[side]) || teamName,
      };
      const existingCandidate = candidatesByName.get(normalizedTeamName);

      if (existingCandidate && existingCandidate.platformId !== platformId) {
        candidatesByName.delete(normalizedTeamName);
        conflictedNames.add(normalizedTeamName);
        conflicts.push({
          teamName,
          normalizedTeamName,
          existingPlatformId: existingCandidate.platformId,
          incomingPlatformId: platformId,
        });
        skippedCount++;
        continue;
      }

      if (conflictedNames.has(normalizedTeamName)) {
        skippedCount++;
        continue;
      }

      candidatesByName.set(normalizedTeamName, candidate);
    }
  }

  return {
    candidates: Array.from(candidatesByName.values()),
    conflicts,
    skippedCount,
  };
}

export function collectSingleManualImportTeamMappingCandidate({
  teamName,
  platformId,
  canonicalName,
}: {
  teamName: unknown;
  platformId: unknown;
  canonicalName?: unknown;
}) {
  const readableTeamName = readString(teamName);
  const normalizedTeamName = normalizeTeamName(readableTeamName);
  const normalizedPlatformId = normalizeAdminSportId(platformId);

  if (!readableTeamName || !normalizedTeamName || isPlaceholderTeam(readableTeamName) || !normalizedPlatformId) {
    return {
      candidates: [],
      conflicts: [],
      skippedCount: 1,
    };
  }

  return {
    candidates: [
      {
        teamName: readableTeamName,
        normalizedTeamName,
        platformId: normalizedPlatformId,
        canonicalName: readString(canonicalName) || readableTeamName,
      },
    ],
    conflicts: [],
    skippedCount: 0,
  };
}

export function buildManualImportTeamMappingSavePlan({
  candidates,
  existingMappings,
  overwriteConflicts = false,
}: {
  candidates: ManualImportTeamMappingCandidate[];
  existingMappings: ManualImportTeamMappingExisting[];
  overwriteConflicts?: boolean;
}): ManualImportTeamMappingSavePlan {
  const existingByName = new Map(existingMappings.map((mapping) => [mapping.normalizedTeamName, mapping]));
  const conflicts: ManualImportTeamMappingConflict[] = [];
  const toSave: ManualImportTeamMappingSavePlan["toSave"] = [];
  let overwrittenCount = 0;

  for (const candidate of candidates) {
    const existing = existingByName.get(candidate.normalizedTeamName);
    if (existing && existing.platformId !== candidate.platformId) {
      if (!overwriteConflicts) {
        conflicts.push({
          teamName: candidate.teamName,
          normalizedTeamName: candidate.normalizedTeamName,
          existingPlatformId: existing.platformId,
          incomingPlatformId: candidate.platformId,
        });
        continue;
      }
      overwrittenCount++;
    }

    toSave.push({
      candidate,
      isOverwrite: Boolean(existing && existing.platformId !== candidate.platformId),
    });
  }

  return {
    toSave,
    conflicts,
    overwrittenCount,
  };
}

export async function loadManualImportTeamMappingLookup(disciplineSlug: string, adminSportId: string) {
  const normalizedSportId = normalizeAdminSportId(adminSportId);
  if (!normalizedSportId) return new Map<string, { platformId: string; canonicalName: string | null }>();

  const mappings = await prisma.manualImportTeamMapping.findMany({
    where: {
      disciplineSlug: disciplineSlug.trim().toLowerCase(),
      adminSportId: normalizedSportId,
    },
    select: {
      normalizedTeamName: true,
      platformId: true,
      canonicalName: true,
    },
  });

  return new Map(mappings.map((mapping) => [mapping.normalizedTeamName, mapping]));
}

export async function saveManualImportTeamMappings({
  disciplineSlug,
  adminSportId,
  matches,
  overwriteConflicts = false,
}: {
  disciplineSlug: string;
  adminSportId: string;
  matches: RawManualMatch[];
  overwriteConflicts?: boolean;
}): Promise<ManualImportTeamMappingsSaveResult> {
  const collected = collectManualImportTeamMappingCandidates(matches);

  return saveManualImportTeamMappingCandidates({
    disciplineSlug,
    adminSportId,
    candidates: collected.candidates,
    skippedCount: collected.skippedCount,
    collectedConflicts: collected.conflicts,
    overwriteConflicts,
  });
}

export async function saveManualImportSingleTeamMapping({
  disciplineSlug,
  adminSportId,
  teamName,
  platformId,
  canonicalName,
  overwriteConflict = false,
}: ManualImportSingleTeamMappingInput): Promise<ManualImportTeamMappingsSaveResult> {
  const collected = collectSingleManualImportTeamMappingCandidate({ teamName, platformId, canonicalName });

  return saveManualImportTeamMappingCandidates({
    disciplineSlug,
    adminSportId,
    candidates: collected.candidates,
    skippedCount: collected.skippedCount,
    collectedConflicts: collected.conflicts,
    overwriteConflicts: overwriteConflict,
  });
}

async function saveManualImportTeamMappingCandidates({
  disciplineSlug,
  adminSportId,
  candidates: rawCandidates,
  skippedCount,
  collectedConflicts,
  overwriteConflicts,
}: {
  disciplineSlug: string;
  adminSportId: string;
  candidates: ManualImportTeamMappingCandidate[];
  skippedCount: number;
  collectedConflicts: ManualImportTeamMappingConflict[];
  overwriteConflicts: boolean;
}): Promise<ManualImportTeamMappingsSaveResult> {
  const normalizedDisciplineSlug = disciplineSlug.trim().toLowerCase();
  const normalizedSportId = normalizeAdminSportId(adminSportId);

  if (!normalizedDisciplineSlug || !normalizedSportId || rawCandidates.length === 0) {
    return {
      savedCount: 0,
      skippedCount,
      conflictCount: collectedConflicts.length,
      overwrittenCount: 0,
      conflicts: collectedConflicts,
      savedMappings: [],
    };
  }

  const platformIds = Array.from(new Set(rawCandidates.map((candidate) => candidate.platformId)));
  const adminTeams = await prisma.adminTeam.findMany({
    where: {
      disciplineSlug: normalizedDisciplineSlug,
      platformId: { in: platformIds },
    },
    select: {
      platformId: true,
      platformName: true,
    },
  });
  const adminNameByPlatformId = new Map(adminTeams.map((team) => [team.platformId, team.platformName]));
  const candidates = rawCandidates.map((candidate) => ({
    ...candidate,
    canonicalName: adminNameByPlatformId.get(candidate.platformId) || candidate.canonicalName || candidate.teamName,
  }));

  const existingMappings = await prisma.manualImportTeamMapping.findMany({
    where: {
      disciplineSlug: normalizedDisciplineSlug,
      adminSportId: normalizedSportId,
      normalizedTeamName: { in: candidates.map((candidate) => candidate.normalizedTeamName) },
    },
    select: {
      normalizedTeamName: true,
      platformId: true,
      teamName: true,
      canonicalName: true,
    },
  });

  const savePlan = buildManualImportTeamMappingSavePlan({
    candidates,
    existingMappings,
    overwriteConflicts,
  });
  const savedMappings: ManualImportTeamMappingCandidate[] = [];

  for (const item of savePlan.toSave) {
    const { candidate } = item;
    const saved = await prisma.manualImportTeamMapping.upsert({
      where: {
        disciplineSlug_adminSportId_normalizedTeamName: {
          disciplineSlug: normalizedDisciplineSlug,
          adminSportId: normalizedSportId,
          normalizedTeamName: candidate.normalizedTeamName,
        },
      },
      create: {
        disciplineSlug: normalizedDisciplineSlug,
        adminSportId: normalizedSportId,
        teamName: candidate.teamName,
        normalizedTeamName: candidate.normalizedTeamName,
        platformId: candidate.platformId,
        canonicalName: candidate.canonicalName,
      },
      update: {
        teamName: candidate.teamName,
        platformId: candidate.platformId,
        canonicalName: candidate.canonicalName,
      },
      select: {
        teamName: true,
        normalizedTeamName: true,
        platformId: true,
        canonicalName: true,
      },
    });
    savedMappings.push(saved);
  }

  const conflicts = [...collectedConflicts, ...savePlan.conflicts];

  return {
    savedCount: savedMappings.length,
    skippedCount: skippedCount + conflicts.length,
    conflictCount: conflicts.length,
    overwrittenCount: savePlan.overwrittenCount,
    conflicts,
    savedMappings,
  };
}

function readString(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function readTeamName(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && "name" in value) {
    return readString((value as { name?: unknown }).name);
  }
  return "";
}

function readTeamPlatformId(value: unknown) {
  if (value && typeof value === "object" && "platformId" in value) {
    return readString((value as { platformId?: unknown }).platformId);
  }
  return "";
}

function readTeamCanonicalName(value: unknown) {
  if (value && typeof value === "object") {
    const team = value as { canonicalName?: unknown; platformName?: unknown; name?: unknown };
    return readString(team.canonicalName) || readString(team.platformName) || readString(team.name);
  }
  return "";
}
