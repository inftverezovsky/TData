import { Prisma } from "@prisma/client";
import { prisma } from "@backend/db/db";
import { logApiError } from "@backend/http/apiResponse";
import { finalizeDota2Diagnostics, finalizeEsportsParsingDiagnostics } from "@backend/matches/parsingDiagnostics";
import {
  fetchPageWikitext,
  fetchPageParsed,
  fetchPageRevision,
  getLiquipediaImportRequestOptions,
} from "@backend/sources/tdata/liquipedia/client";
import { shouldFetchParsedHtmlForDiscipline } from "@backend/config/env";
import { isPlaceholderTeam } from "@backend/teams/teams";
import {
  hasPlaceholderTeams,
  getMatchSourceConfidence,
  buildMatchCandidateMetadata,
  computeMatchSetQuality,
} from "@backend/matches/quality";
import { resolveDisplayMatchDate, resolveExactMatchDate } from "@backend/matches/time";
import {
  findSourceFetchCache,
  isSourceCacheFresh,
  markSourceFetchAttempt,
  markSourceFetchSuccess,
  markSourceFetchFailure,
  isSourceCacheStaleUsable,
  SOURCE_CACHE_TTL_MS,
  buildSourceFetchCacheKey,
  normalizeSourceFetchCacheKey,
  SourceFetchCacheKey,
  SourceFetchCacheRecord,
} from "@backend/utils/sourceFetchCache";
import {
  buildTeamNameCanonicalizer,
  canonicalizeMatchTeams,
  canonicalizeParticipants,
  getTeamMappingLookupKeys,
} from "@backend/teams/canonicalize";
import { createHash } from "crypto";
import {
  titleKey,
  extractRevisionId,
  extractRevisionTimestamp,
  isPlainObject,
  isFinishedMatchStatus,
  IMPORT_MATCH_PAST_GRACE_DAYS,
  IMPORT_MATCH_FUTURE_WINDOW_DAYS,
} from "./helpers";

export type LiquipediaSourceFetchPublication = {
  input: SourceFetchCacheKey;
  data: Parameters<typeof markSourceFetchSuccess>[1];
};

