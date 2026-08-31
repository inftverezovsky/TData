import { Prisma } from "@prisma/client";
import { prisma } from "@backend/db/db";
import { dedupeTournamentMatches } from "@backend/matches/dedupe";
import { getBestOfLabel } from "@backend/matches/format";
import { buildEsportsParsingDiagnostics, type EsportsDiagnosticIssue } from "@backend/matches/parsingDiagnostics";
import { resolveExactMatchDate } from "@backend/matches/time";
import { applyTbdPairCycling } from "@backend/matches/tbdCycling";
import { classifyParserError } from "@backend/proxy/parserErrors";
import { decideTournamentSnapshotWrite, TournamentSnapshotRejectedError } from "@backend/sources/importSafety";
import { refreshTournamentMatchesPreservingState } from "@backend/sources/matchPreservation";
import { mergeTournamentParticipantManualFields, refreshTournamentParticipantsPreservingState } from "@backend/sources/participantPreservation";
import { assertTournamentImportFresh, runSerializableTournamentImport } from "@backend/sources/tournamentImportConcurrency";
import { getTeamMappingLookupKeys } from "@backend/teams/canonicalize";
import { generateInternalTeamId, isPlaceholderTeam } from "@backend/teams/teams";
import type { VlrMatch } from "@backend/sources/tdata/vlr/parse";
import { getVlrEventId, resolveVlrEventUrl, runVlrScraper, type VlrDiagnosticsStats } from "@backend/sources/tdata/vlr/scraper";

type ImportVlrTournamentInput = {
  slug: string;
  title: string;
  pageUrl: string;
  force?: boolean;
};

type VlrData = {
  ok?: boolean;
  error?: string;
  errorClass?: string | null;
  matches?: VlrMatch[];
  title?: string;
  cacheHit?: boolean;
  cacheLayer?: string | null;
  stale?: boolean;
  warning?: string | null;
  diagnostics?: {
    vlr?: VlrDiagnosticsStats;
  };
};

type PersistableVlrMatch = VlrMatch & {
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
  sourceUrl: string;
  rawText: string | null;
};

export async function importVlrTournament(input: ImportVlrTournamentInput) {
  if (input.slug !== "valorant") {
    throw new Error("Провайдер VLR доступен только для Valorant");
  }

  const canonicalPageUrl = resolveVlrEventUrl(input.pageUrl);
  const discipline = await prisma.discipline.findUnique({ where: { slug: input.slug }, select: { id: true } });
  if (!discipline) throw new Error("Дисциплина Valorant не найдена");
  const importRecord = await prisma.tournamentImport.create({
    data: {
      disciplineId: discipline.id,
      pageTitle: input.title,
      pageUrl: canonicalPageUrl,
      status: "PENDING",
    },
  });

  try {
    return await runVlrTournamentImport({ ...input, pageUrl: canonicalPageUrl }, importRecord.id);
  } catch (error) {
    await prisma.tournamentImport.updateMany({
      where: { id: importRecord.id, status: "PENDING" },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : "Не удалось загрузить VLR турнир",
      },
    }).catch(() => {});
    throw error;
  }
}

