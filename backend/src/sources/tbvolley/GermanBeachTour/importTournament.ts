import { Prisma, type ImportStatus } from "@prisma/client";
import { createHash } from "crypto";
import { prisma } from "@backend/db/db";
import { dedupeTournamentMatches } from "@backend/matches/dedupe";
import { getTeamMappingLookupKeys } from "@backend/teams/canonicalize";
import { isPlaceholderTeam } from "@backend/teams/teams";
import {
  buildGermanBeachTourSourceTitle,
  extractGermanBeachTourTournamentId,
  fetchGermanBeachTourTournament,
  isActiveGermanBeachTourMatch,
  normalizeGermanBeachTourGender,
  type GermanBeachTourGender,
  type GermanBeachTourMatch,
  type GermanBeachTourTeam,
  type GermanBeachTourTournament,
} from "@backend/sources/tbvolley/GermanBeachTour";
import {
  BEACH_VOLLEYBALL_DISCIPLINE_SLUG,
  getBeachVolleyballMappingSlug,
} from "@backend/sources/tbvolley/config";

type ImportGermanBeachTourTournamentInput = {
  slug: string;
  disciplineId?: string;
  title: string;
  pageUrl: string;
  tournamentId?: string | number | null;
  gender?: string | null;
  force?: boolean;
};

type PersistableGermanBeachTourMatch = {
  matchId: string;
  teamAName: string;
  teamBName: string;
  teamAId: string;
  teamBId: string;
  hasPlaceholderTeams: boolean;
  matchDate: Date;
  matchDateTime: string | null;
  format: string | null;
  stage: string | null;
  round: string | null;
  court: string | null;
  sourceUrl: string | null;
  rawText: string | null;
  status: string;
  scoreA: number | null;
  scoreB: number | null;
  sourceBreakdown: Prisma.InputJsonValue;
};

type GermanBeachTourNormalization = {
  germanBeachTour: Record<string, unknown>;
};

export async function importGermanBeachTourTournament(input: ImportGermanBeachTourTournamentInput) {
  if (input.slug !== BEACH_VOLLEYBALL_DISCIPLINE_SLUG) {
    throw new Error("Источник German Beach Tour доступен только для Beach Volleyball");
  }

  const disciplineId = input.disciplineId || (await prisma.discipline.findUnique({
    where: { slug: input.slug },
    select: { id: true },
  }))?.id;

  if (!disciplineId) {
    throw new Error("Дисциплина Beach Volleyball не найдена");
  }

  const importRecord = await prisma.tournamentImport.create({
    data: {
      disciplineId,
      pageTitle: input.title,
      pageUrl: input.pageUrl,
      status: "PENDING",
    },
  });

  try {
    const tournamentId = clean(input.tournamentId)
      || extractGermanBeachTourTournamentId(input.pageUrl)
      || extractGermanBeachTourTournamentId(input.title);
    const requestedGender = normalizeGermanBeachTourGender(input.gender || input.title);
    const germanBeachTourTournament = await fetchGermanBeachTourTournament({
      tournamentId,
      title: input.title,
      pageUrl: input.pageUrl,
      gender: requestedGender,
    });

    const displayName = buildDisplayName(germanBeachTourTournament);
    const sourceTitle = buildGermanBeachTourSourceTitle(
      germanBeachTourTournament.title,
      germanBeachTourTournament.gender,
      germanBeachTourTournament.tournamentId,
    );
    const normalizedStatus = resolveGermanBeachTourImportStatus(germanBeachTourTournament.matches?.length || 0);
    const metadata = buildGermanBeachTourMetadata(germanBeachTourTournament, {
      requestedTitle: input.title,
      requestedPageUrl: input.pageUrl,
    });

    const tournament = await prisma.tournament.upsert({
      where: {
        disciplineSlug_sourceTitle: {
          disciplineSlug: input.slug,
          sourceTitle,
        },
      },
      create: {
        name: displayName,
        sourceTitle,
        sourceUrl: germanBeachTourTournament.pageUrl,
        disciplineSlug: input.slug,
        startDate: parseDate(germanBeachTourTournament.startDate),
        endDate: parseDate(germanBeachTourTournament.endDate),
        location: germanBeachTourTournament.location || null,
        prizePool: germanBeachTourTournament.prizePool || null,
        formatText: `Beach Volleyball · ${germanBeachTourTournament.type || "German Beach Tour"}`,
        status: germanBeachTourTournament.status,
        extractionStatus: normalizedStatus,
        normalization: metadata as Prisma.InputJsonValue,
        lastImportId: importRecord.id,
      },
      update: {
        name: displayName,
        sourceUrl: germanBeachTourTournament.pageUrl,
        startDate: parseDate(germanBeachTourTournament.startDate),
        endDate: parseDate(germanBeachTourTournament.endDate),
        location: germanBeachTourTournament.location || null,
        prizePool: germanBeachTourTournament.prizePool || null,
        formatText: `Beach Volleyball · ${germanBeachTourTournament.type || "German Beach Tour"}`,
        status: germanBeachTourTournament.status,
        extractionStatus: normalizedStatus,
        normalization: metadata as Prisma.InputJsonValue,
        lastImportId: importRecord.id,
        updatedAt: new Date(),
      },
    });

    const saveResult = await saveGermanBeachTourTournamentMatches({
      tournamentId: tournament.id,
      slug: input.slug,
      gender: germanBeachTourTournament.gender,
      matches: germanBeachTourTournament.matches || [],
      force: Boolean(input.force),
    });
    const finalStatus = resolveGermanBeachTourImportStatus(saveResult.savedCount);

    await prisma.$transaction([
      prisma.tournament.update({
        where: { id: tournament.id },
        data: {
          extractionStatus: finalStatus,
          normalization: {
            ...metadata,
            germanBeachTour: {
              ...metadata.germanBeachTour,
              savedMatches: saveResult.savedCount,
            },
          } as Prisma.InputJsonValue,
        },
      }),
      prisma.tournamentImport.update({
        where: { id: importRecord.id },
        data: {
          status: finalStatus,
          finishedAt: new Date(),
        },
      }),
    ]);

    const fullTournament = await prisma.tournament.findUnique({
      where: { id: tournament.id },
      include: { participants: true, matches: true, lastImport: true },
    });

    return {
      tournament: fullTournament ? { ...fullTournament, matches: dedupeTournamentMatches(fullTournament.matches) } : null,
      normalized: {
        status: finalStatus,
        error: saveResult.savedCount === 0 ? "Матчи для выбранной сетки German Beach Tour пока не найдены" : undefined,
      },
    };
  } catch (error) {
    await prisma.tournamentImport.update({
      where: { id: importRecord.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : "Не удалось загрузить турнир German Beach Tour",
      },
    }).catch(() => {});
    throw error;
  }
}

