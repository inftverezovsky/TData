import {
  levenshteinDistance,
  normalizeFuzzyName,
  scorePlatformTeamCandidate,
  type PlatformTeamCandidate,
} from "@/lib/teams/fuzzyMatch";

export type AdminTeamSuggestionMatchType = "exact" | "starts_with" | "contains" | "fuzzy";

export type AdminTeamSuggestion = {
  platformId: string;
  platformName: string;
  score: number;
  matchType: AdminTeamSuggestionMatchType;
};

const GENERIC_TEAM_TOKENS = new Set(["the", "team", "esport", "esports", "gaming", "club", "clan"]);

export function buildAdminTeamSuggestions(
  teams: PlatformTeamCandidate[],
  query: string,
  limit = 8
): AdminTeamSuggestion[] {
  const normalizedQuery = normalizeFuzzyName(query);
  if (normalizedQuery.length < 2) return [];

  const seenPlatformIds = new Set<string>();
  const suggestions: AdminTeamSuggestion[] = [];

  for (const team of teams) {
    const platformId = String(team.platformId || "").trim();
    const platformName = String(team.platformName || "").trim();
    if (!platformId || !platformName || seenPlatformIds.has(platformId)) continue;
    seenPlatformIds.add(platformId);

    const normalizedPlatformName = normalizeFuzzyName(platformName);
    const normalizedStoredName = normalizeFuzzyName(team.normalizedName || "");
    const searchableNames = [normalizedPlatformName, normalizedStoredName].filter(Boolean);

    const exact = searchableNames.some((name) => name === normalizedQuery);
    const startsWith = !exact && searchableNames.some((name) => name.startsWith(normalizedQuery));
    const contains = !exact && !startsWith && searchableNames.some((name) => name.includes(normalizedQuery));
    const fuzzyScore = Math.max(
      scorePlatformTeamCandidate(normalizedQuery, team),
      getBroadCandidateScore(normalizedQuery, searchableNames)
    );

    let matchType: AdminTeamSuggestionMatchType | null = null;
    let score = 0;

    if (exact) {
      matchType = "exact";
      score = 1;
    } else if (startsWith) {
      matchType = "starts_with";
      score = Math.max(0.92, fuzzyScore);
    } else if (contains) {
      matchType = "contains";
      score = Math.max(0.82, fuzzyScore);
    } else if (fuzzyScore >= getFuzzyThreshold(normalizedQuery)) {
      matchType = "fuzzy";
      score = fuzzyScore;
    }

    if (!matchType) continue;
    suggestions.push({ platformId, platformName, score, matchType });
  }

  return suggestions
    .sort((a, b) => {
      const priorityDiff = getMatchTypePriority(a.matchType) - getMatchTypePriority(b.matchType);
      if (priorityDiff !== 0) return priorityDiff;
      const scoreDiff = b.score - a.score;
      if (Math.abs(scoreDiff) > 0.0001) return scoreDiff;
      return a.platformName.localeCompare(b.platformName, "ru");
    })
    .slice(0, Math.max(1, Math.min(20, Math.trunc(limit) || 8)));
}

function getBroadCandidateScore(query: string, names: string[]) {
  const normalizedQuery = normalizeFuzzyName(query);
  const compactQuery = getCompactKey(normalizedQuery);
  if (compactQuery.length < 2) return 0;

  let bestScore = 0;

  for (const name of names) {
    const normalizedName = normalizeFuzzyName(name);
    const compactName = getCompactKey(normalizedName);
    if (!compactName) continue;

    bestScore = Math.max(
      bestScore,
      getAnyOrderTokenScore(normalizedQuery, normalizedName),
      getAcronymScore(compactQuery, normalizedName),
      getStrictOrderedSubsequenceScore(compactQuery, compactName)
    );
  }

  return Math.min(0.89, bestScore);
}

function getAnyOrderTokenScore(query: string, candidate: string) {
  const queryTokens = stripGenericTokens(getTokens(query));
  const candidateTokens = stripGenericTokens(getTokens(candidate));
  if (queryTokens.length === 0 || candidateTokens.length === 0) return 0;

  let total = 0;
  let matched = 0;

  for (const queryToken of queryTokens) {
    let bestTokenScore = 0;
    for (const candidateToken of candidateTokens) {
      bestTokenScore = Math.max(bestTokenScore, getLooseTokenScore(queryToken, candidateToken));
    }

    if (bestTokenScore >= 0.62) matched += 1;
    total += bestTokenScore;
  }

  const coverage = matched / queryTokens.length;
  if (queryTokens.length > 1 && coverage < 0.5) return 0;
  if (queryTokens.length === 1 && coverage === 0) return 0;

  const broadSingleTokenPenalty = queryTokens.length === 1 && candidateTokens.length > 3 ? 0.1 : 0;
  return Math.max(0, (total / queryTokens.length) * (0.75 + coverage * 0.25) - broadSingleTokenPenalty);
}

function getLooseTokenScore(queryToken: string, candidateToken: string) {
  if (!queryToken || !candidateToken) return 0;
  if (queryToken === candidateToken) return 1;
  if (candidateToken.startsWith(queryToken)) {
    return 0.95 - Math.min(0.22, (candidateToken.length - queryToken.length) / candidateToken.length / 2);
  }
  if (candidateToken.includes(queryToken)) {
    return 0.82 - Math.min(0.18, (candidateToken.length - queryToken.length) / candidateToken.length / 2);
  }
  if (queryToken.startsWith(candidateToken) && candidateToken.length >= 2) return 0.72;

  const editSimilarity = getAnchoredEditSimilarity(queryToken, candidateToken);
  const subsequenceScore = getAnchoredTokenSubsequenceScore(queryToken, candidateToken);
  return Math.max(editSimilarity, subsequenceScore);
}

