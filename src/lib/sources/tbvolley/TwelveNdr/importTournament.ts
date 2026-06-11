import { Prisma, type ImportStatus } from "@prisma/client";
import { createHash } from "crypto";
import { prisma } from "@/lib/db/db";
import { dedupeTournamentMatches } from "@/lib/matches/dedupe";
import { getTeamMappingLookupKeys } from "@/lib/teams/canonicalize";
import { isPlaceholderTeam } from "@/lib/teams/teams";
import {
  buildTwelveNdrSourceTitle,
  extractTwelveNdrTcode,
  extractTwelveNdrTimezone,
  fetchTwelveNdrTournament,
  isActiveTwelveNdrMatch,
  normalizeTwelveNdrGender,
  type TwelveNdrCalendarMode,
  type TwelveNdrGender,
  type TwelveNdrMatch,
  type TwelveNdrSource,
  type TwelveNdrTeam,
  type TwelveNdrTournament,
} from "@/lib/sources/tbvolley/TwelveNdr";
import {
  BEACH_VOLLEYBALL_DISCIPLINE_SLUG,
  getBeachVolleyballMappingSlug,
} from "@/lib/sources/tbvolley/config";

type ImportTwelveNdrTournamentInput = {
  slug: string;
  disciplineId?: string;
  title: string;
  pageUrl: string;
  source: TwelveNdrSource;
  calendarMode?: string | null;
  tcode?: string | number | null;
  timezone?: string | number | null;
  gender?: string | null;
  force?: boolean;
};

