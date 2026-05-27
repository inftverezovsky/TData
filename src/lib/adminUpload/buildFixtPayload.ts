import { DateTime } from 'luxon';
import { prisma } from '@/lib/db/db';
import { dedupeTournamentMatches } from '@/lib/matches/dedupe';
import { applyDisciplineScheduleLead } from '@/lib/matches/scheduleOffset';
import { hasUnknownExplicitTimezone } from '@/lib/normalizers/wikiText';
import {
  getStageSlotAnnouncementLabel,
  getUploadableTbdAnnouncementSides,
  parseScheduleSelectionId,
  resolveStageSlotAnnouncement,
  type TbdAnnouncementSide,
} from '@/lib/matches/scheduleView';
import { resolveExactMatchDate } from '@/lib/matches/time';
import { isPlaceholderTeam, isTbdPlaceholderTeam } from '@/lib/teams/teams';
import { buildTeamMappingLookup, findTeamMapping } from '@/lib/teams/mappingLookup';
import { resolveUploadPolicy, getUploadPolicyTbdAnnouncementSides, resolveUploadPolicyStageAnnouncementLabel, type UploadPolicy } from '@/lib/adminUpload/uploadPolicy';
import { resolveAdminSettings } from './resolveAdminSettings';

export interface FixtMatch {
  date: string;
  team1: number;
  team2: number | "";
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
  readyMatchIds: string[];
  skippedMatches: any[];
  warnings: string[];
}

