import { Prisma, type ImportStatus } from "@prisma/client";
import { prisma } from "@backend/db/db";
import { buildDota2Diagnostics, type Dota2DiagnosticIssue } from "@backend/matches/parsingDiagnostics";
import { dedupeTournamentMatches } from "@backend/matches/dedupe";
import { getBestOfLabel } from "@backend/matches/format";
import { resolveExactMatchDate } from "@backend/matches/time";
import { applyTbdPairCycling } from "@backend/matches/tbdCycling";
import { classifyParserError } from "@backend/proxy/parserErrors";
import { runDltv } from "@backend/sources/tdata/dltv/queue";
import { validateDltvEventUrl } from "@backend/sources/tdata/dltv/client";
import { extractDltvEventId } from "@backend/sources/tdata/dltv/parse";
import type { DltvMatch, DltvRunResult } from "@backend/sources/tdata/dltv/types";
import { decideTournamentSnapshotWrite, TournamentSnapshotRejectedError } from "@backend/sources/importSafety";
import { refreshTournamentMatchesPreservingState } from "@backend/sources/matchPreservation";
import { mergeTournamentParticipantManualFields, refreshTournamentParticipantsPreservingState } from "@backend/sources/participantPreservation";
import { assertTournamentImportFresh, runSerializableTournamentImport } from "@backend/sources/tournamentImportConcurrency";
import { getTeamMappingLookupKeys } from "@backend/teams/canonicalize";
import { generateInternalTeamId, isPlaceholderTeam } from "@backend/teams/teams";

type ImportDltvTournamentInput = {
  slug: string;
  title: string;
  pageUrl: string;
  force?: boolean;
};

export async function importDltvTournament(input: ImportDltvTournamentInput) {
  if (input.slug !== "dota2") {
    throw new Error("Провайдер DLTV доступен только для Dota 2");
  }

  const identity = buildDltvTournamentIdentity(input.pageUrl);
  const discipline = await prisma.discipline.findUnique({ where: { slug: input.slug }, select: { id: true } });
  if (!discipline) throw new Error("Дисциплина Dota 2 не найдена");
  const importRecord = await prisma.tournamentImport.create({
    data: {
      disciplineId: discipline.id,
      pageTitle: input.title,
      pageUrl: identity.sourceUrl,
      status: "PENDING",
    },
  });

  try {
    return await runDltvTournamentImport({ ...input, pageUrl: identity.sourceUrl }, importRecord.id);
  } catch (error) {
    await prisma.tournamentImport.updateMany({
      where: { id: importRecord.id, status: "PENDING" },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : "Не удалось загрузить DLTV турнир",
      },
    }).catch(() => {});
    throw error;
  }
}

