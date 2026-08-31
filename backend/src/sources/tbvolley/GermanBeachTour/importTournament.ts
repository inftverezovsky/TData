import { Prisma, type ImportStatus } from "@prisma/client";
import { createHash } from "crypto";
import { prisma } from "@backend/db/db";
import { dedupeTournamentMatches } from "@backend/matches/dedupe";
import { decideTournamentSnapshotWrite, TournamentSnapshotRejectedError } from "@backend/sources/importSafety";
import { refreshTournamentMatchesPreservingState } from "@backend/sources/matchPreservation";
import { mergeTournamentParticipantManualFields, refreshTournamentParticipantsPreservingState } from "@backend/sources/participantPreservation";
import { assertTournamentImportFresh, runSerializableTournamentImport } from "@backend/sources/tournamentImportConcurrency";
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

type PreparedGermanBeachTourSnapshot = {
  matches: PersistableGermanBeachTourMatch[];
  teams: Array<{ name: string; team: GermanBeachTourTeam }>;
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
    const metadata = buildGermanBeachTourMetadata(germanBeachTourTournament, {
      requestedTitle: input.title,
      requestedPageUrl: input.pageUrl,
    });
    const snapshot = prepareGermanBeachTourTournamentSnapshot({
      gender: germanBeachTourTournament.gender,
      matches: germanBeachTourTournament.matches || [],
    });
    const finalStatus: ImportStatus = "SUCCESS";
    const finalNormalization = {
      ...metadata,
      germanBeachTour: { ...metadata.germanBeachTour, savedMatches: snapshot.matches.length },
    } as Prisma.InputJsonValue;

    const committed = await runSerializableTournamentImport(async (tx) => {
      await assertTournamentImportFresh({
        tx,
        importRecordId: importRecord.id,
        disciplineSlug: input.slug,
        sourceIdentity: sourceTitle,
        sourceTitle,
        sourceUrl: germanBeachTourTournament.pageUrl,
        lookupBy: "sourceTitle",
      });
      const tournament = await tx.tournament.upsert({
        where: { disciplineSlug_sourceTitle: { disciplineSlug: input.slug, sourceTitle } },
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
          extractionStatus: finalStatus,
          normalization: finalNormalization,
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
          extractionStatus: finalStatus,
          normalization: finalNormalization,
          lastImportId: importRecord.id,
          updatedAt: new Date(),
        },
      });
      await saveGermanBeachTourTournamentSnapshot({
        tx,
        tournamentId: tournament.id,
        gender: germanBeachTourTournament.gender,
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
      normalized: {
        status: finalStatus,
        error: committed.savedCount === 0 ? "Матчи для выбранной сетки German Beach Tour пока не найдены" : undefined,
      },
    };
  } catch (error) {
    await prisma.tournamentImport.updateMany({
      where: { id: importRecord.id, status: "PENDING" },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : "Не удалось загрузить турнир German Beach Tour",
      },
    }).catch(() => {});
    throw error;
  }
}

function prepareGermanBeachTourTournamentSnapshot(params: {
  gender: GermanBeachTourGender;
  matches: GermanBeachTourMatch[];
}): PreparedGermanBeachTourSnapshot {
  const activeMatches = params.matches.filter((match) => isActiveGermanBeachTourMatch(match));
  const candidates = activeMatches
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

  const matches = dedupeTournamentMatches(candidates);
  const decision = decideTournamentSnapshotWrite({
    incomingMatches: matches.length,
    sourceValidated: true,
  });
  if (!decision.allowed) {
    throw new TournamentSnapshotRejectedError(
      `German Beach Tour snapshot rejected (${decision.reason}); last-good data was preserved.`,
    );
  }
  const teamByName = new Map<string, GermanBeachTourTeam>();
  for (const match of activeMatches) {
    for (const team of [match.teamA, match.teamB]) {
      if (!team.name || isPlaceholderTeam(team.name)) continue;
      if (!teamByName.has(team.name)) teamByName.set(team.name, team);
    }
  }

  return { matches, teams: Array.from(teamByName.entries()).map(([name, team]) => ({ name, team })) };
}

async function saveGermanBeachTourTournamentSnapshot(params: {
  tx: Prisma.TransactionClient;
  tournamentId: string;
  gender: GermanBeachTourGender;
  snapshot: PreparedGermanBeachTourSnapshot;
}): Promise<void> {
  const { tx } = params;

  const mappingSlug = getBeachVolleyballMappingSlug(params.gender);
  const [existingParticipants, teamMappings] = await Promise.all([
    tx.tournamentParticipant.findMany({
      where: { tournamentId: params.tournamentId },
      select: { name: true, platformId: true, seed: true, region: true, status: true, logoUrl: true, rawText: true },
    }),
    tx.teamMapping.findMany({ where: { disciplineSlug: mappingSlug } }),
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
          incoming: { rawText: buildTeamRawText(team, params.gender) },
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
      create: { ...match, tournamentId: params.tournamentId, sourceConfidence: 1 },
      update: { ...match, sourceConfidence: 1 },
    })),
  });
  await refreshTournamentParticipantsPreservingState({ tx, tournamentId: params.tournamentId, participants: participantsToInsert });
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

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
