import { createHash } from "crypto";
import { Prisma, type ImportStatus } from "@prisma/client";
import { prisma } from "@backend/db/db";
import { getFandomLolApiUrl } from "@backend/config/env";
import {
  classifyFandomError,
  fetchFandomParsedPage,
  fetchFandomMatchScheduleCargo,
  makeFandomPageUrl,
  titleFromFandomUrl,
  type FandomParsedPage,
} from "@backend/sources/tdata/fandom/client";
import { normalizeFandomLeagueOfLegendsTournament } from "@backend/sources/tdata/fandom/leagueoflegends";
import { dedupeTournamentMatches } from "@backend/matches/dedupe";
import {
  buildMatchCandidateMetadata,
  computeMatchSetQuality,
  getMatchSourceConfidence,
  hasPlaceholderTeams,
} from "@backend/matches/quality";
import { resolveExactMatchDate } from "@backend/matches/time";
import { finalizeEsportsParsingDiagnostics } from "@backend/matches/parsingDiagnostics";
import { IMPORT_MATCH_FUTURE_WINDOW_DAYS, IMPORT_MATCH_PAST_GRACE_DAYS, titleKey } from "@backend/sources/tdata/liquipedia/importer/helpers";
import { canonicalizeMatchesWithTournamentTeams } from "@backend/sources/tdata/liquipedia/importer/helpers";
import { decideTournamentSnapshotWrite, TournamentSnapshotRejectedError } from "@backend/sources/importSafety";
import { cleanWikiValue, extractFirstTemplateByPrefix, parseTemplate } from "@backend/normalizers/wikiText";
import {
  findSourceFetchCache,
  isSourceCacheFresh,
  isSourceCacheStaleUsable,
  markSourceFetchAttempt,
  markSourceFetchFailure,
  markSourceFetchSuccess,
  SOURCE_CACHE_TTL_MS,
  type SourceFetchCacheRecord,
} from "@backend/utils/sourceFetchCache";
import { getTeamMappingLookupKeys } from "@backend/teams/canonicalize";
import { generateInternalTeamId, isPlaceholderTeam } from "@backend/teams/teams";
import { refreshTournamentMatchesPreservingState } from "@backend/sources/matchPreservation";
import { mergeTournamentParticipantManualFields, refreshTournamentParticipantsPreservingState } from "@backend/sources/participantPreservation";
import { assertTournamentImportFresh, runSerializableTournamentImport } from "@backend/sources/tournamentImportConcurrency";

type ImportFandomTournamentInput = {
  slug: string;
  disciplineId: string;
  pageId?: number;
  title: string;
  pageUrl?: string;
  force?: boolean;
};

type PendingFandomPageCacheSuccess = {
  cacheInput: {
    source: string;
    disciplineSlug: string;
    resourceType: string;
    resourceKey: string;
    mode: string;
  };
  data: {
    revisionId: number | null;
    revisionTimestamp: Date | null;
    contentHash: string;
    rawSnapshotId: string;
    externalRequests: number;
    bytesIn: number;
    cacheLayer: string;
    metadata: Prisma.InputJsonValue;
    cacheTtlMs: number;
    staleTtlMs: number;
  };
};

