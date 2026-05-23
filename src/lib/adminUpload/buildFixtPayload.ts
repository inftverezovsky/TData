import { DateTime } from 'luxon';
import { prisma } from '@/lib/db/db';
import { dedupeTournamentMatches } from '@/lib/matches/dedupe';
import { applyDisciplineScheduleLead } from '@/lib/matches/scheduleOffset';
import { resolveExactMatchDate } from '@/lib/matches/time';
import { isPlaceholderTeam, isTbdPlaceholderTeam } from '@/lib/teams/teams';
import { buildTeamMappingLookup, findTeamMapping } from '@/lib/teams/mappingLookup';
import { resolveAdminSettings } from './resolveAdminSettings';

export interface FixtMatch {
  date: string;
  team1: number;
  team2: number;
}

export interface FixtPayload {
  shapka: number;
  sport: number;
  max: number;
  match: FixtMatch[];
}

export interface BuildResult {
  payload: FixtPayload | null;
  readyMatchesCount: number;
  skippedMatches: any[];
  warnings: string[];
}

export async function buildFixtPayload(
  tournamentId: string,
  disciplineSlug: string,
  matchIds?: string[]
): Promise<BuildResult> {
  const warnings: string[] = [];
  const skippedMatches: any[] = [];
  const selectedMatchIds = matchIds
    ?.filter((id): id is string => typeof id === 'string')
    .map((id) => id.trim())
    .filter(Boolean);
  const matchIdFilter = selectedMatchIds && selectedMatchIds.length > 0
    ? { in: selectedMatchIds }
    : undefined;

  // 1. Fetch settings from Prisma (discipline-specific or global)
  const settings = await resolveAdminSettings(disciplineSlug);

  const mapping = await prisma.tournamentAdminMapping.findUnique({
    where: { tournamentId },
  });

  const shapkaId = mapping?.adminShapkaId || settings.defaultShapkaId;
  const sportId = settings.adminSportId;
  const max = settings.adminMax;

  if (!shapkaId) warnings.push('Shapka ID is not set.');
  if (!sportId) warnings.push('Sport ID is not set.');
  // if (!max) warnings.push('Max is not set.'); // Max now defaults to 5000

  // 2. Fetch matches
  const matches = await prisma.tournamentMatch.findMany({
    where: { 
      tournamentId,
      matchId: matchIdFilter
    },
    orderBy: { matchDate: 'asc' },
  });

  // 3. Fetch all team mappings for this discipline to avoid N+1
  const teamMappings = await prisma.teamMapping.findMany({
    where: { disciplineSlug },
  });

  const mappingMap = buildTeamMappingLookup(teamMappings);

  const readyMatches: FixtMatch[] = [];

  const dedupedMatches = dedupeTournamentMatches(matches);

  for (const match of dedupedMatches) {
    const teamAName = match.teamAName;
    const teamBName = match.teamBName;

    if (!teamAName || !teamBName) {
      skippedMatches.push({
        matchId: match.matchId,
        reason: 'Missing team names',
        teams: `${teamAName} vs ${teamBName}`,
      });
      continue;
    }

    const mappingA = findTeamMapping(mappingMap, teamAName);
    const mappingB = findTeamMapping(mappingMap, teamBName);

    let platformIdA = mappingA?.platformId || null;
    let platformIdB = mappingB?.platformId || null;

    const teamAIsPlaceholder = isPlaceholderTeam(teamAName);
    const teamBIsPlaceholder = isPlaceholderTeam(teamBName);
    const teamAIsUploadableTbd = isTbdPlaceholderTeam(teamAName);
    const teamBIsUploadableTbd = isTbdPlaceholderTeam(teamBName);
    const hasUnsupportedPlaceholder =
      (teamAIsPlaceholder && !teamAIsUploadableTbd) ||
      (teamBIsPlaceholder && !teamBIsUploadableTbd);

    if (hasUnsupportedPlaceholder) {
      skippedMatches.push({
        matchId: match.matchId,
        reason: 'Placeholder/TBD teams are not upload-ready',
        teams: `${teamAName} vs ${teamBName}`,
      });
      continue;
    }

    const isMappedA = !!platformIdA;
    const isMappedB = !!platformIdB;

    if (!isMappedA || !isMappedB) {
      const missing = [];
      if (!isMappedA) missing.push(teamAName);
      if (!isMappedB) missing.push(teamBName);
      
      warnings.push(`Команды без ID: ${missing.join(', ')}`);
      
      skippedMatches.push({
        matchId: match.matchId,
        reason: 'Missing or unmapped team platform IDs',
        teams: `${teamAName} (${platformIdA || 'N/A'}) vs ${teamBName} (${platformIdB || 'N/A'})`,
      });
      continue;
    }

    const exactMatchDate = resolveExactMatchDate(match);
    if (!exactMatchDate) {
      warnings.push(`Матч ${teamAName} vs ${teamBName} пропущен: нет точного времени.`);
      skippedMatches.push({
        matchId: match.matchId,
        reason: 'Missing exact match time',
        teams: `${teamAName} vs ${teamBName}`,
      });
      continue;
    }

    const matchDate = applyDisciplineScheduleLead(exactMatchDate, disciplineSlug);

    // 2.3 Skip finished matches (with result)
    const hasScores = match.scoreA !== null || match.scoreB !== null;
    const isFinished = match.status?.toLowerCase().includes('finished') || match.status?.toLowerCase().includes('completed');
    
    if (hasScores || isFinished) {
      skippedMatches.push({
        matchId: match.matchId,
        reason: 'Match already finished (has score or finished status)',
        teams: `${teamAName} (${match.scoreA ?? 0}:${match.scoreB ?? 0}) ${teamBName}`,
      });
      continue;
    }

    // Format date in Moscow
    const moscowDate = DateTime.fromJSDate(matchDate)
      .setZone('Europe/Moscow')
      .toFormat('dd.MM.yyyy HH:mm:ss');

    const team1 = parsePositiveInteger(platformIdA);
    const team2 = parsePositiveInteger(platformIdB);

    if (team1 === null || team2 === null) {
      skippedMatches.push({
        matchId: match.matchId,
        reason: 'Invalid team platform IDs',
        teams: `${teamAName} (${platformIdA}) vs ${teamBName} (${platformIdB})`,
      });
      continue;
    }

    readyMatches.push({
      date: moscowDate,
      team1,
      team2,
    });
  }

  const parsedShapkaId = parsePositiveInteger(shapkaId);
  const parsedSportId = parsePositiveInteger(sportId);
  const parsedMax = parsePositiveInteger(max);

  if (shapkaId && parsedShapkaId === null) warnings.push('Shapka ID must be a positive integer.');
  if (sportId && parsedSportId === null) warnings.push('Sport ID must be a positive integer.');
  if (max && parsedMax === null) warnings.push('Max must be a positive integer.');

  const payload: FixtPayload | null = (parsedShapkaId && parsedSportId && parsedMax && readyMatches.length > 0) ? {
    shapka: parsedShapkaId,
    sport: parsedSportId,
    max: parsedMax,
    match: readyMatches,
  } : null;

  return {
    payload,
    readyMatchesCount: readyMatches.length,
    skippedMatches,
    warnings,
  };
}

function parsePositiveInteger(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