async function runDltvTournamentImport(input: ImportDltvTournamentInput, importRecordId: string) {
  const identity = buildDltvTournamentIdentity(input.pageUrl);

  let dltvData: DltvRunResult = { ok: false };
  try {
    dltvData = await runDltv("event", identity.sourceUrl, { noCache: !!input.force });
  } catch (err) {
    dltvData = {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown DLTV scraper error",
      errorClass: classifyParserError({ message: err instanceof Error ? err.message : String(err) }),
    };
  }

  const matchUrlsFound = dltvData.event?.matchUrls.length ?? dltvData.matches?.length ?? 0;
  const matchPagesFailed = dltvData.matchPageFailures?.length ?? (dltvData.ok ? 0 : 1);
  const saveableMatchesCount = countSaveableDltvMatches(dltvData.matches || []);
  const canReplaceExistingMatches = shouldReplaceDltvMatchesOnImport({
    ok: !!dltvData.ok,
    stale: !!dltvData.stale,
    warning: dltvData.warning,
    matchUrlsFound,
    matchPagesFailed,
    sourceMatchesCount: saveableMatchesCount,
  });
  const forceWasDowngraded = Boolean(input.force && !canReplaceExistingMatches);

  const existingTournament = await findExistingDltvTournament({
    disciplineSlug: input.slug,
    ...identity,
  });
  if (!canReplaceExistingMatches) {
    throw new TournamentSnapshotRejectedError(
      dltvData.error || dltvData.warning || (forceWasDowngraded
        ? "DLTV force-refresh returned a partial snapshot; last-good data was preserved."
        : "DLTV returned a partial or unvalidated event snapshot; last-good data was preserved."),
      resolveDltvImportFailureClass(dltvData),
    );
  }

  const committed = await runSerializableTournamentImport(async (tx) => {
    const freshness = await assertTournamentImportFresh({
      tx,
      importRecordId,
      disciplineSlug: input.slug,
      sourceIdentity: identity.sourceUrl,
      tournamentId: existingTournament?.id,
      sourceTitle: identity.sourceTitle,
      sourceUrl: identity.sourceUrl,
      lookupBy: "sourceUrl",
    });
    const currentTournament = freshness.tournamentId
      ? await tx.tournament.findUnique({ where: { id: freshness.tournamentId } })
      : null;
    const tournament = await resolveDltvTournament({
      disciplineSlug: input.slug,
      title: input.title,
      existing: currentTournament,
      importRecordId,
      client: tx,
      ...identity,
    });
    const saveResult = await saveDltvTournamentMatches({
      tournamentId: tournament.id,
      slug: input.slug,
      title: input.title,
      matches: dltvData.matches || [],
      participants: dltvData.event?.participants || [],
      force: Boolean(input.force),
      client: tx,
    });
    const savedMatchesCount = saveResult.savedCount;
    const normalizedStatus = resolveDltvImportStatus({
      ok: !!dltvData.ok,
      matchUrlsFound,
      matchPagesFailed,
      savedMatchesCount,
    });
    if (normalizedStatus !== "SUCCESS") {
      throw new TournamentSnapshotRejectedError(
        dltvData.error || dltvData.warning || "DLTV returned a partial or unvalidated event snapshot; last-good data was preserved.",
        resolveDltvImportFailureClass(dltvData),
      );
    }
    const diagnostics = buildDota2Diagnostics({
      source: "dltv",
      rawCandidates: matchUrlsFound,
      candidates: (dltvData.matches ?? []).map((match) => ({
        ...match,
        teamAName: match.team1,
        teamBName: match.team2,
        sourceUrl: match.url,
        format: getBestOfLabel(match.format || match.rawText),
      })),
      savedMatches: savedMatchesCount,
      extraIssues: buildDltvExtraIssues(dltvData),
      dltv: {
        matchUrlsFound,
        matchPagesFetched: dltvData.matches?.length ?? 0,
        matchPagesFailed,
        cacheHit: dltvData.cacheHit,
        stale: dltvData.stale,
      },
    });

    await tx.tournament.update({
      where: { id: tournament.id },
      data: {
        name: dltvData.event?.title || input.title,
        startDate: parseDltvRangeDate(dltvData.event?.dates, "start"),
        endDate: parseDltvRangeDate(dltvData.event?.dates, "end"),
        location: dltvData.event?.location,
        prizePool: dltvData.event?.prizePool,
        formatText: dltvData.event?.formatText,
        status: dltvData.event?.status || "ongoing",
        extractionStatus: normalizedStatus,
        normalization: {
          warnings: [dltvData.warning, dltvData.error]
            .filter((item): item is string => typeof item === "string" && item.length > 0),
          cacheHit: !!dltvData.cacheHit,
          stale: !!dltvData.stale,
          dota2Diagnostics: diagnostics,
        } as Prisma.InputJsonValue,
      },
    });
    await tx.tournamentImport.update({
      where: { id: importRecordId },
      data: { status: "SUCCESS", finishedAt: new Date() },
    });
    return { tournamentId: tournament.id, normalizedStatus };
  });

  const fullTournament = await prisma.tournament.findUnique({
    where: { id: committed.tournamentId },
    include: { participants: true, matches: true, lastImport: true },
  });

  return {
    tournament: fullTournament ? { ...fullTournament, matches: dedupeTournamentMatches(fullTournament.matches) } : null,
    normalized: { status: committed.normalizedStatus, error: dltvData?.error },
  };
}

export function buildDltvTournamentIdentity(pageUrl: string) {
  const validated = validateDltvEventUrl(pageUrl);
  const eventPath = extractDltvEventId(validated);
  if (!eventPath) throw new Error("Invalid DLTV event URL");
  const encodedPath = eventPath.split("/").map(encodeURIComponent).join("/");
  return {
    sourceTitle: `dltv:${eventPath}`,
    sourceUrl: `https://ru.dltv.org/events/${encodedPath}`,
  };
}

async function resolveDltvTournament(params: {
  disciplineSlug: string;
  title: string;
  sourceTitle: string;
  sourceUrl: string;
  existing: Awaited<ReturnType<typeof findExistingDltvTournament>>;
  importRecordId: string;
  client: Prisma.TransactionClient;
}) {
  if (params.existing) {
    return params.client.tournament.update({
      where: { id: params.existing.id },
      data: {
        name: params.title,
        sourceTitle: params.sourceTitle,
        sourceUrl: params.sourceUrl,
        lastImportId: params.importRecordId,
        updatedAt: new Date(),
      },
    });
  }

  return params.client.tournament.create({
    data: {
      name: params.title,
      sourceTitle: params.sourceTitle,
      sourceUrl: params.sourceUrl,
      disciplineSlug: params.disciplineSlug,
      status: "ongoing",
      extractionStatus: "PARTIAL",
      lastImportId: params.importRecordId,
    },
  });
}

