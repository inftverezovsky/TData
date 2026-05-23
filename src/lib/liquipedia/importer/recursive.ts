import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/db";
import { processSinglePage } from "./singlePage";
import {
  clearTournamentForceRefreshState,
  canonicalizeMatchesWithTournamentTeams,
  appendTournamentWarning,
  titleFromLiquipediaUrl,
  buildMatchIdentity,
  ForceRefreshCleanupStats,
} from "./helpers";
import { dedupeTournamentMatches } from "@/lib/matches/dedupe";
import type { NormalizedTournament } from "@/lib/normalizers/types";
import {
  buildMatchCandidateMetadata,
  computeMatchSetQuality,
  getMatchSourceConfidence,
  hasPlaceholderTeams,
  shouldKeepPreviousMatches,
} from "@/lib/matches/quality";
import { createHash } from "crypto";

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
  let forceCleanupStats: ForceRefreshCleanupStats | null = null;

  if (force) {
    forceCleanupStats = await clearTournamentForceRefreshState({
      disciplineSlug,
      pageId,
      title,
      pageUrl,
    });
    console.log(
      `[Importer] Force refresh cleanup for ${title}: `
      + `${forceCleanupStats.matchesDeleted} matches, `
      + `${forceCleanupStats.participantsDeleted} participants, `
      + `${forceCleanupStats.rawSnapshotsDeleted} snapshots, `
      + `${forceCleanupStats.sourceFetchCachesDeleted} source cache rows, `
      + `${forceCleanupStats.fileCachesDeleted} file caches.`
    );
  }

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
    clearMatches: true // This will wipe the matches for this tournamentId initially
  });

  const allMatches = [...(mainResult.matches || [])];
  const allMatchIds = [...(mainResult.processedMatchIds || [])];
  let finalProcessedMatchIds = allMatchIds;

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
            tournamentId: mainResult.tournament.id,
            clearMatches: false // DON'T wipe matches on sub-pages!
          });
        })
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          if (result.value.matches) allMatches.push(...result.value.matches);
          if (result.value.processedMatchIds) finalProcessedMatchIds.push(...result.value.processedMatchIds);
        } else {
          console.error(`[Importer] Failed to process sub-page:`, result.reason);
        }
      }
    }
  }

  // 3. FINAL BULK INSERT (One big push for everything!)
  const existingBeforeFinal = await prisma.tournamentMatch.findMany({
    where: { tournamentId: mainResult.tournament.id }
  });
  let qualityScore = computeMatchSetQuality(allMatches, existingBeforeFinal);
  let qualityGateWarning: string | null = null;
  let qualityGateKeptPrevious = false;

  if (allMatches.length > 0) {
    console.log(`[Importer] Performing final bulk insert of ${allMatches.length} matches...`);
    await canonicalizeMatchesWithTournamentTeams(allMatches, mainResult.tournament.id, disciplineSlug);
    const existingSyncedByMatchId = new Map(
      existingBeforeFinal
        .filter((match: any) => match.syncedAt)
        .map((match: any) => [match.matchId, match.syncedAt])
    );
    const existingSyncedByIdentity = new Map(
      existingBeforeFinal
        .filter((match: any) => match.syncedAt)
        .map((match: any) => [buildSyncedIdentityKey(match, buildMatchIdentity(match)), match.syncedAt])
    );
    
    // RE-ASSIGN matchIds consistently using the FULL tournament title
    const mainTournamentKey = title.trim();
    for (const m of allMatches) {
      const identity = buildMatchIdentity(m);
      const teams = [m.teamAId || "unknownA", m.teamBId || "unknownB"].sort();
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
      m.matchId = `match_${hash}`;
      m.lpNumericalId = BigInt("0x" + hash.substring(0, 15)) % 9007199254740991n;
      m.tournamentId = mainResult.tournament.id;
      m.hasPlaceholderTeams = hasPlaceholderTeams(m);
      m.sourceConfidence = getMatchSourceConfidence(m);
      m.sourceBreakdown = buildMatchCandidateMetadata(m, "liquipedia") as Prisma.InputJsonValue;
      m.syncedAt = m.syncedAt || existingSyncedByMatchId.get(m.matchId) || existingSyncedByIdentity.get(buildSyncedIdentityKey(m, identity)) || null;
      (m as any)._identity = identity;
    }

    const deduplicatedMatches = dedupeTournamentMatches(allMatches).map(m => {
      const { _identity, ...rest } = m;
      return rest;
    });
    finalProcessedMatchIds = deduplicatedMatches.map((match: any) => match.matchId).filter(Boolean);
    qualityScore = computeMatchSetQuality(deduplicatedMatches, existingBeforeFinal);

    if (deduplicatedMatches.length !== allMatches.length) {
      console.log(`[Importer] Removed ${allMatches.length - deduplicatedMatches.length} duplicate matches before insert.`);
    }

    qualityGateKeptPrevious = !force && shouldKeepPreviousMatches({
      newMatches: deduplicatedMatches,
      previousMatches: existingBeforeFinal,
      newQualityScore: qualityScore,
      sourceHadError: Boolean(mainResult.warning),
    });

    if (qualityGateKeptPrevious) {
      qualityGateWarning = `Новый импорт выглядит хуже предыдущего snapshot (${deduplicatedMatches.length} vs ${existingBeforeFinal.length} матчей, quality=${qualityScore}). Старые матчи сохранены.`;
      finalProcessedMatchIds = existingBeforeFinal.map((match: any) => match.matchId).filter(Boolean);
      await appendTournamentWarning(mainResult.tournament.id, qualityGateWarning);
      console.warn(`[Importer] ${qualityGateWarning}`);
    } else {
      await prisma.tournamentMatch.deleteMany({
        where: { tournamentId: mainResult.tournament.id }
      });

      await prisma.tournamentMatch.createMany({
        data: deduplicatedMatches,
        skipDuplicates: true
      });
    }
  } else {
    qualityGateKeptPrevious = !force && shouldKeepPreviousMatches({
      newMatches: [],
      previousMatches: existingBeforeFinal,
      newQualityScore: qualityScore,
      sourceHadError: Boolean(mainResult.warning),
    });

    if (qualityGateKeptPrevious) {
      qualityGateWarning = `Источник вернул 0 матчей, поэтому предыдущие ${existingBeforeFinal.length} матчей сохранены.`;
      finalProcessedMatchIds = existingBeforeFinal.map((match: any) => match.matchId).filter(Boolean);
      await appendTournamentWarning(mainResult.tournament.id, qualityGateWarning);
      console.warn(`[Importer] ${qualityGateWarning}`);
    } else {
      await prisma.tournamentMatch.deleteMany({
        where: { tournamentId: mainResult.tournament.id }
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
