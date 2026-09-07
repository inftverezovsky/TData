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

type PreparedFedervolleySnapshot = {
  matches: PersistableFedervolleyMatch[];
  teams: Array<{ name: string; team: FedervolleyTeam }>;
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
    const snapshot = prepareFedervolleyTournamentSnapshot({
      gender: federvolleyTournament.gender,
      category: federvolleyTournament.category,
      nodeId: federvolleyTournament.nodeId,
      matchshareLid: federvolleyTournament.matchshareLid,
      matches: federvolleyTournament.matches || [],
    });
    const finalStatus: ImportStatus = "SUCCESS";
    const finalNormalization = {
      ...metadata,
      federvolley: { ...metadata.federvolley, savedMatches: snapshot.matches.length },
    } as Prisma.InputJsonValue;

    const committed = await runSerializableTournamentImport(async (tx) => {
      await assertTournamentImportFresh({
        tx,
        importRecordId: importRecord.id,
        disciplineSlug: input.slug,
        sourceIdentity: sourceTitle,
        sourceTitle,
        sourceUrl: federvolleyTournament.pageUrl,
        lookupBy: "sourceTitle",
      });
      const tournament = await tx.tournament.upsert({
        where: { disciplineSlug_sourceTitle: { disciplineSlug: input.slug, sourceTitle } },
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
          extractionStatus: finalStatus,
          normalization: finalNormalization,
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
          extractionStatus: finalStatus,
          normalization: finalNormalization,
          lastImportId: importRecord.id,
          updatedAt: new Date(),
        },
      });
      await saveFedervolleyTournamentSnapshot({
        tx,
        tournamentId: tournament.id,
        gender: federvolleyTournament.gender,
        category: federvolleyTournament.category,
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
        error: committed.savedCount === 0 ? "Матчи Federvolley пока не найдены или табло Matchshare ещё не опубликовано" : undefined,
      },
    };
  } catch (error) {
    await prisma.tournamentImport.updateMany({
      where: { id: importRecord.id, status: "PENDING" },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : "Не удалось загрузить турнир Federvolley",
      },
    }).catch(() => {});
    throw error;
  }
}

function prepareFedervolleyTournamentSnapshot(params: {
  gender: FedervolleyGender;
  category: Exclude<FedervolleyCategory, "all">;
  nodeId: string;
  matchshareLid: string;
  matches: FedervolleyMatch[];
}): PreparedFedervolleySnapshot {
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

  const matches = dedupeTournamentMatches(candidates);
  const decision = decideTournamentSnapshotWrite({
    incomingMatches: matches.length,
    sourceValidated: true,
  });
  if (!decision.allowed) {
    throw new TournamentSnapshotRejectedError(
      `Federvolley snapshot rejected (${decision.reason}); last-good data was preserved.`,
    );
  }
  const teamByName = new Map<string, FedervolleyTeam>();
  for (const match of activeMatches) {
    for (const team of [match.teamA, match.teamB]) {
      if (!team.name || isPlaceholderTeam(team.name)) continue;
      if (!teamByName.has(team.name)) teamByName.set(team.name, team);
    }
  }

  return { matches, teams: Array.from(teamByName.entries()).map(([name, team]) => ({ name, team })) };
}

async function saveFedervolleyTournamentSnapshot(params: {
  tx: Prisma.TransactionClient;
  tournamentId: string;
  gender: FedervolleyGender;
  category: Exclude<FedervolleyCategory, "all">;
  snapshot: PreparedFedervolleySnapshot;
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
          incoming: { rawText: buildTeamRawText(team, params.gender, params.category) },
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

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
