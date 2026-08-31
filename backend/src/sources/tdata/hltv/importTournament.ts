import type { Prisma } from "@prisma/client";
import { prisma } from "@backend/db/db";
import { dedupeTournamentMatches } from "@backend/matches/dedupe";
import { getBestOfLabel } from "@backend/matches/format";
import { resolveExactMatchDate } from "@backend/matches/time";
import { applyTbdPairCycling } from "@backend/matches/tbdCycling";
import { classifyParserError } from "@backend/proxy/parserErrors";
import { getTeamMappingLookupKeys } from "@backend/teams/canonicalize";
import { generateInternalTeamId, isPlaceholderTeam } from "@backend/teams/teams";
import { runHltvScript } from "@backend/sources/tdata/hltv/scraper";
import { decideTournamentSnapshotWrite, TournamentSnapshotRejectedError } from "@backend/sources/importSafety";
import { refreshTournamentMatchesPreservingState } from "@backend/sources/matchPreservation";
import { mergeTournamentParticipantManualFields, refreshTournamentParticipantsPreservingState } from "@backend/sources/participantPreservation";
import { assertTournamentImportFresh, runSerializableTournamentImport } from "@backend/sources/tournamentImportConcurrency";

type ImportHltvTournamentInput = {
  slug: string;
  title: string;
  pageUrl: string;
  force?: boolean;
};

export type HltvEmptyState = "no_upcoming_matches" | "event_cancelled" | "event_deleted";

type HltvData = {
  ok?: boolean;
  error?: string;
  errorClass?: string;
  matches?: any[];
  validEmpty?: boolean;
  emptyState?: HltvEmptyState | null;
  stale?: boolean;
};

export async function importHltvTournament(input: ImportHltvTournamentInput) {
  if (input.slug !== "counterstrike") {
    throw new Error("Провайдер HLTV доступен только для Counter-Strike");
  }

  const canonicalPageUrl = normalizeHltvEventUrl(input.pageUrl);
  const canonicalTitle = normalizeHltvTournamentTitle(input.title);
  const discipline = await prisma.discipline.findUnique({ where: { slug: input.slug }, select: { id: true } });
  if (!discipline) throw new Error("Дисциплина Counter-Strike не найдена");
  const importRecord = await prisma.tournamentImport.create({
    data: {
      disciplineId: discipline.id,
      pageTitle: canonicalTitle,
      pageUrl: canonicalPageUrl,
      status: "PENDING",
    },
  });

  try {
    return await runHltvTournamentImport({ ...input, title: canonicalTitle, pageUrl: canonicalPageUrl }, importRecord.id);
  } catch (error) {
    await prisma.tournamentImport.updateMany({
      where: { id: importRecord.id, status: "PENDING" },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : "Не удалось загрузить HLTV турнир",
      },
    }).catch(() => {});
    throw error;
  }
}

