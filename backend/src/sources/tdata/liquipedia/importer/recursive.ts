import { Prisma } from "@prisma/client";
import { prisma } from "@backend/db/db";
import {
  finalizeDota2Diagnostics,
  finalizeEsportsParsingDiagnostics,
  mergeDota2Diagnostics,
  mergeEsportsParsingDiagnostics,
} from "@backend/matches/parsingDiagnostics";
import { processSinglePage } from "./singlePage";
import { resolveSubpageConcurrency } from "./options";
import { publishTournamentSnapshot } from "./persistence";
import { mergeParticipantCandidates } from "./participants";
import {
  clearTournamentForceRefreshState,
  canonicalizeMatchesWithTournamentTeams,
  appendTournamentWarning,
  titleFromLiquipediaUrl,
  buildMatchIdentity,
  isPlainObject,
  ForceRefreshCleanupStats,
} from "./helpers";
import { dedupeTournamentMatches } from "@backend/matches/dedupe";
import type { NormalizedTournament } from "@backend/normalizers/types";
import {
  buildMatchCandidateMetadata,
  computeMatchSetQuality,
  getMatchSourceConfidence,
  hasPlaceholderTeams,
} from "@backend/matches/quality";
import { createHash } from "crypto";

/**
 * Собрать главную страницу и подстраницы → согласовать команды и идентификаторы →
 * убрать дубли → проверить качество → атомарно опубликовать расписание.
 * Слабый новый результат сохраняет прежние матчи и участников.
 * Force требует свежую загрузку, сохраняя ту же проверку качества и атомарную запись.
 */
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

  // 1. Главная страница задаёт турнир и состав участников; матчи пока собираются в памяти.
  const mainResult = await processSinglePage({
    disciplineId,
    disciplineSlug,
    apiUrl,
    pageId,
    title,
    pageUrl,
    normalizer,
    importRecordId,
    force
  });

  const allParticipants = [...mainResult.participants];
  let sourceHadError = Boolean(mainResult.warning);
  const allMatches = [...(mainResult.matches || [])];
  const allMatchIds = [...(mainResult.processedMatchIds || [])];
  const dota2Diagnostics = [mainResult.normalized.dota2Diagnostics];
  const leagueOfLegendsDiagnostics = [mainResult.normalized.leagueOfLegendsDiagnostics];
  const valorantDiagnostics = [mainResult.normalized.valorantDiagnostics];
  let finalProcessedMatchIds = allMatchIds;
  let finalSavedMatchCount = allMatches.length;
  let finalDuplicateMatchCount = 0;

  // 2. Подстраницы обрабатываются ограниченными пакетами; сбой одной не отменяет остальные.
  if (mainResult.normalized.subPages && mainResult.normalized.subPages.length > 0) {
    const subPages = mainResult.normalized.subPages;
    const concurrency = resolveSubpageConcurrency(process.env.LIQUIPEDIA_SUBPAGE_CONCURRENCY);
    console.log(`[Importer] Found ${subPages.length} sub-pages for ${title} (concurrency=${concurrency})`);

    for (let batchStart = 0; batchStart < subPages.length; batchStart += concurrency) {
      const batch = subPages.slice(batchStart, batchStart + concurrency);
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
            tournamentId: mainResult.tournament.id
          });
        })
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          allParticipants.push(...result.value.participants);
          sourceHadError ||= Boolean(result.value.warning);
          if (result.value.matches) allMatches.push(...result.value.matches);
          if (result.value.processedMatchIds) finalProcessedMatchIds.push(...result.value.processedMatchIds);
          if (result.value.normalized.dota2Diagnostics) dota2Diagnostics.push(result.value.normalized.dota2Diagnostics);
          if (result.value.normalized.leagueOfLegendsDiagnostics) {
            leagueOfLegendsDiagnostics.push(result.value.normalized.leagueOfLegendsDiagnostics);
          }
          if (result.value.normalized.valorantDiagnostics) {
            valorantDiagnostics.push(result.value.normalized.valorantDiagnostics);
          }
        } else {
          sourceHadError = true;
          console.error(`[Importer] Failed to process sub-page:`, result.reason);
        }
      }
    }
  }

  // 3. Прежний снимок нужен для оценки качества и сохранения отметок уже отправленных матчей.
  const existingBeforeFinal = await prisma.tournamentMatch.findMany({
    where: { tournamentId: mainResult.tournament.id }
  });
  const participants = mergeParticipantCandidates(allParticipants);
  let finalMatches = allMatches;
  let qualityScore = computeMatchSetQuality(allMatches, existingBeforeFinal);
  let qualityGateWarning: string | null = null;
  let qualityGateKeptPrevious = false;

  if (allMatches.length > 0) {
    console.log(`[Importer] Performing final bulk insert of ${allMatches.length} matches...`);
    await canonicalizeMatchesWithTournamentTeams(allMatches, mainResult.tournament.id, disciplineSlug, participants);
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
    
    // Один ключ главного турнира делает идентификатор матча независимым от его подстраницы.
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
    finalDuplicateMatchCount = Math.max(0, allMatches.length - deduplicatedMatches.length);
    finalProcessedMatchIds = deduplicatedMatches.map((match: any) => match.matchId).filter(Boolean);
    qualityScore = computeMatchSetQuality(deduplicatedMatches, existingBeforeFinal);

    if (deduplicatedMatches.length !== allMatches.length) {
      console.log(`[Importer] Removed ${allMatches.length - deduplicatedMatches.length} duplicate matches before insert.`);
    }

    finalMatches = deduplicatedMatches;
  }

  const publication = await publishTournamentSnapshot(
    prisma, mainResult.tournament.id, finalMatches, participants, sourceHadError,
  );
  qualityGateKeptPrevious = publication.keptPrevious;
  qualityScore = publication.qualityScore;
  finalProcessedMatchIds = publication.matches.map((match) => match.matchId);
  finalSavedMatchCount = publication.matches.length;
  if (qualityGateKeptPrevious) {
    qualityGateWarning = `Новый импорт не прошёл проверку качества (${finalMatches.length} кандидатов, quality=${qualityScore}). Прежние ${finalSavedMatchCount} матчей и участники сохранены.`;
    await appendTournamentWarning(mainResult.tournament.id, qualityGateWarning);
    console.warn(`[Importer] ${qualityGateWarning}`);
  }

  // 4. Диагностика отражает реально сохранённый результат, включая решение оставить старый снимок.
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

async function persistMergedDiagnostics(params: {
  tournamentId: string;
  key: "dota2Diagnostics" | "leagueOfLegendsDiagnostics" | "valorantDiagnostics";
  diagnostics: unknown;
}) {
  const latestTournament = await prisma.tournament.findUnique({
    where: { id: params.tournamentId },
    select: { normalization: true },
  });
  const normalization = isPlainObject(latestTournament?.normalization)
    ? latestTournament?.normalization as Record<string, unknown>
    : {};

  await prisma.tournament.update({
    where: { id: params.tournamentId },
    data: {
      normalization: {
        ...normalization,
        [params.key]: params.diagnostics,
      } as Prisma.InputJsonValue,
    },
  }).catch(() => {});
}
