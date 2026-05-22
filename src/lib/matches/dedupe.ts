import { isPlaceholderTeam, normalizeTeamName } from "@/lib/teams/teams";
import { getTeamAliasKey } from "@/lib/teams/canonicalize";

export interface MatchDedupeInput {
  id?: string | null;
  matchId?: string | null;
  lpNumericalId?: bigint | number | string | null;
  platformId?: string | null;
  matchDate?: Date | string | number | null;
  matchDateTime?: string | null;
  stage?: string | null;
  round?: string | null;
  format?: string | null;
  status?: string | null;
  court?: string | null;
  sourceUrl?: string | null;
  rawText?: string | null;
  teamAId?: string | null;
  teamAName?: string | null;
  teamBId?: string | null;
  teamBName?: string | null;
  scoreA?: number | null;
  scoreB?: number | null;
  syncedAt?: Date | string | null;
  createdAt?: Date | string | null;
}

export function dedupeTournamentMatches<T extends MatchDedupeInput>(matches: readonly T[]): T[] {
  const byKey = new Map<string, T>();
  const keys: string[] = [];
  const scheduledPairKeys = new Set(
    matches
      .filter((match) => !hasPlaceholderSide(match) && parseDateLike(match.matchDate))
      .map(getPairOnlyKey)
      .filter(Boolean)
  );

  for (const match of matches) {
    if (isGeneratedScheduleMatrixRow(match) || isCoveredGeneratedRoundRobinSlot(match, scheduledPairKeys)) {
      continue;
    }

    const key = getCanonicalMatchKey(match);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, match);
      keys.push(key);
      continue;
    }

    byKey.set(key, mergePreferredMatch(existing, match));
  }

  return keys.map((key) => byKey.get(key)).filter((match): match is T => Boolean(match));
}

export function getCanonicalMatchKey(match: MatchDedupeInput) {
  const [team1, team2] = [
    getTeamKey(match.teamAName, match.teamAId, "a"),
    getTeamKey(match.teamBName, match.teamBId, "b")
  ].sort();

  const dateBucket = getDateBucket(match);
  const placeholderContext = hasPlaceholderSide(match)
    ? [
        normalizeLoose(match.stage),
        normalizeLoose(match.round),
        normalizeLoose(match.format),
        normalizeLoose(match.court),
        normalizeLoose(match.rawText) || normalizeLoose(match.matchId) || normalizeLoose(match.sourceUrl)
      ]
    : [];

  if (dateBucket !== "date:tbd") {
    return ["dated", team1, team2, dateBucket, ...placeholderContext].join("|");
  }

  return [
    "undated",
    team1,
    team2,
    normalizeLoose(match.stage),
    normalizeLoose(match.round),
    normalizeLoose(match.format),
    normalizeLoose(match.court),
    ...placeholderContext.slice(4)
  ].join("|");
}

export function mergePreferredMatch<T extends MatchDedupeInput>(left: T, right: T): T {
  const leftScore = scoreMatch(left);
  const rightScore = scoreMatch(right);
  const primary = rightScore > leftScore ? right : left;
  const secondary = primary === right ? left : right;
  const merged: Record<string, unknown> = {
    ...(secondary as Record<string, unknown>),
    ...(primary as Record<string, unknown>)
  };

  for (const [key, value] of Object.entries(secondary as Record<string, unknown>)) {
    if (isEmptyValue(merged[key]) && !isEmptyValue(value)) {
      merged[key] = value;
    }
  }

  return merged as T;
}

function scoreMatch(match: MatchDedupeInput) {
  let score = 0;

  if (hasValue(match.platformId)) score += 1000;
  if (parseDateLike(match.matchDate)) score += 300;
  if (hasValue(match.matchDateTime)) score += 150;
  if (hasRealTeam(match.teamAName) && hasRealTeam(match.teamBName)) score += 120;
  if (hasValue(match.stage)) score += 25;
  if (hasValue(match.round)) score += 25;
  if (hasValue(match.format)) score += 15;
  if (hasValue(match.sourceUrl)) score += 10;
  if (hasValue(match.rawText)) score += 10;
  if (match.scoreA !== null && match.scoreA !== undefined) score += 8;
  if (match.scoreB !== null && match.scoreB !== undefined) score += 8;
  if (hasValue(match.status)) score += 8;
  if (match.matchId?.startsWith("match_")) score += 5;
  if (match.lpNumericalId !== null && match.lpNumericalId !== undefined) score += 3;

  return score;
}