function getAcronymScore(compactQuery: string, candidate: string) {
  const initials = getTokens(candidate)
    .map((token) => token[0])
    .join("");

  if (initials.length < 2) return 0;
  if (initials === compactQuery) return 0.96;
  if (initials.startsWith(compactQuery)) return 0.88;

  const orderedScore = getOrderedSubsequenceScore(compactQuery, initials);
  return orderedScore >= 0.9 ? 0.82 : 0;
}

function getOrderedSubsequenceScore(query: string, candidate: string) {
  const compactQuery = getCompactKey(query);
  const compactCandidate = getCompactKey(candidate);
  if (compactQuery.length < 2 || compactCandidate.length < 2) return 0;

  const common = getLongestCommonSubsequenceLength(compactQuery, compactCandidate);
  const queryCoverage = common / compactQuery.length;
  const lengthFit = common / Math.max(compactQuery.length, Math.min(compactCandidate.length, compactQuery.length + 4));

  return queryCoverage * 0.7 + lengthFit * 0.3;
}

function getStrictOrderedSubsequenceScore(query: string, candidate: string) {
  const compactQuery = getCompactKey(query);
  const compactCandidate = getCompactKey(candidate);
  if (compactQuery.length < 2 || compactCandidate.length < 2) return 0;

  const common = getLongestCommonSubsequenceLength(compactQuery, compactCandidate);
  const queryCoverage = common / compactQuery.length;
  const candidateCoverage = common / compactCandidate.length;
  const lengthRatio = Math.min(compactQuery.length, compactCandidate.length) / Math.max(compactQuery.length, compactCandidate.length);

  if (queryCoverage < 0.86) return 0;
  if (compactQuery.length > 4 && candidateCoverage < 0.45) return 0;
  if (lengthRatio < 0.35) return 0;

  return queryCoverage * 0.55 + candidateCoverage * 0.25 + lengthRatio * 0.2;
}

function getAnchoredEditSimilarity(queryToken: string, candidateToken: string) {
  const query = getCompactKey(queryToken);
  const candidate = getCompactKey(candidateToken);
  if (query.length < 3 || candidate.length < 3) return 0;
  if (!hasTokenAnchor(query, candidate)) return 0;

  const score = 1 - levenshteinDistance(query, candidate) / Math.max(query.length, candidate.length);
  if (score < 0.58) return 0;

  return Math.min(0.86, Math.max(score, getCommonPrefixLength(query, candidate) >= 2 ? 0.66 : 0));
}

function getAnchoredTokenSubsequenceScore(queryToken: string, candidateToken: string) {
  const query = getCompactKey(queryToken);
  const candidate = getCompactKey(candidateToken);
  if (query.length < 3 || candidate.length < 3) return 0;
  if (query[0] !== candidate[0]) return 0;

  const common = getLongestCommonSubsequenceLength(query, candidate);
  const queryCoverage = common / query.length;
  const candidateCoverage = common / candidate.length;
  const lengthRatio = Math.min(query.length, candidate.length) / Math.max(query.length, candidate.length);

  if (queryCoverage < 0.84) return 0;
  if (candidateCoverage < 0.45) return 0;
  if (lengthRatio < 0.45) return 0;

  return Math.min(0.88, queryCoverage * 0.55 + candidateCoverage * 0.25 + lengthRatio * 0.2);
}

function hasTokenAnchor(query: string, candidate: string) {
  return query[0] === candidate[0] || getCommonPrefixLength(query, candidate) >= 2;
}

function getCommonPrefixLength(a: string, b: string) {
  const length = Math.min(a.length, b.length);
  let common = 0;

  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) break;
    common += 1;
  }

  return common;
}

function getLongestCommonSubsequenceLength(a: string, b: string) {
  const previous = new Array<number>(b.length + 1).fill(0);
  const current = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = a[i - 1] === b[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
    }
    previous.splice(0, previous.length, ...current);
    current.fill(0);
  }

  return previous[b.length] || 0;
}

function getTokens(value: string) {
  return normalizeFuzzyName(value).split(" ").filter(Boolean);
}

function stripGenericTokens(tokens: string[]) {
  const meaningfulTokens = tokens.filter((token) => !GENERIC_TEAM_TOKENS.has(token));
  return meaningfulTokens.length > 0 ? meaningfulTokens : tokens;
}

function getCompactKey(value: string) {
  return normalizeFuzzyName(value).replace(/\s+/g, "");
}

function getFuzzyThreshold(query: string) {
  const length = getCompactKey(query).length;
  if (length <= 2) return 0.82;
  if (length === 3) return 0.72;
  if (length === 4) return 0.66;
  if (length <= 7) return 0.68;
  return 0.72;
}

function getMatchTypePriority(matchType: AdminTeamSuggestionMatchType) {
  switch (matchType) {
    case "exact":
      return 0;
    case "starts_with":
      return 1;
    case "contains":
      return 2;
    case "fuzzy":
      return 3;
    default:
      return 4;
  }
}
