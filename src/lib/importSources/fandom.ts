import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/db";
import { getFandomLolApiUrl } from "@/lib/config/env";
import {
  classifyFandomError,
  fetchFandomParsedPage,
  fetchFandomMatchScheduleCargo,
  makeFandomPageUrl,
  titleFromFandomUrl,
  type FandomParsedPage,
} from "@/lib/fandom/client";
import { normalizeFandomLeagueOfLegendsTournament } from "@/lib/fandom/leagueoflegends";
import { dedupeTournamentMatches } from "@/lib/matches/dedupe";
import {
  buildMatchCandidateMetadata,
  computeMatchSetQuality,
  getMatchSourceConfidence,
  hasPlaceholderTeams,
} from "@/lib/matches/quality";
import { resolveExactMatchDate } from "@/lib/matches/time";
import { IMPORT_MATCH_FUTURE_WINDOW_DAYS, IMPORT_MATCH_PAST_GRACE_DAYS, titleKey } from "@/lib/liquipedia/importer/helpers";
import { canonicalizeMatchesWithTournamentTeams } from "@/lib/liquipedia/importer/helpers";
import {
  clearSourceFetchCache,
  findSourceFetchCache,
  isSourceCacheFresh,
  isSourceCacheStaleUsable,
  markSourceFetchAttempt,
  markSourceFetchFailure,
  markSourceFetchSuccess,
  SOURCE_CACHE_TTL_MS,
  type SourceFetchCacheRecord,
} from "@/lib/utils/sourceFetchCache";
import { getTeamMappingLookupKeys } from "@/lib/teams/canonicalize";
import { generateInternalTeamId, isPlaceholderTeam } from "@/lib/teams/teams";

type ImportFandomTournamentInput = {
  slug: string;
  disciplineId: string;
  pageId?: number;
  title: string;
  pageUrl?: string;
  force?: boolean;
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
    const cargoMatches = await fetchFandomMatchScheduleCargo({
      overviewPage: page.title,
    }).catch(() => []);

    const normalized = normalizeFandomLeagueOfLegendsTournament({
      pageId: page.pageId,
      title: page.title,
      pageUrl: page.pageUrl,
      wikitext: page.wikitext,
      parsedHtml: page.html,
      cargoMatches,
    });

    normalized.cacheHit = page.cacheHit;
    normalized.cacheLayer = page.cacheLayer;
    normalized.stale = page.stale;
    normalized.warning = page.warning;
    normalized.requestStats = { externalRequests: page.externalRequests };

    const tournament = await prisma.tournament.upsert({
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
    });

    const qualityScore = computeMatchSetQuality(matches);
    await updateFandomSnapshotQuality(page.rawSnapshotId, qualityScore, matches.length).catch(() => {});
    await prisma.tournament.update({
      where: { id: tournament.id },
      data: {
        normalization: {
          ...(buildNormalizationJson(normalized) as Record<string, unknown>),
          qualityScore,
        sourceBreakdown: {
            fandom: {
              pageTitle: page.title,
              pageId: page.pageId ?? null,
              matches: matches.length,
              cargoMatches: cargoMatches.length,
              cacheHit: page.cacheHit,
              cacheLayer: page.cacheLayer,
              stale: page.stale,
            },
          },
        } as Prisma.InputJsonValue,
      },
    });

    await prisma.tournamentImport.update({
      where: { id: tournamentImport.id },
      data: { status: normalized.status, finishedAt: new Date() },
    });

    const fullTournament = await prisma.tournament.findUnique({
      where: { id: tournament.id },
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
          cacheHit: page.cacheHit,
          cacheLayer: page.cacheLayer,
          stale: page.stale,
        },
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось загрузить Fandom турнир";
    await prisma.tournamentImport.update({
      where: { id: tournamentImport.id },
      data: { status: "FAILED", finishedAt: new Date(), errorMessage: message },
    });
    throw error;
  }
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
  let sourceCache: SourceFetchCacheRecord | null = null;

  if (params.force) {
    await clearFandomPageCaches(params.disciplineSlug, params.title, params.pageUrl);
  } else {
    sourceCache = await findSourceFetchCache(cacheInput);
    if (sourceCache?.rawSnapshotId && isSourceCacheFresh(sourceCache)) {
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
        };
      }
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

    await markSourceFetchSuccess(cacheInput, {
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
    });

    return {
      ...page,
      rawSnapshotId: rawSnapshot.id,
      cacheHit,
      cacheLayer: "network",
      stale,
      warning,
      externalRequests,
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
        };
      }
    }

    throw error;
  }
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

