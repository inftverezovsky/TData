import { Prisma, type ImportStatus } from "@prisma/client";
import { prisma } from "@/lib/db/db";
import { buildDota2Diagnostics, type Dota2DiagnosticIssue } from "@/lib/matches/parsingDiagnostics";
import { dedupeTournamentMatches } from "@/lib/matches/dedupe";
import { getBestOfLabel } from "@/lib/matches/format";
import { resolveExactMatchDate } from "@/lib/matches/time";
import { applyTbdPairCycling } from "@/lib/matches/tbdCycling";
import { classifyParserError } from "@/lib/proxy/parserErrors";
import { runDltv } from "@/lib/dltv/queue";
import type { DltvMatch, DltvRunResult } from "@/lib/dltv/types";
import { getTeamMappingLookupKeys } from "@/lib/teams/canonicalize";
import { generateInternalTeamId, isPlaceholderTeam } from "@/lib/teams/teams";

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

  let dltvData: DltvRunResult = { ok: false };
  try {
    dltvData = await runDltv("event", input.pageUrl, { noCache: !!input.force });
  } catch (err) {
    dltvData = {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown DLTV scraper error",
      errorClass: classifyParserError({ message: err instanceof Error ? err.message : String(err) }),
    };
  }

  let savedMatchesCount = 0;
  if (dltvData.ok && dltvData.matches) {
    const saveResult = await saveDltvTournamentMatches({
      tournamentId: tournament.id,
      slug: input.slug,
      title: input.title,
      matches: dltvData.matches,
      participants: dltvData.event?.participants || [],
      force: !!input.force,
    });
    savedMatchesCount = saveResult.savedCount;

    if (dltvData.event) {
      await prisma.tournament.update({
        where: { id: tournament.id },
        data: {
          name: dltvData.event.title || input.title,
          startDate: parseDltvRangeDate(dltvData.event.dates, "start"),
          endDate: parseDltvRangeDate(dltvData.event.dates, "end"),
          location: dltvData.event.location,
          prizePool: dltvData.event.prizePool,
          formatText: dltvData.event.formatText,
          status: dltvData.event.status || "ongoing",
        },
      });
    }
  }

  const matchUrlsFound = dltvData.event?.matchUrls.length ?? dltvData.matches?.length ?? 0;
  const matchPagesFailed = dltvData.matchPageFailures?.length ?? (dltvData.ok ? 0 : 1);
  const normalizedStatus = resolveDltvImportStatus({
    ok: !!dltvData.ok,
    matchUrlsFound,
    matchPagesFailed,
    savedMatchesCount,
  });
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

  await prisma.tournament.update({
    where: { id: tournament.id },
    data: {
      extractionStatus: normalizedStatus,
      normalization: {
        warnings: [dltvData.warning, dltvData.error].filter((item): item is string => typeof item === "string" && item.length > 0),
        cacheHit: !!dltvData.cacheHit,
        stale: !!dltvData.stale,
        dota2Diagnostics: diagnostics,
      } as Prisma.InputJsonValue,
    },
  }).catch(() => {});

  const fullTournament = await prisma.tournament.findUnique({
    where: { id: tournament.id },
    include: { participants: true, matches: true, lastImport: true },
  });

  return {
    tournament: fullTournament ? { ...fullTournament, matches: dedupeTournamentMatches(fullTournament.matches) } : null,
    normalized: { status: normalizedStatus, error: dltvData?.error },
  };
}

async function saveDltvTournamentMatches(params: {
  tournamentId: string;
  slug: string;
  title: string;
  matches: DltvMatch[];
  participants: Array<{ name: string; url?: string }>;
  force: boolean;
}): Promise<{ savedCount: number }> {
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

  const matchUpserts = dltvMatches.map((m) => {
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
    });
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
  return issues;
}

export function resolveDltvImportStatus(input: {
  ok: boolean;
  matchUrlsFound: number;
  matchPagesFailed: number;
  savedMatchesCount: number;
}): ImportStatus {
  if (!input.ok) return "PARTIAL";
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