type DltvTournamentLookupClient = Pick<Prisma.TransactionClient, "tournament">;

export async function findExistingDltvTournament(params: {
  disciplineSlug: string;
  sourceTitle: string;
  sourceUrl: string;
}, client: DltvTournamentLookupClient = prisma) {
  const bySourceUrl = await client.tournament.findFirst({
    where: {
      disciplineSlug: params.disciplineSlug,
      sourceUrl: params.sourceUrl,
    },
    orderBy: { updatedAt: "desc" },
  });
  if (bySourceUrl) return bySourceUrl;

  return client.tournament.findFirst({
    where: {
      disciplineSlug: params.disciplineSlug,
      sourceTitle: params.sourceTitle,
      OR: [
        { sourceUrl: { startsWith: "https://ru.dltv.org/events/" } },
        { sourceUrl: { startsWith: "https://www.dltv.org/events/" } },
        { sourceUrl: "" },
      ],
    },
    orderBy: { updatedAt: "desc" },
  });
}

export function resolveDltvImportFailureClass(data: Pick<DltvRunResult, "errorClass" | "stale" | "matchPageFailures">) {
  if (data.stale) return "stale_cache";
  if (data.errorClass) return data.errorClass;
  const detailClass = data.matchPageFailures?.find((failure) => failure.errorClass)?.errorClass;
  return detailClass || "parse_failed";
}

async function saveDltvTournamentMatches(params: {
  tournamentId: string;
  slug: string;
  title: string;
  matches: DltvMatch[];
  participants: Array<{ name: string; url?: string }>;
  force: boolean;
  client: Prisma.TransactionClient;
}): Promise<{ savedCount: number }> {
  const client = params.client;
  const dltvMatches = dedupeTournamentMatches(params.matches.map((m) => {
    const hasPlaceholderTeams = isPlaceholderTeam(m.team1) || isPlaceholderTeam(m.team2);
    const teamAId = isPlaceholderTeam(m.team1) ? "tbd" : generateInternalTeamId(m.team1);
    const teamBId = isPlaceholderTeam(m.team2) ? "tbd" : generateInternalTeamId(m.team2);
    const sourceUrl = m.url;
    const matchDate = resolveExactMatchDate({ ...m, sourceUrl });
    return {
      ...m,
      matchId: `dltv-${m.id}`,
      teamAName: m.team1,
      teamBName: m.team2,
      teamAId,
      teamBId,
      hasPlaceholderTeams,
      matchDate,
      matchDateTime: m.matchDateTime,
      format: getBestOfLabel(m.format || m.rawText),
      sourceUrl,
    };
  }).filter((m) => m.matchDate));

  applyTbdPairCycling(dltvMatches, params.title);

  const matchRows = dltvMatches.map((m) => {
    const matchDate = m.matchDate ? new Date(m.matchDate) : null;
    return {
      matchId: m.matchId,
      create: {
        matchId: m.matchId,
        tournamentId: params.tournamentId,
        stage: m.stage,
        teamAName: m.teamAName,
        teamBName: m.teamBName,
        teamAId: m.teamAId,
        teamBId: m.teamBId,
        scoreA: m.scoreA ?? null,
        scoreB: m.scoreB ?? null,
        hasPlaceholderTeams: m.hasPlaceholderTeams,
        matchDate,
        matchDateTime: m.matchDateTime,
        format: m.format,
        sourceUrl: m.sourceUrl,
        rawText: m.rawText,
        status: m.status || "upcoming",
      },
      update: {
        stage: m.stage,
        teamAName: m.teamAName,
        teamBName: m.teamBName,
        teamAId: m.teamAId,
        teamBId: m.teamBId,
        scoreA: m.scoreA ?? null,
        scoreB: m.scoreB ?? null,
        hasPlaceholderTeams: m.hasPlaceholderTeams,
        matchDate,
        matchDateTime: m.matchDateTime,
        sourceUrl: m.sourceUrl,
        rawText: m.rawText,
        status: m.status || "upcoming",
        ...(m.format ? { format: m.format } : {}),
      },
    };
  });

  const uniqueTeams = new Set<string>();
  for (const participant of params.participants) {
    if (participant.name && !isPlaceholderTeam(participant.name)) uniqueTeams.add(participant.name);
  }
  for (const m of dltvMatches) {
    if (m.teamAName && !isPlaceholderTeam(m.teamAName)) uniqueTeams.add(m.teamAName);
    if (m.teamBName && !isPlaceholderTeam(m.teamBName)) uniqueTeams.add(m.teamBName);
  }

  const [existingParticipants, teamMappings] = await Promise.all([
    client.tournamentParticipant.findMany({
      where: { tournamentId: params.tournamentId },
      select: {
        name: true,
        platformId: true,
        seed: true,
        region: true,
        status: true,
        logoUrl: true,
        rawText: true,
      },
    }),
    client.teamMapping.findMany({ where: { disciplineSlug: params.slug } }),
  ]);

  const existingParticipantMap = new Map(existingParticipants.map((p) => [p.name.toLowerCase(), p]));
  const mappingLookup = new Map<string, (typeof teamMappings)[number]>();
  for (const mapping of teamMappings) {
    mappingLookup.set(mapping.liquipediaName.toLowerCase(), mapping);
    for (const key of getTeamMappingLookupKeys(mapping)) {
      if (key && !mappingLookup.has(key.toLowerCase())) mappingLookup.set(key.toLowerCase(), mapping);
    }
  }

  const participantsToInsert = Array.from(uniqueTeams)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const existing = existingParticipantMap.get(name.toLowerCase());
      const mapping = mappingLookup.get(name.toLowerCase());
      const manualFields = mergeTournamentParticipantManualFields({
        existing,
        mapping,
      });
      return {
        tournamentId: params.tournamentId,
        name,
        ...manualFields,
      };
    });

  await refreshTournamentMatchesPreservingState({
    tx: client,
    tournamentId: params.tournamentId,
    matches: matchRows,
  });
  await refreshTournamentParticipantsPreservingState({
    tx: client,
    tournamentId: params.tournamentId,
    participants: participantsToInsert,
  });

  return { savedCount: dltvMatches.length };
}