async function saveGermanBeachTourTournamentMatches(params: {
  tournamentId: string;
  slug: string;
  gender: GermanBeachTourGender;
  matches: GermanBeachTourMatch[];
  force?: boolean;
}): Promise<{ savedCount: number }> {
  const candidates = params.matches
    .filter((match) => isActiveGermanBeachTourMatch(match))
    .map((match): PersistableGermanBeachTourMatch | null => {
      const matchDate = parseDate(match.startTimeUtc);
      if (!matchDate) return null;

      const teamAName = match.teamA.name || "TBD";
      const teamBName = match.teamB.name || "TBD";
      const hasPlaceholderTeams = isPlaceholderTeam(teamAName) || isPlaceholderTeam(teamBName);

      return {
        matchId: `germanbeachtour-${match.tournamentId}-${params.gender}-${match.id}`,
        teamAName,
        teamBName,
        teamAId: generateGermanBeachTourTeamId(teamAName),
        teamBId: generateGermanBeachTourTeamId(teamBName),
        hasPlaceholderTeams,
        matchDate,
        matchDateTime: match.startTimeMoscow || null,
        format: null,
        stage: match.stage || null,
        round: match.round || null,
        court: match.court || null,
        sourceUrl: match.sourceUrl,
        rawText: match.rawText,
        status: match.status,
        scoreA: match.score.teamA,
        scoreB: match.score.teamB,
        sourceBreakdown: {
          source: "germanbeachtour",
          tournamentId: match.tournamentId,
          gender: params.gender,
          field: match.field,
          resultText: match.resultText,
          sets: match.score.sets,
          teamAId: match.teamA.id,
          teamBId: match.teamB.id,
        } as Prisma.InputJsonValue,
      };
    })
    .filter((match): match is PersistableGermanBeachTourMatch => Boolean(match));

  const germanBeachTourMatches = dedupeTournamentMatches(candidates);
  const matchUpserts = germanBeachTourMatches.map((match) => prisma.tournamentMatch.upsert({
    where: { matchId: match.matchId },
    create: {
      matchId: match.matchId,
      tournamentId: params.tournamentId,
      stage: match.stage,
      round: match.round,
      teamAName: match.teamAName,
      teamBName: match.teamBName,
      teamAId: match.teamAId,
      teamBId: match.teamBId,
      scoreA: match.scoreA,
      scoreB: match.scoreB,
      hasPlaceholderTeams: match.hasPlaceholderTeams,
      matchDate: match.matchDate,
      matchDateTime: match.matchDateTime,
      format: match.format,
      status: match.status,
      court: match.court,
      sourceUrl: match.sourceUrl,
      rawText: match.rawText,
      sourceConfidence: 1,
      sourceBreakdown: match.sourceBreakdown,
    },
    update: {
      tournamentId: params.tournamentId,
      stage: match.stage,
      round: match.round,
      teamAName: match.teamAName,
      teamBName: match.teamBName,
      teamAId: match.teamAId,
      teamBId: match.teamBId,
      scoreA: match.scoreA,
      scoreB: match.scoreB,
      hasPlaceholderTeams: match.hasPlaceholderTeams,
      matchDate: match.matchDate,
      matchDateTime: match.matchDateTime,
      format: match.format,
      status: match.status,
      court: match.court,
      sourceUrl: match.sourceUrl,
      rawText: match.rawText,
      sourceConfidence: 1,
      sourceBreakdown: match.sourceBreakdown,
    },
  }));

  const teamByName = new Map<string, GermanBeachTourTeam>();
  for (const match of params.matches) {
    for (const team of [match.teamA, match.teamB]) {
      if (!team.name || isPlaceholderTeam(team.name)) continue;
      if (!teamByName.has(team.name)) teamByName.set(team.name, team);
    }
  }

  const mappingSlug = getBeachVolleyballMappingSlug(params.gender);
  const [existingParticipants, teamMappings] = await Promise.all([
    params.force
      ? Promise.resolve([] as Array<{ name: string; platformId: string | null; logoUrl: string | null; rawText: string | null; region: string | null }>)
      : prisma.tournamentParticipant.findMany({
        where: { tournamentId: params.tournamentId },
        select: { name: true, platformId: true, logoUrl: true, rawText: true, region: true },
      }),
    prisma.teamMapping.findMany({ where: { disciplineSlug: mappingSlug } }),
  ]);

  const existingParticipantMap = new Map(existingParticipants.map((participant) => [participant.name.toLowerCase(), participant]));
  const mappingLookup = new Map<string, (typeof teamMappings)[number]>();
  for (const mapping of teamMappings) {
    mappingLookup.set(mapping.liquipediaName.toLowerCase(), mapping);
    for (const key of getTeamMappingLookupKeys(mapping)) {
      if (key && !mappingLookup.has(key.toLowerCase())) mappingLookup.set(key.toLowerCase(), mapping);
    }
  }

  const participantsToInsert = Array.from(teamByName.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, team]) => {
      const existing = existingParticipantMap.get(name.toLowerCase());
      const mapping = mappingLookup.get(name.toLowerCase());
      return {
        tournamentId: params.tournamentId,
        name,
        platformId: existing?.platformId || mapping?.platformId || null,
        logoUrl: existing?.logoUrl || mapping?.logoUrl || null,
        region: existing?.region || null,
        rawText: existing?.rawText || buildTeamRawText(team, params.gender),
      };
    });

  await prisma.$transaction([
    prisma.tournamentMatch.deleteMany({ where: { tournamentId: params.tournamentId } }),
    prisma.tournamentParticipant.deleteMany({ where: { tournamentId: params.tournamentId } }),
    ...matchUpserts,
    ...(participantsToInsert.length > 0 ? [prisma.tournamentParticipant.createMany({ data: participantsToInsert })] : []),
  ]);

  return { savedCount: germanBeachTourMatches.length };
}

