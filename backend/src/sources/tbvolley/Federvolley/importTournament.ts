import { Prisma, type ImportStatus } from "@prisma/client";
import { createHash } from "crypto";
import { prisma } from "@backend/db/db";
import { dedupeTournamentMatches } from "@backend/matches/dedupe";
import { getTeamMappingLookupKeys } from "@backend/teams/canonicalize";
import { isPlaceholderTeam } from "@backend/teams/teams";
import {
  buildFedervolleySourceTitle,
  extractFedervolleyNodeId,
  extractMatchshareLid,
  fetchFedervolleyTournament,
  isActiveFedervolleyMatch,
  normalizeFedervolleyCategory,
  normalizeFedervolleyGender,
  type FedervolleyCategory,
  type FedervolleyGender,
  type FedervolleyMatch,
  type FedervolleyTeam,
  type FedervolleyTournament,
} from "@backend/sources/tbvolley/Federvolley";
import {
  BEACH_VOLLEYBALL_DISCIPLINE_SLUG,
  getBeachVolleyballMappingSlug,
} from "@backend/sources/tbvolley/config";

type ImportFedervolleyTournamentInput = {
  slug: string;
  disciplineId?: string;
  title: string;
  pageUrl: string;
  federvolleyNodeId?: string | number | null;
  matchshareLid?: string | number | null;
  category?: string | null;
  gender?: string | null;
  force?: boolean;
};

