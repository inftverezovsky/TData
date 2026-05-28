import { prisma } from "@/lib/db/db";

export type PlatformTeamCandidate = {
  platformId: string;
  platformName: string;
  platformNameRu?: string | null;
  platformNameEn?: string | null;
  normalizedName?: string | null;
  normalizedNameRu?: string | null;
  normalizedNameEn?: string | null;
};

export type PlatformTeamMatchMethod =
  | "none"
  | "exact"
  | "alias_exact"
  | "pair_exact"
  | "pair_fuzzy"
  | "initials_fuzzy"
  | "translit_fuzzy"
  | "token_fuzzy";

export type PlatformTeamScore = {
  score: number;
  matchedName: string | null;
  matchMethod: PlatformTeamMatchMethod;
};

export type FuzzyMatchResult = {
  platformId: string;
  platformName: string;
  score: number;
  matchedName: string | null;
  matchMethod: PlatformTeamMatchMethod;
};

type VariantKind = "base" | "reordered" | "sorted" | "compact" | "generic" | "translit";

type FuzzyNameVariant = {
  value: string;
  kind: VariantKind;
  matchMethod: PlatformTeamMatchMethod;
  fromGeneric?: boolean;
  fromTranslit?: boolean;
};

type NameMatchScore = {
  score: number;
  matchMethod: PlatformTeamMatchMethod;
};

const GENERIC_PREFIX_TOKENS = new Set(["the", "team"]);
const GENERIC_SUFFIX_TOKENS = new Set(["team", "esports", "esport", "gaming", "club", "clan"]);
const QUALIFIER_TOKENS = new Set([
  "academy",
  "junior",
  "juniors",
  "youth",
  "youngsters",
  "female",
  "women",
  "woman",
  "ladies",
  "fe",
  "red",
  "blue",
  "black",
  "white",
  "gold",
  "challengers",
  "академия",
  "юниоры",
  "юниор",
  "молодежь",
  "женщины",
  "женский",
  "женская",
  "красные",
  "синие",
  "черные",
  "белые",
  "золотые",
]);

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "shch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
  і: "i",
  ї: "yi",
  є: "ye",
  ґ: "g",
};

