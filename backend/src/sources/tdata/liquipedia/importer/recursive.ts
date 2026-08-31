import { Prisma } from "@prisma/client";
import { prisma } from "@backend/db/db";
import {
  finalizeDota2Diagnostics,
  finalizeEsportsParsingDiagnostics,
  mergeDota2Diagnostics,
  mergeEsportsParsingDiagnostics,
} from "@backend/matches/parsingDiagnostics";
import { processSinglePage, publishLiquipediaSourceFetchSuccess } from "./singlePage";
import {
  canonicalizeMatchesWithTournamentTeams,
  appendTournamentWarning,
  titleFromLiquipediaUrl,
  buildMatchIdentity,
  isPlainObject,
} from "./helpers";
import { dedupeTournamentMatches } from "@backend/matches/dedupe";
import type { NormalizedTournament } from "@backend/normalizers/types";
import { decideTournamentSnapshotWrite, TournamentSnapshotRejectedError } from "@backend/sources/importSafety";
import { refreshTournamentMatchesPreservingState } from "@backend/sources/matchPreservation";
import { mergeTournamentParticipantManualFields } from "@backend/sources/participantPreservation";
import {
  buildMatchCandidateMetadata,
  computeMatchSetQuality,
  getMatchSourceConfidence,
  hasPlaceholderTeams,
  shouldKeepPreviousMatches,
} from "@backend/matches/quality";
import { createHash } from "crypto";
import { getTeamMappingLookupKeys } from "@backend/teams/canonicalize";
import {
  assessLiquipediaSnapshotHealth,
  buildLiquipediaStableTournamentKey,
  canonicalizeLiquipediaSourceUrl,
} from "./snapshotSafety";

