import { Prisma, type ImportStatus } from "@prisma/client";
import { createHash } from "crypto";
import { prisma } from "@/lib/db/db";
import { dedupeTournamentMatches } from "@/lib/matches/dedupe";
import { getTeamMappingLookupKeys } from "@/lib/teams/canonicalize";
import { isPlaceholderTeam } from "@/lib/teams/teams";
import {
  buildCBVSourceTitle,
  extractCBVCampeonatoId,
  extractCBVEtapaId,
  extractCBVTemporadaId,
  fetchCBVTournament,
  normalizeCBVGender,
  type CBVGender,
  type CBVMatch,
  type CBVTeam,
  type CBVTournament,
} from "@/lib/sources/tbvolley/CBV";
import {
  BEACH_VOLLEYBALL_DISCIPLINE_SLUG,
  getBeachVolleyballMappingSlug,
} from "@/lib/sources/tbvolley/config";

type ImportCBVTournamentInput = {
  slug: string;
  disciplineId?: string;
  title: string;
  pageUrl: string;
  campeonatoId?: string | number | null;
  temporadaId?: string | number | null;
  etapaId?: string | number | null;
  gender?: string | null;
  force?: boolean;
};

type PersistableCBVMatch = {
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

type CBVNormalization = {
  cbv: Record<string, unknown>;
};

export async function importCBVTournament(input: ImportCBVTournamentInput) {
  if (input.slug !== BEACH_VOLLEYBALL_DISCIPLINE_SLUG) {
    throw new Error("Источник CBV доступен только для Beach Volleyball");
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
    const campeonatoId = clean(input.campeonatoId)
      || extractCBVCampeonatoId(input.pageUrl)
      || extractCBVCampeonatoId(input.title);
    const temporadaId = clean(input.temporadaId)
      || extractCBVTemporadaId(input.pageUrl)
      || extractCBVTemporadaId(input.title);
    const etapaId = clean(input.etapaId)
      || extractCBVEtapaId(input.pageUrl)
      || extractCBVEtapaId(input.title);
    const requestedGender = normalizeCBVGender(input.gender || input.title || input.pageUrl);
    const cbvTournament = await fetchCBVTournament({
      campeonatoId,
      temporadaId,
      etapaId,
      title: input.title,
      pageUrl: input.pageUrl,
      gender: requestedGender,
    });

    const displayName = buildDisplayName(cbvTournament);
    const sourceTitle = buildCBVSourceTitle(
      cbvTournament.title,
      cbvTournament.gender,
      cbvTournament.campeonatoId,
      cbvTournament.temporadaId,
      cbvTournament.etapaId,
    );
    const metadata = buildCBVMetadata(cbvTournament, {
      requestedTitle: input.title,
      requestedPageUrl: input.pageUrl,
    });
    const normalizedStatus = resolveCBVImportStatus(cbvTournament.matches?.length || 0);

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
        sourceUrl: cbvTournament.pageUrl,
        disciplineSlug: input.slug,
        startDate: parseDate(cbvTournament.startDate),
        endDate: parseDate(cbvTournament.endDate),
        location: cbvTournament.location || null,
        formatText: buildFormatText(cbvTournament),
        status: cbvTournament.status,
        extractionStatus: normalizedStatus,
        normalization: metadata as Prisma.InputJsonValue,
        lastImportId: importRecord.id,
      },
      update: {
        name: displayName,
        sourceUrl: cbvTournament.pageUrl,
        startDate: parseDate(cbvTournament.startDate),
        endDate: parseDate(cbvTournament.endDate),
        location: cbvTournament.location || null,
        formatText: buildFormatText(cbvTournament),
        status: cbvTournament.status,
        extractionStatus: normalizedStatus,
        normalization: metadata as Prisma.InputJsonValue,
        lastImportId: importRecord.id,
        updatedAt: new Date(),
      },
    });

    const saveResult = await saveCBVTournamentMatches({
      tournamentId: tournament.id,
      slug: input.slug,
      gender: cbvTournament.gender,
      matches: cbvTournament.matches || [],
      force: Boolean(input.force),
    });
    const finalStatus = resolveCBVImportStatus(saveResult.savedCount);

    await prisma.$transaction([
      prisma.tournament.update({
        where: { id: tournament.id },
        data: {
          extractionStatus: finalStatus,
          normalization: {
            ...metadata,
            cbv: {
              ...metadata.cbv,
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
        error: saveResult.savedCount === 0 ? "Матчи для выбранного этапа CBV пока не найдены" : undefined,
      },
    };
  } catch (error) {
    await prisma.tournamentImport.update({
      where: { id: importRecord.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : "Не удалось загрузить турнир CBV",
      },
    }).catch(() => {});
    throw error;
  }
}

async function saveCBVTournamentMatches(params: {
  tournamentId: string;
  slug: string;
  gender: CBVGender;
  matches: CBVMatch[];
  force?: boolean;
}): Promise<{ savedCount: number }> {
  const candidates = params.matches.map((match): PersistableCBVMatch => {
    const teamAName = match.teamA.name || "TBD";
    const teamBName = match.teamB.name || "TBD";
    const hasPlaceholderTeams = isPlaceholderTeam(teamAName) || isPlaceholderTeam(teamBName);

    return {
      matchId: `cbv-${match.campeonatoId}-${match.temporadaId}-${match.etapaId}-${params.gender}-${match.id}`,
      teamAName,
      teamBName,
      teamAId: generateCBVTeamId(teamAName),
      teamBId: generateCBVTeamId(teamBName),
      hasPlaceholderTeams,
      matchDate: parseDate(match.startTimeUtc),
      matchDateTime: match.startTimeMoscow || null,
      format: null,
      stage: match.phase || null,
      round: match.round || null,
      court: match.court || null,
      sourceUrl: match.sourceUrl,
      rawText: match.rawText,
      status: match.status,
      scoreA: match.score.teamA,
      scoreB: match.score.teamB,
      sourceBreakdown: {
        source: "cbv",
        campeonatoId: match.campeonatoId,
        temporadaId: match.temporadaId,
        etapaId: match.etapaId,
        phaseId: match.phaseId,
        gender: params.gender,
        sets: match.score.sets,
        teamAId: match.teamA.id,
        teamBId: match.teamB.id,
        teamARegion: match.teamA.region,
        teamBRegion: match.teamB.region,
      } as Prisma.InputJsonValue,
    };
  });

  const cbvMatches = dedupeTournamentMatches(candidates);
  const matchUpserts = cbvMatches.map((match) => prisma.tournamentMatch.upsert({
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

  const teamByName = new Map<string, CBVTeam>();
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
        region: existing?.region || team.region || null,
        rawText: existing?.rawText || buildTeamRawText(team, params.gender),
      };
    });

  await prisma.$transaction([
    prisma.tournamentMatch.deleteMany({ where: { tournamentId: params.tournamentId } }),
    prisma.tournamentParticipant.deleteMany({ where: { tournamentId: params.tournamentId } }),
    ...matchUpserts,
    ...(participantsToInsert.length > 0 ? [prisma.tournamentParticipant.createMany({ data: participantsToInsert })] : []),
  ]);

  return { savedCount: cbvMatches.length };
}

function buildCBVMetadata(
  tournament: CBVTournament,
  context: { requestedTitle: string; requestedPageUrl: string },
): CBVNormalization {
  return {
    cbv: {
      source: "cbv",
      sourceDomain: "evolleyball.cbv.com.br",
      discipline: "beach",
      campeonatoId: tournament.campeonatoId,
      temporadaId: tournament.temporadaId,
      etapaId: tournament.etapaId,
      gender: tournament.gender,
      championship: tournament.championship,
      category: tournament.category,
      season: tournament.season,
      requestedTitle: context.requestedTitle,
      requestedPageUrl: context.requestedPageUrl,
      pageUrl: tournament.pageUrl,
      matchCount: tournament.matchCount ?? tournament.matches?.length ?? 0,
    },
  };
}

function buildDisplayName(tournament: CBVTournament) {
  return `${tournament.title} — ${tournament.gender === "women" ? "Женщины" : "Мужчины"}`;
}

function buildFormatText(tournament: CBVTournament) {
  return `Beach Volleyball · CBV · ${tournament.category || tournament.championship}`;
}

function buildTeamRawText(team: CBVTeam, gender: CBVGender) {
  return [
    team.region ? `code=${team.region}` : null,
    team.rawName ? `raw=${team.rawName}` : null,
    team.players.length > 0 ? `players=${team.players.join(" / ")}` : null,
    team.id ? `cbvTeamId=${team.id}` : null,
    `gender=${gender}`,
    "source=cbv",
  ].filter(Boolean).join("; ");
}

function generateCBVTeamId(name: string) {
  if (isPlaceholderTeam(name)) return "tbd";
  const hash = createHash("sha1").update(name.trim().toLowerCase()).digest("hex").slice(0, 16);
  return `team_cbv_${hash}`;
}

function resolveCBVImportStatus(savedMatchesCount: number): ImportStatus {
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