export type DuplicateAnnouncementOffsetCandidate = {
  id: string;
  uploadDate: Date;
  team1: number;
  team2: number | "";
};

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

  const selectedTokens = selectedMatchIds
    ?.map(parseScheduleSelectionId)
    .filter((token): token is { matchId: string; side?: TbdAnnouncementSide } => Boolean(token));
  const hasExplicitSelection = Boolean(selectedTokens && selectedTokens.length > 0);
  const selectedFullMatchIds = new Set(
    selectedTokens?.filter((token) => !token.side).map((token) => token.matchId) || []
  );
  const selectedSidesByMatchId = new Map<string, Set<TbdAnnouncementSide>>();
  for (const token of selectedTokens || []) {
    if (!token.side) continue;
    const sides = selectedSidesByMatchId.get(token.matchId) || new Set<TbdAnnouncementSide>();
    sides.add(token.side);
    selectedSidesByMatchId.set(token.matchId, sides);
  }

  // 1. Fetch settings from Prisma (discipline-specific or global)
  const settings = await resolveAdminSettings(disciplineSlug);

  const [mapping, tournament] = await Promise.all([
    prisma.tournamentAdminMapping.findUnique({
      where: { tournamentId },
    }),
    prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { disciplineSlug: true, sourceUrl: true, normalization: true },
    }),
  ]);

  if (!tournament || tournament.disciplineSlug !== disciplineSlug) {
    return {
      payload: null,
      readyMatchesCount: 0,
      readyMatchIds: [],
      skippedMatches,
      warnings: ['Tournament was not found for the requested discipline.'],
    };
  }

  const shapkaId = mapping?.adminShapkaId || settings.defaultShapkaId;
  const sportId = settings.adminSportId;
  const max = settings.adminMax;
  const uploadPolicy = resolveUploadPolicy({
    disciplineSlug,
    sourceUrl: tournament.sourceUrl,
    normalization: tournament.normalization,
  });
  const { source, teamMappingDisciplineSlug, matchContext, scheduleLeadDisciplineSlug } = uploadPolicy;

  if (!shapkaId) warnings.push('Shapka ID is not set.');
  if (!sportId) warnings.push('Sport ID is not set.');
  // if (!max) warnings.push('Max is not set.'); // Max now defaults to 5000

  // 2. Fetch matches
  const matches = await prisma.tournamentMatch.findMany({
    where: { 
      tournamentId,
    },
    orderBy: { matchDate: 'asc' },
  });

  // 3. Fetch all team mappings for this discipline to avoid N+1
  const teamMappings = await prisma.teamMapping.findMany({
    where: { disciplineSlug: teamMappingDisciplineSlug },
  });

  const mappingMap = buildTeamMappingLookup(teamMappings);

  const readyMatches: FixtMatch[] = [];
  const readyMatchIds = new Set<string>();

  const dedupedMatches = dedupeTournamentMatches(matches);
  const duplicateAnnouncementSecondOffsets = buildDuplicateAnnouncementSecondOffsets(
    collectDuplicateAnnouncementOffsetCandidates({
      matches: dedupedMatches,
      policy: uploadPolicy,
      mappingMap,
    })
  );

  for (const match of dedupedMatches) {
    const teamAName = match.teamAName;
    const teamBName = match.teamBName;
    const selectedSides = selectedSidesByMatchId.get(match.matchId);
    const isSelectedMatch =
      !hasExplicitSelection ||
      selectedFullMatchIds.has(match.matchId) ||
      Boolean(selectedSides?.size);

    if (!isSelectedMatch) continue;

    const selectedFullMatch = !hasExplicitSelection || selectedFullMatchIds.has(match.matchId);
    const exactMatchDate = resolveExactMatchDate(match);
    const hasScores = match.scoreA !== null || match.scoreB !== null;
    const isFinished = match.status?.toLowerCase().includes('finished') || match.status?.toLowerCase().includes('completed');

    if (!teamAName || !teamBName) {
      skippedMatches.push({
        matchId: match.matchId,
        reason: 'Missing team names',
        teams: `${teamAName} vs ${teamBName}`,
      });
      continue;
    }

    if (!exactMatchDate) {
      const missingTimeReason =
        hasUnknownExplicitTimezone(match.matchDateTime) || hasUnknownExplicitTimezone(match.rawText)
          ? 'неизвестный часовой пояс'
          : 'нет точного времени';
      warnings.push(`Матч ${teamAName} vs ${teamBName} пропущен: ${missingTimeReason}.`);
      skippedMatches.push({
        matchId: match.matchId,
        reason: missingTimeReason === 'неизвестный часовой пояс'
          ? 'Unknown explicit timezone'
          : 'Missing exact match time',
        teams: `${teamAName} vs ${teamBName}`,
      });
      continue;
    }

    if (hasScores || isFinished) {
      skippedMatches.push({
        matchId: match.matchId,
        reason: 'Match already finished (has score or finished status)',
        teams: `${teamAName} (${match.scoreA ?? 0}:${match.scoreB ?? 0}) ${teamBName}`,
      });
      continue;
    }

    const matchDate = applyDisciplineScheduleLead(exactMatchDate, scheduleLeadDisciplineSlug);
    const uploadableTbdSides = getUploadPolicyTbdAnnouncementSides(uploadPolicy, match);
    const stageAnnouncement = resolveStageSlotAnnouncement(match, matchContext);
    const isStageAnnouncementSlot = uploadableTbdSides.includes('stage');
    if (isStageAnnouncementSlot) {
      const stageName = stageAnnouncement?.label || resolveUploadPolicyStageAnnouncementLabel(uploadPolicy, match);
      const requestedStageAnnouncement =
        !hasExplicitSelection ||
        selectedFullMatch ||
        Boolean(selectedSides && (selectedSides.has('stage') || selectedSides.has('teamA') || selectedSides.has('teamB')));

      if (requestedStageAnnouncement) {
        const mapping = findTeamMapping(mappingMap, stageName);
        const platformId = mapping?.platformId || null;
        const team1 = parsePositiveInteger(platformId);
        const virtualMatchId = `${match.matchId}::stage`;

        if (!team1) {
          warnings.push(`Анонс без ID: ${stageName}`);
          skippedMatches.push({
            matchId: virtualMatchId,
            reason: 'Missing or unmapped stage announcement platform ID',
            teams: `${stageName} (${platformId || 'N/A'})`,
          });
          continue;
        }

        readyMatches.push({
          date: formatUploadDate(
            applyDuplicateAnnouncementSecondOffset(matchDate, duplicateAnnouncementSecondOffsets.get(virtualMatchId)),
            settings.timezone,
            settings.dateFormat
          ),
          team1,
          team2: "",
        });
        readyMatchIds.add(match.id);
      } else if (selectedSides && selectedSides.size > 0) {
        skippedMatches.push({
          matchId: match.matchId,
          reason: 'Selected stage announcement side is not upload-ready',
          teams: `${stageName} (${Array.from(selectedSides).join(', ')})`,
        });
      }
      continue;
    }

    const requestedTbdSides = selectedSides
      ? uploadableTbdSides.filter((side) => selectedSides.has(side))
      : selectedFullMatch
        ? uploadableTbdSides
        : [];

    if (requestedTbdSides.length > 0) {
      for (const side of requestedTbdSides) {
        const teamName = side === 'teamA' ? teamAName : teamBName;
        const mapping = findTeamMapping(mappingMap, teamName);
        const platformId = mapping?.platformId || null;
        const team1 = parsePositiveInteger(platformId);
        const virtualMatchId = `${match.matchId}::${side}`;

        if (!team1) {
          warnings.push(`Команда без ID: ${teamName}`);
          skippedMatches.push({
            matchId: virtualMatchId,
            reason: 'Missing or unmapped TBD announcement platform ID',
            teams: `${teamName} (${platformId || 'N/A'})`,
          });
          continue;
        }

        readyMatches.push({
          date: formatUploadDate(
            applyDuplicateAnnouncementSecondOffset(matchDate, duplicateAnnouncementSecondOffsets.get(virtualMatchId)),
            settings.timezone,
            settings.dateFormat
          ),
          team1,
          team2: "",
        });
        readyMatchIds.add(match.id);
      }
      continue;
    }

    if (selectedSides && selectedSides.size > 0 && !selectedFullMatch) {
      const unsupportedSides = Array.from(selectedSides).join(', ');
      skippedMatches.push({
        matchId: match.matchId,
        reason: 'Selected TBD announcement side is not upload-ready',
        teams: `${teamAName} vs ${teamBName} (${unsupportedSides})`,
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
      date: formatUploadDate(matchDate, settings.timezone, settings.dateFormat),
      team1,
      team2,
    });
    readyMatchIds.add(match.id);
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
    readyMatchIds: Array.from(readyMatchIds),
    skippedMatches,
    warnings,
  };
}

