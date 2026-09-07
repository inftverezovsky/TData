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
  buildBeachVolleyRuSourceTitle,
  extractBeachVolleyRuEventId,
  fetchBeachVolleyRuTournament,
  isActiveBeachVolleyRuMatch,
  normalizeBeachVolleyRuGender,
  type BeachVolleyRuGender,
  type BeachVolleyRuMatch,
  type BeachVolleyRuTeam,
} from "@backend/sources/tbvolley/beach.volley.ru";
import {
  BEACH_VOLLEYBALL_DISCIPLINE_SLUG,
  getBeachVolleyballMappingSlug,
} from "@backend/sources/tbvolley/config";

type ImportBeachVolleyRuTournamentInput = {
  slug: string;
  disciplineId?: string;
  title: string;
  pageUrl: string;
  eventId?: string | number | null;
  gender?: string | null;
  force?: boolean;
};

type PersistableBeachVolleyRuMatch = {
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

type BeachVolleyRuNormalization = {
  beachVolleyRu: Record<string, unknown>;
};

type PreparedBeachVolleyRuSnapshot = {
  matches: PersistableBeachVolleyRuMatch[];
  teams: Array<{ name: string; team: BeachVolleyRuTeam }>;
};

export async function importBeachVolleyRuTournament(input: ImportBeachVolleyRuTournamentInput) {
  if (input.slug !== BEACH_VOLLEYBALL_DISCIPLINE_SLUG) {
    throw new Error("Источник beach.volley.ru доступен только для Beach Volleyball");
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
    const eventId = clean(input.eventId)
      || extractBeachVolleyRuEventId(input.pageUrl)
      || extractBeachVolleyRuEventId(input.title);
    const requestedGender = normalizeBeachVolleyRuGender(input.gender);
    const beachVolleyRuTournament = await fetchBeachVolleyRuTournament({
      eventId,
      title: input.title,
      pageUrl: input.pageUrl,
      gender: requestedGender,
    });

    const displayName = buildDisplayName(beachVolleyRuTournament.title, beachVolleyRuTournament.gender);
    const sourceTitle = buildBeachVolleyRuSourceTitle(
      beachVolleyRuTournament.title,
      beachVolleyRuTournament.gender,
      beachVolleyRuTournament.eventId,
    );
    const metadata = buildBeachVolleyRuMetadata(beachVolleyRuTournament, {
      requestedTitle: input.title,
      requestedPageUrl: input.pageUrl,
    });
    const snapshot = prepareBeachVolleyRuTournamentSnapshot({
      gender: beachVolleyRuTournament.gender,
      matches: beachVolleyRuTournament.matches || [],
    });
    const finalStatus: ImportStatus = "SUCCESS";
    const finalNormalization = {
      ...metadata,
      beachVolleyRu: { ...metadata.beachVolleyRu, savedMatches: snapshot.matches.length },
    } as Prisma.InputJsonValue;

    const committed = await runSerializableTournamentImport(async (tx) => {
      await assertTournamentImportFresh({
        tx,
        importRecordId: importRecord.id,
        disciplineSlug: input.slug,
        sourceIdentity: sourceTitle,
        sourceTitle,
        sourceUrl: beachVolleyRuTournament.pageUrl,
        lookupBy: "sourceTitle",
      });
      const tournament = await tx.tournament.upsert({
        where: { disciplineSlug_sourceTitle: { disciplineSlug: input.slug, sourceTitle } },
        create: {
          name: displayName,
          sourceTitle,
          sourceUrl: beachVolleyRuTournament.pageUrl,
          disciplineSlug: input.slug,
          startDate: parseDate(beachVolleyRuTournament.startDate),
          endDate: parseDate(beachVolleyRuTournament.endDate),
          location: beachVolleyRuTournament.location || null,
          prizePool: beachVolleyRuTournament.prizePool || null,
          formatText: buildFormatText(beachVolleyRuTournament.kind),
          status: beachVolleyRuTournament.status,
          extractionStatus: finalStatus,
          normalization: finalNormalization,
          lastImportId: importRecord.id,
        },
        update: {
          name: displayName,
          sourceUrl: beachVolleyRuTournament.pageUrl,
          startDate: parseDate(beachVolleyRuTournament.startDate),
          endDate: parseDate(beachVolleyRuTournament.endDate),
          location: beachVolleyRuTournament.location || null,
          prizePool: beachVolleyRuTournament.prizePool || null,
          formatText: buildFormatText(beachVolleyRuTournament.kind),
          status: beachVolleyRuTournament.status,
          extractionStatus: finalStatus,
          normalization: finalNormalization,
          lastImportId: importRecord.id,
          updatedAt: new Date(),
        },
      });
      await saveBeachVolleyRuTournamentSnapshot({
        tx,
        tournamentId: tournament.id,
        gender: beachVolleyRuTournament.gender,
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
        error: committed.savedCount === 0 ? "Матчи для выбранной сетки на beach.volley.ru пока не найдены" : undefined,
      },
    };
  } catch (error) {
    await prisma.tournamentImport.updateMany({
      where: { id: importRecord.id, status: "PENDING" },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : "Не удалось загрузить турнир beach.volley.ru",
      },
    }).catch(() => {});
    throw error;
  }
}

function prepareBeachVolleyRuTournamentSnapshot(params: {
  gender: BeachVolleyRuGender;
  matches: BeachVolleyRuMatch[];
}): PreparedBeachVolleyRuSnapshot {
  const activeMatches = params.matches.filter((match) => isActiveBeachVolleyRuMatch(match));
  const candidates = activeMatches
    .map((match): PersistableBeachVolleyRuMatch | null => {
      const matchDate = parseDate(match.startTimeUtc);
      if (!matchDate) return null;

      const teamAName = match.teamA.name || "TBD";
      const teamBName = match.teamB.name || "TBD";
      const hasPlaceholderTeams = isPlaceholderTeam(teamAName) || isPlaceholderTeam(teamBName);

      return {
        matchId: `beachvolleyru-${match.eventId}-${params.gender}-${match.id}`,
        teamAName,
        teamBName,
        teamAId: generateBeachVolleyRuTeamId(teamAName),
        teamBId: generateBeachVolleyRuTeamId(teamBName),
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
          source: "beachvolleyru",
          eventId: match.eventId,
          gender: params.gender,
          sets: match.score.sets,
          teamAClub: match.teamA.club,
          teamBClub: match.teamB.club,
        } as Prisma.InputJsonValue,
      };
    })
    .filter((match): match is PersistableBeachVolleyRuMatch => Boolean(match));

  const matches = dedupeTournamentMatches(candidates);
  const decision = decideTournamentSnapshotWrite({
    incomingMatches: matches.length,
    sourceValidated: true,
  });
  if (!decision.allowed) {
    throw new TournamentSnapshotRejectedError(
      `beach.volley.ru snapshot rejected (${decision.reason}); last-good data was preserved.`,
    );
  }
  const teamByName = new Map<string, BeachVolleyRuTeam>();
  for (const match of activeMatches) {
    for (const team of [match.teamA, match.teamB]) {
      if (!team.name || isPlaceholderTeam(team.name)) continue;
      if (!teamByName.has(team.name)) teamByName.set(team.name, team);
    }
  }

  return { matches, teams: Array.from(teamByName.entries()).map(([name, team]) => ({ name, team })) };
}

async function saveBeachVolleyRuTournamentSnapshot(params: {
  tx: Prisma.TransactionClient;
  tournamentId: string;
  gender: BeachVolleyRuGender;
  snapshot: PreparedBeachVolleyRuSnapshot;
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
          incoming: { region: team.club || null, rawText: buildTeamRawText(team, params.gender) },
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

function buildBeachVolleyRuMetadata(
  tournament: {
    eventId: string;
    pageUrl: string;
    gender: BeachVolleyRuGender;
    kind: string;
    matchCount?: number;
    matches?: BeachVolleyRuMatch[];
  },
  context: { requestedTitle: string; requestedPageUrl: string },
): BeachVolleyRuNormalization {
  return {
    beachVolleyRu: {
      source: "beachvolleyru",
      sourceDomain: "beach.volley.ru",
      discipline: "beach",
      eventId: tournament.eventId,
      gender: tournament.gender,
      kind: tournament.kind,
      requestedTitle: context.requestedTitle,
      requestedPageUrl: context.requestedPageUrl,
      pageUrl: tournament.pageUrl,
      matchCount: tournament.matchCount ?? tournament.matches?.length ?? 0,
    },
  };
}

function buildDisplayName(title: string, gender: BeachVolleyRuGender) {
  return `${title} — ${gender === "women" ? "Женщины" : "Мужчины"}`;
}

function buildFormatText(kind: string) {
  if (kind === "cup") return "Пляжный волейбол · Кубок России";
  if (kind === "championship") return "Пляжный волейбол · Чемпионат России";
  return "Пляжный волейбол";
}

function buildTeamRawText(team: BeachVolleyRuTeam, gender: BeachVolleyRuGender) {
  return [
    team.club ? `club=${team.club}` : null,
    team.players ? `players=${team.players}` : null,
    `gender=${gender}`,
    "source=beach.volley.ru",
  ].filter(Boolean).join("; ");
}

function generateBeachVolleyRuTeamId(name: string) {
  if (isPlaceholderTeam(name)) return "tbd";
  const hash = createHash("sha1").update(name.trim().toLowerCase()).digest("hex").slice(0, 16);
  return `team_bvru_${hash}`;
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