type PersistableFedervolleyMatch = {
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

type FedervolleyNormalization = {
  federvolley: Record<string, unknown>;
};

export async function importFedervolleyTournament(input: ImportFedervolleyTournamentInput) {
  if (input.slug !== BEACH_VOLLEYBALL_DISCIPLINE_SLUG) {
    throw new Error("Источник Federvolley доступен только для Beach Volleyball");
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
    const nodeId = clean(input.federvolleyNodeId)
      || extractFedervolleyNodeId(input.pageUrl)
      || extractFedervolleyNodeId(input.title);
    const matchshareLid = clean(input.matchshareLid)
      || extractMatchshareLid(input.pageUrl)
      || extractMatchshareLid(input.title);
    const requestedGender = normalizeFedervolleyGender(input.gender || input.title || input.pageUrl);
    const requestedCategory = normalizeFedervolleyCategory(input.category || input.title || input.pageUrl);
    const federvolleyTournament = await fetchFedervolleyTournament({
      federvolleyNodeId: nodeId,
      matchshareLid,
      category: requestedCategory,
      title: input.title,
      pageUrl: input.pageUrl,
      gender: requestedGender,
    });

    const displayName = buildDisplayName(federvolleyTournament);
    const sourceTitle = buildFedervolleySourceTitle(
      federvolleyTournament.title,
      federvolleyTournament.gender,
      federvolleyTournament.category,
      federvolleyTournament.nodeId,
      federvolleyTournament.matchshareLid,
    );
    const metadata = buildFedervolleyMetadata(federvolleyTournament, {
      requestedTitle: input.title,
      requestedPageUrl: input.pageUrl,
    });
    const normalizedStatus = resolveFedervolleyImportStatus(federvolleyTournament.matches?.length || 0);

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
        sourceUrl: federvolleyTournament.pageUrl,
        disciplineSlug: input.slug,
        startDate: parseDate(federvolleyTournament.startDate),
        endDate: parseDate(federvolleyTournament.endDate),
        location: federvolleyTournament.location || null,
        region: federvolleyTournament.region || null,
        prizePool: federvolleyTournament.prizePool || null,
        formatText: buildFormatText(federvolleyTournament),
        status: federvolleyTournament.status,
        extractionStatus: normalizedStatus,
        normalization: metadata as Prisma.InputJsonValue,
        lastImportId: importRecord.id,
      },
      update: {
        name: displayName,
        sourceUrl: federvolleyTournament.pageUrl,
        startDate: parseDate(federvolleyTournament.startDate),
        endDate: parseDate(federvolleyTournament.endDate),
        location: federvolleyTournament.location || null,
        region: federvolleyTournament.region || null,
        prizePool: federvolleyTournament.prizePool || null,
        formatText: buildFormatText(federvolleyTournament),
        status: federvolleyTournament.status,
        extractionStatus: normalizedStatus,
        normalization: metadata as Prisma.InputJsonValue,
        lastImportId: importRecord.id,
        updatedAt: new Date(),
      },
    });

    const saveResult = await saveFedervolleyTournamentMatches({
      tournamentId: tournament.id,
      slug: input.slug,
      gender: federvolleyTournament.gender,
      category: federvolleyTournament.category,
      nodeId: federvolleyTournament.nodeId,
      matchshareLid: federvolleyTournament.matchshareLid,
      matches: federvolleyTournament.matches || [],
      force: Boolean(input.force),
    });
    const finalStatus = resolveFedervolleyImportStatus(saveResult.savedCount);

    await prisma.$transaction([
      prisma.tournament.update({
        where: { id: tournament.id },
        data: {
          extractionStatus: finalStatus,
          normalization: {
            ...metadata,
            federvolley: {
              ...metadata.federvolley,
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
        error: saveResult.savedCount === 0 ? "Матчи Federvolley пока не найдены или табло Matchshare ещё не опубликовано" : undefined,
      },
    };
  } catch (error) {
    await prisma.tournamentImport.update({
      where: { id: importRecord.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : "Не удалось загрузить турнир Federvolley",
      },
    }).catch(() => {});
    throw error;
  }
}

async function saveFedervolleyTournamentMatches(params: {
  tournamentId: string;
  slug: string;
  gender: FedervolleyGender;
  category: Exclude<FedervolleyCategory, "all">;
  nodeId: string;
  matchshareLid: string;
  matches: FedervolleyMatch[];
  force?: boolean;
}): Promise<{ savedCount: number }> {
  const activeMatches = params.matches.filter((match) => isActiveFedervolleyMatch(match));
  const candidates = activeMatches.map((match): PersistableFedervolleyMatch => {
    const teamAName = match.teamA.name || "TBD";
    const teamBName = match.teamB.name || "TBD";
    const hasPlaceholderTeams = isPlaceholderTeam(teamAName) || isPlaceholderTeam(teamBName);

    return {
      matchId: `federvolley-${params.nodeId}-${params.matchshareLid}-${params.gender}-${match.id}`,
      teamAName,
      teamBName,
      teamAId: generateFedervolleyTeamId(teamAName),
      teamBId: generateFedervolleyTeamId(teamBName),
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
        source: "federvolley",
        provider: "matchshare",
        category: params.category,
        nodeId: params.nodeId,
        matchshareLid: params.matchshareLid,
        gender: params.gender,
        sets: match.score.sets,
        teamAId: match.teamA.id,
        teamBId: match.teamB.id,
        teamASeed: match.teamA.seed,
        teamBSeed: match.teamB.seed,
      } as Prisma.InputJsonValue,
    };
  });

  const federvolleyMatches = dedupeTournamentMatches(candidates);
  const matchUpserts = federvolleyMatches.map((match) => prisma.tournamentMatch.upsert({
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

  const teamByName = new Map<string, FedervolleyTeam>();
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
        region: existing?.region || null,
        rawText: existing?.rawText || buildTeamRawText(team, params.gender, params.category),
      };
    });

  await prisma.$transaction([
    prisma.tournamentMatch.deleteMany({ where: { tournamentId: params.tournamentId } }),
    prisma.tournamentParticipant.deleteMany({ where: { tournamentId: params.tournamentId } }),
    ...matchUpserts,
    ...(participantsToInsert.length > 0 ? [prisma.tournamentParticipant.createMany({ data: participantsToInsert })] : []),
  ]);

  return { savedCount: federvolleyMatches.length };
}

function buildFedervolleyMetadata(
  tournament: FedervolleyTournament,
  context: { requestedTitle: string; requestedPageUrl: string },
): FedervolleyNormalization {
  return {
    federvolley: {
      source: "federvolley",
      sourceDomain: "beachvolley.federvolley.it",
      provider: "matchshare",
      discipline: "beach",
      category: tournament.category,
      nodeId: tournament.nodeId,
      matchshareLid: tournament.matchshareLid,
      gender: tournament.gender,
      code: tournament.code,
      categoryLabel: tournament.categoryLabel,
      requestedTitle: context.requestedTitle,
      requestedPageUrl: context.requestedPageUrl,
      pageUrl: tournament.pageUrl,
      matchCount: tournament.matchCount ?? tournament.matches?.length ?? 0,
    },
  };
}

function buildDisplayName(tournament: FedervolleyTournament) {
  return `${tournament.title} — ${tournament.gender === "women" ? "Женщины" : "Мужчины"}`;
}

function buildFormatText(tournament: FedervolleyTournament) {
  return `Beach Volleyball · Federvolley · ${tournament.categoryLabel}${tournament.bracketType ? ` · ${tournament.bracketType}` : ""}`;
}

function buildTeamRawText(team: FedervolleyTeam, gender: FedervolleyGender, category: Exclude<FedervolleyCategory, "all">) {
  return [
    team.rawName ? `raw=${team.rawName}` : null,
    team.seed ? `seed=${team.seed}` : null,
    team.id ? `matchshareTeamId=${team.id}` : null,
    `category=${category}`,
    `gender=${gender}`,
    "source=federvolley",
  ].filter(Boolean).join("; ");
}

function generateFedervolleyTeamId(name: string) {
  if (isPlaceholderTeam(name)) return "tbd";
  const hash = createHash("sha1").update(name.trim().toLowerCase()).digest("hex").slice(0, 16);
  return `team_federvolley_${hash}`;
}

function resolveFedervolleyImportStatus(savedMatchesCount: number): ImportStatus {
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