async function runHltvTournamentImport(input: ImportHltvTournamentInput, importRecordId: string) {

  const canonicalPageUrl = normalizeHltvEventUrl(input.pageUrl);
  const canonicalTitle = normalizeHltvTournamentTitle(input.title);
  const hltvEventId = extractHltvEventId(canonicalPageUrl);
  const sourcePageId = parseHltvSourcePageId(hltvEventId);
  let hltvData: HltvData = { ok: false };

  if (hltvEventId) {
    hltvData = await runHltvScript("event", canonicalPageUrl, { noCache: !!input.force }).catch((err: unknown) => {
      const typed = err as Error & { errorClass?: string };
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown HLTV scraper error",
        errorClass: typed?.errorClass || classifyParserError({ message: err instanceof Error ? err.message : String(err) }),
      };
    });

  } else {
    hltvData = { ok: false, error: "Не удалось определить HLTV event id из URL" };
  }

  const matchesCount = countSaveableHltvMatches(hltvData.matches || []);
  let tournament = await findExistingHltvTournament(
    input.slug,
    canonicalTitle,
    input.title,
    canonicalPageUrl,
    sourcePageId,
  );
  const [persistedMatchesCount, persistedParticipantsCount] = tournament
    ? await Promise.all([
        prisma.tournamentMatch.count({ where: { tournamentId: tournament.id } }),
        prisma.tournamentParticipant.count({ where: { tournamentId: tournament.id } }),
      ])
    : [0, 0];
  const canReplaceExisting = shouldReplaceHltvMatchesOnImport({
    ok: !!hltvData.ok,
    matchesCount,
    validEmpty: !!hltvData.validEmpty,
    emptyState: hltvData.emptyState,
    persistedMatchesCount: persistedMatchesCount + persistedParticipantsCount,
    stale: !!hltvData.stale,
  });

  if (hltvData.ok && !canReplaceExisting) {
    hltvData = {
      ...hltvData,
      ok: false,
      errorClass: hltvData.errorClass || "parse_failed",
      error: hltvData.error || "HLTV returned an unexplained empty or stale event result; last-good data was preserved.",
    };
  }

  if (!canReplaceExisting) {
    throw new TournamentSnapshotRejectedError(
      hltvData.error || "HLTV did not return a validated fresh event snapshot; last-good data was preserved.",
      hltvData.errorClass || "parse_failed",
    );
  }

  if (canReplaceExisting) {
    const existingTournament = tournament;
    tournament = await runSerializableTournamentImport(async (tx) => {
      const freshness = await assertTournamentImportFresh({
        tx,
        importRecordId,
        disciplineSlug: input.slug,
        sourceIdentity: canonicalPageUrl,
        tournamentId: existingTournament?.id,
        sourceTitle: canonicalTitle,
        sourceUrl: canonicalPageUrl,
        lookupBy: "sourceUrl",
      });
      const currentTournament = freshness.tournamentId
        ? await tx.tournament.findUnique({ where: { id: freshness.tournamentId } })
        : null;
      if (
        currentTournament
        && matchesCount === 0
        && hltvData.validEmpty
        && !isAuthoritativeHltvEmptyState(hltvData.emptyState)
      ) {
        const [currentPersistedMatchesCount, currentPersistedParticipantsCount] = await Promise.all([
          tx.tournamentMatch.count({ where: { tournamentId: currentTournament.id } }),
          tx.tournamentParticipant.count({ where: { tournamentId: currentTournament.id } }),
        ]);
        if (currentPersistedMatchesCount + currentPersistedParticipantsCount > 0) {
          throw new TournamentSnapshotRejectedError(
            "HLTV returned only a generic empty schedule while persisted tournament data exists; last-good data was preserved.",
            "parse_failed",
          );
        }
      }

      const target = currentTournament
        ? await tx.tournament.update({
            where: { id: currentTournament.id },
            data: {
              name: canonicalTitle,
              sourceTitle: canonicalTitle,
              sourceUrl: canonicalPageUrl,
              sourcePageId,
              extractionStatus: "PARTIAL",
              lastImportId: importRecordId,
              updatedAt: new Date(),
            },
          })
        : await tx.tournament.create({
            data: {
              name: canonicalTitle,
              sourceTitle: canonicalTitle,
              sourceUrl: canonicalPageUrl,
              sourcePageId,
              disciplineSlug: input.slug,
              status: "ongoing",
              extractionStatus: "PARTIAL",
              lastImportId: importRecordId,
            },
          });

      await saveHltvTournamentMatches({
        tournamentId: target.id,
        slug: input.slug,
        title: canonicalTitle,
        matches: hltvData.matches || [],
        force: !!input.force || matchesCount === 0,
        client: tx,
        preserveExistingParticipants: true,
      });

      const committed = await tx.tournament.update({
        where: { id: target.id },
        data: { extractionStatus: "SUCCESS", updatedAt: new Date() },
      });
      await tx.tournamentImport.update({
        where: { id: importRecordId },
        data: { status: "SUCCESS", finishedAt: new Date() },
      });
      return committed;
    });
  }

  const fullTournament = tournament
    ? await prisma.tournament.findUnique({
        where: { id: tournament.id },
        include: { participants: true, matches: true, lastImport: true },
      })
    : null;

  return {
    tournament: fullTournament ? { ...fullTournament, matches: dedupeTournamentMatches(fullTournament.matches) } : null,
    normalized: { status: canReplaceExisting ? "SUCCESS" : "PARTIAL", error: hltvData?.error },
  };
}

