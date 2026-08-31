import { Prisma, type ImportStatus } from "@prisma/client";
import { prisma } from "@backend/db/db";
import { dedupeTournamentMatches } from "@backend/matches/dedupe";
import { decideTournamentSnapshotWrite, TournamentSnapshotRejectedError } from "@backend/sources/importSafety";
import { refreshTournamentMatchesPreservingState } from "@backend/sources/matchPreservation";
import {
  mergeTournamentParticipantManualFields,
  refreshTournamentParticipantsPreservingState,
} from "@backend/sources/participantPreservation";
import {
  assertTournamentImportFresh,
  runSerializableTournamentImport,
} from "@backend/sources/tournamentImportConcurrency";
import { getTeamMappingLookupKeys } from "@backend/teams/canonicalize";
import { generateInternalTeamId, isPlaceholderTeam } from "@backend/teams/teams";
import { TABLE_TENNIS_DISCIPLINE_SLUG } from "@backend/sources/tablet/config";
import {
  buildWttEventUrl,
  fetchWttSchedule,
  getWttCategoryLabel,
  getWttTimeZoneCode,
  isActiveWttMatch,
  inferWttCategoryScope,
  normalizeWttSchedule,
  normalizeWttTournamentEvents,
  searchWttTournaments,
  summarizeWttMatchCategories,
  type WttMatch,
  type WttCategorySummary,
  type WttTournamentEvent,
} from "@backend/sources/tablet/WTT";
import {
  getTableTennisMappingSlug,
  normalizeTableTennisCategoryScope,
  type TableTennisCategoryScope,
} from "@backend/sources/tablet/config";

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
  matchDate: Date | null;
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

type PreparedWttSnapshot = {
  matches: PersistableWttMatch[];
  teams: Array<{ name: string; organization: string; rawText: string | null }>;
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
    if (!getWttTimeZoneCode(timeZoneId)) {
      throw new Error(`WTT не отдал валидный часовой пояс для eventId=${wttTournament.eventId}. Обновите список турниров и попробуйте снова.`);
    }

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
    const snapshot = prepareWttTournamentSnapshot({
      matches: categoryMatches,
    });
    const finalStatus: ImportStatus = "SUCCESS";
    const finalNormalization = {
      ...metadata,
      wtt: {
        ...metadata.wtt,
        savedMatches: snapshot.matches.length,
        categoryLabel: categorySummary?.label || getWttCategoryLabel(categoryScope),
      },
    } as Prisma.InputJsonValue;

    const committed = await runSerializableTournamentImport(async (tx) => {
      await assertTournamentImportFresh({
        tx,
        importRecordId: importRecord.id,
        disciplineSlug: input.slug,
        sourceIdentity: sourceTitle,
        sourceTitle,
        sourceUrl: wttTournament.pageUrl,
        lookupBy: "sourceTitle",
      });
      const tournament = await tx.tournament.upsert({
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
          extractionStatus: finalStatus,
          normalization: finalNormalization,
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
          extractionStatus: finalStatus,
          normalization: finalNormalization,
          lastImportId: importRecord.id,
          updatedAt: new Date(),
        },
      });

      await saveWttTournamentSnapshot({
        tx,
        tournamentId: tournament.id,
        mappingSlug: getTableTennisMappingSlug(categoryScope),
        snapshot,
      });
      await tx.tournamentImport.update({
        where: { id: importRecord.id },
        data: {
          status: finalStatus,
          finishedAt: new Date(),
        },
      });

      return { tournamentId: tournament.id, savedCount: snapshot.matches.length };
    }, { maxWaitMs: 10_000, timeoutMs: 60_000 });

    const fullTournament = await prisma.tournament.findUnique({
      where: { id: committed.tournamentId },
      include: { participants: true, matches: true, lastImport: true },
    });

    return {
      tournament: fullTournament ? { ...fullTournament, matches: dedupeTournamentMatches(fullTournament.matches) } : null,
      normalized: { status: finalStatus, error: committed.savedCount === 0 ? "Актуальных матчей для импорта нет" : undefined },
    };
  } catch (error) {
    await prisma.tournamentImport.updateMany({
      where: { id: importRecord.id, status: "PENDING" },
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

export function prepareWttTournamentSnapshot(params: {
  matches: WttMatch[];
}): PreparedWttSnapshot {
  const candidates = params.matches
    .map((match): PersistableWttMatch => {
      const matchDate = parseDate(match.startTimeUtc);

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
    });
  const matches = dedupeTournamentMatches(candidates);
  const decision = decideTournamentSnapshotWrite({
    incomingMatches: matches.length,
    sourceValidated: true,
  });
  if (!decision.allowed) {
    throw new TournamentSnapshotRejectedError(
      `WTT snapshot rejected (${decision.reason}); last-good data was preserved.`,
    );
  }

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

  return { matches, teams: Array.from(teamByName.values()) };
}

async function saveWttTournamentSnapshot(params: {
  tx: Prisma.TransactionClient;
  tournamentId: string;
  mappingSlug: string;
  snapshot: PreparedWttSnapshot;
}): Promise<void> {
  const { tx } = params;
  const [existingParticipants, teamMappings] = await Promise.all([
    tx.tournamentParticipant.findMany({
      where: { tournamentId: params.tournamentId },
      select: { name: true, platformId: true, seed: true, region: true, status: true, logoUrl: true, rawText: true },
    }),
    tx.teamMapping.findMany({ where: { disciplineSlug: params.mappingSlug } }),
  ]);

  const existingParticipantMap = new Map(existingParticipants.map((participant) => [participant.name.toLowerCase(), participant]));
  const mappingLookup = new Map<string, (typeof teamMappings)[number]>();
  for (const mapping of teamMappings) {
    mappingLookup.set(mapping.liquipediaName.toLowerCase(), mapping);
    for (const key of getTeamMappingLookupKeys(mapping)) {
      if (key && !mappingLookup.has(key.toLowerCase())) mappingLookup.set(key.toLowerCase(), mapping);
    }
  }

  const participantsToInsert = [...params.snapshot.teams]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((team) => {
      const existing = existingParticipantMap.get(team.name.toLowerCase());
      const mapping = mappingLookup.get(team.name.toLowerCase());
      return {
        tournamentId: params.tournamentId,
        name: team.name,
        ...mergeTournamentParticipantManualFields({
          incoming: { rawText: team.rawText || (team.organization ? `org=${team.organization}` : null) },
          existing,
          mapping,
        }),
      };
    });

  await refreshTournamentMatchesPreservingState({
    tx,
    tournamentId: params.tournamentId,
    matches: params.snapshot.matches.map((match) => ({
      matchId: match.matchId,
      create: { ...match, tournamentId: params.tournamentId, scoreA: null, scoreB: null },
      update: { ...match, scoreA: null, scoreB: null },
    })),
  });
  await refreshTournamentParticipantsPreservingState({
    tx,
    tournamentId: params.tournamentId,
    participants: participantsToInsert,
  });
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
