import {
  levenshteinDistance,
  normalizeFuzzyName,
  transliterateCyrillicToLatin,
} from "@backend/teams/fuzzyMatch";

export type KhlAdminDirectoryRecord = {
  disciplineSlug: string;
  platformId: string;
  platformName: string;
  platformNameRu?: string | null;
  platformNameEn?: string | null;
};

export type KhlAdminDirectorySuggestion = {
  platformId: string;
  platformName: string;
  platformNameRu: string | null;
  platformNameEn: string | null;
  scopes: string[];
  score: number;
  matchType: "exact_id" | "exact_name" | "tokens" | "contains" | "fuzzy";
};

export function buildKhlAdminDirectorySearch(query: string) {
  const value = String(query || "").trim();
  if (/^[1-9]\d{0,127}$/.test(value)) {
    return { kind: "id" as const, exactId: value, anchors: [] as string[] };
  }
  const normalized = normalizeFuzzyName(value);
  const anchors = Array.from(new Set(normalized.split(/\s+/).filter((token) => token.length >= 2)))
    .sort((left, right) => right.length - left.length)
    .slice(0, 3);
  return { kind: "name" as const, exactId: null, anchors };
}

export function buildKhlAdminDirectorySuggestions(
  records: readonly KhlAdminDirectoryRecord[],
  query: string,
  limit = 8
): KhlAdminDirectorySuggestion[] {
  const search = buildKhlAdminDirectorySearch(query);
  const boundedLimit = Math.max(1, Math.min(20, Math.trunc(limit) || 8));
  const grouped = new Map<string, KhlAdminDirectoryRecord[]>();
  for (const record of records) {
    const platformId = String(record.platformId || "").trim();
    const platformName = String(record.platformName || "").trim();
    if (!platformId || !platformName) continue;
    grouped.set(platformId, [...(grouped.get(platformId) || []), record]);
  }

  return [...grouped.entries()]
    .map(([platformId, matches]) => scoreGroup(platformId, matches, query, search.kind))
    .filter((item): item is KhlAdminDirectorySuggestion => Boolean(item))
    .sort((left, right) => (
      right.score - left.score
      || left.platformName.localeCompare(right.platformName, "ru")
      || left.platformId.localeCompare(right.platformId)
    ))
    .slice(0, boundedLimit);
}

function scoreGroup(
  platformId: string,
  records: KhlAdminDirectoryRecord[],
  query: string,
  searchKind: "id" | "name"
): KhlAdminDirectorySuggestion | null {
  const primary = records[0];
  if (searchKind === "id") {
    if (platformId !== String(query).trim()) return null;
    return suggestion(primary, records, 1, "exact_id");
  }

  let best: { score: number; matchType: KhlAdminDirectorySuggestion["matchType"] } | null = null;
  for (const record of records) {
    for (const name of searchableNames(record)) {
      const candidate = scoreName(query, name);
      if (!best || candidate.score > best.score) best = candidate;
    }
  }
  if (!best || best.score < 0.64) return null;
  return suggestion(primary, records, best.score, best.matchType);
}

function suggestion(
  primary: KhlAdminDirectoryRecord,
  records: KhlAdminDirectoryRecord[],
  score: number,
  matchType: KhlAdminDirectorySuggestion["matchType"]
): KhlAdminDirectorySuggestion {
  return {
    platformId: primary.platformId.trim(),
    platformName: primary.platformName.trim(),
    platformNameRu: clean(primary.platformNameRu),
    platformNameEn: clean(primary.platformNameEn),
    scopes: Array.from(new Set(records.map((record) => record.disciplineSlug.trim()).filter(Boolean))).sort(),
    score: Number(score.toFixed(4)),
    matchType,
  };
}

function scoreName(query: string, name: string) {
  const normalizedQuery = normalizeFuzzyName(query);
  const normalizedName = normalizeFuzzyName(name);
  if (!normalizedQuery || !normalizedName) return { score: 0, matchType: "fuzzy" as const };
  if (normalizedName === normalizedQuery) return { score: 1, matchType: "exact_name" as const };
  if (normalizedName.includes(normalizedQuery) || normalizedQuery.includes(normalizedName)) {
    return { score: 0.92, matchType: "contains" as const };
  }

  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const nameTokens = normalizedName.split(/\s+/).filter(Boolean);
  const tokenScores = queryTokens.map((token) => bestTokenScore(token, nameTokens));
  const everyTokenMatches = tokenScores.length > 0 && tokenScores.every((score) => score >= 0.72);
  if (everyTokenMatches) {
    const average = tokenScores.reduce((total, score) => total + score, 0) / tokenScores.length;
    return { score: 0.82 + average * 0.16, matchType: "tokens" as const };
  }

  const transliteratedQuery = normalizeFuzzyName(transliterateCyrillicToLatin(query));
  const transliteratedName = normalizeFuzzyName(transliterateCyrillicToLatin(name));
  const maxLength = Math.max(transliteratedQuery.length, transliteratedName.length);
  if (maxLength >= 4) {
    const fuzzy = 1 - levenshteinDistance(transliteratedQuery, transliteratedName) / maxLength;
    if (fuzzy >= 0.64) return { score: fuzzy, matchType: "fuzzy" as const };
  }
  return { score: 0, matchType: "fuzzy" as const };
}

function bestTokenScore(queryToken: string, candidateTokens: string[]) {
  let best = 0;
  for (const token of candidateTokens) {
    if (token === queryToken) return 1;
    if (token.startsWith(queryToken) || queryToken.startsWith(token)) best = Math.max(best, 0.9);
    else if (token.includes(queryToken) || queryToken.includes(token)) best = Math.max(best, 0.82);
    else if (Math.max(token.length, queryToken.length) >= 4) {
      const score = 1 - levenshteinDistance(token, queryToken) / Math.max(token.length, queryToken.length);
      best = Math.max(best, score);
    }
  }
  return best;
}

function searchableNames(record: KhlAdminDirectoryRecord) {
  return Array.from(new Set([
    record.platformName,
    record.platformNameRu,
    record.platformNameEn,
  ].map(clean).filter((value): value is string => Boolean(value))));
}

function clean(value: string | null | undefined) {
  const text = String(value || "").trim();
  return text || null;
}
