import { buildTeamMappingLookup, findTeamMapping } from "@/lib/teams/mappingLookup";
import { prisma } from "@/lib/db/db";
import { findClosestPlatformTeamFromCandidates } from "@/lib/teams/fuzzyMatch";
import { normalizeTeamName } from "@/lib/teams/teams";
import { loadManualImportTeamMappingLookup } from "./teamMappings";

export type ManualImportRawMatch = {
  id?: unknown;
  tournament?: unknown;
  team1?: unknown;
  team2?: unknown;
  team1PlatformId?: unknown;
  team2PlatformId?: unknown;
  date?: unknown;
  unix_time?: unknown;
};

export type ManualImportMappedMatch = {
  id: string;
  tournament: string;
  team1: {
    name: string;
    platformId: string | null;
    source?: ManualTeamPlatformIdSource;
  };
  team2: {
    name: string;
    platformId: string | null;
    source?: ManualTeamPlatformIdSource;
  };
  date: string;
  isReady: boolean;
};

export type ManualTeamPlatformIdSource = "explicit" | "manual" | "team_mapping" | "admin_team" | "embedded" | null;

export type ManualFixtMatch = {
  date: string;
  team1: number;
  team2: number;
};

export type ManualFixtPayload = {
  shapka: number;
  sport: number;
  max: number;
  match: ManualFixtMatch[];
};

export type ManualFixtBuildResult = {
  payload: ManualFixtPayload | null;
  readyMatchesCount: number;
  skippedMatches: Array<{ matchId: string; reason: string; teams: string }>;
  warnings: string[];
  mappedMatches: ManualImportMappedMatch[];
};

export function resolveManualTeamPlatformId({
  explicitPlatformId,
  embeddedPlatformId,
  manualMappingPlatformId,
  teamMappingPlatformId,
  adminTeamPlatformId,
}: {
  explicitPlatformId?: string | null;
  embeddedPlatformId?: string | null;
  manualMappingPlatformId?: string | null;
  teamMappingPlatformId?: string | null;
  adminTeamPlatformId?: string | null;
}) {
  return resolveManualTeamPlatformIdWithSource({
    explicitPlatformId,
    embeddedPlatformId,
    manualMappingPlatformId,
    teamMappingPlatformId,
    adminTeamPlatformId,
  }).platformId;
}

export function resolveManualTeamPlatformIdWithSource({
  explicitPlatformId,
  embeddedPlatformId,
  manualMappingPlatformId,
  teamMappingPlatformId,
  adminTeamPlatformId,
}: {
  explicitPlatformId?: string | null;
  embeddedPlatformId?: string | null;
  manualMappingPlatformId?: string | null;
  teamMappingPlatformId?: string | null;
  adminTeamPlatformId?: string | null;
}): { platformId: string | null; source: ManualTeamPlatformIdSource } {
  if (explicitPlatformId) return { platformId: explicitPlatformId, source: "explicit" };
  if (manualMappingPlatformId) return { platformId: manualMappingPlatformId, source: "manual" };
  if (teamMappingPlatformId) return { platformId: teamMappingPlatformId, source: "team_mapping" };
  if (adminTeamPlatformId) return { platformId: adminTeamPlatformId, source: "admin_team" };
  if (embeddedPlatformId) return { platformId: embeddedPlatformId, source: "embedded" };
  return { platformId: null, source: null };
}

export async function mapManualMatches(
  rawMatches: ManualImportRawMatch[],
  disciplineSlug: string,
  adminSportId = ""
) {
  const normalizedDisciplineSlug = disciplineSlug.trim().toLowerCase();
  const mappings = await prisma.teamMapping.findMany({
    where: { disciplineSlug: normalizedDisciplineSlug },
  });
  const mappingMap = buildTeamMappingLookup(mappings);
  const manualMappingMap = await loadManualImportTeamMappingLookup(normalizedDisciplineSlug, adminSportId);
  const adminTeams = await prisma.adminTeam.findMany({
    where: { disciplineSlug: normalizedDisciplineSlug },
    select: {
      platformId: true,
      platformName: true,
      platformNameRu: true,
      platformNameEn: true,
      normalizedName: true,
      normalizedNameRu: true,
      normalizedNameEn: true,
    },
  });

  return Promise.all(rawMatches.map(async (match, index) => {
    const team1Name = readTeamName(match.team1) || "TBD";
    const team2Name = readTeamName(match.team2) || "TBD";
    const mappingA = findTeamMapping(mappingMap, team1Name);
    const mappingB = findTeamMapping(mappingMap, team2Name);
    const manualMappingA = manualMappingMap.get(normalizeTeamName(team1Name));
    const manualMappingB = manualMappingMap.get(normalizeTeamName(team2Name));
    const adminTeamA =
      manualMappingA?.platformId || mappingA?.platformId
        ? null
        : findClosestPlatformTeamFromCandidates(adminTeams, team1Name, 0.85, { minScoreGap: 0.1 });
    const adminTeamB =
      manualMappingB?.platformId || mappingB?.platformId
        ? null
        : findClosestPlatformTeamFromCandidates(adminTeams, team2Name, 0.85, { minScoreGap: 0.1 });
    const platformIdA = resolveManualTeamPlatformIdWithSource({
      explicitPlatformId: readString(match.team1PlatformId),
      embeddedPlatformId: readTeamPlatformId(match.team1),
      manualMappingPlatformId: manualMappingA?.platformId,
      teamMappingPlatformId: mappingA?.platformId,
      adminTeamPlatformId: adminTeamA?.platformId,
    });
    const platformIdB = resolveManualTeamPlatformIdWithSource({
      explicitPlatformId: readString(match.team2PlatformId),
      embeddedPlatformId: readTeamPlatformId(match.team2),
      manualMappingPlatformId: manualMappingB?.platformId,
      teamMappingPlatformId: mappingB?.platformId,
      adminTeamPlatformId: adminTeamB?.platformId,
    });
    const fallbackId = `manual-${stableMatchKey(team1Name, team2Name, readString(match.date) || String(index)).slice(0, 10)}`;

    return {
      id: readString(match.id) || fallbackId,
      tournament: readString(match.tournament) || "Manual Import",
      team1: {
        name: team1Name,
        platformId: platformIdA.platformId,
        source: platformIdA.source,
      },
      team2: {
        name: team2Name,
        platformId: platformIdB.platformId,
        source: platformIdB.source,
      },
      date: normalizeManualDate(match.date, match.unix_time),
      isReady: Boolean(platformIdA.platformId && platformIdB.platformId),
    };
  }));
}

