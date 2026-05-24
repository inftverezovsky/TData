import { prisma } from "@/lib/db/db";
import { dedupeTournamentMatches } from "@/lib/matches/dedupe";
import { getBestOfLabel } from "@/lib/matches/format";
import { resolveExactMatchDate } from "@/lib/matches/time";
import { applyTbdPairCycling } from "@/lib/matches/tbdCycling";
import { classifyParserError } from "@/lib/proxy/parserErrors";
import { getTeamMappingLookupKeys } from "@/lib/teams/canonicalize";
import { generateInternalTeamId, isPlaceholderTeam } from "@/lib/teams/teams";
import { getVlrEventId, runVlrScraper } from "@/lib/vlr/scraper";

type ImportVlrTournamentInput = {
  slug: string;
  title: string;
  pageUrl: string;
  force?: boolean;
};

type VlrData = { ok?: boolean; error?: string; errorClass?: string | null; matches?: any[]; title?: string };

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
        matches: (data.matches || []).filter((match: any) => normalizeSearch(match.tournament).includes(query) || query.includes(normalizeSearch(match.tournament))),
      };
    }
  } catch (err) {
    vlrData = {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown VLR scraper error",
      errorClass: classifyParserError({ message: err instanceof Error ? err.message : String(err) }),
    };
  }

  if (vlrData.ok && vlrData.matches) {
    await saveVlrTournamentMatches({
      tournamentId: tournament.id,
      slug: input.slug,
      title: input.title,
      matches: vlrData.matches,
      force: !!input.force,
    });
  }

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
  matches: any[];
  force: boolean;
}) {
  const vlrMatches = dedupeTournamentMatches(params.matches.map((m: any) => {
    const hasPlaceholderTeams = isPlaceholderTeam(m.team1) || isPlaceholderTeam(m.team2);
    const teamAId = isPlaceholderTeam(m.team1) ? "tbd" : generateInternalTeamId(m.team1);
    const teamBId = isPlaceholderTeam(m.team2) ? "tbd" : generateInternalTeamId(m.team2);
    const format = getBestOfLabel(m.format || m.matchFormat || m.bestOf || m.rawText);
    const sourceUrl = m.url || `https://www.vlr.gg/${m.id}/match`;
    const candidate = {
      ...m,
      matchDate: m.unix_time ? new Date(Number(m.unix_time) * 1000) : null,
      matchDateTime: m.utcTimestamp ? `data-utc-ts="${m.utcTimestamp}"` : null,
      sourceUrl,
    };
    const matchDate = resolveExactMatchDate(candidate);
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
    };
  }).filter((m: any) => m.matchDate));

  applyTbdPairCycling(vlrMatches, params.title);

  const matchUpserts = vlrMatches.map((m: any) => {
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
}

function normalizeSearch(value: string) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