export async function publishLiquipediaSourceFetchSuccess(publication: LiquipediaSourceFetchPublication) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const key = normalizeSourceFetchCacheKey(publication.input);
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${buildSourceFetchCacheKey(publication.input)}))`;
        const current = await (tx as any).sourceFetchCache.findUnique({
          where: { source_disciplineSlug_resourceType_resourceKey_mode: key },
        });
        const [candidateSnapshot, currentSnapshot] = await Promise.all([
          publication.data.rawSnapshotId
            ? tx.rawSnapshot.findUnique({
              where: { id: publication.data.rawSnapshotId },
              select: { id: true, fetchedAt: true },
            })
            : null,
          current?.rawSnapshotId
            ? tx.rawSnapshot.findUnique({
              where: { id: current.rawSnapshotId },
              select: { id: true, fetchedAt: true },
            })
            : null,
        ]);

        if (shouldSkipLiquipediaSourceFetchPublication({
          candidateRawSnapshotId: publication.data.rawSnapshotId ?? null,
          candidateRevisionId: publication.data.revisionId ?? null,
          candidateRevisionTimestamp: publication.data.revisionTimestamp ?? null,
          candidateFetchedAt: candidateSnapshot?.fetchedAt ?? null,
          currentRawSnapshotId: current?.rawSnapshotId ?? null,
          currentRevisionId: current?.revisionId ?? null,
          currentRevisionTimestamp: current?.revisionTimestamp ?? null,
          currentFetchedAt: currentSnapshot?.fetchedAt ?? null,
        })) {
          return current;
        }
        return markSourceFetchSuccess(publication.input, publication.data, tx);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
      if (!retryable || attempt === 3) throw error;
    }
  }
}

export function shouldSkipLiquipediaSourceFetchPublication(input: {
  candidateRawSnapshotId: string | null;
  candidateRevisionId: number | null;
  candidateRevisionTimestamp: Date | null;
  candidateFetchedAt: Date | null;
  currentRawSnapshotId: string | null;
  currentRevisionId: number | null;
  currentRevisionTimestamp: Date | null;
  currentFetchedAt: Date | null;
}) {
  if (!input.currentRawSnapshotId || input.currentRawSnapshotId === input.candidateRawSnapshotId) return false;
  const candidateRevisionId = validRevisionId(input.candidateRevisionId);
  const currentRevisionId = validRevisionId(input.currentRevisionId);
  if (currentRevisionId !== null) {
    if (candidateRevisionId === null) return true;
    if (currentRevisionId !== candidateRevisionId) return currentRevisionId > candidateRevisionId;
  }
  const candidateRevision = input.candidateRevisionTimestamp?.getTime() ?? null;
  const currentRevision = input.currentRevisionTimestamp?.getTime() ?? null;
  if (candidateRevision !== null && currentRevision !== null && currentRevision !== candidateRevision) {
    return currentRevision > candidateRevision;
  }
  const candidateFetchedAt = input.candidateFetchedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const currentFetchedAt = input.currentFetchedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  return currentFetchedAt > candidateFetchedAt;
}

function validRevisionId(value: number | null) {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}
import { canonicalizeLiquipediaSourceUrl } from "./snapshotSafety";
import { mergeTournamentParticipantManualFields } from "@backend/sources/participantPreservation";

/**
 * Прочитать кэш или источник → нормализовать страницу → вернуть кандидатов и отложенную публикацию кэша.
 * Бизнес-данные записывает только recursive после общей проверки страниц в одной транзакции.
 */
export async function processSinglePage(params: {
  disciplineId: string;
  disciplineSlug: string;
  apiUrl: string;
  pageId?: number;
  title: string;
  pageUrl: string;
  normalizer: any;
  importRecordId: string;
  tournamentId?: string;
  force?: boolean;
  clearMatches?: boolean;
  deferBusinessWrites: true;
}) {
  const {
    disciplineSlug,
    apiUrl,
    pageId,
    title,
    pageUrl,
    normalizer,
    importRecordId,
    tournamentId,
    force,
    clearMatches = true,
    deferBusinessWrites,
  } = params;

  if (deferBusinessWrites !== true) {
    throw new Error("Liquipedia singlePage direct business writes are disabled; use the recursive atomic importer");
  }

  try {
    let wikitext = "";
    let pageTitle = title;
    let rawJson: any = {};
    let parsedHtml: string | undefined;
    let currentPageId: number | undefined = pageId;
    let currentPageUrl = pageUrl;
    let rawSnapshot: any | null = null;
    let cacheHit = false;
    let cacheLayer: string | null = null;
    let stale = false;
    let warning: string | null = null;
    let sourceFetchPublicationNeeded = false;
    let externalRequests = 0;
    const requestOptions = getLiquipediaImportRequestOptions();
    const shouldFetchParsedHtml = shouldFetchParsedHtmlForDiscipline(disciplineSlug);

    const fetchParsedHtml = async (targetTitle: string) => {
      try {
        const html = await fetchPageParsed(apiUrl, targetTitle, requestOptions);
        externalRequests += 1;
        return html;
      } catch (parseError) {
        const parseWarning = `Parsed HTML недоступен для ${targetTitle}.`;
        warning = warning ? `${warning}; ${parseWarning}` : parseWarning;
        logApiError("[Importer] Liquipedia parsed HTML unavailable", parseError);
        return undefined;
      }
    };

    const cacheInput = {
      source: "liquipedia",
      disciplineSlug,
      resourceType: "page",
      resourceKey: titleKey(title),
      mode: "cache-first",
    };

    let sourceCache: SourceFetchCacheRecord | null = !force
      ? await findSourceFetchCache(cacheInput)
      : null;

    if (!force && sourceCache?.rawSnapshotId && isSourceCacheFresh(sourceCache)) {
      rawSnapshot = await prisma.rawSnapshot.findUnique({ where: { id: sourceCache.rawSnapshotId } });
      if (rawSnapshot?.rawWikitext) {
        cacheHit = true;
        cacheLayer = sourceCache.cacheLayer || "source-fetch-cache";
      } else {
        rawSnapshot = null;
      }
    }

    if (!force && !rawSnapshot) {
      const cacheThreshold = new Date(Date.now() - SOURCE_CACHE_TTL_MS.liquipediaImport);
      rawSnapshot = await prisma.rawSnapshot.findFirst({
        where: {
          pageTitle: title,
          OR: [
            { disciplineSlug },
            { disciplineSlug: null }
          ],
          fetchedAt: { gte: cacheThreshold }
        },
        orderBy: { fetchedAt: "desc" }
      });
      if (rawSnapshot?.rawWikitext) {
        cacheHit = true;
        cacheLayer = "raw-snapshot";
        sourceFetchPublicationNeeded = true;
      } else {
        rawSnapshot = null;
      }
    }

    if (!force && !rawSnapshot && sourceCache?.rawSnapshotId) {
      try {
        const revision = await fetchPageRevision(apiUrl, disciplineSlug, { pageId, title }, requestOptions);
        externalRequests += 1;
        const revisionUnchanged = Boolean(revision.revisionId && sourceCache.revisionId === revision.revisionId);
        if (revisionUnchanged) {
          const revisionSnapshot = await prisma.rawSnapshot.findUnique({ where: { id: sourceCache.rawSnapshotId } });
          if (revisionSnapshot?.rawWikitext) {
            rawSnapshot = revisionSnapshot;
            cacheHit = true;
            cacheLayer = "revision-cache";
            sourceFetchPublicationNeeded = true;
          }
        }
      } catch (revisionError) {
        warning = `Не удалось проверить revision для ${title}.`;
        logApiError("[Importer] Liquipedia revision check failed", revisionError);
        await markSourceFetchFailure(cacheInput, {
          errorClass: "revision_check_failed",
          externalRequests,
        });
      }
    }

    if (rawSnapshot?.rawWikitext) {
      console.log(`[Importer] Using ${cacheLayer || "cached"} data for ${title}`);
      wikitext = rawSnapshot.rawWikitext;
      pageTitle = rawSnapshot.pageTitle;
      rawJson = rawSnapshot.rawJson;
      parsedHtml = rawSnapshot.rawHtml || undefined;
      currentPageId = rawSnapshot.pageId ?? pageId;
      currentPageUrl = getSnapshotPageUrl(rawSnapshot) || currentPageUrl;
      if (shouldFetchParsedHtml && !parsedHtml) {
        parsedHtml = await fetchParsedHtml(pageTitle);
      }
    } else {
      console.log(`[Importer] Fetching data for ${title}`);
      await markSourceFetchAttempt(cacheInput);

      try {
        const page = await fetchPageWikitext(apiUrl, disciplineSlug, { pageId, title }, requestOptions);
        externalRequests += 1;
        wikitext = page.wikitext;
        pageTitle = page.title;
        rawJson = page.raw;
        currentPageId = page.pageId;
        currentPageUrl = page.fullUrl || currentPageUrl;

        if (shouldFetchParsedHtml) {
          parsedHtml = await fetchParsedHtml(pageTitle);
        } else {
          console.log(`[Importer] Skipping fetchPageParsed for ${pageTitle} (LIQUIPEDIA_SKIP_PARSED_HTML=1)`);
        }

        const contentHash = createHash("sha1").update(wikitext).digest("hex");
        rawSnapshot = await prisma.rawSnapshot.create({
          data: {
            tournamentImportId: importRecordId,
            source: "liquipedia-mediawiki-api",
            disciplineSlug,
            pageId: currentPageId,
            pageTitle,
            contentHash,
            revisionId: extractRevisionId(rawJson),
            revisionTimestamp: extractRevisionTimestamp(rawJson),
            rawJson: rawJson as Prisma.InputJsonValue,
            rawWikitext: wikitext,
            rawHtml: parsedHtml,
            metadata: {
              resourceType: "page",
              resourceKey: titleKey(pageTitle),
              pageUrl: currentPageUrl,
              mode: "cache-first",
            } as Prisma.InputJsonValue,
          }
        });
        cacheLayer = "network";
        sourceFetchPublicationNeeded = true;
      } catch (fetchError) {
        await markSourceFetchFailure(cacheInput, {
          errorClass: "source_fetch_failed",
          externalRequests,
        });

        sourceCache = sourceCache || (!force ? await findSourceFetchCache(cacheInput) : null);
        if (!force && sourceCache?.rawSnapshotId && isSourceCacheStaleUsable(sourceCache)) {
          const staleSnapshot = await prisma.rawSnapshot.findUnique({ where: { id: sourceCache.rawSnapshotId } });
          if (staleSnapshot?.rawWikitext) {
            rawSnapshot = staleSnapshot;
            wikitext = staleSnapshot.rawWikitext;
            pageTitle = staleSnapshot.pageTitle;
            rawJson = staleSnapshot.rawJson;
            parsedHtml = staleSnapshot.rawHtml || undefined;
            currentPageId = staleSnapshot.pageId ?? pageId;
            currentPageUrl = getSnapshotPageUrl(staleSnapshot) || currentPageUrl;
            if (shouldFetchParsedHtml && !parsedHtml) {
              parsedHtml = await fetchParsedHtml(pageTitle);
            }
            cacheHit = true;
            cacheLayer = "stale-if-error";
            stale = true;
            warning = `Источник недоступен, показан последний хороший snapshot для ${title}.`;
          } else {
            throw fetchError;
          }
        } else {
          const fallbackSnapshot = await prisma.rawSnapshot.findFirst({
            where: {
              pageTitle: title,
              OR: [
                { disciplineSlug },
                { disciplineSlug: null }
              ],
              fetchedAt: { gte: new Date(Date.now() - SOURCE_CACHE_TTL_MS.liquipediaStale) }
            },
            orderBy: { fetchedAt: "desc" }
          });

          if (!force && fallbackSnapshot?.rawWikitext) {
            rawSnapshot = fallbackSnapshot;
            wikitext = fallbackSnapshot.rawWikitext;
            pageTitle = fallbackSnapshot.pageTitle;
            rawJson = fallbackSnapshot.rawJson;
            parsedHtml = fallbackSnapshot.rawHtml || undefined;
            currentPageId = fallbackSnapshot.pageId ?? pageId;
            currentPageUrl = getSnapshotPageUrl(fallbackSnapshot) || currentPageUrl;
            if (shouldFetchParsedHtml && !parsedHtml) {
              parsedHtml = await fetchParsedHtml(pageTitle);
            }
            cacheHit = true;
            cacheLayer = "raw-snapshot-stale-if-error";
            stale = true;
            warning = `Источник недоступен, использован stale snapshot для ${title}.`;
          } else {
            throw fetchError;
          }
        }
      }
    }

    const normalized = normalizer({
      pageId: currentPageId,
      title: pageTitle,
      pageUrl: currentPageUrl,
      wikitext,
      parsedHtml
    });
    normalized.cacheHit = cacheHit;
    normalized.cacheLayer = cacheLayer;
    normalized.stale = stale;
    normalized.warning = warning;
    normalized.requestStats = {
      externalRequests,
      sourceCacheExternalRequests: sourceCache?.externalRequests ?? 0,
    };

    const initialNormalization = buildLiquipediaNormalizationJson(normalized, {
      warning,
      cacheHit,
      cacheLayer,
      stale,
    });

    const requestedTournament = tournamentId && tournamentId !== "__pending__"
      ? await prisma.tournament.findUnique({ where: { id: tournamentId } })
      : null;
    const sourceTitle = normalized.sourceTitle;
    const existingTournament = requestedTournament || await findExistingLiquipediaTournament({
      disciplineSlug,
      sourcePageId: normalized.sourcePageId,
      sourceUrl: normalized.sourceUrl,
      requestedPageUrl: currentPageUrl,
      sourceTitle,
    });
    const tournament = deferBusinessWrites
      ? {
          ...existingTournament,
          id: existingTournament?.id || "__pending__",
          sourcePageId: normalized.sourcePageId,
          sourceTitle,
          sourceUrl: normalized.sourceUrl,
          name: normalized.name,
          disciplineSlug,
          startDate: normalized.startDate,
          endDate: normalized.endDate,
          location: normalized.location,
          region: normalized.region,
          organizer: normalized.organizer,
          prizePool: normalized.prizePool,
          formatText: normalized.formatText,
          status: normalized.tournamentStatus,
          extractionStatus: normalized.status,
          normalization: initialNormalization,
          lastImportId: importRecordId,
        }
      : existingTournament
        ? await prisma.tournament.update({
          where: { id: existingTournament.id },
          data: {
            sourcePageId: normalized.sourcePageId,
            sourceTitle,
            sourceUrl: normalized.sourceUrl,
            name: normalized.name,
            extractionStatus: normalized.status,
            normalization: initialNormalization,
            lastImportId: importRecordId,
          },
        })
        : await prisma.tournament.create({
          data: {
            sourcePageId: normalized.sourcePageId,
            sourceTitle,
            sourceUrl: normalized.sourceUrl,
            name: normalized.name,
            disciplineSlug,
            startDate: normalized.startDate,
            endDate: normalized.endDate,
            location: normalized.location,
            region: normalized.region,
            organizer: normalized.organizer,
            prizePool: normalized.prizePool,
            formatText: normalized.formatText,
            status: normalized.tournamentStatus,
            extractionStatus: normalized.status,
            normalization: initialNormalization,
            lastImportId: importRecordId,
          },
        });

    const disciplineMappings = await prisma.teamMapping.findMany({
      where: { disciplineSlug }
    });
    const teamCanonicalizer = buildTeamNameCanonicalizer({
      participants: normalized.participants,
      mappings: disciplineMappings,
      extraNames: normalized.matches.flatMap((match: any) => [match.teamAName, match.teamBName]),
    });
    normalized.participants = canonicalizeParticipants(normalized.participants, teamCanonicalizer);
    normalized.matches = normalized.matches.map((match: any) => canonicalizeMatchTeams(match, teamCanonicalizer));

    if (normalized.participants.length > 0) {
      const mappingMap = new Map(disciplineMappings.map((m: any) => [m.liquipediaName.toLowerCase(), m]));
      const aliasMap = new Map<string, any>();
      disciplineMappings.forEach((m: any) => {
        for (const key of getTeamMappingLookupKeys(m)) {
          aliasMap.set(key.toLowerCase(), m);
        }
        if (m.alias) {
          m.alias.split(',').forEach((a: string) => aliasMap.set(a.trim().toLowerCase(), m));
        }
      });

      const existingParticipants = await prisma.tournamentParticipant.findMany({
        where: { tournamentId: tournament.id },
        select: {
          name: true,
          platformId: true,
          seed: true,
          region: true,
          status: true,
          logoUrl: true,
          rawText: true,
        }
      });
      const existingParticipantMap = new Map(
        existingParticipants.map((participant: any) => [participant.name.toLowerCase(), participant]),
      );

      const participantsToInsert = normalized.participants.map((p: any) => {
        const mapping = mappingMap.get(p.name.toLowerCase()) || aliasMap.get(p.name.toLowerCase());
        const existing = existingParticipantMap.get(p.name.toLowerCase());
        const manualFields = mergeTournamentParticipantManualFields({
          incoming: p,
          existing,
          mapping,
        });
        
        return {
          id: `part_${tournament.id}_${p.name.toLowerCase().replace(/\s/g, "_")}`,
          tournamentId: tournament.id,
          name: p.name,
          ...manualFields,
        };
      });

      if (deferBusinessWrites) {
        // The recursive importer persists the complete participant snapshot
        // together with the final match set in one transaction.
      } else if (clearMatches !== false) {
        await prisma.$transaction([
          prisma.tournamentParticipant.deleteMany({ where: { tournamentId: tournament.id } }),
          ...(participantsToInsert.length > 0
            ? [prisma.tournamentParticipant.createMany({ data: participantsToInsert, skipDuplicates: true })]
            : [])
        ]);
      } else {
        if (participantsToInsert.length > 0) {
          await prisma.tournamentParticipant.createMany({ data: participantsToInsert, skipDuplicates: true });
        }
      }

      for (const p of deferBusinessWrites ? [] : normalized.participants) {
        if (!mappingMap.has(p.name.toLowerCase())) {
          prisma.teamMapping.upsert({
            where: { disciplineSlug_liquipediaName: { disciplineSlug, liquipediaName: p.name } },
            update: { logoUrl: p.logoUrl || undefined },
            create: { disciplineSlug, liquipediaName: p.name, logoUrl: p.logoUrl }
          }).catch(() => {});
        }
      }
    } else if (clearMatches !== false) {
      // Preserve the last known participant snapshot when the source returns an
      // unexplained empty result. A force refresh only bypasses caches.
    }

    let matchesToInsert: any[] = [];
    if (normalized.matches.length > 0) {
      const existingMatches = await prisma.tournamentMatch.findMany({
            where: { tournamentId: tournament.id },
            select: { matchId: true, platformId: true, lpNumericalId: true, teamAName: true, teamBName: true, matchDate: true, syncedAt: true }
          });
      const matchPlatformMap = new Map(existingMatches.filter((em: any) => em.platformId).map((em: any) => [em.matchId, em.platformId]));
      const lpIdMap = new Map(existingMatches.filter((em: any) => em.lpNumericalId).map((em: any) => [em.matchId, em.lpNumericalId]));
      const matchSyncedAtMap = new Map(existingMatches.filter((em: any) => em.syncedAt).map((em: any) => [em.matchId, em.syncedAt]));
      
      const fuzzyPlatformMap = new Map();
      const fuzzySyncedAtMap = new Map();
      existingMatches.forEach((em: any) => {
        if (em.teamAName && em.teamBName) {
           const teams = [em.teamAName.toLowerCase(), em.teamBName.toLowerCase()].sort();
           const dateStr = em.matchDate ? new Date(em.matchDate).toISOString().split('T')[0] : "";
           const fuzzyKey = `${dateStr}|${teams[0]}|${teams[1]}`;
           if (em.platformId) fuzzyPlatformMap.set(fuzzyKey, em.platformId);
           if (em.syncedAt) fuzzySyncedAtMap.set(fuzzyKey, em.syncedAt);
        }
      });

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const pastLimit = new Date(today.getTime() - IMPORT_MATCH_PAST_GRACE_DAYS * 24 * 60 * 60 * 1000);
      const futureLimit = new Date(today.getTime() + IMPORT_MATCH_FUTURE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

      matchesToInsert = normalized.matches
        .map((m: any) => {
          const exactMatchDate = resolveExactMatchDate(m);
          if (exactMatchDate) return { ...m, matchDate: exactMatchDate };

          const displayMatchDate = resolveDisplayMatchDate(m);
          if (shouldKeepDisplayOnlyScheduleMatch(m, displayMatchDate)) {
            return { ...m, matchDate: displayMatchDate };
          }

          return null;
        })
        .filter((m: any): m is any => Boolean(m))
        .filter((m: any) => {
          if (m.scoreA !== null || m.scoreB !== null) return false;
          if (isFinishedMatchStatus(m.status)) return false;
          
          if (m.matchDate) {
            const mDate = new Date(m.matchDate);
            if (mDate < pastLimit || mDate > futureLimit) return false;
          }
          
          return true;
        })
        .map((m: any, idx: number) => {
          const matchId = m.matchId || `fallback_${Date.now()}_${idx}`;
          
          let platformId = matchPlatformMap.get(matchId) || null;
          if (!platformId && m.teamAName && m.teamBName) {
            const teams = [m.teamAName.toLowerCase(), m.teamBName.toLowerCase()].sort();
            const dateStr = m.matchDate ? new Date(m.matchDate).toISOString().split('T')[0] : "";
            platformId = fuzzyPlatformMap.get(`${dateStr}|${teams[0]}|${teams[1]}`) || null;
          }
          let syncedAt = matchSyncedAtMap.get(matchId) || null;
          if (!syncedAt && m.teamAName && m.teamBName) {
            const teams = [m.teamAName.toLowerCase(), m.teamBName.toLowerCase()].sort();
            const dateStr = m.matchDate ? new Date(m.matchDate).toISOString().split('T')[0] : "";
            syncedAt = fuzzySyncedAtMap.get(`${dateStr}|${teams[0]}|${teams[1]}`) || null;
          }

          return {
            ...m,
            matchId,
            tournamentId: tournament.id,
            platformId,
            lpNumericalId: lpIdMap.get(matchId) || m.lpNumericalId || null,
            syncedAt,
            teamAId: m.teamAId,
            teamAName: m.teamAName,
            teamBId: m.teamBId,
            teamBName: m.teamBName,
            scoreA: m.scoreA,
            scoreB: m.scoreB,
            format: m.format,
            status: m.status,
            court: m.court,
            sourceUrl: m.sourceUrl,
            rawText: m.rawText,
            hasPlaceholderTeams: hasPlaceholderTeams(m),
            sourceConfidence: getMatchSourceConfidence(m),
            sourceBreakdown: buildMatchCandidateMetadata(m, "liquipedia") as Prisma.InputJsonValue
          };
        });

      // Batch team mapping creation instead of individual fire-and-forget upserts
      const matchTeamNames = new Set<string>();
      for (const m of normalized.matches) {
        if (m.teamAName && !isPlaceholderTeam(m.teamAName)) matchTeamNames.add(m.teamAName);
        if (m.teamBName && !isPlaceholderTeam(m.teamBName)) matchTeamNames.add(m.teamBName);
      }
      if (!deferBusinessWrites && matchTeamNames.size > 0) {
        const existingMappings = await prisma.teamMapping.findMany({
          where: { disciplineSlug, liquipediaName: { in: [...matchTeamNames] } },
          select: { liquipediaName: true },
        });
        const existingNames = new Set(existingMappings.map(m => m.liquipediaName));
        const newMappings = [...matchTeamNames]
          .filter(name => !existingNames.has(name))
          .map(name => ({ disciplineSlug, liquipediaName: name }));
        if (newMappings.length > 0) {
          await prisma.teamMapping.createMany({ data: newMappings, skipDuplicates: true }).catch(() => {});
        }
      }
    }

    const pageQualityScore = computeMatchSetQuality(matchesToInsert);
    normalized.qualityScore = pageQualityScore;
    if (normalized.dota2Diagnostics) {
      normalized.dota2Diagnostics = finalizeDota2Diagnostics(normalized.dota2Diagnostics, {
        savedMatches: matchesToInsert.length,
      });
    }
    if (normalized.leagueOfLegendsDiagnostics) {
      normalized.leagueOfLegendsDiagnostics = finalizeEsportsParsingDiagnostics(normalized.leagueOfLegendsDiagnostics, {
        savedMatches: matchesToInsert.length,
      }) || undefined;
    }
    if (normalized.valorantDiagnostics) {
      normalized.valorantDiagnostics = finalizeEsportsParsingDiagnostics(normalized.valorantDiagnostics, {
        savedMatches: matchesToInsert.length,
      }) || undefined;
    }
    normalized.sourceBreakdown = {
      liquipedia: {
        pageTitle,
        pageId: currentPageId ?? null,
        matches: matchesToInsert.length,
        placeholders: matchesToInsert.filter((match) => hasPlaceholderTeams(match)).length,
        cacheHit,
        cacheLayer,
        stale,
      },
    };

    if (rawSnapshot?.id) {
      await prisma.rawSnapshot.update({
        where: { id: rawSnapshot.id },
        data: {
          qualityScore: pageQualityScore,
          metadata: {
            resourceType: "page",
            resourceKey: titleKey(pageTitle),
            mode: "cache-first",
            pageUrl: currentPageUrl,
            cacheHit,
            cacheLayer,
            stale,
            warning,
            matchesCount: matchesToInsert.length,
            placeholdersCount: matchesToInsert.filter((match) => hasPlaceholderTeams(match)).length,
          } as Prisma.InputJsonValue,
        },
      }).catch(() => {});

    }

    const sourceFetchPublication: LiquipediaSourceFetchPublication | null = (
      sourceFetchPublicationNeeded
      && rawSnapshot?.id
      && !stale
      && !warning
      && normalized.status === "SUCCESS"
    )
      ? {
        input: cacheInput,
        data: {
          revisionId: rawSnapshot.revisionId,
          revisionTimestamp: rawSnapshot.revisionTimestamp,
          contentHash: rawSnapshot.contentHash,
          rawSnapshotId: rawSnapshot.id,
          qualityScore: pageQualityScore,
          externalRequests,
          cacheLayer: cacheLayer || (cacheHit ? "raw-snapshot" : "network"),
          metadata: {
            title: pageTitle,
            pageId: currentPageId ?? null,
            pageUrl: currentPageUrl,
            matchesCount: matchesToInsert.length,
            placeholdersCount: matchesToInsert.filter((match) => hasPlaceholderTeams(match)).length,
            stale,
          },
        },
      }
      : null;

    if (!deferBusinessWrites && (normalized.dota2Diagnostics || normalized.leagueOfLegendsDiagnostics || normalized.valorantDiagnostics)) {
      await prisma.tournament.update({
        where: { id: tournament.id },
        data: {
          normalization: buildLiquipediaNormalizationJson(normalized, {
            warning,
            cacheHit,
            cacheLayer,
            stale,
          }),
        },
      }).catch(() => {});
    }

    return { 
      tournament, 
      normalized, 
      matches: matchesToInsert,
      processedMatchIds: normalized.matches.map((m: any) => m.matchId).filter((id: any): id is string => !!id),
      cacheHit,
      cacheLayer,
      stale,
      warning,
      requestStats: normalized.requestStats,
      sourceBreakdown: normalized.sourceBreakdown,
      qualityScore: pageQualityScore,
      sourceFetchPublication,
      sourceFreshness: {
        revisionId: rawSnapshot?.revisionId ?? null,
        revisionTimestamp: rawSnapshot?.revisionTimestamp ?? null,
        fetchedAt: rawSnapshot?.fetchedAt ?? null,
      },
    };
  } catch (error) {
    logApiError("[Importer] Error processing Liquipedia page", error);
    throw error;
  }
}

type LiquipediaTournamentLookupClient = Pick<Prisma.TransactionClient, "tournament">;

export async function findExistingLiquipediaTournament(params: {
  disciplineSlug: string;
  sourcePageId?: number | null;
  sourceUrl?: string | null;
  requestedPageUrl?: string | null;
  sourceTitle: string;
}, client: LiquipediaTournamentLookupClient = prisma) {
  if (Number.isInteger(params.sourcePageId) && Number(params.sourcePageId) > 0) {
    const byPageId = await client.tournament.findFirst({
      where: {
        disciplineSlug: params.disciplineSlug,
        sourcePageId: Number(params.sourcePageId),
        OR: [
          { sourceUrl: { startsWith: `https://liquipedia.net/${params.disciplineSlug}/` } },
          { sourceUrl: { startsWith: `https://www.liquipedia.net/${params.disciplineSlug}/` } },
        ],
      },
      orderBy: { updatedAt: "desc" },
    });
    if (byPageId) return byPageId;
  }

  const sourceUrls = Array.from(new Set([
    params.sourceUrl,
    params.requestedPageUrl,
    canonicalizeLiquipediaSourceUrl(params.sourceUrl),
    canonicalizeLiquipediaSourceUrl(params.requestedPageUrl),
  ].map((value) => String(value || "").trim()).filter(Boolean)));
  if (sourceUrls.length > 0) {
    const byUrl = await client.tournament.findFirst({
      where: {
        disciplineSlug: params.disciplineSlug,
        sourceUrl: { in: sourceUrls },
      },
      orderBy: { updatedAt: "desc" },
    });
    if (byUrl) return byUrl;
  }

  return client.tournament.findFirst({
    where: {
      disciplineSlug: params.disciplineSlug,
      sourceTitle: params.sourceTitle,
      OR: [
        { sourceUrl: { startsWith: `https://liquipedia.net/${params.disciplineSlug}/` } },
        { sourceUrl: { startsWith: `https://www.liquipedia.net/${params.disciplineSlug}/` } },
        { sourceUrl: "" },
      ],
    },
    orderBy: { updatedAt: "desc" },
  });
}

