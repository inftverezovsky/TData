import { Prisma, type ImportStatus } from "@prisma/client";
import { prisma } from "@/lib/db/db";
import { dedupeTournamentMatches } from "@/lib/matches/dedupe";
import { getTeamMappingLookupKeys } from "@/lib/teams/canonicalize";
import { generateInternalTeamId, isPlaceholderTeam } from "@/lib/teams/teams";
import {
  isActiveVolleyballWorldMatch,
  normalizeVolleyballWorldGender,
  searchVolleyballWorldBeachTournaments,
  type VolleyballWorldBeachMatch,
  type VolleyballWorldBeachTeam,
  type VolleyballWorldBeachTournament,
  type VolleyballWorldGender,
} from "@/lib/tbvolley/volleyballworld";
import {
  BEACH_VOLLEYBALL_DISCIPLINE_SLUG,
  getBeachVolleyballMappingSlug,
} from "@/lib/tbvolley/config";

type ImportVolleyballWorldTournamentInput = {
  slug: string;
  disciplineId?: string;
  title: string;
  pageUrl: string;
  tournamentNo?: string | number | null;
  gender?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  days?: string | number | null;
  force?: boolean;
};

type PersistableVolleyballWorldMatch = {
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
  status: "upcoming" | "live";
};

type VolleyballWorldNormalization = {
  volleyballWorld: Record<string, unknown>;
};

