import { Prisma, type ImportStatus } from "@prisma/client";
import { prisma } from "@/lib/db/db";
import { dedupeTournamentMatches } from "@/lib/matches/dedupe";
import { getTeamMappingLookupKeys } from "@/lib/teams/canonicalize";
import { generateInternalTeamId, isPlaceholderTeam } from "@/lib/teams/teams";
import { TABLE_TENNIS_DISCIPLINE_SLUG } from "@/lib/sources/tablet/config";
import {
  buildWttEventUrl,
  fetchWttSchedule,
  getWttCategoryLabel,
  isActiveWttMatch,
  inferWttCategoryScope,
  normalizeWttSchedule,
  normalizeWttTournamentEvents,
  searchWttTournaments,
  summarizeWttMatchCategories,
  type WttMatch,
  type WttCategorySummary,
  type WttTournamentEvent,
} from "@/lib/sources/tablet/WTT";
import {
  getTableTennisMappingSlug,
  normalizeTableTennisCategoryScope,
  type TableTennisCategoryScope,
} from "@/lib/sources/tablet/config";

type ImportWttTournamentInput = {
  slug: string;
  disciplineId?: string;
  title: string;
  pageUrl: string;
  eventId?: string | number | null;
  timeZoneId?: string | number | null;
  fromDate?: string | null;
  toDate?: string | null;
  days?: string | number | null;
  categoryScope?: string | null;
  force?: boolean;
};