function getSnapshotPageUrl(snapshot: { metadata?: unknown }) {
  const metadata = snapshot.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const record = metadata as Record<string, unknown>;
  if (typeof record.pageUrl === "string") return record.pageUrl;
  if (typeof record.fullUrl === "string") return record.fullUrl;
  return null;
}

function shouldKeepDisplayOnlyScheduleMatch(match: any, displayMatchDate: Date | null) {
  if (!match?.teamAName || !match?.teamBName) return false;
  if (match.scoreA !== null && match.scoreA !== undefined) return false;
  if (match.scoreB !== null && match.scoreB !== undefined) return false;
  if (isFinishedMatchStatus(match.status)) return false;

  const teamAPlaceholder = isPlaceholderTeam(match.teamAName);
  const teamBPlaceholder = isPlaceholderTeam(match.teamBName);
  if (teamAPlaceholder && teamBPlaceholder) return hasStageAnnouncementContext(match);

  return Boolean(displayMatchDate);
}

function hasStageAnnouncementContext(match: any) {
  const text = [
    match.stage,
    match.round,
    match.format,
    match.rawText,
    match.matchId,
  ].filter(Boolean).join(" ");

  return /\b(?:slot|round\s*\d+|group\s+stage|swiss|playoffs?|bracket|quarter[-\s]?finals?|semi[-\s]?finals?|finals?|grand\s+final|winner|loser|bo\s*\d+)\b/i.test(text);
}

function buildLiquipediaNormalizationJson(
  normalized: {
    warnings: string[];
    requestStats?: unknown;
    dota2Diagnostics?: unknown;
    leagueOfLegendsDiagnostics?: unknown;
    valorantDiagnostics?: unknown;
  },
  params: {
    warning: string | null;
    cacheHit: boolean;
    cacheLayer: string | null;
    stale: boolean;
  },
) {
  return {
    warnings: params.warning ? Array.from(new Set([...normalized.warnings, params.warning])) : normalized.warnings,
    cacheHit: params.cacheHit,
    cacheLayer: params.cacheLayer,
    stale: params.stale,
    requestStats: normalized.requestStats,
    ...(normalized.dota2Diagnostics ? { dota2Diagnostics: normalized.dota2Diagnostics } : {}),
    ...(normalized.leagueOfLegendsDiagnostics ? { leagueOfLegendsDiagnostics: normalized.leagueOfLegendsDiagnostics } : {}),
    ...(normalized.valorantDiagnostics ? { valorantDiagnostics: normalized.valorantDiagnostics } : {}),
  } as Prisma.InputJsonValue;
}