export async function importTournamentRecursive(params: {
  disciplineId: string;
  disciplineSlug: string;
  apiUrl: string;
  pageId?: number;
  title: string;
  pageUrl: string;
  normalizer: (input: any) => NormalizedTournament;
  importRecordId: string;
  force?: boolean;
}) {
  const { disciplineId, disciplineSlug, apiUrl, pageId, title, pageUrl, normalizer, importRecordId, force } = params;

  console.log(`[Importer] Starting optimized bulk import for ${title}`);
  const startTime = Date.now();
  const forceCleanupStats = null;

  // 1. Process Main Page (Does NOT insert matches anymore, just returns them)
  const mainResult = await processSinglePage({
    disciplineId,
    disciplineSlug,
    apiUrl,
    pageId,
    title,
    pageUrl,
    normalizer,
    importRecordId,
    force,
    clearMatches: true,
    deferBusinessWrites: true,
  });

  const allMatches = [...(mainResult.matches || [])];
  const allParticipants = [...(mainResult.normalized.participants || [])];
  const pageResults = [mainResult];
  const allMatchIds = [...(mainResult.processedMatchIds || [])];
  const dota2Diagnostics = [mainResult.normalized.dota2Diagnostics];
  const leagueOfLegendsDiagnostics = [mainResult.normalized.leagueOfLegendsDiagnostics];
  const valorantDiagnostics = [mainResult.normalized.valorantDiagnostics];
  let finalProcessedMatchIds = allMatchIds;
  let finalSavedMatchCount = allMatches.length;
  let finalDuplicateMatchCount = 0;
  let subPageFailures = 0;

  // 2. Process Sub-pages (parallel in batches for speed)
  if (mainResult.normalized.subPages && mainResult.normalized.subPages.length > 0) {
    const subPages = mainResult.normalized.subPages;
    const CONCURRENCY = Number(process.env.LIQUIPEDIA_SUBPAGE_CONCURRENCY || 3);
    console.log(`[Importer] Found ${subPages.length} sub-pages for ${title} (concurrency=${CONCURRENCY})`);

    for (let batchStart = 0; batchStart < subPages.length; batchStart += CONCURRENCY) {
      const batch = subPages.slice(batchStart, batchStart + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (subUrl: string, idx: number) => {
          const globalIdx = batchStart + idx;
          console.log(`[Importer] Processing sub-page ${globalIdx + 1}/${subPages.length}: ${subUrl}`);
          const subTitle = titleFromLiquipediaUrl(subUrl, disciplineSlug);
          return processSinglePage({
            disciplineId,
            disciplineSlug,
            apiUrl,
            title: subTitle,
            pageUrl: subUrl,
            normalizer,
            importRecordId,
            force,
            tournamentId: mainResult.tournament.id === "__pending__" ? undefined : mainResult.tournament.id,
            clearMatches: false,
            deferBusinessWrites: true,
          });
        })
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          pageResults.push(result.value);
          if (result.value.matches) allMatches.push(...result.value.matches);
          if (result.value.normalized.participants) allParticipants.push(...result.value.normalized.participants);
          if (result.value.processedMatchIds) finalProcessedMatchIds.push(...result.value.processedMatchIds);
          if (result.value.normalized.dota2Diagnostics) dota2Diagnostics.push(result.value.normalized.dota2Diagnostics);
          if (result.value.normalized.leagueOfLegendsDiagnostics) {
            leagueOfLegendsDiagnostics.push(result.value.normalized.leagueOfLegendsDiagnostics);
          }
          if (result.value.normalized.valorantDiagnostics) {
            valorantDiagnostics.push(result.value.normalized.valorantDiagnostics);
          }
        } else {
          subPageFailures += 1;
          console.error(`[Importer] Failed to process sub-page:`, result.reason);
        }
      }
    }
  }

  // 3. Build and validate the complete snapshot before mutating tournament data.
  const existingTournamentId = mainResult.tournament.id === "__pending__"
    ? null
    : mainResult.tournament.id;
  const existingBeforeFinal = existingTournamentId
    ? await prisma.tournamentMatch.findMany({ where: { tournamentId: existingTournamentId } })
    : [];
  let qualityScore = computeMatchSetQuality(allMatches, existingBeforeFinal);
  let qualityGateWarning: string | null = null;
  let qualityGateKeptPrevious = false;
  let deduplicatedMatches: any[] = [];
  const snapshotHealth = assessLiquipediaSnapshotHealth({
    pages: pageResults,
    rejectedSubpages: subPageFailures,
  });
  const sourceHadError = !snapshotHealth.sourceValidated;
  const mainTournamentKey = buildLiquipediaStableTournamentKey({
    disciplineSlug,
    sourcePageId: mainResult.normalized.sourcePageId ?? pageId,
    sourceUrl: mainResult.normalized.sourceUrl || pageUrl,
    sourceTitle: mainResult.normalized.sourceTitle,
  });
  if (allMatches.length > 0) {
    console.log(`[Importer] Preparing final snapshot of ${allMatches.length} matches...`);
    await canonicalizeMatchesWithTournamentTeams(
      allMatches,
      existingTournamentId || "__pending__",
      disciplineSlug,
      allParticipants,
    );
    // Match identity is namespaced by the immutable Liquipedia page identity.
    // A display-title edit must not orphan platform mappings or sync state.
    for (const m of allMatches) {
      const identity = buildMatchIdentity(m);
      const teams = [
        m.teamAId || m.teamAName || "unknownA",
        m.teamBId || m.teamBName || "unknownB",
      ].map((value) => String(value).trim().toLowerCase()).sort();
      const data = [
        mainTournamentKey,
        identity.date,
        identity.time,
        teams[0],
        teams[1],
        identity.stage,
        identity.round,
        identity.format,
        identity.sourceSlot,
      ].join("|");
      const hash = createHash("md5").update(data).digest("hex").slice(0, 12);
      const nextMatchId = `match_${hash}`;
      m.matchId = nextMatchId;
      m.lpNumericalId = BigInt("0x" + hash.substring(0, 15)) % 9007199254740991n;
      m.tournamentId = existingTournamentId || "__pending__";
      delete m.platformId;
      delete m.syncedAt;
      m.hasPlaceholderTeams = hasPlaceholderTeams(m);
      m.sourceConfidence = getMatchSourceConfidence(m);
      m.sourceBreakdown = buildMatchCandidateMetadata(m, "liquipedia") as Prisma.InputJsonValue;
      (m as any)._identity = identity;
    }

    deduplicatedMatches = dedupeTournamentMatches(allMatches).map(m => {
      const { _identity, ...rest } = m;
      return rest;
    });
    finalDuplicateMatchCount = Math.max(0, allMatches.length - deduplicatedMatches.length);
    finalProcessedMatchIds = deduplicatedMatches.map((match: any) => match.matchId).filter(Boolean);

    if (deduplicatedMatches.length !== allMatches.length) {
      console.log(`[Importer] Removed ${allMatches.length - deduplicatedMatches.length} duplicate matches before insert.`);
    }
  }

  // A cheap preflight still provides useful diagnostics, but it is never
  // authoritative: another import may commit before this one acquires its lock.
  const preflightGate = evaluateLiquipediaSnapshotQualityGate({
    incomingMatches: deduplicatedMatches,
    previousMatches: existingBeforeFinal,
    sourceHadError,
    sourceValidated: !sourceHadError,
    force,
  });
  qualityScore = preflightGate.qualityScore;
  qualityGateKeptPrevious = preflightGate.keepPrevious;

  const importRecord = await prisma.tournamentImport.findUniqueOrThrow({
    where: { id: importRecordId },
    select: { startedAt: true },
  });
  const candidateFreshness: LiquipediaImportFreshness = {
    revisionId: validRevisionId(mainResult.sourceFreshness?.revisionId),
    revisionTimestamp: validDate(mainResult.sourceFreshness?.revisionTimestamp),
    fetchedAt: validDate(mainResult.sourceFreshness?.fetchedAt),
    importStartedAt: importRecord.startedAt,
  };
  const commitResult = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`liquipedia-import:${mainTournamentKey}`}))`;
      const normalized = mainResult.normalized;
      const existingTournament = await findLiquipediaTournamentForCommit({
        client: tx,
        existingTournamentId,
        disciplineSlug,
        sourcePageId: normalized.sourcePageId,
        sourceUrl: normalized.sourceUrl,
        sourceTitle: normalized.sourceTitle,
      });
      const currentFreshness = readLiquipediaImportFreshness(existingTournament?.normalization);
      if (existingTournament && currentFreshness && shouldRejectSupersededLiquipediaImport(candidateFreshness, currentFreshness)) {
        return {
          applied: false as const,
          reason: "stale" as const,
          tournament: existingTournament,
        };
      }

      const lockedCurrentMatches = existingTournament
        ? await tx.tournamentMatch.findMany({ where: { tournamentId: existingTournament.id } })
        : [];
      const lockedGate = evaluateLiquipediaSnapshotQualityGate({
        incomingMatches: deduplicatedMatches,
        previousMatches: lockedCurrentMatches,
        sourceHadError,
        sourceValidated: !sourceHadError,
        force,
      });
      if (lockedGate.keepPrevious) {
        const warning = buildLiquipediaQualityGateWarning({
          incomingMatches: deduplicatedMatches,
          previousMatches: lockedCurrentMatches,
          qualityScore: lockedGate.qualityScore,
          reasons: snapshotHealth.reasons,
        });
        if (existingTournament) {
          await appendTournamentWarning({
            client: tx,
            tournamentId: existingTournament.id,
            warning,
          });
        }
        return {
          applied: false as const,
          reason: "quality" as const,
          tournament: existingTournament,
          warning,
          qualityScore: lockedGate.qualityScore,
          previousMatches: lockedCurrentMatches,
        };
      }
      const committedNormalization = withLiquipediaImportFreshness(
        mainResult.tournament.normalization,
        candidateFreshness,
      );
      const tournament = existingTournament
        ? await tx.tournament.update({
          where: { id: existingTournament.id },
          data: {
            sourcePageId: normalized.sourcePageId,
            sourceTitle: normalized.sourceTitle,
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
            extractionStatus: "SUCCESS",
            normalization: committedNormalization,
            lastImportId: importRecordId,
          },
        })
        : await tx.tournament.create({
          data: {
          sourcePageId: normalized.sourcePageId,
          sourceTitle: normalized.sourceTitle,
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
          extractionStatus: "SUCCESS",
          normalization: committedNormalization,
          lastImportId: importRecordId,
        },
        });
      const participantRows = await buildLiquipediaParticipantRows({
        client: tx,
        tournamentId: tournament.id,
        disciplineSlug,
        participants: allParticipants,
      });
      const matchRows = deduplicatedMatches.map((match) => ({
        ...match,
        tournamentId: tournament.id,
      }));

      // Manual delivery state is concurrency-sensitive. Re-read it inside the
      // transaction and reject globally unique IDs owned by another tournament
      // before attempting semantic ID migrations.
      const incomingMatchIds = matchRows.map((match) => match.matchId);
      const incomingMatchIdSet = new Set(incomingMatchIds);
      const currentMatches = await tx.tournamentMatch.findMany({
        where: {
          OR: [
            { tournamentId: tournament.id },
            { matchId: { in: incomingMatchIds } },
          ],
        },
      });
      const foreignCollision = currentMatches.find(
        (match) => incomingMatchIdSet.has(match.matchId) && match.tournamentId !== tournament.id,
      );
      if (foreignCollision) {
        throw new TournamentSnapshotRejectedError(
          `Liquipedia match identity ${foreignCollision.matchId} belongs to another tournament; refresh was aborted.`,
          "parse_failed",
        );
      }

      const currentTournamentMatches = currentMatches.filter(
        (match) => match.tournamentId === tournament.id,
      );
      const currentByMatchId = new Map(
        currentTournamentMatches.map((match) => [match.matchId, match]),
      );
      const currentByIdentity = new Map(
        currentTournamentMatches.map((match) => [
          buildSyncedIdentityKey(match, buildMatchIdentity(match)),
          match,
        ]),
      );
      const currentMatchIdMigrations = matchRows.flatMap((match) => {
        if (currentByMatchId.has(match.matchId)) return [];
        const semanticExisting = currentByIdentity.get(
          buildSyncedIdentityKey(match, buildMatchIdentity(match)),
        );
        if (!semanticExisting || semanticExisting.matchId === match.matchId) return [];
        return [{
          id: semanticExisting.id,
          previousMatchId: semanticExisting.matchId,
          nextMatchId: match.matchId,
        }];
      });

      for (const migration of dedupeMatchIdMigrations(currentMatchIdMigrations)) {
        await tx.tournamentMatch.updateMany({
          where: {
            id: migration.id,
            tournamentId: tournament.id,
            matchId: migration.previousMatchId,
          },
          data: { matchId: migration.nextMatchId },
        });
      }

      await refreshTournamentMatchesPreservingState({
        tx,
        tournamentId: tournament.id,
        matches: matchRows.map((matchRow) => {
          const {
            id: _id,
            createdAt: _createdAt,
            tournament: _tournament,
            matchId,
            ...data
          } = matchRow as any;
          return {
            matchId,
            create: { ...data, matchId, tournamentId: tournament.id },
            update: data,
          };
        }),
      });
      await tx.tournamentParticipant.deleteMany({ where: { tournamentId: tournament.id } });
      if (participantRows.length > 0) {
        await tx.tournamentParticipant.createMany({ data: participantRows, skipDuplicates: true });
      }
      await tx.tournamentImport.update({
        where: { id: importRecordId },
        data: { status: "SUCCESS", finishedAt: new Date() },
      });
      return {
        applied: true as const,
        tournament,
        qualityScore: lockedGate.qualityScore,
      };
  });
  if (!commitResult.applied) {
    const message = commitResult.reason === "stale"
      ? `Liquipedia import ${importRecordId} was superseded by a newer committed source revision; existing tournament data was preserved.`
      : commitResult.warning;
    await prisma.tournamentImport.updateMany({
      where: { id: importRecordId, status: "PENDING" },
      data: { status: "PARTIAL", finishedAt: new Date(), errorMessage: message },
    });
    if (commitResult.reason === "quality") {
      qualityScore = commitResult.qualityScore;
      qualityGateWarning = message;
      qualityGateKeptPrevious = true;
      finalProcessedMatchIds = commitResult.previousMatches.map((match: any) => match.matchId).filter(Boolean);
      finalSavedMatchCount = commitResult.previousMatches.length;
      console.warn(`[Importer] ${message}`);
    }
    throw new TournamentSnapshotRejectedError(
      message,
      commitResult.reason === "stale" ? "stale_cache" : snapshotHealth.errorClass || "parse_failed",
      commitResult.reason === "stale" ? 409 : undefined,
    );
  }
  const committedTournament = commitResult.tournament;
  qualityScore = commitResult.qualityScore;
  qualityGateKeptPrevious = false;
  mainResult.tournament = committedTournament;
  finalSavedMatchCount = deduplicatedMatches.length;
  finalProcessedMatchIds = deduplicatedMatches.map((match) => match.matchId).filter(Boolean);

  // Raw snapshots may be stored before validation, but a cache entry becomes
  // last-good only after the complete multi-page business transaction commits.
  const cachePublicationResults = await Promise.allSettled(
    pageResults
      .map((result) => result.sourceFetchPublication)
      .filter((publication): publication is NonNullable<typeof publication> => Boolean(publication))
      .map((publication) => publishLiquipediaSourceFetchSuccess(publication)),
  );
  for (const result of cachePublicationResults) {
    if (result.status === "rejected") {
      console.warn("[Importer] Liquipedia snapshot committed, but source cache publication failed.");
    }
  }

  if (disciplineSlug === "dota2") {
    const mergedDiagnostics = finalizeDota2Diagnostics(mergeDota2Diagnostics(dota2Diagnostics), {
      savedMatches: finalSavedMatchCount,
      duplicateMatches: finalDuplicateMatchCount,
      extraIssues: qualityGateWarning
        ? [{ reason: "parse_failed", message: qualityGateWarning }]
        : [],
    });

    if (mergedDiagnostics) {
      await persistMergedDiagnostics({
        tournamentId: mainResult.tournament.id,
        stableKey: mainTournamentKey,
        expectedFreshness: candidateFreshness,
        key: "dota2Diagnostics",
        diagnostics: mergedDiagnostics,
      });
    }
  }

  if (disciplineSlug === "leagueoflegends") {
    const mergedDiagnostics = finalizeEsportsParsingDiagnostics(mergeEsportsParsingDiagnostics(leagueOfLegendsDiagnostics), {
      savedMatches: finalSavedMatchCount,
      duplicateMatches: finalDuplicateMatchCount,
      extraIssues: qualityGateWarning
        ? [{ reason: "parse_failed", message: qualityGateWarning }]
        : [],
    });

    if (mergedDiagnostics) {
      await persistMergedDiagnostics({
        tournamentId: mainResult.tournament.id,
        stableKey: mainTournamentKey,
        expectedFreshness: candidateFreshness,
        key: "leagueOfLegendsDiagnostics",
        diagnostics: mergedDiagnostics,
      });
    }
  }

  if (disciplineSlug === "valorant") {
    const mergedDiagnostics = finalizeEsportsParsingDiagnostics(mergeEsportsParsingDiagnostics(valorantDiagnostics), {
      savedMatches: finalSavedMatchCount,
      duplicateMatches: finalDuplicateMatchCount,
      extraIssues: qualityGateWarning
        ? [{ reason: "parse_failed", message: qualityGateWarning }]
        : [],
    });

    if (mergedDiagnostics) {
      await persistMergedDiagnostics({
        tournamentId: mainResult.tournament.id,
        stableKey: mainTournamentKey,
        expectedFreshness: candidateFreshness,
        key: "valorantDiagnostics",
        diagnostics: mergedDiagnostics,
      });
    }
  }

  console.log(`[Importer] Completed optimized import for ${title} in ${Date.now() - startTime}ms`);
  return {
    ...mainResult,
    processedMatchIds: finalProcessedMatchIds,
    qualityScore,
    warning: qualityGateWarning || mainResult.warning || null,
    qualityGateKeptPrevious,
    forceCleanupStats,
  };
}

export type LiquipediaImportFreshness = {
  revisionId: number | null;
  revisionTimestamp: Date | null;
  fetchedAt: Date | null;
  importStartedAt: Date;
};

export function evaluateLiquipediaSnapshotQualityGate(params: {
  incomingMatches: readonly any[];
  previousMatches: readonly any[];
  sourceHadError: boolean;
  sourceValidated: boolean;
  force?: boolean;
}) {
  const qualityScore = computeMatchSetQuality(params.incomingMatches, params.previousMatches);
  const writeDecision = decideTournamentSnapshotWrite({
    incomingMatches: params.incomingMatches.length,
    sourceValidated: params.sourceValidated,
    force: params.force,
  });
  const keepPrevious = !writeDecision.allowed || shouldKeepPreviousMatches({
    newMatches: params.incomingMatches,
    previousMatches: params.previousMatches,
    newQualityScore: qualityScore,
    sourceHadError: params.sourceHadError,
  });
  return { qualityScore, keepPrevious };
}

export function shouldRejectSupersededLiquipediaImport(
  candidate: LiquipediaImportFreshness,
  current: LiquipediaImportFreshness,
) {
  const candidateRevisionId = validRevisionId(candidate.revisionId);
  const currentRevisionId = validRevisionId(current.revisionId);
  if (candidateRevisionId !== null && currentRevisionId !== null && candidateRevisionId !== currentRevisionId) {
    return candidateRevisionId < currentRevisionId;
  }
  if (currentRevisionId !== null && candidateRevisionId === null) {
    return true;
  }

  if (current.revisionTimestamp !== null) {
    if (candidate.revisionTimestamp === null) return true;
    const revisionTimestampOrder = candidate.revisionTimestamp.getTime() - current.revisionTimestamp.getTime();
    if (revisionTimestampOrder !== 0) return revisionTimestampOrder < 0;
  }

  const importOrder = candidate.importStartedAt.getTime() - current.importStartedAt.getTime();
  if (importOrder !== 0) return importOrder < 0;

  return compareOptionalDates(candidate.fetchedAt, current.fetchedAt) < 0;
}

function buildLiquipediaQualityGateWarning(params: {
  incomingMatches: readonly any[];
  previousMatches: readonly any[];
  qualityScore: number;
  reasons: readonly string[];
}) {
  const semanticDetails = params.reasons.length > 0
    ? ` Причины: ${params.reasons.join("; ")}.`
    : "";
  return params.incomingMatches.length > 0
    ? `Новый импорт выглядит хуже предыдущего snapshot (${params.incomingMatches.length} vs ${params.previousMatches.length} матчей, quality=${params.qualityScore}). Последняя рабочая выборка сохранена.${semanticDetails}`
    : `Источник вернул 0 неподтверждённых матчей. Последняя рабочая выборка (${params.previousMatches.length}) сохранена.${semanticDetails}`;
}

function readLiquipediaImportFreshness(value: unknown): LiquipediaImportFreshness | null {
  if (!isPlainObject(value)) return null;
  const marker = value.liquipediaImportFreshness;
  if (!isPlainObject(marker)) return null;
  const importStartedAt = validDate(marker.importStartedAt);
  if (!importStartedAt) return null;
  return {
    revisionId: validRevisionId(marker.revisionId),
    revisionTimestamp: validDate(marker.revisionTimestamp),
    fetchedAt: validDate(marker.fetchedAt),
    importStartedAt,
  };
}

type LiquipediaDiagnosticsKey = "dota2Diagnostics" | "leagueOfLegendsDiagnostics" | "valorantDiagnostics";

export function mergeLiquipediaDiagnosticsNormalization(params: {
  currentNormalization: unknown;
  expectedFreshness: LiquipediaImportFreshness;
  key: LiquipediaDiagnosticsKey;
  diagnostics: unknown;
}) {
  const currentFreshness = readLiquipediaImportFreshness(params.currentNormalization);
  if (!currentFreshness || !sameLiquipediaImportFreshness(params.expectedFreshness, currentFreshness)) {
    return null;
  }
  const normalization = isPlainObject(params.currentNormalization)
    ? params.currentNormalization as Record<string, unknown>
    : {};
  return {
    ...normalization,
    [params.key]: params.diagnostics,
  } as Prisma.InputJsonValue;
}

function sameLiquipediaImportFreshness(
  expected: LiquipediaImportFreshness,
  current: LiquipediaImportFreshness,
) {
  return validRevisionId(expected.revisionId) === validRevisionId(current.revisionId)
    && compareOptionalDates(expected.revisionTimestamp, current.revisionTimestamp) === 0
    && compareOptionalDates(expected.fetchedAt, current.fetchedAt) === 0
    && expected.importStartedAt.getTime() === current.importStartedAt.getTime();
}

function withLiquipediaImportFreshness(
  value: unknown,
  marker: LiquipediaImportFreshness,
): Prisma.InputJsonValue {
  const normalization = isPlainObject(value) ? value : {};
  return {
    ...normalization,
    liquipediaImportFreshness: {
      revisionId: marker.revisionId,
      revisionTimestamp: marker.revisionTimestamp?.toISOString() ?? null,
      fetchedAt: marker.fetchedAt?.toISOString() ?? null,
      importStartedAt: marker.importStartedAt.toISOString(),
    },
  } as Prisma.InputJsonValue;
}

function compareOptionalDates(candidate: Date | null, current: Date | null) {
  if (candidate === null && current === null) return 0;
  if (candidate === null) return -1;
  if (current === null) return 1;
  return candidate.getTime() - current.getTime();
}

function validRevisionId(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function validDate(value: unknown) {
  if (!(value instanceof Date) && typeof value !== "string") return null;
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function buildSyncedIdentityKey(match: any, identity: ReturnType<typeof buildMatchIdentity>) {
  const teams = [
    match.teamAId || match.teamAName || "unknownA",
    match.teamBId || match.teamBName || "unknownB",
  ].map((value) => String(value).toLowerCase().trim()).sort();

  return [
    identity.date,
    identity.time,
    teams[0],
    teams[1],
    identity.stage,
    identity.round,
    identity.format,
    identity.sourceSlot,
  ].join("|");
}

function dedupeMatchIdMigrations(
  migrations: Array<{ id: string; previousMatchId: string; nextMatchId: string }>,
) {
  const uniqueByRecord = new Map<string, (typeof migrations)[number]>();
  for (const migration of migrations) {
    if (!uniqueByRecord.has(migration.id)) uniqueByRecord.set(migration.id, migration);
  }
  return Array.from(uniqueByRecord.values());
}

export async function findLiquipediaTournamentForCommit(params: {
  client: Prisma.TransactionClient;
  existingTournamentId: string | null;
  disciplineSlug: string;
  sourcePageId?: number | null;
  sourceUrl?: string | null;
  sourceTitle: string;
}) {
  if (params.existingTournamentId) {
    const byId = await params.client.tournament.findUnique({
      where: { id: params.existingTournamentId },
    });
    if (byId) return byId;
  }

  if (Number.isInteger(params.sourcePageId) && Number(params.sourcePageId) > 0) {
    const byPageId = await params.client.tournament.findFirst({
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
    canonicalizeLiquipediaSourceUrl(params.sourceUrl),
  ].map((value) => String(value || "").trim()).filter(Boolean)));
  if (sourceUrls.length > 0) {
    const byUrl = await params.client.tournament.findFirst({
      where: {
        disciplineSlug: params.disciplineSlug,
        sourceUrl: { in: sourceUrls },
      },
      orderBy: { updatedAt: "desc" },
    });
    if (byUrl) return byUrl;
  }

  return params.client.tournament.findFirst({
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

async function buildLiquipediaParticipantRows(params: {
  client: Prisma.TransactionClient;
  tournamentId: string;
  disciplineSlug: string;
  participants: any[];
}) {
  const [existingParticipants, mappings] = await Promise.all([
    params.client.tournamentParticipant.findMany({
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
    params.client.teamMapping.findMany({ where: { disciplineSlug: params.disciplineSlug } }),
  ]);
  const existingByName = new Map(existingParticipants.map((participant) => [participant.name.toLowerCase(), participant]));
  const mappingByName = new Map<string, (typeof mappings)[number]>();
  for (const mapping of mappings) {
    mappingByName.set(mapping.liquipediaName.toLowerCase(), mapping);
    for (const key of getTeamMappingLookupKeys(mapping)) {
      if (key && !mappingByName.has(key.toLowerCase())) mappingByName.set(key.toLowerCase(), mapping);
    }
  }

  const unique = new Map<string, any>();
  for (const participant of params.participants) {
    const name = String(participant?.name || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!unique.has(key)) unique.set(key, { ...participant, name });
  }

  return Array.from(unique.values()).map((participant) => {
    const key = participant.name.toLowerCase();
    const existing = existingByName.get(key);
    const mapping = mappingByName.get(key);
    const manualFields = mergeTournamentParticipantManualFields({
      incoming: participant,
      existing,
      mapping,
    });
    return {
      tournamentId: params.tournamentId,
      name: participant.name,
      ...manualFields,
    };
  });
}

async function persistMergedDiagnostics(params: {
  tournamentId: string;
  stableKey: string;
  expectedFreshness: LiquipediaImportFreshness;
  key: LiquipediaDiagnosticsKey;
  diagnostics: unknown;
}) {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`liquipedia-import:${params.stableKey}`}))`;
      const latestTournament = await tx.tournament.findUnique({
        where: { id: params.tournamentId },
        select: { normalization: true },
      });
      const normalization = mergeLiquipediaDiagnosticsNormalization({
        currentNormalization: latestTournament?.normalization,
        expectedFreshness: params.expectedFreshness,
        key: params.key,
        diagnostics: params.diagnostics,
      });
      if (!normalization) return false;

      await tx.tournament.update({
        where: { id: params.tournamentId },
        data: { normalization },
      });
      return true;
    });
  } catch {
    return false;
  }
}
