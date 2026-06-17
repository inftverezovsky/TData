import { prisma } from "@backend/db/db";
import { dedupeTournamentMatches } from "@backend/matches/dedupe";
import { getBestOfLabel } from "@backend/matches/format";
import { resolveExactMatchDate } from "@backend/matches/time";
import { applyTbdPairCycling } from "@backend/matches/tbdCycling";
import { classifyParserError } from "@backend/proxy/parserErrors";
import { getTeamMappingLookupKeys } from "@backend/teams/canonicalize";
import { generateInternalTeamId, isPlaceholderTeam } from "@backend/teams/teams";
import { runHltvScript } from "@backend/sources/tdata/hltv/scraper";

type ImportHltvTournamentInput = {
  slug: string;
  title: string;
  pageUrl: string;
  force?: boolean;
};

type HltvData = { ok?: boolean; error?: string; errorClass?: string; matches?: any[] };

export async function importHltvTournament(input: ImportHltvTournamentInput) {
  if (input.slug !== "counterstrike") {
    throw new Error("Провайдер HLTV доступен только для Counter-Strike");
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

  const hltvEventId = extractHltvEventId(input.pageUrl);
  let hltvData: HltvData = { ok: false };

  if (hltvEventId) {
    hltvData = await runHltvScript("event", hltvEventId, { noCache: !!input.force }).catch((err: unknown) => ({
      ok: false,
      error: err instanceof Error ? err.message : "Unknown HLTV scraper error",
      errorClass: classifyParserError({ message: err instanceof Error ? err.message : String(err) }),
    }));

    if (hltvData.ok && hltvData.matches) {
      await saveHltvTournamentMatches({
        tournamentId: tournament.id,
        slug: input.slug,
        title: input.title,
        matches: hltvData.matches,
        force: !!input.force,
      });
    }
  } else {
    hltvData = { ok: false, error: "Не удалось определить HLTV event id из URL" };
  }

  const fullTournament = await prisma.tournament.findUnique({
    where: { id: tournament.id },
    include: { participants: true, matches: true, lastImport: true },
  });

  return {
    tournament: fullTournament ? { ...fullTournament, matches: dedupeTournamentMatches(fullTournament.matches) } : null,
    normalized: { status: hltvData?.ok ? "SUCCESS" : "PARTIAL", error: hltvData?.error },
  };
}

function extractHltvEventId(pageUrl: string) {
  const idMatch = pageUrl.match(/\/events\/(\d+)\//);
  if (idMatch) return idMatch[1];

  const parts = pageUrl.split("/");
  const eventIdx = parts.indexOf("events");
  return eventIdx !== -1 && parts[eventIdx + 1] ? parts[eventIdx + 1] : "";
}

async function saveHltvTournamentMatches(params: {
  tournamentId: string;
  slug: string;
  title: string;
  matches: any[];
  force: boolean;
}) {
  const hltvMatches = dedupeTournamentMatches(params.matches.map((m: any) => {
    const hasPlaceholderTeams = isPlaceholderTeam(m.team1) || isPlaceholderTeam(m.team2);
    const teamAId = isPlaceholderTeam(m.team1) ? "tbd" : generateInternalTeamId(m.team1);
    const teamBId = isPlaceholderTeam(m.team2) ? "tbd" : generateInternalTeamId(m.team2);
    const format = getBestOfLabel(m.format || m.matchFormat || m.bestOf || m.rawText);
    const sourceUrl = `https://www.hltv.org/matches/${m.id}/match`;
    const candidate = {
      ...m,
      matchDate: m.unix_time ? new Date(m.unix_time * 1000) : null,
      sourceUrl,
    };
    const matchDate = resolveExactMatchDate(candidate);
    return {
      ...m,
      matchId: `hltv-${m.id}`,
      teamAName: m.team1,
      teamBName: m.team2,
      teamAId,
      teamBId,
      hasPlaceholderTeams,
      matchDate,
      format,
      stage: cleanOptionalText(m.stage),
      round: cleanOptionalText(m.round),
      rawText: cleanOptionalText(m.rawText),
      sourceUrl,
    };
  }).filter((m: any) => m.matchDate));

  const knownFormats = Array.from(new Set(hltvMatches.map((m: any) => m.format).filter(Boolean)));
  const eventWideFormat = knownFormats.length === 1 ? knownFormats[0] : null;
  if (eventWideFormat) {
    for (const match of hltvMatches) {
      if (!match.format) match.format = eventWideFormat;
    }
  }

  applyTbdPairCycling(hltvMatches, params.title);

  const matchUpserts = hltvMatches.map((m: any) => {
    const matchDate = m.matchDate ? new Date(m.matchDate) : null;
    return prisma.tournamentMatch.upsert({
      where: { matchId: m.matchId },
      create: {
        matchId: m.matchId,
        tournamentId: params.tournamentId,
        teamAName: m.teamAName,
        teamBName: m.teamBName,
        teamAId: m.teamAId,
        teamBId: m.teamBId,
        hasPlaceholderTeams: m.hasPlaceholderTeams,
        matchDate,
        format: m.format,
        stage: m.stage,
        round: m.round,
        rawText: m.rawText,
        sourceUrl: m.sourceUrl,
        status: "upcoming",
      },
      update: {
        teamAName: m.teamAName,
        teamBName: m.teamBName,
        teamAId: m.teamAId,
        teamBId: m.teamBId,
        hasPlaceholderTeams: m.hasPlaceholderTeams,
        matchDate,
        stage: m.stage,
        round: m.round,
        rawText: m.rawText,
        sourceUrl: m.sourceUrl,
        ...(m.format ? { format: m.format } : {}),
      },
    });
  });

  const uniqueTeams = new Set<string>();
  for (const m of hltvMatches) {
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
    prisma.teamMapping.findMany({
      where: { disciplineSlug: params.slug },
    }),
  ]);

  const existingParticipantMap = new Map(existingParticipants.map((p) => [p.name.toLowerCase(), p]));
  const mappingLookup = new Map<string, (typeof teamMappings)[number]>();
  for (const mapping of teamMappings) {
    mappingLookup.set(mapping.liquipediaName.toLowerCase(), mapping);
  }
  for (const mapping of teamMappings) {
    for (const key of getTeamMappingLookupKeys(mapping)) {
      if (key && !mappingLookup.has(key.toLowerCase())) {
        mappingLookup.set(key.toLowerCase(), mapping);
      }
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
    ...(participantsToInsert.length > 0
      ? [prisma.tournamentParticipant.createMany({ data: participantsToInsert })]
      : []),
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

function cleanOptionalText(value: unknown) {
  const text = String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}