function collectDuplicateAnnouncementOffsetCandidates(params: {
  matches: Array<{
    id: string;
    matchId: string;
    matchDate?: Date | string | number | null;
    matchDateTime?: string | null;
    rawText?: string | null;
    scoreA?: number | null;
    scoreB?: number | null;
    status?: string | null;
    stage?: string | null;
    round?: string | null;
    teamAName?: string | null;
    teamBName?: string | null;
    hasPlaceholderTeams?: boolean | null;
  }>;
  policy: Pick<UploadPolicy, 'matchContext' | 'scheduleLeadDisciplineSlug'>;
  mappingMap: ReturnType<typeof buildTeamMappingLookup>;
}) {
  const candidates: DuplicateAnnouncementOffsetCandidate[] = [];

  for (const match of params.matches) {
    const exactMatchDate = resolveExactMatchDate(match);
    if (!exactMatchDate) continue;
    if (match.scoreA !== null && match.scoreA !== undefined) continue;
    if (match.scoreB !== null && match.scoreB !== undefined) continue;
    if (match.status?.toLowerCase().includes('finished') || match.status?.toLowerCase().includes('completed')) continue;

    const uploadDate = applyDisciplineScheduleLead(exactMatchDate, params.policy.scheduleLeadDisciplineSlug);
    const sides = getUploadPolicyTbdAnnouncementSides(params.policy, match);

    for (const side of sides) {
      const announcementName = side === 'stage'
        ? resolveUploadPolicyStageAnnouncementLabel(params.policy, match)
        : side === 'teamA'
          ? match.teamAName
          : match.teamBName;
      const mapping = findTeamMapping(params.mappingMap, announcementName || '');
      const team1 = parsePositiveInteger(mapping?.platformId || null);
      if (!team1) continue;

      candidates.push({
        id: `${match.matchId}::${side}`,
        uploadDate,
        team1,
        team2: "",
      });
    }
  }

  return candidates;
}

export function buildDuplicateAnnouncementSecondOffsets(candidates: DuplicateAnnouncementOffsetCandidate[]) {
  const groups = new Map<string, DuplicateAnnouncementOffsetCandidate[]>();

  for (const candidate of candidates) {
    if (candidate.team2 !== "") continue;
    const key = [
      Math.floor(candidate.uploadDate.getTime() / 1000),
      candidate.team1,
      candidate.team2,
    ].join('|');
    const group = groups.get(key) || [];
    group.push(candidate);
    groups.set(key, group);
  }

  const offsets = new Map<string, number>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.forEach((candidate, index) => {
      offsets.set(candidate.id, index + 1);
    });
  }

  return offsets;
}

function applyDuplicateAnnouncementSecondOffset(matchDate: Date, offsetSeconds: number | null | undefined) {
  if (!offsetSeconds) return matchDate;
  return new Date(matchDate.getTime() + offsetSeconds * 1000);
}

export function formatUploadDate(matchDate: Date, timezone: string | null | undefined, dateFormat: string | null | undefined) {
  void timezone;
  return DateTime.fromJSDate(matchDate)
    .setZone('Europe/Moscow')
    .toFormat(toLuxonDateFormat(dateFormat || 'DD.MM.YYYY HH:mm:ss'));
}

function parsePositiveInteger(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function toLuxonDateFormat(format: string) {
  return format
    .replace(/YYYY/g, 'yyyy')
    .replace(/YY/g, 'yy')
    .replace(/DD/g, 'dd');
}
