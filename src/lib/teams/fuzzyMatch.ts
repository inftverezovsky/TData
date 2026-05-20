import { prisma } from "@/lib/db/db";

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

/**
 * Returns a similarity score between 0.0 and 1.0.
 */
export function getFuzzySimilarity(a: string, b: string): number {
  const s1 = a.toLowerCase().trim();
  const s2 = b.toLowerCase().trim();

  if (s1 === s2) return 1.0;
  if (s1.includes(s2) || s2.includes(s1)) {
    // If one is a substring of the other, reward it highly (e.g. "G2 Esports" vs "G2")
    const lenDiff = Math.abs(s1.length - s2.length);
    return Math.max(0.6, 1.0 - lenDiff / Math.max(s1.length, s2.length));
  }

  const distance = levenshteinDistance(s1, s2);
  const maxLength = Math.max(s1.length, s2.length);
  return 1.0 - distance / maxLength;
}

export type FuzzyMatchResult = {
  platformId: string;
  platformName: string;
  score: number;
};

/**
 * Scans the AdminTeam database for the closest team name.
 */
export async function findClosestPlatformTeam(
  disciplineSlug: string,
  noisyTeamName: string,
  minScoreThreshold = 0.5
): Promise<FuzzyMatchResult | null> {
  const slug = disciplineSlug.trim().toLowerCase();
  const cleanNoisyName = noisyTeamName
    .replace(/[®©@|«»<>+%#§°^~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (cleanNoisyName.length < 2) return null;

  // 1. Fetch candidates from the database
  const candidates = await prisma.adminTeam.findMany({
    where: { disciplineSlug: slug },
    select: { platformId: true, platformName: true, normalizedName: true }
  });

  if (candidates.length === 0) return null;

  let bestMatch: FuzzyMatchResult | null = null;

  for (const candidate of candidates) {
    const scoreByName = getFuzzySimilarity(cleanNoisyName, candidate.platformName);
    const scoreByNorm = getFuzzySimilarity(cleanNoisyName, candidate.normalizedName);
    const score = Math.max(scoreByName, scoreByNorm);

    if (score >= minScoreThreshold) {
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = {
          platformId: candidate.platformId,
          platformName: candidate.platformName,
          score
        };
      }
    }
  }

  return bestMatch;
}