async function runVlrTournamentImport(input: ImportVlrTournamentInput, importRecordId: string) {

  const canonicalPageUrl = resolveVlrEventUrl(input.pageUrl);
  const eventId = getVlrEventId(canonicalPageUrl);
  const sourcePageId = parseSafeSourcePageId(eventId);
  let vlrData: VlrData = { ok: false };

  try {
    if (eventId) {
      vlrData = await runVlrScraper("event", eventId, { noCache: !!input.force });
    } else {
      const data = await runVlrScraper("matches", undefined, { noCache: !!input.force });
      const query = normalizeSearch(input.title);
      vlrData = {
        ...data,
        matches: (data.matches || []).filter((match) => normalizeSearch(match.tournament).includes(query) || query.includes(normalizeSearch(match.tournament))),
      };
    }
  } catch (err) {
    vlrData = {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown VLR scraper error",
      errorClass: classifyParserError({ message: err instanceof Error ? err.message : String(err) }),
    };
  }

  const matchUrlsFound = vlrData.diagnostics?.vlr?.matchUrlsFound ?? vlrData.matches?.length ?? 0;
  const matchPagesFailed = vlrData.diagnostics?.vlr?.matchPagesFailed ?? (vlrData.ok ? 0 : 1);
  const saveableMatchesCount = countSaveableVlrMatches(vlrData.matches || []);
  const canReplaceExisting = shouldReplaceVlrMatchesOnImport({
    ok: Boolean(vlrData.ok),
    stale: Boolean(vlrData.stale || vlrData.diagnostics?.vlr?.stale),
    warning: vlrData.warning,
    matchUrlsFound,
    matchPagesFailed,
    saveableMatchesCount,
  });

  const existingTournament = await findExistingVlrTournament({
    disciplineSlug: input.slug,
    sourceTitle: input.title,
    sourceUrl: canonicalPageUrl,
    sourcePageId,
  });

  if (!canReplaceExisting) {
    throw new TournamentSnapshotRejectedError(
      vlrData.error || vlrData.warning || "VLR returned a partial, stale, or unvalidated event snapshot; last-good data was preserved.",
      vlrData.errorClass || (vlrData.stale ? "stale_cache" : matchPagesFailed > 0 ? "parse_failed" : "schema_drift"),
    );
  }

  const committed = await runSerializableTournamentImport(async (tx) => {
    const freshness = await assertTournamentImportFresh({
      tx,
      importRecordId,
      disciplineSlug: input.slug,
      sourceIdentity: canonicalPageUrl,
      tournamentId: existingTournament?.id,
      sourceTitle: input.title,
      sourceUrl: canonicalPageUrl,
      lookupBy: "sourceUrl",
    });
    const currentTournament = freshness.tournamentId
      ? await tx.tournament.findUnique({ where: { id: freshness.tournamentId } })
      : null;
    const tournament = currentTournament
      ? await tx.tournament.update({
          where: { id: currentTournament.id },
          data: {
            name: vlrData.title || input.title,
            sourceUrl: canonicalPageUrl,
            sourcePageId,
            lastImportId: importRecordId,
            updatedAt: new Date(),
          },
        })
      : await tx.tournament.create({
          data: {
            name: vlrData.title || input.title,
            sourceTitle: input.title,
            sourceUrl: canonicalPageUrl,
            sourcePageId,
            disciplineSlug: input.slug,
            status: "ongoing",
            extractionStatus: "PARTIAL",
            lastImportId: importRecordId,
          },
        });

    const saveResult = await saveVlrTournamentMatches({
      tournamentId: tournament.id,
      slug: input.slug,
      title: input.title,
      matches: vlrData.matches || [],
      force: !!input.force,
      sourceValidated: true,
      client: tx,
    });
    const savedMatchesCount = saveResult.savedCount;
    const diagnostics = buildEsportsParsingDiagnostics({
      source: "vlr",
      rawCandidates: matchUrlsFound,
      candidates: (vlrData.matches ?? []).map(toVlrDiagnosticCandidate),
      savedMatches: savedMatchesCount,
      extraIssues: buildVlrExtraIssues(vlrData),
      vlr: {
        matchUrlsFound,
        matchPagesFetched: vlrData.diagnostics?.vlr?.matchPagesFetched ?? (vlrData.ok ? vlrData.matches?.length ?? 0 : 0),
        matchPagesFailed,
        cacheHit: vlrData.cacheHit || vlrData.diagnostics?.vlr?.cacheHit,
        stale: vlrData.stale || vlrData.diagnostics?.vlr?.stale,
      },
    });
    const normalizedStatus = resolveVlrImportStatus({
      ok: !!vlrData.ok,
      matchUrlsFound: diagnostics.vlr?.matchUrlsFound ?? 0,
      matchPagesFailed: diagnostics.vlr?.matchPagesFailed ?? 0,
      savedMatchesCount,
    });
    if (normalizedStatus !== "SUCCESS") {
      throw new TournamentSnapshotRejectedError(
        vlrData.error || vlrData.warning || "VLR returned a partial, stale, or unvalidated event snapshot; last-good data was preserved.",
        vlrData.errorClass || (vlrData.stale ? "stale_cache" : matchPagesFailed > 0 ? "parse_failed" : "schema_drift"),
      );
    }

    await tx.tournament.update({
      where: { id: tournament.id },
      data: {
        name: vlrData.title || input.title,
        extractionStatus: normalizedStatus,
        normalization: {
          warnings: [
            vlrData.warning,
            vlrData.error,
            diagnostics.vlr?.matchPagesFailed ? `Не удалось загрузить detail-страниц VLR: ${diagnostics.vlr.matchPagesFailed}.` : null,
          ].filter((item): item is string => typeof item === "string" && item.length > 0),
          cacheHit: !!vlrData.cacheHit,
          stale: !!vlrData.stale,
          valorantDiagnostics: diagnostics,
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
    normalized: { status: committed.normalizedStatus, error: vlrData?.error },
  };
}

function parseSafeSourcePageId(value: string) {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 2_147_483_647 ? parsed : null;
}

type VlrTournamentLookupClient = Pick<Prisma.TransactionClient, "tournament">;

export async function findExistingVlrTournament(params: {
  disciplineSlug: string;
  sourceTitle: string;
  sourceUrl: string;
  sourcePageId: number | null;
}, client: VlrTournamentLookupClient = prisma) {
  if (params.sourcePageId !== null) {
    const bySourcePageId = await client.tournament.findFirst({
      where: {
        disciplineSlug: params.disciplineSlug,
        sourcePageId: params.sourcePageId,
        OR: [
          { sourceUrl: { startsWith: "https://www.vlr.gg/event/" } },
          { sourceUrl: { startsWith: "https://vlr.gg/event/" } },
        ],
      },
      orderBy: { updatedAt: "desc" },
    });
    if (bySourcePageId) return bySourcePageId;
  }

  const byCanonicalUrl = await client.tournament.findFirst({
    where: { disciplineSlug: params.disciplineSlug, sourceUrl: params.sourceUrl },
    orderBy: { updatedAt: "desc" },
  });
  if (byCanonicalUrl) return byCanonicalUrl;

  return client.tournament.findFirst({
    where: {
      disciplineSlug: params.disciplineSlug,
      sourceTitle: params.sourceTitle,
      OR: [
        { sourceUrl: { startsWith: "https://www.vlr.gg/event/" } },
        { sourceUrl: { startsWith: "https://vlr.gg/event/" } },
        { sourceUrl: "" },
      ],
    },
    orderBy: { updatedAt: "desc" },
  });
}

async function saveVlrTournamentMatches(params: {
  tournamentId: string;
  slug: string;
  title: string;
  matches: VlrMatch[];
  force: boolean;
  sourceValidated: boolean;
  client: Prisma.TransactionClient;
}): Promise<{ savedCount: number }> {
  const client = params.client;
  const vlrMatches = buildPersistableVlrMatches(params.matches);

  if (!decideTournamentSnapshotWrite({
    incomingMatches: vlrMatches.length,
    sourceValidated: params.sourceValidated,
    force: params.force,
  }).allowed) {
    return { savedCount: 0 };
  }

  applyTbdPairCycling(vlrMatches, params.title);

  const matchRows = vlrMatches.map((m) => {
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
        hasPlaceholderTeams: m.hasPlaceholderTeams,
        matchDate,
        matchDateTime: m.matchDateTime,
        format: m.format,
        sourceUrl: m.sourceUrl,
        rawText: m.rawText,
        status: m.isLive ? "live" : "upcoming",
      },
      update: {
        stage: m.stage,
        teamAName: m.teamAName,
        teamBName: m.teamBName,
        teamAId: m.teamAId,
        teamBId: m.teamBId,
        hasPlaceholderTeams: m.hasPlaceholderTeams,
        matchDate,
        matchDateTime: m.matchDateTime,
        sourceUrl: m.sourceUrl,
        rawText: m.rawText,
        status: m.isLive ? "live" : "upcoming",
        ...(m.format ? { format: m.format } : {}),
      },
    };
  });

  const uniqueTeams = new Set<string>();
  for (const m of vlrMatches) {
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

  return { savedCount: vlrMatches.length };
}

function buildPersistableVlrMatches(matches: VlrMatch[]) {
  return dedupeTournamentMatches(matches.map((m): PersistableVlrMatch | null => {
    const hasPlaceholderTeams = isPlaceholderTeam(m.team1) || isPlaceholderTeam(m.team2);
    const teamAId = isPlaceholderTeam(m.team1) ? "tbd" : generateInternalTeamId(m.team1);
    const teamBId = isPlaceholderTeam(m.team2) ? "tbd" : generateInternalTeamId(m.team2);
    const format = getBestOfLabel(m.format || m.rawText);
    const sourceUrl = m.url || `https://www.vlr.gg/${m.id}/match`;
    const candidate = {
      ...m,
      matchDate: m.unix_time ? new Date(Number(m.unix_time) * 1000) : null,
      matchDateTime: m.utcTimestamp ? `data-utc-ts="${String(m.utcTimestamp)}"` : null,
      sourceUrl,
    };
    const matchDate = resolveExactMatchDate(candidate);
    if (!matchDate) return null;

    return {
      ...m,
      matchId: `vlr-${m.id}`,
      teamAName: m.team1,
      teamBName: m.team2,
      teamAId,
      teamBId,
      hasPlaceholderTeams,
      matchDate,
      matchDateTime: candidate.matchDateTime,
      format,
      stage: m.stage || null,
      sourceUrl,
      rawText: m.rawText || null,
    };
  }).filter((m): m is PersistableVlrMatch => Boolean(m)));
}

export function countSaveableVlrMatches(matches: VlrMatch[]) {
  return buildPersistableVlrMatches(matches).length;
}

export function shouldReplaceVlrMatchesOnImport(input: {
  ok: boolean;
  stale: boolean;
  warning?: string | null;
  matchUrlsFound: number;
  matchPagesFailed: number;
  saveableMatchesCount: number;
}) {
  return decideTournamentSnapshotWrite({
    incomingMatches: input.saveableMatchesCount,
    sourceValidated: input.ok
      && !input.stale
      && !input.warning
      && input.matchUrlsFound > 0
      && input.matchPagesFailed === 0
      && input.saveableMatchesCount >= input.matchUrlsFound,
  }).allowed;
}

function toVlrDiagnosticCandidate(match: VlrMatch) {
  const sourceUrl = match.url || (match.id ? `https://www.vlr.gg/${match.id}/match` : null);
  const matchDate = match.unix_time ? new Date(Number(match.unix_time) * 1000) : null;
  const matchDateTime = match.utcTimestamp ? `data-utc-ts="${match.utcTimestamp}"` : match.dateLabel || null;
  return {
    ...match,
    teamAName: match.team1,
    teamBName: match.team2,
    matchDate,
    matchDateTime,
    format: getBestOfLabel(match.format || match.rawText),
    sourceUrl,
  };
}

function buildVlrExtraIssues(data: VlrData): EsportsDiagnosticIssue[] {
  const issues: EsportsDiagnosticIssue[] = [];
  const failed = data.diagnostics?.vlr?.matchPagesFailed ?? 0;
  if (failed > 0) {
    issues.push({
      reason: "parse_failed",
      message: `Не удалось загрузить или разобрать detail-страницы VLR: ${failed}.`,
    });
  }
  if (!data.ok && data.error) {
    issues.push({
      reason: "parse_failed",
      message: data.error,
    });
  }
  return issues;
}

export function resolveVlrImportStatus(input: {
  ok: boolean;
  matchUrlsFound: number;
  matchPagesFailed: number;
  savedMatchesCount: number;
}) {
  if (!input.ok) return "PARTIAL";
  if (input.matchUrlsFound === 0 && input.savedMatchesCount === 0) return "PARTIAL";
  if (input.matchPagesFailed > 0) return "PARTIAL";
  if (input.matchUrlsFound > 0 && input.savedMatchesCount === 0) return "PARTIAL";
  return "SUCCESS";
}

function normalizeSearch(value: string) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
