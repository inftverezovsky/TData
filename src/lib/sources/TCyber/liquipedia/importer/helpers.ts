import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/db";
import { clearCachedSearchPageMetadata } from "@/lib/sources/TCyber/liquipedia/client";
import { clearSourceFetchCache } from "@/lib/utils/sourceFetchCache";
import {
  buildTeamNameCanonicalizer,
  canonicalizeMatchTeams,
  getTeamMappingLookupKeys,
} from "@/lib/teams/canonicalize";
import { isPlaceholderTeam } from "@/lib/teams/teams";
import { hasPlaceholderTeams } from "@/lib/matches/quality";

export const IMPORT_MATCH_FUTURE_WINDOW_DAYS = Number(process.env.IMPORT_MATCH_FUTURE_WINDOW_DAYS || 365);
export const IMPORT_MATCH_PAST_GRACE_DAYS = Number(process.env.IMPORT_MATCH_PAST_GRACE_DAYS || 0);

export type ForceRefreshCleanupStats = {
  tournamentId: string | null;
  matchesDeleted: number;
  participantsDeleted: number;
  rawSnapshotsDeleted: number;
  sourceFetchCachesDeleted: number;
  fileCachesDeleted: number;
};

export async function clearTournamentForceRefreshState(params: {
  disciplineSlug: string;
  pageId?: number;
  title: string;
  pageUrl?: string | null;
}): Promise<ForceRefreshCleanupStats> {
  const titleVariants = getTitleVariants(params.title, params.pageUrl, params.disciplineSlug);
  const tournament = await prisma.tournament.findFirst({
    where: {
      disciplineSlug: params.disciplineSlug,
      OR: [
        { sourceTitle: { in: [...titleVariants] } },
        ...(params.pageUrl ? [{ sourceUrl: params.pageUrl }] : []),
        ...(params.pageId ? [{ sourcePageId: params.pageId }] : []),
      ],
    },
    select: { id: true, sourceTitle: true },
  });

  if (tournament?.sourceTitle) {
    for (const variant of getTitleVariants(tournament.sourceTitle, null, params.disciplineSlug)) {
      titleVariants.add(variant);
    }
  }

  let matchesDeleted = 0;
  let participantsDeleted = 0;
  if (tournament?.id) {
    const [matches, participants] = await prisma.$transaction([
      prisma.tournamentMatch.deleteMany({ where: { tournamentId: tournament.id } }),
      prisma.tournamentParticipant.deleteMany({ where: { tournamentId: tournament.id } }),
    ]);
    matchesDeleted = matches.count;
    participantsDeleted = participants.count;

    await prisma.tournament.update({
      where: { id: tournament.id },
      data: {
        extractionStatus: "PENDING",
        normalization: {
          forceRefresh: true,
          cacheClearedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    }).catch(() => {});
  }

  const pageCacheStats = await Promise.all(
    [...titleVariants].map((title) => clearPageFetchCaches(params.disciplineSlug, title))
  );

  return {
    tournamentId: tournament?.id ?? null,
    matchesDeleted,
    participantsDeleted,
    rawSnapshotsDeleted: pageCacheStats.reduce((sum, item) => sum + item.rawSnapshotsDeleted, 0),
    sourceFetchCachesDeleted: pageCacheStats.reduce((sum, item) => sum + item.sourceFetchCachesDeleted, 0),
    fileCachesDeleted: pageCacheStats.reduce((sum, item) => sum + item.fileCachesDeleted, 0),
  };
}

export async function clearPageFetchCaches(disciplineSlug: string, title: string) {
  const titleVariants = getTitleVariants(title, null, disciplineSlug);
  const [rawSnapshotsResult, sourceFetchResults] = await Promise.all([
    prisma.rawSnapshot.deleteMany({
      where: {
        pageTitle: { in: [...titleVariants] },
        OR: [
          { disciplineSlug },
          { disciplineSlug: null },
        ],
      },
    }),
    Promise.all([...titleVariants].map((variant) => clearSourceFetchCache({
      source: "liquipedia",
      disciplineSlug,
      resourceType: "page",
      resourceKey: titleKey(variant),
    }))),
  ]);

  const fileCachesDeleted = [...titleVariants].reduce(
    (count, variant) => count + clearCachedSearchPageMetadata(disciplineSlug, variant),
    0
  );

  return {
    rawSnapshotsDeleted: rawSnapshotsResult.count,
    sourceFetchCachesDeleted: sourceFetchResults.reduce((sum, result) => sum + result.count, 0),
    fileCachesDeleted,
  };
}

export function getTitleVariants(title: string, pageUrl: string | null | undefined, disciplineSlug: string) {
  const variants = new Set<string>();
  const add = (value?: string | null) => {
    const cleaned = String(value || "").trim();
    if (!cleaned) return;
    variants.add(cleaned);
    variants.add(cleaned.replace(/_/g, " "));
    variants.add(cleaned.replace(/ /g, "_"));
  };

  add(title);
  if (pageUrl) add(titleFromLiquipediaUrl(pageUrl, disciplineSlug));

  return variants;
}

export async function canonicalizeMatchesWithTournamentTeams(matches: any[], tournamentId: string, disciplineSlug: string) {
  const [participants, mappings] = await Promise.all([
    prisma.tournamentParticipant.findMany({
      where: { tournamentId },
      select: { name: true, rawText: true, platformId: true, logoUrl: true },
    }),
    prisma.teamMapping.findMany({ where: { disciplineSlug } }),
  ]);

  const canonicalizer = buildTeamNameCanonicalizer({
    participants,
    mappings,
    extraNames: matches.flatMap((match: any) => [match.teamAName, match.teamBName]),
  });

  for (const match of matches) {
    Object.assign(match, canonicalizeMatchTeams(match, canonicalizer));
  }
}

export async function appendTournamentWarning(tournamentId: string, warning: string) {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { normalization: true },
  });
  const normalization = isPlainObject(tournament?.normalization)
    ? tournament?.normalization as Record<string, unknown>
    : {};
  const existingWarnings = Array.isArray(normalization.warnings)
    ? normalization.warnings.filter((item): item is string => typeof item === "string")
    : [];

  await prisma.tournament.update({
    where: { id: tournamentId },
    data: {
      extractionStatus: "PARTIAL",
      normalization: {
        ...normalization,
        warnings: Array.from(new Set([...existingWarnings, warning])),
        qualityGateKeptPrevious: true,
      } as Prisma.InputJsonValue,
    },
  });
}