async function clearFandomPageCaches(disciplineSlug: string, title: string, pageUrl?: string | null) {
  const variants = new Set([title, title.replace(/_/g, " "), title.replace(/ /g, "_")]);
  if (pageUrl) {
    const fromUrl = titleFromFandomUrl(pageUrl);
    variants.add(fromUrl);
    variants.add(fromUrl.replace(/_/g, " "));
    variants.add(fromUrl.replace(/ /g, "_"));
  }

  await Promise.all([
    prisma.rawSnapshot.deleteMany({
      where: {
        source: { startsWith: "fandom" },
        disciplineSlug,
        pageTitle: { in: [...variants] },
      },
    }),
    Promise.all([...variants].map((variant) => clearSourceFetchCache({
      source: "fandom",
      disciplineSlug,
      resourceType: "page",
      resourceKey: titleKey(variant),
    }))),
  ]);
}

async function saveFandomTournamentData(params: {
  tournamentId: string;
  slug: string;
  title: string;
  participants: any[];
  matches: any[];
  force: boolean;
}) {
  const teamMappings = await prisma.teamMapping.findMany({ where: { disciplineSlug: params.slug } });
  const mappingLookup = new Map<string, (typeof teamMappings)[number]>();
  for (const mapping of teamMappings) {
    mappingLookup.set(mapping.liquipediaName.toLowerCase(), mapping);
    for (const key of getTeamMappingLookupKeys(mapping)) {
      if (key) mappingLookup.set(key.toLowerCase(), mapping);
    }
  }

  const participantsToInsert = params.participants.map((participant) => {
    const mapping = mappingLookup.get(String(participant.name || "").toLowerCase());
    return {
      tournamentId: params.tournamentId,
      name: participant.name,
      platformId: mapping?.platformId || null,
      seed: participant.seed || null,
      region: participant.region || null,
      status: participant.status || null,
      logoUrl: participant.logoUrl || mapping?.logoUrl || null,
      rawText: participant.rawText || null,
    };
  });

  await prisma.$transaction([
    prisma.tournamentParticipant.deleteMany({ where: { tournamentId: params.tournamentId } }),
    ...(participantsToInsert.length > 0
      ? [prisma.tournamentParticipant.createMany({ data: participantsToInsert, skipDuplicates: true })]
      : []),
    ...(params.force ? [prisma.tournamentMatch.deleteMany({ where: { tournamentId: params.tournamentId } })] : []),
  ]);

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

  await canonicalizeMatchesWithTournamentTeams(matches, params.tournamentId, params.slug);

  const existingMatches = params.force
    ? []
    : await prisma.tournamentMatch.findMany({
        where: { tournamentId: params.tournamentId },
        select: { matchId: true, platformId: true, lpNumericalId: true, syncedAt: true },
      });
  const existingById = new Map(existingMatches.map((match) => [match.matchId, match]));

  for (const match of matches) {
    if (match.teamAName && !isPlaceholderTeam(match.teamAName)) matchTeamNames.add(match.teamAName);
    if (match.teamBName && !isPlaceholderTeam(match.teamBName)) matchTeamNames.add(match.teamBName);
  }

  const upserts = dedupeTournamentMatches(matches).map((match: any) => {
    const existing = existingById.get(match.matchId);
    return prisma.tournamentMatch.upsert({
      where: { matchId: match.matchId },
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
        lpNumericalId: match.lpNumericalId,
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
        teamAId: match.teamAId,
        teamAName: match.teamAName,
        teamBId: match.teamBId,
        teamBName: match.teamBName,
        format: match.format,
        status: match.status,
        court: match.court,
        sourceUrl: match.sourceUrl,
        rawText: match.rawText,
        platformId: existing?.platformId || undefined,
        syncedAt: existing?.syncedAt || undefined,
        hasPlaceholderTeams: hasPlaceholderTeams(match),
        sourceConfidence: getMatchSourceConfidence(match),
        sourceBreakdown: buildMatchCandidateMetadata(match, "fandom") as Prisma.InputJsonValue,
      },
    });
  });

  if (upserts.length > 0) await prisma.$transaction(upserts);

  const existingMappingNames = new Set(teamMappings.map((mapping) => mapping.liquipediaName.toLowerCase()));
  const newMappings = [...matchTeamNames]
    .filter((name) => !existingMappingNames.has(name.toLowerCase()))
    .map((name) => ({ disciplineSlug: params.slug, liquipediaName: name }));
  if (newMappings.length > 0) {
    await prisma.teamMapping.createMany({ data: newMappings, skipDuplicates: true }).catch(() => {});
  }

  return dedupeTournamentMatches(matches);
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
  } as Prisma.InputJsonValue;
}

function getSnapshotPageUrl(snapshot: { metadata?: unknown }) {
  const metadata = snapshot.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const record = metadata as Record<string, unknown>;
  return typeof record.pageUrl === "string" ? record.pageUrl : null;
}
