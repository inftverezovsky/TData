import { normalizeFuzzyName, scorePlatformTeamCandidate, type PlatformTeamCandidate } from "@/lib/teams/fuzzyMatch";

export type AdminTeamSuggestionMatchType = "exact" | "starts_with" | "contains" | "fuzzy";

export type AdminTeamSuggestion = {
  platformId: string;
  platformName: string;
  score: number;
  matchType: AdminTeamSuggestionMatchType;
};

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
    const fuzzyScore = scorePlatformTeamCandidate(normalizedQuery, team);

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
    } else if (fuzzyScore >= 0.45) {
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