export function extractRevisionId(rawJson: any) {
  const revision = rawJson?.query?.pages?.[0]?.revisions?.[0];
  return typeof revision?.revid === "number" ? revision.revid : null;
}

export function extractRevisionTimestamp(rawJson: any) {
  const revision = rawJson?.query?.pages?.[0]?.revisions?.[0];
  if (!revision?.timestamp) return null;
  const parsed = new Date(revision.timestamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function buildMatchIdentity(match: any) {
  const parsedDate = parseMatchDate(match);
  const placeholder = hasPlaceholderTeams(match);
  const sourceSlot = placeholder
    ? normalizeIdentityPart(match.rawText || match.sourceUrl || match.matchId)
    : (parsedDate || match.matchDateTime ? "" : normalizeIdentityPart(match.matchId));

  return {
    date: parsedDate ? parsedDate.toISOString().slice(0, 10) : "no-date",
    time: parsedDate ? parsedDate.toISOString().slice(11, 16) : normalizeIdentityPart(match.matchDateTime),
    stage: normalizeIdentityPart(match.stage),
    round: normalizeIdentityPart(match.round),
    format: normalizeIdentityPart(match.format),
    sourceSlot,
  };
}

export function parseMatchDate(match: any): Date | null {
  if (match.matchDate) {
    const date = new Date(match.matchDate);
    if (!Number.isNaN(date.getTime())) return date;
  }

  if (match.matchDateTime) {
    const cleaned = String(match.matchDateTime)
      .replace(/\s*-\s*/, " ")
      .replace(/\s+[A-Z]{2,5}$/, "")
      .trim();
    const parsed = new Date(`${cleaned}Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return null;
}

export function normalizeIdentityPart(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isFinishedMatchStatus(status: unknown) {
  return /\b(finished|completed|complete|closed|done|walkover|cancelled|canceled)\b/i.test(String(status || ""));
}

export function titleFromLiquipediaUrl(pageUrl: string, disciplineSlug: string) {
  try {
    const parsed = new URL(pageUrl);
    const marker = `/${disciplineSlug}/`;
    const markerIndex = parsed.pathname.indexOf(marker);
    if (markerIndex >= 0) {
      return decodeURIComponent(parsed.pathname.slice(markerIndex + marker.length)).replace(/_/g, " ");
    }
  } catch {
    // Fall back below.
  }

  return decodeURIComponent(pageUrl.split("/").filter(Boolean).slice(-2).join("/")).replace(/_/g, " ");
}

export function titleKey(title: string) {
  return title.replace(/_/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}