export async function importVolleyballWorldTournament(input: ImportVolleyballWorldTournamentInput) {
  if (input.slug !== BEACH_VOLLEYBALL_DISCIPLINE_SLUG) {
    throw new Error("Провайдер VolleyballWorld доступен только для Beach Volleyball");
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
    const requestedGender = inferImportGender(input.gender, input.title);
    const requestedTournamentNo = clean(input.tournamentNo) || inferTournamentNo(input.title);
    const search = await searchVolleyballWorldBeachTournaments({
      gender: requestedGender,
      fromDate: input.fromDate,
      toDate: input.toDate,
      days: input.days || 60,
    });
    const volleyballWorldTournament = selectTournament(search.tournaments, {
      title: input.title,
      pageUrl: input.pageUrl,
      tournamentNo: requestedTournamentNo,
    });

    if (!volleyballWorldTournament) {
      throw new Error("Не удалось найти актуальные матчи этого турнира на VolleyballWorld");
    }

    const displayName = buildDisplayName(volleyballWorldTournament);
    const sourceTitle = buildSourceTitle(volleyballWorldTournament);
    const normalizedStatus = resolveVolleyballWorldImportStatus(volleyballWorldTournament.matches.length);
    const metadata = buildVolleyballWorldMetadata(volleyballWorldTournament, {
      fromDate: search.fromDate,
      toDate: search.toDate,
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
        sourceUrl: volleyballWorldTournament.pageUrl,
        disciplineSlug: input.slug,
        startDate: parseDate(volleyballWorldTournament.startDate),
        endDate: parseDate(volleyballWorldTournament.endDate),
        location: volleyballWorldTournament.location || null,
        formatText: `Beach Volleyball ${volleyballWorldTournament.subCompetitionType}`,
        status: volleyballWorldTournament.status,
        extractionStatus: normalizedStatus,
        normalization: metadata as Prisma.InputJsonValue,
        lastImportId: importRecord.id,
      },
      update: {
        name: displayName,
        sourceUrl: volleyballWorldTournament.pageUrl,
        startDate: parseDate(volleyballWorldTournament.startDate),
        endDate: parseDate(volleyballWorldTournament.endDate),
        location: volleyballWorldTournament.location || null,
        formatText: `Beach Volleyball ${volleyballWorldTournament.subCompetitionType}`,
        status: volleyballWorldTournament.status,
        extractionStatus: normalizedStatus,
        normalization: metadata as Prisma.InputJsonValue,
        lastImportId: importRecord.id,
        updatedAt: new Date(),
      },
    });

    const saveResult = await saveVolleyballWorldTournamentMatches({
      tournamentId: tournament.id,
      slug: input.slug,
      matches: volleyballWorldTournament.matches,
      force: Boolean(input.force),
    });
    const finalStatus = resolveVolleyballWorldImportStatus(saveResult.savedCount);

    await prisma.$transaction([
      prisma.tournament.update({
        where: { id: tournament.id },
        data: {
          extractionStatus: finalStatus,
          normalization: {
            ...metadata,
            volleyballWorld: {
              ...metadata.volleyballWorld,
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
      normalized: { status: finalStatus, error: saveResult.savedCount === 0 ? "Актуальных матчей для импорта нет" : undefined },
    };
  } catch (error) {
    await prisma.tournamentImport.update({
      where: { id: importRecord.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : "Не удалось загрузить VolleyballWorld турнир",
      },
    }).catch(() => {});
    throw error;
  }
}

async function saveVolleyballWorldTournamentMatches(params: {
  tournamentId: string;
  slug: string;
  matches: VolleyballWorldBeachMatch[];
  force?: boolean;
}): Promise<{ savedCount: number }> {
  const candidates = params.matches
    .filter((match) => isActiveVolleyballWorldMatch(match))
    .map((match): PersistableVolleyballWorldMatch | null => {
      const matchDate = parseDate(match.startTimeUtc);
      if (!matchDate) return null;

      const teamAName = match.teamA.name || "TBD";
      const teamBName = match.teamB.name || "TBD";
      const hasPlaceholderTeams = isPlaceholderTeam(teamAName) || isPlaceholderTeam(teamBName);

      return {
        matchId: `volleyballworld-${match.tournamentNo || match.competitionSlug}-${match.id}`,
        teamAName,
        teamBName,
        teamAId: isPlaceholderTeam(teamAName) ? "tbd" : generateInternalTeamId(teamAName),
        teamBId: isPlaceholderTeam(teamBName) ? "tbd" : generateInternalTeamId(teamBName),
        hasPlaceholderTeams,
        matchDate,
        matchDateTime: match.startTimeMoscow === "TBD" ? null : match.startTimeMoscow,
        format: null,
        stage: match.phase || null,
        round: match.round || null,
        court: match.court || null,
        sourceUrl: match.links.matchCenter,
        rawText: buildRawMatchText(match),
        status: match.status === "live" ? "live" : "upcoming",
      };
    })
    .filter((match): match is PersistableVolleyballWorldMatch => Boolean(match));

  const volleyballWorldMatches = dedupeTournamentMatches(candidates);
  const matchUpserts = volleyballWorldMatches.map((match) => prisma.tournamentMatch.upsert({
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
      scoreA: null,
      scoreB: null,
      hasPlaceholderTeams: match.hasPlaceholderTeams,
      matchDate: match.matchDate,
      matchDateTime: match.matchDateTime,
      format: match.format,
      status: match.status,
      court: match.court,
      sourceUrl: match.sourceUrl,
      rawText: match.rawText,
    },
    update: {
      tournamentId: params.tournamentId,
      stage: match.stage,
      round: match.round,
      teamAName: match.teamAName,
      teamBName: match.teamBName,
      teamAId: match.teamAId,
      teamBId: match.teamBId,
      scoreA: null,
      scoreB: null,
      hasPlaceholderTeams: match.hasPlaceholderTeams,
      matchDate: match.matchDate,
      matchDateTime: match.matchDateTime,
      format: match.format,
      status: match.status,
      court: match.court,
      sourceUrl: match.sourceUrl,
      rawText: match.rawText,
    },
  }));

  const teamByName = new Map<string, VolleyballWorldBeachTeam>();
  for (const match of params.matches) {
    for (const team of [match.teamA, match.teamB]) {
      if (!team.name || isPlaceholderTeam(team.name)) continue;
      if (!teamByName.has(team.name)) teamByName.set(team.name, team);
    }
  }

  const [existingParticipants, teamMappings] = await Promise.all([
    params.force
      ? Promise.resolve([] as Array<{ name: string; platformId: string | null; logoUrl: string | null; rawText: string | null }>)
      : prisma.tournamentParticipant.findMany({
        where: { tournamentId: params.tournamentId },
        select: { name: true, platformId: true, logoUrl: true, rawText: true },
      }),
    prisma.teamMapping.findMany({ where: { disciplineSlug: resolveVolleyballWorldMappingSlug(params.slug, params.matches) } }),
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
        logoUrl: existing?.logoUrl || mapping?.logoUrl || team.flagUrl || null,
        rawText: existing?.rawText || buildTeamRawText(team),
      };
    });

  await prisma.$transaction([
    prisma.tournamentMatch.deleteMany({ where: { tournamentId: params.tournamentId } }),
    prisma.tournamentParticipant.deleteMany({ where: { tournamentId: params.tournamentId } }),
    ...matchUpserts,
    ...(participantsToInsert.length > 0 ? [prisma.tournamentParticipant.createMany({ data: participantsToInsert })] : []),
  ]);

  return { savedCount: volleyballWorldMatches.length };
}

function resolveVolleyballWorldMappingSlug(slug: string, matches: VolleyballWorldBeachMatch[]) {
  if (slug !== BEACH_VOLLEYBALL_DISCIPLINE_SLUG) return slug;
  return getBeachVolleyballMappingSlug(matches.find((match) => match.gender)?.gender);
}

function selectTournament(
  tournaments: VolleyballWorldBeachTournament[],
  input: { title: string; pageUrl: string; tournamentNo: string },
) {
  const targetNo = clean(input.tournamentNo);
  if (targetNo) {
    const byNo = tournaments.find((tournament) => tournament.tournamentNo === targetNo || tournament.id === targetNo);
    if (byNo) return byNo;
  }

  const targetUrl = normalizeUrl(input.pageUrl);
  if (targetUrl) {
    const byUrl = tournaments.find((tournament) => normalizeUrl(tournament.pageUrl) === targetUrl);
    if (byUrl) return byUrl;
  }

  const title = normalizeSearch(input.title);
  return tournaments.find((tournament) => {
    const candidate = normalizeSearch(`${tournament.title} ${buildGenderLabel(tournament.gender, "en")} ${tournament.tournamentNo}`);
    return candidate === title || candidate.includes(title) || title.includes(candidate);
  }) || null;
}

function inferImportGender(value: string | null | undefined, title: string): VolleyballWorldGender {
  const explicitValue = clean(value);
  if (explicitValue) return normalizeVolleyballWorldGender(explicitValue);

  const normalizedTitle = title.toLowerCase();
  if (normalizedTitle.includes("women") || normalizedTitle.includes("жен")) return "women";
  if (normalizedTitle.includes("men") || normalizedTitle.includes("муж")) return "men";
  return "men";
}

function buildDisplayName(tournament: VolleyballWorldBeachTournament) {
  return `${tournament.title} — ${buildGenderLabel(tournament.gender, "ru")}`;
}

function buildSourceTitle(tournament: VolleyballWorldBeachTournament) {
  return `${tournament.title} — ${buildGenderLabel(tournament.gender, "en")} [VW:${tournament.tournamentNo || tournament.id}]`;
}

function buildGenderLabel(gender: VolleyballWorldGender, locale: "ru" | "en") {
  if (locale === "ru") return gender === "women" ? "Женщины" : "Мужчины";
  return gender === "women" ? "Women" : "Men";
}

function buildVolleyballWorldMetadata(
  tournament: VolleyballWorldBeachTournament,
  context: { fromDate: string; toDate: string; requestedTitle: string; requestedPageUrl: string },
): VolleyballWorldNormalization {
  return {
    volleyballWorld: {
      source: "volleyballworld",
      discipline: "beach",
      gender: tournament.gender,
      tournamentNo: tournament.tournamentNo,
      competitionSlug: tournament.competitionSlug,
      subCompetitionType: tournament.subCompetitionType,
      fromDate: context.fromDate,
      toDate: context.toDate,
      requestedTitle: context.requestedTitle,
      requestedPageUrl: context.requestedPageUrl,
      matchCount: tournament.matchCount,
    },
  };
}

function buildRawMatchText(match: VolleyballWorldBeachMatch) {
  return [
    match.tournamentName,
    match.matchNoInTournament ? `Match ${match.matchNoInTournament}` : null,
    match.phase,
    match.round,
    match.court,
    `${match.teamA.name} vs ${match.teamB.name}`,
    match.links.matchCenter,
  ].filter(Boolean).join(" | ");
}

function buildTeamRawText(team: VolleyballWorldBeachTeam) {
  return [
    team.code ? `code=${team.code}` : null,
    team.country ? `country=${team.country}` : null,
    team.no ? `vwNo=${team.no}` : null,
  ].filter(Boolean).join("; ") || null;
}

function resolveVolleyballWorldImportStatus(savedMatchesCount: number): ImportStatus {
  return savedMatchesCount > 0 ? "SUCCESS" : "PARTIAL";
}

function inferTournamentNo(title: string) {
  return clean(title.match(/\[VW:([^\]]+)\]/i)?.[1] || title.match(/#(\d{2,})/)?.[1]);
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function normalizeUrl(value: string | null | undefined) {
  return clean(value).replace(/\/+$/, "").toLowerCase();
}

function normalizeSearch(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9а-яё]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