type PersistableTwelveNdrMatch = {
  matchId: string;
  teamAName: string;
  teamBName: string;
  teamAId: string;
  teamBId: string;
  hasPlaceholderTeams: boolean;
  matchDate: Date | null;
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

type TwelveNdrNormalization = {
  twelveNdr: Record<string, unknown>;
};

export async function importTwelveNdrTournament(input: ImportTwelveNdrTournamentInput) {
  if (input.slug !== BEACH_VOLLEYBALL_DISCIPLINE_SLUG) {
    throw new Error("Источник 12ndr доступен только для Beach Volleyball");
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
    const source = input.source;
    const calendarMode = normalizeCalendarMode(input.calendarMode, source);
    const tcode = clean(input.tcode)
      || extractTwelveNdrTcode(input.pageUrl)
      || extractTwelveNdrTcode(input.title);
    const timezone = clean(input.timezone)
      || extractTwelveNdrTimezone(input.pageUrl)
      || extractTwelveNdrTimezone(input.title);
    const requestedGender = normalizeTwelveNdrGender(input.gender || input.title || input.pageUrl);
    const twelveNdrTournament = await fetchTwelveNdrTournament({
      source,
      calendarMode,
      tcode,
      timezone,
      title: input.title,
      pageUrl: input.pageUrl,
      gender: requestedGender,
    });

    const displayName = buildDisplayName(twelveNdrTournament);
    const sourceTitle = buildTwelveNdrSourceTitle(
      twelveNdrTournament.source,
      twelveNdrTournament.title,
      twelveNdrTournament.gender,
      twelveNdrTournament.tcode,
    );
    const metadata = buildTwelveNdrMetadata(twelveNdrTournament, {
      requestedTitle: input.title,
      requestedPageUrl: input.pageUrl,
    });
    const normalizedStatus = resolveTwelveNdrImportStatus(twelveNdrTournament.matches?.length || 0);

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
        sourceUrl: twelveNdrTournament.pageUrl,
        disciplineSlug: input.slug,
        startDate: parseDate(twelveNdrTournament.startDate),
        endDate: parseDate(twelveNdrTournament.endDate),
        location: twelveNdrTournament.location || twelveNdrTournament.country || null,
        formatText: buildFormatText(twelveNdrTournament),
        status: twelveNdrTournament.status,
        extractionStatus: normalizedStatus,
        normalization: metadata as Prisma.InputJsonValue,
        lastImportId: importRecord.id,
      },
      update: {
        name: displayName,
        sourceUrl: twelveNdrTournament.pageUrl,
        startDate: parseDate(twelveNdrTournament.startDate),
        endDate: parseDate(twelveNdrTournament.endDate),
        location: twelveNdrTournament.location || twelveNdrTournament.country || null,
        formatText: buildFormatText(twelveNdrTournament),
        status: twelveNdrTournament.status,
        extractionStatus: normalizedStatus,
        normalization: metadata as Prisma.InputJsonValue,
        lastImportId: importRecord.id,
        updatedAt: new Date(),
      },
    });

    const saveResult = await saveTwelveNdrTournamentMatches({
      tournamentId: tournament.id,
      slug: input.slug,
      source,
      gender: twelveNdrTournament.gender,
      tcode: twelveNdrTournament.tcode,
      matches: twelveNdrTournament.matches || [],
      force: Boolean(input.force),
    });
    const finalStatus = resolveTwelveNdrImportStatus(saveResult.savedCount);

    await prisma.$transaction([
      prisma.tournament.update({
        where: { id: tournament.id },
        data: {
          extractionStatus: finalStatus,
          normalization: {
            ...metadata,
            twelveNdr: {
              ...metadata.twelveNdr,
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
        error: saveResult.savedCount === 0 ? "Матчи для выбранной сетки 12ndr пока не найдены" : undefined,
      },
    };
  } catch (error) {
    await prisma.tournamentImport.update({
      where: { id: importRecord.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : "Не удалось загрузить турнир 12ndr",
      },
    }).catch(() => {});
    throw error;
  }
}

async function saveTwelveNdrTournamentMatches(params: {
  tournamentId: string;
  slug: string;
  source: TwelveNdrSource;
  gender: TwelveNdrGender;
  tcode: string;
  matches: TwelveNdrMatch[];
  force?: boolean;
}): Promise<{ savedCount: number }> {
  const activeMatches = params.matches.filter((match) => isActiveTwelveNdrMatch(match));
  const candidates = activeMatches
    .map((match): PersistableTwelveNdrMatch => {
      const teamAName = match.teamA.name || "TBD";
      const teamBName = match.teamB.name || "TBD";
      const hasPlaceholderTeams = isPlaceholderTeam(teamAName) || isPlaceholderTeam(teamBName);

      return {
        matchId: `12ndr-${params.source}-${params.tcode}-${params.gender}-${match.id}`,
        teamAName,
        teamBName,
        teamAId: generateTwelveNdrTeamId(teamAName),
        teamBId: generateTwelveNdrTeamId(teamBName),
        hasPlaceholderTeams,
        matchDate: parseDate(match.startTimeUtc),
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
          source: params.source,
          provider: "12ndr",
          tcode: params.tcode,
          gender: params.gender,
          field: match.field,
          resultText: match.resultText,
          sets: match.score.sets,
          teamACountry: match.teamA.country,
          teamBCountry: match.teamB.country,
        } as Prisma.InputJsonValue,
      };
    });

  const twelveNdrMatches = dedupeTournamentMatches(candidates);
  const matchUpserts = twelveNdrMatches.map((match) => prisma.tournamentMatch.upsert({
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

  const teamByName = new Map<string, TwelveNdrTeam>();
  for (const match of activeMatches) {
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
        region: existing?.region || team.country || null,
        rawText: existing?.rawText || buildTeamRawText(team, params.gender, params.source),
      };
    });

  await prisma.$transaction([
    prisma.tournamentMatch.deleteMany({ where: { tournamentId: params.tournamentId } }),
    prisma.tournamentParticipant.deleteMany({ where: { tournamentId: params.tournamentId } }),
    ...matchUpserts,
    ...(participantsToInsert.length > 0 ? [prisma.tournamentParticipant.createMany({ data: participantsToInsert })] : []),
  ]);

  return { savedCount: twelveNdrMatches.length };
}

function buildTwelveNdrMetadata(
  tournament: TwelveNdrTournament,
  context: { requestedTitle: string; requestedPageUrl: string },
): TwelveNdrNormalization {
  return {
    twelveNdr: {
      source: tournament.source,
      sourceDomain: "fivb.12ndr.at",
      discipline: "beach",
      calendarMode: tournament.calendarMode,
      tcode: tournament.tcode,
      timezone: tournament.timezone,
      gender: tournament.gender,
      type: tournament.type,
      federation: tournament.federation,
      requestedTitle: context.requestedTitle,
      requestedPageUrl: context.requestedPageUrl,
      pageUrl: tournament.pageUrl,
      matchCount: tournament.matchCount ?? tournament.matches?.length ?? 0,
    },
  };
}

function normalizeCalendarMode(value: string | null | undefined, source: TwelveNdrSource): TwelveNdrCalendarMode {
  const normalized = clean(value).toLowerCase();
  if (normalized === "oevv") return "oevv";
  if (normalized === "csvp") return "csvp";
  return source === "twelvendroevv" ? "oevv" : "csvp";
}

function buildDisplayName(tournament: TwelveNdrTournament) {
  return `${tournament.title} — ${tournament.gender === "women" ? "Женщины" : "Мужчины"}`;
}

function buildFormatText(tournament: TwelveNdrTournament) {
  if (tournament.source === "twelvendroevv") return `Beach Volleyball · Austrian Beach Tour · ${tournament.type}`;
  return `Beach Volleyball · CSVP · ${tournament.type}`;
}

function buildTeamRawText(team: TwelveNdrTeam, gender: TwelveNdrGender, source: TwelveNdrSource) {
  return [
    team.country ? `code=${team.country}` : null,
    team.rawName ? `raw=${team.rawName}` : null,
    team.seed ? `seed=${team.seed}` : null,
    `gender=${gender}`,
    `source=${source}`,
    "provider=12ndr",
  ].filter(Boolean).join("; ");
}

function generateTwelveNdrTeamId(name: string) {
  if (isPlaceholderTeam(name)) return "tbd";
  const hash = createHash("sha1").update(name.trim().toLowerCase()).digest("hex").slice(0, 16);
  return `team_12ndr_${hash}`;
}

function resolveTwelveNdrImportStatus(savedMatchesCount: number): ImportStatus {
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