type PersistableWttMatch = {
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

type WttNormalization = {
  wtt: Record<string, unknown>;
};

export async function importWttTournament(input: ImportWttTournamentInput) {
  if (input.slug !== TABLE_TENNIS_DISCIPLINE_SLUG) {
    throw new Error("Провайдер WTT доступен только для Table Tennis");
  }

  const disciplineId = input.disciplineId || (await prisma.discipline.findUnique({
    where: { slug: input.slug },
    select: { id: true },
  }))?.id;

  if (!disciplineId) {
    throw new Error("Дисциплина Table Tennis не найдена");
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
    const requestedEventId = clean(input.eventId) || inferWttEventId(input.pageUrl, input.title);
    const wttTournament = await resolveWttTournament({
      eventId: requestedEventId,
      title: input.title,
      pageUrl: input.pageUrl,
      timeZoneId: input.timeZoneId,
      fromDate: input.fromDate,
      toDate: input.toDate,
      days: input.days || 60,
    });

    if (!wttTournament) {
      throw new Error("Не удалось найти турнир WTT в актуальном списке событий");
    }

    const timeZoneId = clean(input.timeZoneId) || clean(wttTournament.timeZoneId);
    const schedule = normalizeWttSchedule(
      await fetchWttSchedule(wttTournament.eventId, { allowApiFallback: true }),
      { eventId: wttTournament.eventId, timeZoneId },
    );
    const activeMatches = schedule.matches.filter((match) => isActiveWttMatch(match));
    const categoryScope = resolveRequestedWttCategoryScope(input.categoryScope, activeMatches, wttTournament.categories);
    if (!categoryScope) {
      throw new Error("Не удалось определить сетку WTT. Загрузите турнир, где есть матчи по нужной категории.");
    }

    const categoryMatches = activeMatches.filter((match) => {
      const matchScope = match.categoryScope || inferWttCategoryScope(match.subEvent, match.eventCategory);
      return matchScope === categoryScope;
    });
    const categorySummary = summarizeWttMatchCategories(categoryMatches).find((item) => item.scope === categoryScope)
      || findCategorySummary(wttTournament.categories, categoryScope);
    const displayName = buildDisplayName(wttTournament, categoryScope);
    const sourceTitle = buildSourceTitle(wttTournament, categoryScope);
    const normalizedStatus = resolveWttImportStatus(categoryMatches.length);
    const metadata = buildWttMetadata(wttTournament, {
      requestedTitle: input.title,
      requestedPageUrl: input.pageUrl,
      timeZoneId,
      timeZoneCode: schedule.timeZoneCode,
      matchCount: categoryMatches.length,
      categoryScope,
      categories: summarizeWttMatchCategories(activeMatches),
      activeCategories: summarizeWttMatchCategories(categoryMatches),
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
        sourceUrl: wttTournament.pageUrl,
        disciplineSlug: input.slug,
        startDate: parseDate(wttTournament.startDate),
        endDate: parseDate(wttTournament.endDate),
        location: wttTournament.location || null,
        formatText: null,
        status: wttTournament.status,
        extractionStatus: normalizedStatus,
        normalization: metadata as Prisma.InputJsonValue,
        lastImportId: importRecord.id,
      },
      update: {
        name: displayName,
        sourceUrl: wttTournament.pageUrl,
        startDate: parseDate(wttTournament.startDate),
        endDate: parseDate(wttTournament.endDate),
        location: wttTournament.location || null,
        formatText: null,
        status: wttTournament.status,
        extractionStatus: normalizedStatus,
        normalization: metadata as Prisma.InputJsonValue,
        lastImportId: importRecord.id,
        updatedAt: new Date(),
      },
    });

    const saveResult = await saveWttTournamentMatches({
      tournamentId: tournament.id,
      mappingSlug: getTableTennisMappingSlug(categoryScope),
      matches: categoryMatches,
      force: Boolean(input.force),
    });
    const finalStatus = resolveWttImportStatus(saveResult.savedCount);

    await prisma.$transaction([
      prisma.tournament.update({
        where: { id: tournament.id },
        data: {
          extractionStatus: finalStatus,
          normalization: {
            ...metadata,
            wtt: {
              ...metadata.wtt,
              savedMatches: saveResult.savedCount,
              categoryLabel: categorySummary?.label || getWttCategoryLabel(categoryScope),
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
        errorMessage: error instanceof Error ? error.message : "Не удалось загрузить WTT турнир",
      },
    }).catch(() => {});
    throw error;
  }
}

async function resolveWttTournament(input: {
  eventId: string;
  title: string;
  pageUrl: string;
  timeZoneId?: string | number | null;
  fromDate?: string | null;
  toDate?: string | null;
  days?: string | number | null;
}) {
  const search = await searchWttTournaments({
    query: "",
    fromDate: input.fromDate,
    toDate: input.toDate,
    days: input.days,
  });

  return selectTournament(search.tournaments, input) || (
    input.eventId
      ? normalizeWttTournamentEvents([{
          eventId: input.eventId,
          eventName: stripSourceMarker(input.title),
          timeZoneId: input.timeZoneId,
        }])[0] || null
      : null
  );
}

async function saveWttTournamentMatches(params: {
  tournamentId: string;
  mappingSlug: string;
  matches: WttMatch[];
  force?: boolean;
}): Promise<{ savedCount: number }> {
  const candidates = params.matches
    .map((match): PersistableWttMatch | null => {
      const matchDate = parseDate(match.startTimeUtc);
      if (!matchDate) return null;

      const teamAName = match.teamA.name || "TBD";
      const teamBName = match.teamB.name || "TBD";
      const hasPlaceholderTeams = isPlaceholderTeam(teamAName) || isPlaceholderTeam(teamBName);

      return {
        matchId: match.id,
        teamAName,
        teamBName,
        teamAId: isPlaceholderTeam(teamAName) ? "tbd" : generateInternalTeamId(teamAName),
        teamBId: isPlaceholderTeam(teamBName) ? "tbd" : generateInternalTeamId(teamBName),
        hasPlaceholderTeams,
        matchDate,
        matchDateTime: match.startTimeMoscow === "TBD" ? null : match.startTimeMoscow,
        format: null,
        stage: match.stage || match.subEvent || null,
        round: match.round || null,
        court: match.court || null,
        sourceUrl: match.sourceUrl,
        rawText: buildRawMatchText(match),
        status: match.status === "live" ? "live" : "upcoming",
      };
    })
    .filter((match): match is PersistableWttMatch => Boolean(match));

  const wttMatches = dedupeTournamentMatches(candidates);
  const matchUpserts = wttMatches.map((match) => prisma.tournamentMatch.upsert({
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

  const teamByName = new Map<string, { name: string; organization: string; rawText: string | null }>();
  for (const match of params.matches) {
    for (const team of [match.teamA, match.teamB]) {
      if (!team.name || isPlaceholderTeam(team.name)) continue;
      if (!teamByName.has(team.name)) {
        teamByName.set(team.name, {
          name: team.name,
          organization: team.organization,
          rawText: team.rawText,
        });
      }
    }
  }

  const [existingParticipants, teamMappings] = await Promise.all([
    params.force
      ? Promise.resolve([] as Array<{ name: string; platformId: string | null; logoUrl: string | null; rawText: string | null }>)
      : prisma.tournamentParticipant.findMany({
        where: { tournamentId: params.tournamentId },
        select: { name: true, platformId: true, logoUrl: true, rawText: true },
      }),
    prisma.teamMapping.findMany({ where: { disciplineSlug: params.mappingSlug } }),
  ]);

  const existingParticipantMap = new Map(existingParticipants.map((participant) => [participant.name.toLowerCase(), participant]));
  const mappingLookup = new Map<string, (typeof teamMappings)[number]>();
  for (const mapping of teamMappings) {
    mappingLookup.set(mapping.liquipediaName.toLowerCase(), mapping);
    for (const key of getTeamMappingLookupKeys(mapping)) {
      if (key && !mappingLookup.has(key.toLowerCase())) mappingLookup.set(key.toLowerCase(), mapping);
    }
  }

  const participantsToInsert = Array.from(teamByName.values())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((team) => {
      const existing = existingParticipantMap.get(team.name.toLowerCase());
      const mapping = mappingLookup.get(team.name.toLowerCase());
      return {
        tournamentId: params.tournamentId,
        name: team.name,
        platformId: existing?.platformId || mapping?.platformId || null,
        logoUrl: existing?.logoUrl || mapping?.logoUrl || null,
        rawText: existing?.rawText || team.rawText || (team.organization ? `org=${team.organization}` : null),
      };
    });

  await prisma.$transaction([
    prisma.tournamentMatch.deleteMany({ where: { tournamentId: params.tournamentId } }),
    prisma.tournamentParticipant.deleteMany({ where: { tournamentId: params.tournamentId } }),
    ...matchUpserts,
    ...(participantsToInsert.length > 0 ? [prisma.tournamentParticipant.createMany({ data: participantsToInsert })] : []),
  ]);

  return { savedCount: wttMatches.length };
}

function selectTournament(
  tournaments: WttTournamentEvent[],
  input: { eventId: string; title: string; pageUrl: string },
) {
  const targetEventId = clean(input.eventId) || inferWttEventId(input.pageUrl, input.title);
  if (targetEventId) {
    const byId = tournaments.find((tournament) => tournament.eventId === targetEventId);
    if (byId) return byId;
  }

  const targetUrlEventId = inferWttEventId(input.pageUrl, "");
  if (targetUrlEventId) {
    const byUrl = tournaments.find((tournament) => tournament.eventId === targetUrlEventId);
    if (byUrl) return byUrl;
  }

  const title = normalizeSearch(stripSourceMarker(input.title));
  return tournaments.find((tournament) => {
    const candidate = normalizeSearch(`${tournament.title} ${tournament.eventId}`);
    return candidate === title || candidate.includes(title) || title.includes(candidate);
  }) || null;
}

function buildSourceTitle(tournament: WttTournamentEvent, categoryScope: TableTennisCategoryScope) {
  return `${tournament.title} — ${getWttCategoryLabel(categoryScope)} [WTT:${tournament.eventId}:${categoryScope}]`;
}

function buildDisplayName(tournament: WttTournamentEvent, categoryScope: TableTennisCategoryScope) {
  return `${tournament.title} — ${getWttCategoryLabel(categoryScope)}`;
}

function buildWttMetadata(
  tournament: WttTournamentEvent,
  context: {
    requestedTitle: string;
    requestedPageUrl: string;
    timeZoneId: string | null;
    timeZoneCode: string | null;
    matchCount: number;
    categoryScope: TableTennisCategoryScope;
    categories: WttCategorySummary[];
    activeCategories: WttCategorySummary[];
  },
): WttNormalization {
  return {
    wtt: {
      source: "wtt",
      eventId: tournament.eventId,
      timeZoneId: tournament.timeZoneId || context.timeZoneId,
      timeZoneCode: context.timeZoneCode,
      startDate: tournament.startDate,
      endDate: tournament.endDate,
      countryName: tournament.countryName,
      countryCode: tournament.countryCode,
      city: tournament.city,
      venueName: tournament.venueName,
      categoryName: tournament.categoryName,
      tierName: tournament.tierName,
      tournamentCategoryId: tournament.tournamentCategoryId,
      requestedTitle: context.requestedTitle,
      requestedPageUrl: context.requestedPageUrl,
      matchCount: context.matchCount,
      categoryScope: context.categoryScope,
      categoryLabel: getWttCategoryLabel(context.categoryScope),
      categories: context.categories,
      activeCategories: context.activeCategories,
    },
  };
}

function buildRawMatchText(match: WttMatch) {
  return [
    match.subEvent,
    match.round,
    match.draw,
    match.court,
    match.venueName,
    `${match.teamA.name} vs ${match.teamB.name}`,
    match.rawText,
  ].filter(Boolean).join(" | ") || null;
}

function resolveWttImportStatus(savedMatchesCount: number): ImportStatus {
  return savedMatchesCount > 0 ? "SUCCESS" : "PARTIAL";
}

function inferWttEventId(...values: Array<unknown>) {
  for (const value of values) {
    const text = clean(value);
    if (!text) continue;

    const marker = text.match(/\[WTT:(\d+)(?::[^\]]+)?]/i);
    if (marker) return marker[1];

    try {
      const url = new URL(text);
      const id = url.searchParams.get("eventId");
      if (id) return id.trim();
    } catch {
      const loose = text.match(/(?:eventId=|event\/|#)(\d{3,})/i);
      if (loose) return loose[1];
    }
  }
  return "";
}

function stripSourceMarker(value: string) {
  return clean(value).replace(/\s*\[WTT:\d+(?::[^\]]+)?]\s*$/i, "");
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = value.includes("T") ? new Date(value) : new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date : null;
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

function resolveRequestedWttCategoryScope(
  rawCategoryScope: unknown,
  matches: WttMatch[],
  tournamentCategories: WttCategorySummary[],
) {
  const requested = normalizeTableTennisCategoryScope(rawCategoryScope);
  if (requested) return requested;

  const fromMatches = summarizeWttMatchCategories(matches);
  if (fromMatches.length === 1) return fromMatches[0].scope;
  if (fromMatches.length > 1) return fromMatches[0].scope;
  if (tournamentCategories.length === 1) return tournamentCategories[0].scope;
  return null;
}

function findCategorySummary(categories: WttCategorySummary[], scope: TableTennisCategoryScope) {
  return categories.find((category) => category.scope === scope) || null;
}
