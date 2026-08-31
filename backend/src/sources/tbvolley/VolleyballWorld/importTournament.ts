import { Prisma, type ImportStatus } from "@prisma/client";
import { prisma } from "@backend/db/db";
import { dedupeTournamentMatches } from "@backend/matches/dedupe";
import { getTeamMappingLookupKeys } from "@backend/teams/canonicalize";
import { generateInternalTeamId, isPlaceholderTeam } from "@backend/teams/teams";
import { decideTournamentSnapshotWrite, TournamentSnapshotRejectedError } from "@backend/sources/importSafety";
import { refreshTournamentMatchesPreservingState } from "@backend/sources/matchPreservation";
import { mergeTournamentParticipantManualFields, refreshTournamentParticipantsPreservingState } from "@backend/sources/participantPreservation";
import { assertTournamentImportFresh, runSerializableTournamentImport } from "@backend/sources/tournamentImportConcurrency";
import {
  isActiveVolleyballWorldMatch,
  normalizeVolleyballWorldGender,
  searchVolleyballWorldBeachTournaments,
  type VolleyballWorldBeachMatch,
  type VolleyballWorldBeachTeam,
  type VolleyballWorldBeachTournament,
  type VolleyballWorldGender,
} from "@backend/sources/tbvolley/VolleyballWorld";
import {
  BEACH_VOLLEYBALL_DISCIPLINE_SLUG,
  getBeachVolleyballMappingSlug,
} from "@backend/sources/tbvolley/config";

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

type VolleyballWorldNormalization = {
  volleyballWorld: Record<string, unknown>;
};

type PreparedVolleyballWorldSnapshot = {
  matches: PersistableVolleyballWorldMatch[];
  teams: Array<{ name: string; team: VolleyballWorldBeachTeam }>;
  mappingSlug: string;
  completeness: "partial";
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
      forceFresh: Boolean(input.force),
    });
    const sourceValidated = search.upstream.cacheStatus !== "stale"
      && search.upstream.fallbackErrorCode === null
      && (!input.force || search.upstream.cacheStatus === "miss");
    if (!sourceValidated) {
      throw new TournamentSnapshotRejectedError(
        "VolleyballWorld did not return a validated fresh snapshot; last-good data was preserved.",
        search.upstream.cacheStatus === "stale" ? "stale_cache" : search.upstream.fallbackErrorCode || "parse_failed",
      );
    }
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
    const metadata = buildVolleyballWorldMetadata(volleyballWorldTournament, {
      fromDate: search.fromDate,
      toDate: search.toDate,
      requestedTitle: input.title,
      requestedPageUrl: input.pageUrl,
    });
    const snapshot = prepareVolleyballWorldTournamentSnapshot({
      slug: input.slug,
      matches: volleyballWorldTournament.matches,
      sourceValidated,
    });
    const finalStatus: ImportStatus = "SUCCESS";
    const finalNormalization = {
      ...metadata,
      volleyballWorld: {
        ...metadata.volleyballWorld,
        savedMatches: snapshot.matches.length,
        snapshotCompleteness: snapshot.completeness,
      },
    } as Prisma.InputJsonValue;

    const committed = await runSerializableTournamentImport(async (tx) => {
      await assertTournamentImportFresh({
        tx,
        importRecordId: importRecord.id,
        disciplineSlug: input.slug,
        sourceIdentity: sourceTitle,
        sourceTitle,
        sourceUrl: volleyballWorldTournament.pageUrl,
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
          sourceUrl: volleyballWorldTournament.pageUrl,
          disciplineSlug: input.slug,
          startDate: parseDate(volleyballWorldTournament.startDate),
          endDate: parseDate(volleyballWorldTournament.endDate),
          location: volleyballWorldTournament.location || null,
          formatText: `Beach Volleyball ${volleyballWorldTournament.subCompetitionType}`,
          status: volleyballWorldTournament.status,
          extractionStatus: finalStatus,
          normalization: finalNormalization,
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
          extractionStatus: finalStatus,
          normalization: finalNormalization,
          lastImportId: importRecord.id,
          updatedAt: new Date(),
        },
      });

      await saveVolleyballWorldTournamentSnapshot({
        tx,
        tournamentId: tournament.id,
        snapshot,
      });
      await tx.tournamentImport.update({
        where: { id: importRecord.id },
        data: { status: finalStatus, finishedAt: new Date() },
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
        errorMessage: error instanceof Error ? error.message : "Не удалось загрузить VolleyballWorld турнир",
      },
    }).catch(() => {});
    throw error;
  }
}