const LATIN_SPECIAL_FOLD: Record<string, string> = {
  ł: "l",
  đ: "d",
  ð: "d",
  þ: "th",
  æ: "ae",
  œ: "oe",
  ø: "o",
  ı: "i",
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

/**
 * Returns a similarity score between 0.0 and 1.0.
 * It treats swapped human names as equal, e.g. "Волин Лев" and "Лев Волин".
 */
export function getFuzzySimilarity(a: string, b: string): number {
  return getNameMatchScore(a, b);
}

export function getNameMatchScore(a: string | null | undefined, b: string | null | undefined): number {
  return getNameMatchDetails(a, b).score;
}

export function getNameMatchDetails(a: string | null | undefined, b: string | null | undefined): NameMatchScore {
  const pairScore = getPairMatchDetails(a, b);
  const singleScore = getSingleNameMatchDetails(a, b);
  const best = pairScore.score > 0 && pairScore.score >= singleScore.score ? pairScore : singleScore;
  return applyQualifierSafetyCap(a, b, best);
}

export function normalizeFuzzyName(value: string | null | undefined) {
  return foldLatinSpecialLetters(
    String(value ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
  )
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
  return getFuzzyNameVariantEntries(value).map((variant) => variant.value);
}

export function scorePlatformTeamCandidate(
  noisyTeamName: string,
  candidate: Pick<
    PlatformTeamCandidate,
    "platformName" | "platformNameRu" | "platformNameEn" | "normalizedName" | "normalizedNameRu" | "normalizedNameEn"
  >
) {
  return scorePlatformTeamCandidateDetailed(noisyTeamName, candidate).score;
}

export function scorePlatformTeamCandidateDetailed(
  noisyTeamName: string,
  candidate: Pick<
    PlatformTeamCandidate,
    "platformName" | "platformNameRu" | "platformNameEn" | "normalizedName" | "normalizedNameRu" | "normalizedNameEn"
  >
): PlatformTeamScore {
  let best: PlatformTeamScore = { score: 0, matchedName: null, matchMethod: "none" };

  for (const name of getPlatformTeamSearchNames(candidate)) {
    const details = getNameMatchDetails(noisyTeamName, name);
    if (details.score > best.score) {
      best = {
        score: details.score,
        matchedName: name,
        matchMethod: details.matchMethod,
      };
    }
  }

  return best;
}

export function getPlatformTeamSearchNames(
  candidate: Pick<
    PlatformTeamCandidate,
    "platformName" | "platformNameRu" | "platformNameEn" | "normalizedName" | "normalizedNameRu" | "normalizedNameEn"
  >
) {
  return Array.from(
    new Set(
      [
        candidate.platformName,
        candidate.platformNameRu,
        candidate.platformNameEn,
        candidate.normalizedName,
        candidate.normalizedNameRu,
        candidate.normalizedNameEn,
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

export function findClosestPlatformTeamFromCandidates(
  candidates: PlatformTeamCandidate[],
  noisyTeamName: string,
  minScoreThreshold = 0.5,
  options: { minScoreGap?: number } = {}
): FuzzyMatchResult | null {
  const cleanNoisyName = normalizeFuzzyName(noisyTeamName);
  if (cleanNoisyName.length < 2) return null;

  const scored = candidates
    .map((candidate) => ({
      candidate,
      result: scorePlatformTeamCandidateDetailed(noisyTeamName, candidate),
    }))
    .filter((item) => item.result.score >= minScoreThreshold)
    .sort((a, b) => b.result.score - a.result.score);

  const best = scored[0];
  if (!best) return null;

  const secondDistinct = scored.find((item) => item.candidate.platformId !== best.candidate.platformId);
  if (options.minScoreGap != null && secondDistinct && best.result.score - secondDistinct.result.score < options.minScoreGap) {
    return null;
  }

  return {
    platformId: best.candidate.platformId,
    platformName: best.candidate.platformName,
    score: best.result.score,
    matchedName: best.result.matchedName,
    matchMethod: best.result.matchMethod,
  };
}

/**
 * Scans the AdminTeam database for the closest team name.
 */
export async function findClosestPlatformTeam(
  disciplineSlug: string,
  noisyTeamName: string,
  minScoreThreshold = 0.5,
  options: { minScoreGap?: number } = {}
): Promise<FuzzyMatchResult | null> {
  const slug = disciplineSlug.trim().toLowerCase();
  const cleanNoisyName = normalizeFuzzyName(noisyTeamName);

  if (cleanNoisyName.length < 2) return null;

  const candidates = await prisma.adminTeam.findMany({
    where: { disciplineSlug: slug },
    select: {
      platformId: true,
      platformName: true,
      platformNameRu: true,
      platformNameEn: true,
      normalizedName: true,
      normalizedNameRu: true,
      normalizedNameEn: true,
    },
  });

  if (candidates.length === 0) return null;

  return findClosestPlatformTeamFromCandidates(candidates, cleanNoisyName, minScoreThreshold, options);
}

function getSingleNameMatchDetails(a: string | null | undefined, b: string | null | undefined): NameMatchScore {
  const variantsA = getFuzzyNameVariantEntries(a);
  const variantsB = getFuzzyNameVariantEntries(b);

  if (variantsA.length === 0 || variantsB.length === 0) return { score: 0, matchMethod: "none" };

  let bestScore = 0;
  let bestMethod: PlatformTeamMatchMethod = "none";

  for (const left of variantsA) {
    for (const right of variantsB) {
      const compared = compareVariants(left, right);
      if (compared.score > bestScore) {
        bestScore = compared.score;
        bestMethod = compared.matchMethod;
      }
    }
  }

  for (const left of variantsA) {
    for (const right of variantsB) {
      const score = getInitialAwareTokenScore(left.value, right.value);
      const cappedScore = left.fromGeneric || right.fromGeneric ? Math.min(score, 0.84) : score;
      if (cappedScore > bestScore) {
        bestScore = cappedScore;
        bestMethod = left.fromTranslit || right.fromTranslit ? "translit_fuzzy" : "initials_fuzzy";
      }
    }
  }

  return { score: bestScore, matchMethod: bestMethod };
}

function compareVariants(left: FuzzyNameVariant, right: FuzzyNameVariant): NameMatchScore {
  const rawScore = getLinearSimilarity(left.value, right.value);
  let score = rawScore;

  if (rawScore < 1 && (left.fromGeneric || right.fromGeneric)) {
    score = Math.min(score, 0.84);
  }

  let matchMethod: PlatformTeamMatchMethod = "token_fuzzy";
  if (left.fromTranslit || right.fromTranslit) {
    matchMethod = "translit_fuzzy";
  } else if (score === 1) {
    matchMethod = left.kind === "base" && right.kind === "base" ? "exact" : "alias_exact";
  }

  return { score, matchMethod };
}

function getPairMatchDetails(a: string | null | undefined, b: string | null | undefined): NameMatchScore {
  const partsA = splitPairParts(a);
  const partsB = splitPairParts(b);

  if (partsA.length < 2 || partsB.length < 2 || partsA.length !== partsB.length) {
    return { score: 0, matchMethod: "none" };
  }

  const direct = scorePairOrder(partsA, partsB);
  const reversed = scorePairOrder(partsA, [...partsB].reverse());
  const best = direct.averageScore >= reversed.averageScore ? direct : reversed;
  if (best.minPartScore < 0.68) return { score: 0, matchMethod: "none" };

  const score = best.minPartScore >= 0.9 ? best.averageScore : best.averageScore * 0.96;
  return {
    score,
    matchMethod: score === 1 ? "pair_exact" : best.usedTranslit ? "translit_fuzzy" : "pair_fuzzy",
  };
}

function scorePairOrder(partsA: string[], partsB: string[]) {
  let total = 0;
  let minPartScore = 1;
  let usedTranslit = false;

  for (let index = 0; index < partsA.length; index += 1) {
    const details = getSingleNameMatchDetails(partsA[index], partsB[index]);
    total += details.score;
    minPartScore = Math.min(minPartScore, details.score);
    if (details.matchMethod === "translit_fuzzy") usedTranslit = true;
  }

  return {
    averageScore: total / partsA.length,
    minPartScore,
    usedTranslit,
  };
}

function splitPairParts(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!/[\\/|&+]/.test(raw)) return [];
  return raw
    .split(/[\\/|&+]/)
    .map((part) => normalizeFuzzyName(part))
    .filter((part) => part.length >= 2);
}

function getFuzzyNameVariantEntries(value: string | null | undefined) {
  const normalized = normalizeFuzzyName(value);
  if (!normalized) return [];

  const variants = new Map<string, FuzzyNameVariant>();
  const addVariant = (variant: FuzzyNameVariant) => {
    if (!variant.value) return;
    const existing = variants.get(variant.value);
    if (!existing || getVariantPriority(variant) < getVariantPriority(existing)) {
      variants.set(variant.value, variant);
    }
  };

  addVariant({ value: normalized, kind: "base", matchMethod: "exact" });
  addDerivedVariants(normalized, addVariant);

  for (const stripped of getGenericTeamNameVariants(normalized)) {
    addVariant({ value: stripped, kind: "generic", matchMethod: "alias_exact", fromGeneric: true });
    addDerivedVariants(stripped, (variant) => addVariant({ ...variant, fromGeneric: true }));
  }

  for (const variant of Array.from(variants.values())) {
    if (!containsCyrillic(variant.value)) continue;
    const translit = transliterateCyrillicToLatin(variant.value);
    if (!translit || translit === variant.value) continue;
    addVariant({
      value: translit,
      kind: "translit",
      matchMethod: "translit_fuzzy",
      fromGeneric: variant.fromGeneric,
      fromTranslit: true,
    });
    addDerivedVariants(translit, (derived) =>
      addVariant({
        ...derived,
        matchMethod: "translit_fuzzy",
        fromGeneric: variant.fromGeneric,
        fromTranslit: true,
      })
    );
  }

  return Array.from(variants.values()).filter((variant) => variant.value);
}

function addDerivedVariants(value: string, addVariant: (variant: FuzzyNameVariant) => void) {
  const tokens = value.split(" ").filter(Boolean);

  if (tokens.length >= 2 && tokens.length <= 4) {
    addVariant({ value: [...tokens].reverse().join(" "), kind: "reordered", matchMethod: "token_fuzzy" });
  }

  const sorted = sortNameTokens(value);
  if (sorted) addVariant({ value: sorted, kind: "sorted", matchMethod: "token_fuzzy" });

  const compact = getCompactNameKey(value);
  if (compact && compact !== value && isSafeCompactNameKey(compact)) {
    addVariant({ value: compact, kind: "compact", matchMethod: "token_fuzzy" });
  }
}

function getVariantPriority(variant: FuzzyNameVariant) {
  switch (variant.kind) {
    case "base":
      return 0;
    case "generic":
      return 1;
    case "translit":
      return 2;
    default:
      return 3;
  }
}

function getLinearSimilarity(a: string, b: string): number {
  const s1 = normalizeFuzzyName(a);
  const s2 = normalizeFuzzyName(b);

  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1.0;
  if (s1.includes(s2) || s2.includes(s1)) {
    const lenDiff = Math.abs(s1.length - s2.length);
    return Math.max(0.6, 1.0 - lenDiff / Math.max(s1.length, s2.length));
  }

  const distance = levenshteinDistance(s1, s2);
  const maxLength = Math.max(s1.length, s2.length);
  return maxLength === 0 ? 0 : 1.0 - distance / maxLength;
}

function getInitialAwareTokenScore(a: string, b: string) {
  const tokensA = getComparableTokens(a);
  const tokensB = getComparableTokens(b);
  if (tokensA.length < 2 || tokensB.length < 2) return 0;

  const forward = getTokenCoverageScore(tokensA, tokensB);
  const backward = getTokenCoverageScore(tokensB, tokensA);
  return Math.max(forward, backward);
}

function getTokenCoverageScore(sourceTokens: string[], targetTokens: string[]) {
  let total = 0;
  let matched = 0;

  for (const sourceToken of sourceTokens) {
    let bestTokenScore = 0;
    for (const targetToken of targetTokens) {
      bestTokenScore = Math.max(bestTokenScore, getLooseTokenScore(sourceToken, targetToken));
    }
    if (bestTokenScore >= 0.68) matched += 1;
    total += bestTokenScore;
  }

  const coverage = matched / sourceTokens.length;
  if (coverage < 0.75) return 0;
  return (total / sourceTokens.length) * (0.7 + coverage * 0.3);
}

function getLooseTokenScore(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length === 1 && b.startsWith(a)) return 0.92;
  if (b.length === 1 && a.startsWith(b)) return 0.92;
  if (a.length >= 2 && b.startsWith(a)) return 0.9 - Math.min(0.18, (b.length - a.length) / b.length / 2);
  if (b.length >= 2 && a.startsWith(b)) return 0.9 - Math.min(0.18, (a.length - b.length) / a.length / 2);

  const compactA = getCompactNameKey(a);
  const compactB = getCompactNameKey(b);
  if (compactA.length < 3 || compactB.length < 3) return 0;

  const score = 1 - levenshteinDistance(compactA, compactB) / Math.max(compactA.length, compactB.length);
  if (score < 0.64) return 0;
  return Math.min(0.9, score);
}

function applyQualifierSafetyCap(
  a: string | null | undefined,
  b: string | null | undefined,
  score: NameMatchScore
): NameMatchScore {
  if (score.score <= 0.84) return score;

  const qualifiersA = getQualifierTokens(a);
  const qualifiersB = getQualifierTokens(b);
  const hasA = qualifiersA.size > 0;
  const hasB = qualifiersB.size > 0;
  if (!hasA && !hasB) return score;

  const sameQualifiers =
    hasA &&
    hasB &&
    qualifiersA.size === qualifiersB.size &&
    Array.from(qualifiersA).every((token) => qualifiersB.has(token));

  return sameQualifiers ? score : { ...score, score: 0.84 };
}

function getQualifierTokens(value: string | null | undefined) {
  const tokens = new Set<string>();
  for (const token of getComparableTokens(value)) {
    if (QUALIFIER_TOKENS.has(token)) tokens.add(token);
  }
  return tokens;
}

function sortNameTokens(value: string) {
  const tokens = normalizeFuzzyName(value).split(" ").filter(Boolean);
  if (tokens.length < 2) return "";
  return [...tokens].sort((a, b) => a.localeCompare(b, "ru")).join(" ");
}

function getGenericTeamNameVariants(value: string) {
  const tokens = getComparableTokens(value);
  if (tokens.length < 2) return [];
  if (tokens.some((token) => QUALIFIER_TOKENS.has(token))) return [];

  const variants = new Set<string>();

  const withoutLeadingGeneric = [...tokens];
  while (withoutLeadingGeneric.length > 1 && GENERIC_PREFIX_TOKENS.has(withoutLeadingGeneric[0])) {
    withoutLeadingGeneric.shift();
  }
  addSafeGenericVariant(variants, withoutLeadingGeneric.join(" "));

  const withoutTrailingGeneric = [...tokens];
  while (
    withoutTrailingGeneric.length > 1 &&
    GENERIC_SUFFIX_TOKENS.has(withoutTrailingGeneric[withoutTrailingGeneric.length - 1])
  ) {
    withoutTrailingGeneric.pop();
  }
  addSafeGenericVariant(variants, withoutTrailingGeneric.join(" "));

  const bothSides = [...withoutLeadingGeneric];
  while (bothSides.length > 1 && GENERIC_SUFFIX_TOKENS.has(bothSides[bothSides.length - 1])) {
    bothSides.pop();
  }
  addSafeGenericVariant(variants, bothSides.join(" "));

  variants.delete(tokens.join(" "));
  return Array.from(variants);
}

function getComparableTokens(value: string | null | undefined) {
  return normalizeFuzzyName(value)
    .replace(/\be\s+sports\b/g, "esports")
    .split(" ")
    .filter(Boolean);
}

function addSafeGenericVariant(variants: Set<string>, value: string) {
  const normalized = normalizeFuzzyName(value);
  if (!normalized) return;

  const compact = getCompactNameKey(normalized);
  if (isSafeGenericAlias(normalized) || isSafeCompactNameKey(compact)) {
    variants.add(normalized);
  }
}

function isSafeGenericAlias(value: string) {
  if (!value || GENERIC_PREFIX_TOKENS.has(value) || GENERIC_SUFFIX_TOKENS.has(value)) return false;
  const compact = getCompactNameKey(value);
  return compact.length >= 4 || /\d/.test(compact);
}

function getCompactNameKey(value: string) {
  return normalizeFuzzyName(value).replace(/\s+/g, "");
}

function isSafeCompactNameKey(value: string) {
  return value.length >= 4 || (value.length >= 2 && /\d/.test(value));
}

function containsCyrillic(value: string) {
  return /\p{Script=Cyrillic}/u.test(value);
}

function transliterateCyrillicToLatin(value: string) {
  return normalizeFuzzyName(value)
    .split("")
    .map((char) => CYRILLIC_TO_LATIN[char] ?? char)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function foldLatinSpecialLetters(value: string) {
  return value.replace(/[łđðþæœøı]/g, (char) => LATIN_SPECIAL_FOLD[char] ?? char);
}
