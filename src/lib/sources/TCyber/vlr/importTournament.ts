import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/db";
import { dedupeTournamentMatches } from "@/lib/matches/dedupe";
import { getBestOfLabel } from "@/lib/matches/format";
import { buildEsportsParsingDiagnostics, type EsportsDiagnosticIssue } from "@/lib/matches/parsingDiagnostics";
import { resolveExactMatchDate } from "@/lib/matches/time";
import { applyTbdPairCycling } from "@/lib/matches/tbdCycling";
import { classifyParserError } from "@/lib/proxy/parserErrors";
import { getTeamMappingLookupKeys } from "@/lib/teams/canonicalize";
import { generateInternalTeamId, isPlaceholderTeam } from "@/lib/teams/teams";
import type { VlrMatch } from "@/lib/sources/TCyber/vlr/parse";
import { getVlrEventId, runVlrScraper, type VlrDiagnosticsStats } from "@/lib/sources/TCyber/vlr/scraper";

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

  const tournament = await prisma.tournament.upsert({
    where: { disciplineSlug_sourceTitle: { disciplineSlug: input.slug, sourceTitle: input.title } },
    create: {
      name: input.title,
      sourceTitle: input.title,
      sourceUrl: input.pageUrl,
      disciplineSlug: input.slug,
      status: "ongoing",
      extractionStatus: "SUCCESS",
    },
    update: {
      sourceUrl: input.pageUrl,
      updatedAt: new Date(),
    },
  });

  const eventId = getVlrEventId(input.pageUrl);
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

  let savedMatchesCount = 0;
  if (vlrData.ok && vlrData.matches) {
    const saveResult = await saveVlrTournamentMatches({
      tournamentId: tournament.id,
      slug: input.slug,
      title: input.title,
      matches: vlrData.matches,
      force: !!input.force,
    });
    savedMatchesCount = saveResult.savedCount;
  }

  const diagnostics = buildEsportsParsingDiagnostics({
    source: "vlr",
    rawCandidates: vlrData.diagnostics?.vlr?.matchUrlsFound ?? vlrData.matches?.length ?? 0,
    candidates: (vlrData.matches ?? []).map(toVlrDiagnosticCandidate),
    savedMatches: savedMatchesCount,
    extraIssues: buildVlrExtraIssues(vlrData),
    vlr: {
      matchUrlsFound: vlrData.diagnostics?.vlr?.matchUrlsFound ?? vlrData.matches?.length ?? 0,
      matchPagesFetched: vlrData.diagnostics?.vlr?.matchPagesFetched ?? (vlrData.ok ? vlrData.matches?.length ?? 0 : 0),
      matchPagesFailed: vlrData.diagnostics?.vlr?.matchPagesFailed ?? (vlrData.ok ? 0 : 1),
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

  await prisma.tournament.update({
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
  }).catch(() => {});

  const fullTournament = await prisma.tournament.findUnique({
    where: { id: tournament.id },
    include: { participants: true, matches: true, lastImport: true },
  });

  return {
    tournament: fullTournament ? { ...fullTournament, matches: dedupeTournamentMatches(fullTournament.matches) } : null,
    normalized: { status: vlrData?.ok ? "SUCCESS" : "PARTIAL", error: vlrData?.error },
  };
}

async function saveVlrTournamentMatches(params: {
  tournamentId: string;
  slug: string;
  title: string;
  matches: VlrMatch[];
  force: boolean;
}): Promise<{ savedCount: number }> {
  const vlrMatches = dedupeTournamentMatches(params.matches.map((m): PersistableVlrMatch | null => {
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

  applyTbdPairCycling(vlrMatches, params.title);

  const matchUpserts = vlrMatches.map((m) => {
    const matchDate = m.matchDate ? new Date(m.matchDate) : null;
    return prisma.tournamentMatch.upsert({
      where: { matchId: m.matchId },
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
    });
  });

  const uniqueTeams = new Set<string>();
  for (const m of vlrMatches) {
    if (m.teamAName && !isPlaceholderTeam(m.teamAName)) uniqueTeams.add(m.teamAName);
    if (m.teamBName && !isPlaceholderTeam(m.teamBName)) uniqueTeams.add(m.teamBName);
  }

  const [existingParticipants, teamMappings] = await Promise.all([
    params.force
      ? Promise.resolve([])
      : prisma.tournamentParticipant.findMany({
          where: { tournamentId: params.tournamentId },
          select: { name: true, platformId: true, logoUrl: true, rawText: true },
        }),
    prisma.teamMapping.findMany({ where: { disciplineSlug: params.slug } }),
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
      return {
        tournamentId: params.tournamentId,
        name,
        platformId: existing?.platformId || mapping?.platformId || null,
        logoUrl: existing?.logoUrl || mapping?.logoUrl || null,
        rawText: existing?.rawText || null,
      };
    });

  const participantRefresh = [
    prisma.tournamentParticipant.deleteMany({ where: { tournamentId: params.tournamentId } }),
    ...(participantsToInsert.length > 0 ? [prisma.tournamentParticipant.createMany({ data: participantsToInsert })] : []),
  ];

  if (params.force) {
    await prisma.$transaction([
      prisma.tournamentMatch.deleteMany({ where: { tournamentId: params.tournamentId } }),
      ...participantRefresh,
      ...matchUpserts,
    ]);
  } else {
    await prisma.$transaction([
      ...matchUpserts,
      ...participantRefresh,
    ]);
  }

  return { savedCount: vlrMatches.length };
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
  if (input.matchPagesFailed > 0) return "PARTIAL";
  if (input.matchUrlsFound > 0 && input.savedMatchesCount === 0) return "PARTIAL";
  return "SUCCESS";
}

function normalizeSearch(value: string) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