export function extractHltvEventId(pageUrl: string) {
  const idMatch = pageUrl.match(/\/events\/(\d+)\//);
  if (idMatch) return idMatch[1];

  const parts = pageUrl.split("/");
  const eventIdx = parts.indexOf("events");
  return eventIdx !== -1 && parts[eventIdx + 1] ? parts[eventIdx + 1] : "";
}

export function parseHltvSourcePageId(eventId: string) {
  if (!/^\d+$/.test(eventId)) return null;
  const parsed = Number(eventId);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 2_147_483_647 ? parsed : null;
}

export function normalizeHltvEventUrl(value: string) {
  let url: URL;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("Invalid HLTV event URL");
  }
  if (
    url.protocol !== "https:"
    || !["hltv.org", "www.hltv.org"].includes(url.hostname.toLowerCase())
    || url.port !== ""
    || url.username !== ""
    || url.password !== ""
    || !/^\/events\/[1-9]\d{0,15}(?:\/[^/?#]+)?\/?$/iu.test(url.pathname)
  ) {
    throw new Error("Invalid HLTV event URL");
  }
  url.hostname = "www.hltv.org";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function normalizeHltvTournamentTitle(value: string) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b((?:19|20)\d{2})LAN$/i, "$1")
    .trim();
}

export function shouldReplaceHltvMatchesOnImport(input: {
  ok: boolean;
  matchesCount: number;
  validEmpty: boolean;
  emptyState?: HltvEmptyState | null;
  persistedMatchesCount?: number;
  stale?: boolean;
}) {
  const authoritativeEmpty = input.validEmpty && isAuthoritativeHltvEmptyState(input.emptyState);
  const safeEmptyTarget = input.validEmpty && (input.persistedMatchesCount ?? 0) === 0;
  return decideTournamentSnapshotWrite({
    incomingMatches: input.matchesCount,
    sourceValidated: input.ok && !input.stale,
    explicitAuthoritativeEmpty: authoritativeEmpty || safeEmptyTarget,
  }).allowed;
}

function isAuthoritativeHltvEmptyState(value: HltvEmptyState | null | undefined) {
  return value === "event_cancelled" || value === "event_deleted";
}

export function countSaveableHltvMatches(matches: any[]) {
  return dedupeTournamentMatches(matches.map((match: any) => {
    const sourceUrl = `https://www.hltv.org/matches/${match.id}/match`;
    const matchDate = resolveExactMatchDate({
      ...match,
      matchDate: match.unix_time ? new Date(match.unix_time * 1000) : null,
      sourceUrl,
    });
    return { ...match, matchDate, sourceUrl };
  }).filter((match: any) => match.matchDate)).length;
}

type HltvTournamentLookupClient = Pick<Prisma.TransactionClient, "tournament">;

export async function findExistingHltvTournament(
  disciplineSlug: string,
  canonicalTitle: string,
  originalTitle: string,
  sourceUrl: string,
  sourcePageId: number | null,
  client: HltvTournamentLookupClient = prisma,
) {
  if (sourcePageId !== null) {
    const byEventId = await client.tournament.findFirst({
      where: {
        disciplineSlug,
        sourcePageId,
        OR: [
          { sourceUrl: { startsWith: "https://www.hltv.org/events/" } },
          { sourceUrl: { startsWith: "https://hltv.org/events/" } },
        ],
      },
      orderBy: { updatedAt: "desc" },
    });
    if (byEventId) return byEventId;
  }

  const bySourceUrl = await client.tournament.findFirst({
    where: { disciplineSlug, sourceUrl },
    orderBy: { updatedAt: "desc" },
  });
  if (bySourceUrl) return bySourceUrl;

  const byCanonicalTitle = await client.tournament.findFirst({
    where: {
      disciplineSlug,
      sourceTitle: canonicalTitle,
      OR: [
        { sourceUrl: { startsWith: "https://www.hltv.org/events/" } },
        { sourceUrl: { startsWith: "https://hltv.org/events/" } },
        { sourceUrl: "" },
      ],
    },
    orderBy: { updatedAt: "desc" },
  });
  if (byCanonicalTitle) return byCanonicalTitle;

  if (originalTitle !== canonicalTitle) {
    return client.tournament.findFirst({
      where: {
        disciplineSlug,
        sourceTitle: originalTitle,
        OR: [
          { sourceUrl: { startsWith: "https://www.hltv.org/events/" } },
          { sourceUrl: { startsWith: "https://hltv.org/events/" } },
          { sourceUrl: "" },
        ],
      },
      orderBy: { updatedAt: "desc" },
    });
  }
  return null;
}

export async function saveHltvTournamentMatches(params: {
  tournamentId: string;
  slug: string;
  title: string;
  matches: any[];
  force: boolean;
  client: Prisma.TransactionClient;
  preserveExistingParticipants?: boolean;
}): Promise<{ savedCount: number }> {
  const client = params.client;
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

  const matchRows = hltvMatches.map((m: any) => {
    const matchDate = m.matchDate ? new Date(m.matchDate) : null;
    return {
      matchId: m.matchId,
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
    };
  });

  const uniqueTeams = new Set<string>();
  for (const m of hltvMatches) {
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
    client.teamMapping.findMany({
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

  return { savedCount: hltvMatches.length };
}

function cleanOptionalText(value: unknown) {
  const text = String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}