function getTeamKey(name: string | null | undefined, id: string | null | undefined, side: "a" | "b") {
  const rawName = normalizeLoose(name);
  const rawId = normalizeLoose(id);
  const usefulName = rawName && !isPlaceholderTeam(rawName) ? rawName : "";
  const value = usefulName || rawId || rawName || `unknown-${side}`;

  return getTeamAliasKey(value) || normalizeTeamName(value) || normalizeLoose(value) || `unknown-${side}`;
}

function getDateBucket(match: MatchDedupeInput) {
  const textDate = getComparableDateText(match.matchDateTime);
  if (textDate && hasCalendarDateText(textDate)) {
    return `text-time:${textDate}`;
  }

  const parsedDate = parseDateLike(match.matchDate);
  if (parsedDate) {
    return `minute:${Math.floor(parsedDate.getTime() / 60000)}`;
  }

  if (textDate) {
    return `text-time:${textDate}`;
  }

  const looseTextDate = normalizeLoose(match.matchDateTime);
  if (looseTextDate && !/^(date|date tbd|tbd|-|unknown)$/i.test(looseTextDate)) {
    return `text:${looseTextDate}`;
  }

  return "date:tbd";
}

function hasCalendarDateText(value: string) {
  return (
    /\b(?:19|20)\d{2}\b/.test(value) ||
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}\b/i.test(value) ||
    /\b(?:19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/.test(value)
  );
}

function getComparableDateText(value: string | null | undefined) {
  const normalized = normalizeLoose(value)
    .replace(/\s*\([^)]*\butc[+-]?\d*[^)]*\)\s*$/i, "")
    .replace(/\s+(?:z|utc|gmt|[a-z]{2,5}|[+-][0-2]\d:?[0-5]\d)\s*$/i, "")
    .replace(/[,]/g, "")
    .replace(/\s*[-–—]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized || /^(date|date tbd|tbd|-|unknown)$/i.test(normalized)) {
    return "";
  }

  return /\b\d{1,2}:\d{2}\b/.test(normalized) ? normalized : "";
}

function parseDateLike(value: Date | string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;

  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function normalizeLoose(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function hasRealTeam(name: string | null | undefined) {
  return Boolean(name && !isPlaceholderTeam(name));
}

function hasPlaceholderSide(match: MatchDedupeInput) {
  return isPlaceholderTeam(match.teamAName) || isPlaceholderTeam(match.teamBName);
}

function isCoveredGeneratedRoundRobinSlot(match: MatchDedupeInput, scheduledPairKeys: Set<string>) {
  if (!isGeneratedScheduleMatrixRow(match)) return false;
  const pairKey = getPairOnlyKey(match);
  return Boolean(pairKey && scheduledPairKeys.has(pairKey));
}

function isGeneratedScheduleMatrixRow(match: MatchDedupeInput) {
  if (hasPlaceholderSide(match)) return false;
  if (parseDateLike(match.matchDate)) return false;

  const textDate = normalizeLoose(match.matchDateTime);
  if (textDate && !/^(date|date tbd|tbd|-|unknown)$/i.test(textDate)) return false;

  const hasScore = match.scoreA !== null && match.scoreA !== undefined
    || match.scoreB !== null && match.scoreB !== undefined;
  if (hasScore) return false;

  const status = normalizeLoose(match.status);
  if (status && status !== "upcoming" && status !== "scheduled") return false;

  const isGeneratedRoundRobin =
    normalizeLoose(match.format) === "round robin"
    || normalizeLoose(match.rawText).includes("crosstable");
  return isGeneratedRoundRobin;
}

function getPairOnlyKey(match: MatchDedupeInput) {
  const [team1, team2] = [
    getTeamKey(match.teamAName, match.teamAId, "a"),
    getTeamKey(match.teamBName, match.teamBId, "b")
  ].sort();

  if (!team1 || !team2 || team1.startsWith("unknown-") || team2.startsWith("unknown-")) {
    return "";
  }

  return `${team1}|${team2}`;
}

function hasValue(value: unknown) {
  return !isEmptyValue(value);
}

function isEmptyValue(value: unknown) {
  return value === null || value === undefined || value === "";
}