function buildDltvExtraIssues(data: DltvRunResult): Dota2DiagnosticIssue[] {
  const issues: Dota2DiagnosticIssue[] = [];
  for (const failure of data.matchPageFailures ?? []) {
    issues.push({
      reason: "parse_failed",
      message: failure.error || "Не удалось разобрать страницу матча DLTV.",
      sourceUrl: failure.url,
    });
  }
  if (!data.ok && data.error) {
    issues.push({
      reason: "parse_failed",
      message: data.error,
    });
  }
  if (data.ok && data.event && data.event.matchUrls.length === 0) {
    issues.push({
      reason: "parse_failed",
      message: "DLTV event page did not expose match links.",
      sourceUrl: data.event.url,
    });
  }
  return issues;
}

export function shouldReplaceDltvMatchesOnImport(input: {
  ok: boolean;
  stale?: boolean;
  warning?: string | null;
  matchUrlsFound: number;
  matchPagesFailed: number;
  sourceMatchesCount: number;
}) {
  return decideTournamentSnapshotWrite({
    incomingMatches: input.sourceMatchesCount,
    sourceValidated: input.ok &&
      !input.stale &&
      !input.warning &&
      input.matchUrlsFound > 0 &&
      input.matchPagesFailed === 0 &&
      input.sourceMatchesCount >= input.matchUrlsFound,
  }).allowed;
}

export function countSaveableDltvMatches(matches: DltvMatch[]) {
  return dedupeTournamentMatches(matches.map((match) => ({
    ...match,
    matchDate: resolveExactMatchDate({ ...match, sourceUrl: match.url }),
    sourceUrl: match.url,
  })).filter((match) => match.matchDate)).length;
}

export function resolveDltvImportStatus(input: {
  ok: boolean;
  matchUrlsFound: number;
  matchPagesFailed: number;
  savedMatchesCount: number;
}): ImportStatus {
  if (!input.ok) return "PARTIAL";
  if (input.matchUrlsFound === 0 && input.savedMatchesCount === 0) return "PARTIAL";
  if (input.matchPagesFailed > 0) return "PARTIAL";
  if (input.matchUrlsFound > 0 && input.savedMatchesCount === 0) return "PARTIAL";
  return "SUCCESS";
}

function parseDltvRangeDate(value: string | null | undefined, part: "start" | "end") {
  const match = String(value || "").match(/((?:19|20)\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s*-\s*((?:19|20)\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
  const raw = part === "start" ? match?.[1] : match?.[2];
  if (!raw) return null;
  const parsed = raw.match(/((?:19|20)\d{2})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!parsed) return null;
  const date = new Date(Date.UTC(Number(parsed[1]), Number(parsed[2]) - 1, Number(parsed[3]), Number(parsed[4]) - 3, Number(parsed[5]), Number(parsed[6])));
  return Number.isFinite(date.getTime()) ? date : null;
}
