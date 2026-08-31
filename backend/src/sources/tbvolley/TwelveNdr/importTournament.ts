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
} from "@backend/sources/tbvolley/TwelveNdr";
import {
  BEACH_VOLLEYBALL_DISCIPLINE_SLUG,
  getBeachVolleyballMappingSlug,
} from "@backend/sources/tbvolley/config";

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

type PreparedTwelveNdrSnapshot = {
  matches: PersistableTwelveNdrMatch[];
  teams: Array<{ name: string; team: TwelveNdrTeam }>;
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
    const snapshot = prepareTwelveNdrTournamentSnapshot({
      source,
      gender: twelveNdrTournament.gender,
      tcode: twelveNdrTournament.tcode,
      matches: twelveNdrTournament.matches || [],
    });
    const finalStatus: ImportStatus = "SUCCESS";
    const finalNormalization = {
      ...metadata,
      twelveNdr: { ...metadata.twelveNdr, savedMatches: snapshot.matches.length },
    } as Prisma.InputJsonValue;

    const committed = await runSerializableTournamentImport(async (tx) => {
      await assertTournamentImportFresh({
        tx,
        importRecordId: importRecord.id,
        disciplineSlug: input.slug,
        sourceIdentity: sourceTitle,
        sourceTitle,
        sourceUrl: twelveNdrTournament.pageUrl,
        lookupBy: "sourceTitle",
      });
      const tournament = await tx.tournament.upsert({
        where: { disciplineSlug_sourceTitle: { disciplineSlug: input.slug, sourceTitle } },
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
          extractionStatus: finalStatus,
          normalization: finalNormalization,
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
          extractionStatus: finalStatus,
          normalization: finalNormalization,
          lastImportId: importRecord.id,
          updatedAt: new Date(),
        },
      });
      await saveTwelveNdrTournamentSnapshot({
        tx,
        tournamentId: tournament.id,
        source,
        gender: twelveNdrTournament.gender,
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
        error: committed.savedCount === 0 ? "Матчи для выбранной сетки 12ndr пока не найдены" : undefined,
      },
    };
  } catch (error) {
    await prisma.tournamentImport.updateMany({
      where: { id: importRecord.id, status: "PENDING" },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : "Не удалось загрузить турнир 12ndr",
      },
    }).catch(() => {});
    throw error;
  }
}

function prepareTwelveNdrTournamentSnapshot(params: {
  source: TwelveNdrSource;
  gender: TwelveNdrGender;
  tcode: string;
  matches: TwelveNdrMatch[];
}): PreparedTwelveNdrSnapshot {
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

  const matches = dedupeTournamentMatches(candidates);
  const decision = decideTournamentSnapshotWrite({
    incomingMatches: matches.length,
    sourceValidated: true,
  });
  if (!decision.allowed) {
    throw new TournamentSnapshotRejectedError(
      `12ndr snapshot rejected (${decision.reason}); last-good data was preserved.`,
    );
  }
  const teamByName = new Map<string, TwelveNdrTeam>();
  for (const match of activeMatches) {
    for (const team of [match.teamA, match.teamB]) {
      if (!team.name || isPlaceholderTeam(team.name)) continue;
      if (!teamByName.has(team.name)) teamByName.set(team.name, team);
    }
  }

  return { matches, teams: Array.from(teamByName.entries()).map(([name, team]) => ({ name, team })) };
}

async function saveTwelveNdrTournamentSnapshot(params: {
  tx: Prisma.TransactionClient;
  tournamentId: string;
  source: TwelveNdrSource;
  gender: TwelveNdrGender;
  snapshot: PreparedTwelveNdrSnapshot;
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
          incoming: {
            region: team.country || null,
            rawText: buildTeamRawText(team, params.gender, params.source),
          },
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

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
