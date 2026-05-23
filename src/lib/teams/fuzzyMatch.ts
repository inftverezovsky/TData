import { prisma } from "@/lib/db/db";

export type PlatformTeamCandidate = {
  platformId: string;
  platformName: string;
  normalizedName?: string | null;
};

/**
 * Calculates the Levenshtein distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  const tmp = [];
  let i, j;
  const alen = a.length;
  const blen = b.length;

  if (alen === 0) return blen;
  if (blen === 0) return alen;

  for (i = 0; i <= alen; i++) {
    tmp[i] = [i];
  }
  for (j = 0; j <= blen; j++) {
    tmp[0][j] = j;
  }

  for (i = 1; i <= alen; i++) {
    for (j = 1; j <= blen; j++) {
      tmp[i][j] = Math.min(
        tmp[i - 1][j] + 1,
        tmp[i][j - 1] + 1,
        tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }

  return tmp[alen][blen];
}

export type FuzzyMatchResult = {
  platformId: string;
  platformName: string;
  score: number;
};

/**
 * Returns a similarity score between 0.0 and 1.0.
 * It treats swapped human names as equal, e.g. "Волин Лев" and "Лев Волин".
 */
export function getFuzzySimilarity(a: string, b: string): number {
  return getNameMatchScore(a, b);
}

export function getNameMatchScore(a: string | null | undefined, b: string | null | undefined): number {
  const variantsA = getFuzzyNameVariants(a);
  const variantsB = getFuzzyNameVariants(b);

  if (variantsA.length === 0 || variantsB.length === 0) return 0;

  let bestScore = 0;

  for (const left of variantsA) {
    for (const right of variantsB) {
      bestScore = Math.max(bestScore, getLinearSimilarity(left, right));
    }
  }

  const sortedA = sortNameTokens(variantsA[0]);
  const sortedB = sortNameTokens(variantsB[0]);
  if (sortedA && sortedB) {
    bestScore = Math.max(bestScore, getLinearSimilarity(sortedA, sortedB));
  }

  return bestScore;
}

export function normalizeFuzzyName(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\[\[([^|\]]+\|)?([^\]]+)\]\]/g, "$2")
    .replace(/\{\{[^}]+\}\}/g, "")
    .replace(/ё/g, "е")
    .replace(/[®©@«»<>%#§°^~]/g, " ")
    .replace(/[\\/|&+]/g, " ")
    .replace(/[.,()[\]{}:;!?'"`]/g, " ")
    .replace(/[-_]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getFuzzyNameVariants(value: string | null | undefined) {
  const normalized = normalizeFuzzyName(value);
  if (!normalized) return [];

  const variants = new Set<string>([normalized]);
  const tokens = normalized.split(" ").filter(Boolean);

  if (tokens.length >= 2 && tokens.length <= 4) {
    variants.add([...tokens].reverse().join(" "));
  }

  const sorted = sortNameTokens(normalized);
  if (sorted) variants.add(sorted);

  return Array.from(variants).filter(Boolean);
}

export function scorePlatformTeamCandidate(
  noisyTeamName: string,
  candidate: Pick<PlatformTeamCandidate, "platformName" | "normalizedName">
) {
  return Math.max(
    getNameMatchScore(noisyTeamName, candidate.platformName),
    getNameMatchScore(noisyTeamName, candidate.normalizedName || "")
  );
}

export function findClosestPlatformTeamFromCandidates(
  candidates: PlatformTeamCandidate[],
  noisyTeamName: string,
  minScoreThreshold = 0.5
): FuzzyMatchResult | null {
  const cleanNoisyName = normalizeFuzzyName(noisyTeamName);
  if (cleanNoisyName.length < 2) return null;

  let bestMatch: FuzzyMatchResult | null = null;

  for (const candidate of candidates) {
    const score = scorePlatformTeamCandidate(cleanNoisyName, candidate);

    if (score >= minScoreThreshold && (!bestMatch || score > bestMatch.score)) {
      bestMatch = {
        platformId: candidate.platformId,
        platformName: candidate.platformName,
        score,
      };
    }
  }

  return bestMatch;
}

/**
 * Scans the AdminTeam database for the closest team name.
 */
export async function findClosestPlatformTeam(
  disciplineSlug: string,
  noisyTeamName: string,
  minScoreThreshold = 0.5
): Promise<FuzzyMatchResult | null> {
  const slug = disciplineSlug.trim().toLowerCase();
  const cleanNoisyName = normalizeFuzzyName(noisyTeamName);

  if (cleanNoisyName.length < 2) return null;

  // 1. Fetch candidates from the database
  const candidates = await prisma.adminTeam.findMany({
    where: { disciplineSlug: slug },
    select: { platformId: true, platformName: true, normalizedName: true }
  });

  if (candidates.length === 0) return null;

  return findClosestPlatformTeamFromCandidates(candidates, cleanNoisyName, minScoreThreshold);
}

function getLinearSimilarity(a: string, b: string): number {
  const s1 = normalizeFuzzyName(a);
  const s2 = normalizeFuzzyName(b);

  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1.0;
  if (s1.includes(s2) || s2.includes(s1)) {
    // If one is a substring of the other, reward it highly (e.g. "G2 Esports" vs "G2").
    const lenDiff = Math.abs(s1.length - s2.length);
    return Math.max(0.6, 1.0 - lenDiff / Math.max(s1.length, s2.length));
  }

  const distance = levenshteinDistance(s1, s2);
  const maxLength = Math.max(s1.length, s2.length);
  return maxLength === 0 ? 0 : 1.0 - distance / maxLength;
}

function sortNameTokens(value: string) {
  const tokens = normalizeFuzzyName(value).split(" ").filter(Boolean);
  if (tokens.length < 2) return "";
  return [...tokens].sort((a, b) => a.localeCompare(b, "ru")).join(" ");
}