export async function buildManualFixtPayload({
  matches,
  disciplineSlug,
  shapkaId,
  disciplineId,
}: {
  matches: ManualImportRawMatch[];
  disciplineSlug: string;
  shapkaId: string;
  disciplineId: string;
}): Promise<ManualFixtBuildResult> {
  const warnings: string[] = [];
  const skippedMatches: ManualFixtBuildResult["skippedMatches"] = [];
  const mappedMatches = await mapManualMatches(matches, disciplineSlug, disciplineId);
  const readyMatches: ManualFixtMatch[] = [];

  if (!shapkaId) warnings.push("ID шапки не указан.");
  if (!disciplineId) warnings.push("ID дисциплины не указан.");

  const parsedShapka = parsePositiveInteger(shapkaId);
  const parsedSport = parsePositiveInteger(disciplineId);

  if (shapkaId && parsedShapka === null) warnings.push("ID шапки должен быть положительным числом.");
  if (disciplineId && parsedSport === null) warnings.push("ID дисциплины должен быть положительным числом.");

  for (const match of mappedMatches) {
    const team1Id = parsePositiveInteger(match.team1.platformId);
    const team2Id = parsePositiveInteger(match.team2.platformId);
    const hasDate = isManualDateReady(match.date);

    if (!team1Id || !team2Id) {
      const missing = [
        !team1Id ? `${match.team1.name} (${match.team1.platformId || "NO ID"})` : null,
        !team2Id ? `${match.team2.name} (${match.team2.platformId || "NO ID"})` : null,
      ].filter(Boolean);

      warnings.push(`Команды без ID: ${missing.join(", ")}`);
      skippedMatches.push({
        matchId: match.id,
        reason: "Missing or invalid team platform IDs",
        teams: `${match.team1.name} (${match.team1.platformId || "N/A"}) vs ${match.team2.name} (${match.team2.platformId || "N/A"})`,
      });
      continue;
    }

    if (!hasDate) {
      warnings.push(`Для матча ${match.team1.name} vs ${match.team2.name} не распознана дата.`);
      skippedMatches.push({
        matchId: match.id,
        reason: "Missing or invalid match date",
        teams: `${match.team1.name} vs ${match.team2.name}`,
      });
      continue;
    }

    readyMatches.push({
      date: match.date,
      team1: team1Id,
      team2: team2Id,
    });
  }

  const payload =
    parsedShapka && parsedSport && readyMatches.length > 0
      ? {
          shapka: parsedShapka,
          sport: parsedSport,
          max: 5000,
          match: readyMatches,
        }
      : null;

  return {
    payload,
    readyMatchesCount: readyMatches.length,
    skippedMatches,
    warnings: dedupeWarnings(warnings),
    mappedMatches,
  };
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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
    const raw = (value as { platformId?: unknown }).platformId;
    return raw === null || raw === undefined ? null : String(raw).trim() || null;
  }
  return null;
}

function normalizeManualDate(dateValue: unknown, unixTimeValue: unknown) {
  const unixTime = typeof unixTimeValue === "number" || typeof unixTimeValue === "string" ? Number(unixTimeValue) : NaN;
  if (Number.isFinite(unixTime) && unixTime > 0) {
    return new Date(unixTime * 1000)
      .toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "Europe/Moscow",
      })
      .replace(",", "");
  }

  const date = readString(dateValue);
  if (!date) return "Unknown";

  const alreadyReady = date.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (alreadyReady) {
    return `${alreadyReady[1]}.${alreadyReady[2]}.${alreadyReady[3]} ${alreadyReady[4]}:${alreadyReady[5]}:${alreadyReady[6] || "00"}`;
  }

  const isoLike = date.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (isoLike) {
    return `${isoLike[3]}.${isoLike[2]}.${isoLike[1]} ${isoLike[4].padStart(2, "0")}:${isoLike[5]}:${isoLike[6] || "00"}`;
  }

  return date;
}

function isManualDateReady(date: string) {
  return /^\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}:\d{2}$/.test(date);
}

function parsePositiveInteger(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function dedupeWarnings(warnings: string[]) {
  return Array.from(new Set(warnings));
}

function stableMatchKey(team1: string, team2: string, date: string) {
  let hash = 0;
  const value = `${team1}|${team2}|${date}`;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36).padStart(8, "0");
}