function buildGermanBeachTourMetadata(
  tournament: GermanBeachTourTournament,
  context: { requestedTitle: string; requestedPageUrl: string },
): GermanBeachTourNormalization {
  return {
    germanBeachTour: {
      source: "germanbeachtour",
      sourceDomain: "beach.volleyball-verband.de",
      discipline: "beach",
      tournamentId: tournament.tournamentId,
      gender: tournament.gender,
      type: tournament.type,
      requestedTitle: context.requestedTitle,
      requestedPageUrl: context.requestedPageUrl,
      pageUrl: tournament.pageUrl,
      matchCount: tournament.matchCount ?? tournament.matches?.length ?? 0,
    },
  };
}

function buildDisplayName(tournament: GermanBeachTourTournament) {
  return `${tournament.title} — ${tournament.gender === "women" ? "Женщины" : "Мужчины"}`;
}

function buildTeamRawText(team: GermanBeachTourTeam, gender: GermanBeachTourGender) {
  return [
    team.id ? `gbtTeamId=${team.id}` : null,
    team.rawName ? `raw=${team.rawName}` : null,
    team.seed ? `seed=${team.seed}` : null,
    `gender=${gender}`,
    "source=beach.volleyball-verband.de",
  ].filter(Boolean).join("; ");
}

function generateGermanBeachTourTeamId(name: string) {
  if (isPlaceholderTeam(name)) return "tbd";
  const hash = createHash("sha1").update(name.trim().toLowerCase()).digest("hex").slice(0, 16);
  return `team_gbt_${hash}`;
}

function resolveGermanBeachTourImportStatus(savedMatchesCount: number): ImportStatus {
  return savedMatchesCount > 0 ? "SUCCESS" : "PARTIAL";
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