export async function importFandomTournament(input: ImportFandomTournamentInput) {
  if (input.slug !== "leagueoflegends") {
    throw new Error("Провайдер Fandom доступен только для League of Legends");
  }

  const title = input.title || titleFromFandomUrl(input.pageUrl || "");
  const pageUrl = input.pageUrl || makeFandomPageUrl(title);
  if (!title || title.length < 2) throw new Error("Нужен title выбранной страницы Fandom");

  const tournamentImport = await prisma.tournamentImport.create({
    data: {
      disciplineId: input.disciplineId,
      pageId: input.pageId,
      pageTitle: title,
      pageUrl,
      status: "PENDING",
    },
  });

  try {
    const page = await fetchFandomPageWithCache({
      disciplineSlug: input.slug,
      importRecordId: tournamentImport.id,
      pageId: input.pageId,
      title,
      pageUrl,
      force: input.force,
    });
    let cargoFailed = false;
    let cargoError: string | null = null;
    const cargoLookup = await fetchFandomMatchScheduleCargoCandidates(page, title).catch((error) => {
      cargoFailed = true;
      cargoError = error instanceof Error ? error.message : "Fandom Cargo недоступен";
      return { rows: [], overviewPage: null, attempted: [] };
    });
    const cargoMatches = cargoLookup.rows;

    const normalized = normalizeFandomLeagueOfLegendsTournament({
      pageId: page.pageId,
      title: page.title,
      pageUrl: page.pageUrl,
      wikitext: page.wikitext,
      parsedHtml: page.html,
      cargoMatches,
      cargoFailed,
      cargoError,
      cacheHit: page.cacheHit,
      stale: page.stale,
    });

    normalized.cacheHit = page.cacheHit;
    normalized.cacheLayer = page.cacheLayer;
    normalized.stale = page.stale;
    normalized.warning = page.warning;
    normalized.requestStats = { externalRequests: page.externalRequests };

    const sourceValidated = normalized.status === "SUCCESS" && !page.stale && !page.warning && !cargoFailed;
    if (!sourceValidated) {
      throw new TournamentSnapshotRejectedError(
        page.warning || cargoError || "Fandom returned a partial, stale, or unvalidated snapshot; last-good data was preserved.",
        page.stale ? "stale_cache" : "parse_failed",
      );
    }

    const committed = await runSerializableTournamentImport(async (tx) => {
      await assertTournamentImportFresh({
        tx,
        importRecordId: tournamentImport.id,
        disciplineSlug: input.slug,
        sourceIdentity: normalized.sourceTitle,
        sourceTitle: normalized.sourceTitle,
        sourceUrl: normalized.sourceUrl,
        lookupBy: "sourceTitle",
      });
      const tournament = await tx.tournament.upsert({
        where: {
          disciplineSlug_sourceTitle: {
            disciplineSlug: input.slug,
            sourceTitle: normalized.sourceTitle,
          },
        },
        update: {
          sourcePageId: normalized.sourcePageId,
          sourceUrl: normalized.sourceUrl,
          name: normalized.name,
          startDate: normalized.startDate,
          endDate: normalized.endDate,
          location: normalized.location,
          region: normalized.region,
          organizer: normalized.organizer,
          prizePool: normalized.prizePool,
          formatText: normalized.formatText,
          status: normalized.tournamentStatus,
          extractionStatus: normalized.status,
          normalization: buildNormalizationJson(normalized),
          lastImportId: tournamentImport.id,
        },
        create: {
          sourcePageId: normalized.sourcePageId,
          sourceTitle: normalized.sourceTitle,
          sourceUrl: normalized.sourceUrl,
          name: normalized.name,
          disciplineSlug: input.slug,
          startDate: normalized.startDate,
          endDate: normalized.endDate,
          location: normalized.location,
          region: normalized.region,
          organizer: normalized.organizer,
          prizePool: normalized.prizePool,
          formatText: normalized.formatText,
          status: normalized.tournamentStatus,
          extractionStatus: normalized.status,
          normalization: buildNormalizationJson(normalized),
          lastImportId: tournamentImport.id,
        },
      });

      const matches = await saveFandomTournamentData({
        tournamentId: tournament.id,
        slug: input.slug,
        title: normalized.sourceTitle,
        participants: normalized.participants,
        matches: normalized.matches,
        force: !!input.force,
        sourceValidated,
        client: tx,
      });
      normalized.status = resolveFandomSavedStatus(normalized.status, normalized.matches.length, matches.length);
      if (normalized.status !== "SUCCESS") {
        throw new TournamentSnapshotRejectedError(
          "Fandom produced no complete persistable match snapshot; last-good data was preserved.",
          "parse_failed",
        );
      }

      const qualityScore = computeMatchSetQuality(matches);
      normalized.leagueOfLegendsDiagnostics = finalizeEsportsParsingDiagnostics(normalized.leagueOfLegendsDiagnostics, {
        savedMatches: matches.length,
        fandom: {
          cargoFailed,
          cacheHit: page.cacheHit,
          stale: page.stale,
        },
      }) || undefined;
      await tx.tournament.update({
        where: { id: tournament.id },
        data: {
          extractionStatus: normalized.status,
          normalization: {
            ...(buildNormalizationJson(normalized) as Record<string, unknown>),
            qualityScore,
            sourceBreakdown: {
              fandom: {
                pageTitle: page.title,
                pageId: page.pageId ?? null,
                matches: matches.length,
                cargoMatches: cargoMatches.length,
                cargoOverviewPage: cargoLookup.overviewPage,
                cargoOverviewPagesTried: cargoLookup.attempted,
                cacheHit: page.cacheHit,
                cacheLayer: page.cacheLayer,
                stale: page.stale,
              },
            },
          } as Prisma.InputJsonValue,
        },
      });
      await tx.tournamentImport.update({
        where: { id: tournamentImport.id },
        data: { status: normalized.status, finishedAt: new Date() },
      });
      return { tournamentId: tournament.id, matches, qualityScore };
    });

    const { matches, qualityScore } = committed;
    await publishFandomPageCache(page.pendingCacheSuccess, qualityScore).catch(() => {});
    await updateFandomSnapshotQuality(page.rawSnapshotId, qualityScore, matches.length).catch(() => {});

    const fullTournament = await prisma.tournament.findUnique({
      where: { id: committed.tournamentId },
      include: { participants: true, matches: true, lastImport: true },
    });

    return {
      tournament: fullTournament ? { ...fullTournament, matches: dedupeTournamentMatches(fullTournament.matches) } : null,
      normalized,
      cacheHit: page.cacheHit,
      cacheLayer: page.cacheLayer,
      stale: page.stale,
      warning: page.warning,
      qualityScore,
      sourceBreakdown: {
        fandom: {
          pageTitle: page.title,
          pageId: page.pageId ?? null,
          matches: matches.length,
          cargoMatches: cargoMatches.length,
          cargoOverviewPage: cargoLookup.overviewPage,
          cargoOverviewPagesTried: cargoLookup.attempted,
          cacheHit: page.cacheHit,
          cacheLayer: page.cacheLayer,
          stale: page.stale,
        },
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось загрузить Fandom турнир";
    await prisma.tournamentImport.updateMany({
      where: { id: tournamentImport.id, status: "PENDING" },
      data: { status: "FAILED", finishedAt: new Date(), errorMessage: message },
    });
    throw error;
  }
}

export function resolveFandomSavedStatus(currentStatus: ImportStatus, normalizedMatchesCount: number, savedMatchesCount: number): ImportStatus {
  if (currentStatus !== "SUCCESS") return currentStatus;
  if (normalizedMatchesCount === 0) return "PARTIAL";
  if (normalizedMatchesCount > 0 && savedMatchesCount === 0) return "PARTIAL";
  return currentStatus;
}

async function fetchFandomMatchScheduleCargoCandidates(page: FandomParsedPage, requestedTitle: string) {
  const attempted: string[] = [];
  let lastError: unknown = null;

  for (const overviewPage of getFandomCargoOverviewCandidates(page, requestedTitle)) {
    attempted.push(overviewPage);
    try {
      const rows = await fetchFandomMatchScheduleCargo({ overviewPage });
      if (rows.length > 0) return { rows, overviewPage, attempted };
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError && attempted.length > 0) throw lastError;
  return { rows: [], overviewPage: null, attempted };
}

function getFandomCargoOverviewCandidates(page: FandomParsedPage, requestedTitle: string) {
  const candidates = new Set<string>();
  const add = (value: string | null | undefined) => {
    const cleaned = cleanWikiValue(value);
    if (cleaned && cleaned.length >= 2) candidates.add(cleaned);
  };

  add(page.title);
  add(requestedTitle);
  add(titleFromFandomUrl(page.pageUrl));

  const infobox = extractFirstTemplateByPrefix(page.wikitext, "Infobox");
  if (infobox) {
    const params = parseTemplate(infobox).params;
    add(params.name);
    add(params.tournament);
    add(params.event);
    add(params.league);
  }

  for (const value of Array.from(candidates)) {
    add(value.replace(/_/g, " "));
    add(value.replace(/^(\d{4}) Season (.+)$/i, "$1 $2"));
    add(value.replace(/^(\d{4}) (.+)$/, "$2 $1"));
  }

  return Array.from(candidates);
}

async function fetchFandomPageWithCache(params: {
  disciplineSlug: string;
  importRecordId: string;
  pageId?: number;
  title: string;
  pageUrl: string;
  force?: boolean;
}) {
  const cacheInput = {
    source: "fandom",
    disciplineSlug: params.disciplineSlug,
    resourceType: "page",
    resourceKey: titleKey(params.title),
    mode: "cache-first",
  };
  let externalRequests = 0;
  let cacheHit = false;
  let cacheLayer: string | null = null;
  let stale = false;
  let warning: string | null = null;
  let sourceCache: SourceFetchCacheRecord | null = await findSourceFetchCache(cacheInput);

  if (!params.force && sourceCache?.rawSnapshotId && isSourceCacheFresh(sourceCache)) {
    const cached = await rawSnapshotToParsedPage(sourceCache.rawSnapshotId);
    if (cached) {
      return {
        ...cached,
        rawSnapshotId: sourceCache.rawSnapshotId,
        cacheHit: true,
        cacheLayer: sourceCache.cacheLayer || "source-fetch-cache",
        stale: false,
        warning: null,
        externalRequests,
        pendingCacheSuccess: null,
      };
    }
  }

  await markSourceFetchAttempt(cacheInput);

  try {
    const page = await fetchFandomParsedPage({
      apiUrl: getFandomLolApiUrl(),
      pageId: params.pageId,
      title: params.title,
    });
    externalRequests += 1;

    const contentHash = createHash("sha1").update(`${page.wikitext}\n${page.html}`).digest("hex");
    const rawSnapshot = await prisma.rawSnapshot.create({
      data: {
        tournamentImportId: params.importRecordId,
        source: "fandom-mediawiki-api",
        disciplineSlug: params.disciplineSlug,
        pageId: page.pageId,
        pageTitle: page.title,
        contentHash,
        revisionId: page.revisionId ?? null,
        revisionTimestamp: null,
        rawJson: page.raw as Prisma.InputJsonValue,
        rawWikitext: page.wikitext,
        rawHtml: page.html,
        metadata: {
          resourceType: "page",
          resourceKey: titleKey(page.title),
          pageUrl: page.pageUrl,
          mode: "cache-first",
        } as Prisma.InputJsonValue,
      },
    });

    return {
      ...page,
      rawSnapshotId: rawSnapshot.id,
      cacheHit,
      cacheLayer: "network",
      stale,
      warning,
      externalRequests,
      pendingCacheSuccess: {
        cacheInput,
        data: {
          revisionId: rawSnapshot.revisionId,
          revisionTimestamp: null,
          contentHash,
          rawSnapshotId: rawSnapshot.id,
          externalRequests,
          bytesIn: page.wikitext.length + page.html.length,
          cacheLayer: "network",
          metadata: { title: page.title, pageId: page.pageId ?? null, pageUrl: page.pageUrl },
          cacheTtlMs: SOURCE_CACHE_TTL_MS.liquipediaImport,
          staleTtlMs: SOURCE_CACHE_TTL_MS.liquipediaStale,
        },
      } satisfies PendingFandomPageCacheSuccess,
    };
  } catch (error) {
    await markSourceFetchFailure(cacheInput, {
      errorClass: classifyFandomError(error),
      externalRequests,
    });

    sourceCache = sourceCache || await findSourceFetchCache(cacheInput);
    if (sourceCache?.rawSnapshotId && isSourceCacheStaleUsable(sourceCache)) {
      const cached = await rawSnapshotToParsedPage(sourceCache.rawSnapshotId);
      if (cached) {
        warning = `Fandom недоступен, показан последний хороший snapshot для ${params.title}.`;
        cacheHit = true;
        cacheLayer = "stale-if-error";
        stale = true;
        return {
          ...cached,
          rawSnapshotId: sourceCache.rawSnapshotId,
          cacheHit,
          cacheLayer,
          stale,
          warning,
          externalRequests,
          pendingCacheSuccess: null,
        };
      }
    }

    throw error;
  }
}

async function publishFandomPageCache(pending: PendingFandomPageCacheSuccess | null, qualityScore: number) {
  if (!pending) return;
  await markSourceFetchSuccess(pending.cacheInput, {
    ...pending.data,
    qualityScore,
  });
}

async function rawSnapshotToParsedPage(rawSnapshotId: string): Promise<FandomParsedPage | null> {
  const rawSnapshot = await prisma.rawSnapshot.findUnique({ where: { id: rawSnapshotId } });
  if (!rawSnapshot?.rawWikitext && !rawSnapshot?.rawHtml) return null;
  return {
    pageId: rawSnapshot.pageId ?? undefined,
    title: rawSnapshot.pageTitle,
    pageUrl: getSnapshotPageUrl(rawSnapshot) || makeFandomPageUrl(rawSnapshot.pageTitle),
    revisionId: rawSnapshot.revisionId,
    raw: rawSnapshot.rawJson,
    wikitext: rawSnapshot.rawWikitext || "",
    html: rawSnapshot.rawHtml || "",
  };
}

export async function saveFandomTournamentData(params: {
  tournamentId: string;
  slug: string;
  title: string;
  participants: any[];
  matches: any[];
  force: boolean;
  sourceValidated: boolean;
  client: Prisma.TransactionClient;
}): Promise<any[]> {
  const client = params.client;
  const [teamMappings, existingParticipants] = await Promise.all([
    client.teamMapping.findMany({ where: { disciplineSlug: params.slug } }),
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
  ]);
  const mappingLookup = new Map<string, (typeof teamMappings)[number]>();
  for (const mapping of teamMappings) {
    mappingLookup.set(mapping.liquipediaName.toLowerCase(), mapping);
    for (const key of getTeamMappingLookupKeys(mapping)) {
      if (key) mappingLookup.set(key.toLowerCase(), mapping);
    }
  }

  const existingParticipantLookup = new Map(
    existingParticipants.map((participant) => [participant.name.trim().toLowerCase(), participant]),
  );

  const participantsToInsert = params.participants.map((participant) => {
    const participantKey = String(participant.name || "").trim().toLowerCase();
    const mapping = mappingLookup.get(participantKey);
    const manualFields = mergeTournamentParticipantManualFields({
      incoming: participant,
      existing: existingParticipantLookup.get(participantKey),
      mapping,
    });
    return {
      tournamentId: params.tournamentId,
      name: participant.name,
      ...manualFields,
    };
  });

  const matchTeamNames = new Set<string>();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const pastLimit = new Date(today.getTime() - IMPORT_MATCH_PAST_GRACE_DAYS * 24 * 60 * 60 * 1000);
  const futureLimit = new Date(today.getTime() + IMPORT_MATCH_FUTURE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const matches = params.matches
    .map((match) => {
      const matchDate = resolveExactMatchDate(match);
      return matchDate ? { ...match, matchDate } : null;
    })
    .filter((match): match is any => Boolean(match))
    .filter((match) => {
      if (match.scoreA !== null || match.scoreB !== null) return false;
      if (/\b(finished|completed|cancelled|canceled)\b/i.test(String(match.status || ""))) return false;
      const matchDate = new Date(match.matchDate);
      return matchDate >= pastLimit && matchDate <= futureLimit;
    });

  if (!decideTournamentSnapshotWrite({
    incomingMatches: matches.length,
    sourceValidated: params.sourceValidated,
    force: params.force,
  }).allowed) {
    return [];
  }

  // Finish every fallible normalization/read before beginning the destructive
  // replacement. The participant snapshot and the match snapshot are committed
  // together so a failed upsert rolls the deletions back.
  await canonicalizeMatchesWithTournamentTeams(
    matches,
    params.tournamentId,
    params.slug,
    params.participants,
    params.client,
  );

  for (const match of matches) {
    if (match.teamAName && !isPlaceholderTeam(match.teamAName)) matchTeamNames.add(match.teamAName);
    if (match.teamBName && !isPlaceholderTeam(match.teamBName)) matchTeamNames.add(match.teamBName);
  }

  const persistedMatches = dedupeTournamentMatches(matches);
  await refreshTournamentMatchesPreservingState({
    tx: client,
    tournamentId: params.tournamentId,
    matches: persistedMatches.map((match: any) => ({
      matchId: match.matchId,
      create: {
        matchId: match.matchId,
        tournamentId: params.tournamentId,
        stage: match.stage,
        round: match.round,
        matchDate: match.matchDate,
        matchDateTime: match.matchDateTime,
        teamAId: match.teamAId || (match.teamAName ? generateInternalTeamId(match.teamAName) : null),
        teamAName: match.teamAName,
        teamBId: match.teamBId || (match.teamBName ? generateInternalTeamId(match.teamBName) : null),
        teamBName: match.teamBName,
        scoreA: null,
        scoreB: null,
        format: match.format,
        status: match.status,
        court: match.court,
        sourceUrl: match.sourceUrl,
        platformId: match.platformId ?? null,
        lpNumericalId: match.lpNumericalId,
        syncedAt: match.syncedAt ?? null,
        rawText: match.rawText,
        hasPlaceholderTeams: hasPlaceholderTeams(match),
        sourceConfidence: getMatchSourceConfidence(match),
        sourceBreakdown: buildMatchCandidateMetadata(match, "fandom") as Prisma.InputJsonValue,
      },
      update: {
        stage: match.stage,
        round: match.round,
        matchDate: match.matchDate,
        matchDateTime: match.matchDateTime,
        teamAId: match.teamAId || (match.teamAName ? generateInternalTeamId(match.teamAName) : null),
        teamAName: match.teamAName,
        teamBId: match.teamBId || (match.teamBName ? generateInternalTeamId(match.teamBName) : null),
        teamBName: match.teamBName,
        format: match.format,
        status: match.status,
        court: match.court,
        sourceUrl: match.sourceUrl,
        rawText: match.rawText,
        platformId: match.platformId ?? null,
        lpNumericalId: match.lpNumericalId ?? null,
        syncedAt: match.syncedAt ?? null,
        hasPlaceholderTeams: hasPlaceholderTeams(match),
        sourceConfidence: getMatchSourceConfidence(match),
        sourceBreakdown: buildMatchCandidateMetadata(match, "fandom") as Prisma.InputJsonValue,
      },
    })),
  });

  await refreshTournamentParticipantsPreservingState({
    tx: client,
    tournamentId: params.tournamentId,
    participants: participantsToInsert,
  });

  const existingMappingNames = new Set(teamMappings.map((mapping) => mapping.liquipediaName.toLowerCase()));
  const newMappings = [...matchTeamNames]
    .filter((name) => !existingMappingNames.has(name.toLowerCase()))
    .map((name) => ({ disciplineSlug: params.slug, liquipediaName: name }));
  if (newMappings.length > 0) {
    await client.teamMapping.createMany({ data: newMappings, skipDuplicates: true }).catch(() => {});
  }

  return persistedMatches;
}

async function updateFandomSnapshotQuality(rawSnapshotId: string | null | undefined, qualityScore: number, matchesCount: number) {
  if (!rawSnapshotId) return;
  await prisma.rawSnapshot.update({
    where: { id: rawSnapshotId },
    data: {
      qualityScore,
      metadata: {
        source: "fandom",
        matchesCount,
        qualityScore,
      } as Prisma.InputJsonValue,
    },
  });
}

function buildNormalizationJson(normalized: any) {
  return {
    warnings: normalized.warning
      ? Array.from(new Set([...(normalized.warnings || []), normalized.warning]))
      : normalized.warnings || [],
    cacheHit: !!normalized.cacheHit,
    cacheLayer: normalized.cacheLayer || null,
    stale: !!normalized.stale,
    requestStats: normalized.requestStats || null,
    ...(normalized.leagueOfLegendsDiagnostics ? { leagueOfLegendsDiagnostics: normalized.leagueOfLegendsDiagnostics } : {}),
  } as Prisma.InputJsonValue;
}

function getSnapshotPageUrl(snapshot: { metadata?: unknown }) {
  const metadata = snapshot.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const record = metadata as Record<string, unknown>;
  return typeof record.pageUrl === "string" ? record.pageUrl : null;
}