export function prepareVolleyballWorldTournamentSnapshot(params: {
  slug: string;
  matches: VolleyballWorldBeachMatch[];
  sourceValidated: boolean;
}): PreparedVolleyballWorldSnapshot {
  const activeMatches = params.matches.filter((match) => isActiveVolleyballWorldMatch(match));
  const candidates = activeMatches
    .map((match): PersistableVolleyballWorldMatch => {
      const matchDate = parseDate(match.startTimeUtc);

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
    });

  const matches = dedupeTournamentMatches(candidates);
  if (!shouldReplaceVolleyballWorldMatchesOnImport({
    incomingMatches: matches.length,
    sourceValidated: params.sourceValidated,
  })) {
    throw new TournamentSnapshotRejectedError(
      "VolleyballWorld snapshot is empty or unvalidated; last-good data was preserved.",
      params.sourceValidated ? "parse_failed" : "stale_cache",
    );
  }
  const teamByName = new Map<string, VolleyballWorldBeachTeam>();
  for (const match of activeMatches) {
    for (const team of [match.teamA, match.teamB]) {
      if (!team.name || isPlaceholderTeam(team.name)) continue;
      if (!teamByName.has(team.name)) teamByName.set(team.name, team);
    }
  }

  return {
    matches,
    teams: Array.from(teamByName.entries()).map(([name, team]) => ({ name, team })),
    mappingSlug: resolveVolleyballWorldMappingSlug(params.slug, activeMatches),
    completeness: "partial",
  };
}

async function saveVolleyballWorldTournamentSnapshot(params: {
  tx: Prisma.TransactionClient;
  tournamentId: string;
  snapshot: PreparedVolleyballWorldSnapshot;
}): Promise<void> {
  const { tx } = params;

  const [existingParticipants, teamMappings] = await Promise.all([
    tx.tournamentParticipant.findMany({
      where: { tournamentId: params.tournamentId },
      select: { name: true, platformId: true, seed: true, region: true, status: true, logoUrl: true, rawText: true },
    }),
    tx.teamMapping.findMany({ where: { disciplineSlug: params.snapshot.mappingSlug } }),
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
    .map(({ name, team }) => {
      const existing = existingParticipantMap.get(name.toLowerCase());
      const mapping = mappingLookup.get(name.toLowerCase());
      return {
        tournamentId: params.tournamentId,
        name,
        ...mergeTournamentParticipantManualFields({
          incoming: { logoUrl: team.flagUrl || null, rawText: buildTeamRawText(team) },
          existing,
          mapping,
        }),
      };
    });

  await refreshTournamentMatchesPreservingState({
    tx,
    tournamentId: params.tournamentId,
    snapshotCompleteness: params.snapshot.completeness,
    matches: params.snapshot.matches.map((match) => ({
      matchId: match.matchId,
      create: { ...match, tournamentId: params.tournamentId, scoreA: null, scoreB: null },
      update: { ...match, scoreA: null, scoreB: null },
    })),
  });
  const incomingParticipantNames = new Set(
    participantsToInsert.map((participant) => participant.name.toLowerCase()),
  );
  const participantsToKeep = existingParticipants
    .filter((participant) => !incomingParticipantNames.has(participant.name.toLowerCase()))
    .map((participant) => ({
      tournamentId: params.tournamentId,
      name: participant.name,
      platformId: participant.platformId,
      seed: participant.seed,
      region: participant.region,
      status: participant.status,
      logoUrl: participant.logoUrl,
      rawText: participant.rawText,
    }));
  const mergedParticipants = [...participantsToInsert, ...participantsToKeep];
  await refreshTournamentParticipantsPreservingState({
    tx,
    tournamentId: params.tournamentId,
    participants: mergedParticipants,
  });
}

export function shouldReplaceVolleyballWorldMatchesOnImport(input: {
  incomingMatches: number;
  sourceValidated: boolean;
  force?: boolean;
}) {
  return decideTournamentSnapshotWrite({
    incomingMatches: input.incomingMatches,
    sourceValidated: input.sourceValidated,
  }).allowed;
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
