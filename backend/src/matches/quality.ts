import { isPlaceholderTeam } from "@backend/teams/teams";

export type ParsedMatchCandidate = {
  source: string;
  confidence: number;
  rawTeamA?: string | null;
  rawTeamB?: string | null;
  canonicalTeamA?: string | null;
  canonicalTeamB?: string | null;
  rawDate?: string | null;
  parsedDate?: string | null;
  sourceUrl?: string | null;
};

export type MatchQualityInput = {
  matchDate?: Date | string | number | null;
  matchDateTime?: string | null;
  teamAName?: string | null;
  teamBName?: string | null;
  scoreA?: number | null;
  scoreB?: number | null;
  status?: string | null;
  sourceUrl?: string | null;
  rawText?: string | null;
  hasPlaceholderTeams?: boolean | null;
};

export function hasPlaceholderTeams(match: MatchQualityInput) {
  return Boolean(
    match.hasPlaceholderTeams ||
    isPlaceholderTeam(match.teamAName) ||
    isPlaceholderTeam(match.teamBName)
  );
}

export function getMatchSourceConfidence(match: MatchQualityInput) {
  let confidence = 0.35;

  if (parseDateLike(match.matchDate)) confidence += 0.25;
  else if (match.matchDateTime) confidence += 0.1;

  if (match.teamAName && !isPlaceholderTeam(match.teamAName)) confidence += 0.15;
  if (match.teamBName && !isPlaceholderTeam(match.teamBName)) confidence += 0.15;
  if (match.sourceUrl) confidence += 0.05;
  if (match.rawText) confidence += 0.03;
  if (isFinishedMatch(match)) confidence += 0.05;
  if (hasPlaceholderTeams(match)) confidence -= 0.12;

  return clamp(confidence, 0.05, 1);
}

export function buildMatchCandidateMetadata(match: MatchQualityInput, source: string): ParsedMatchCandidate {
  const parsedDate = parseDateLike(match.matchDate);
  return {
    source,
    confidence: getMatchSourceConfidence(match),
    rawTeamA: match.teamAName ?? null,
    rawTeamB: match.teamBName ?? null,
    canonicalTeamA: match.teamAName ?? null,
    canonicalTeamB: match.teamBName ?? null,
    rawDate: match.matchDateTime ?? (match.matchDate ? String(match.matchDate) : null),
    parsedDate: parsedDate ? parsedDate.toISOString() : null,
    sourceUrl: match.sourceUrl ?? null,
  };
}

export function computeMatchSetQuality(
  newMatches: readonly MatchQualityInput[],
  previousMatches: readonly MatchQualityInput[] = []
) {
  const total = newMatches.length;
  if (total === 0) {
    return previousMatches.length > 0 ? 0 : 0.25;
  }

  const dated = newMatches.filter((match) => parseDateLike(match.matchDate)).length;
  const bothReal = newMatches.filter((match) =>
    match.teamAName && !isPlaceholderTeam(match.teamAName) &&
    match.teamBName && !isPlaceholderTeam(match.teamBName)
  ).length;
  const placeholder = newMatches.filter(hasPlaceholderTeams).length;
  const sourceRich = newMatches.filter((match) => match.sourceUrl || match.rawText).length;
  const finished = newMatches.filter(isFinishedMatch).length;

  const previousTotal = previousMatches.length;
  const dropPenalty = previousTotal > 0 && total < previousTotal * 0.4 ? 0.25 : 0;
  const placeholderPenalty = total > 0 ? Math.min(0.18, (placeholder / total) * 0.18) : 0;
  const finishedPenalty = total > 0 ? Math.min(0.12, (finished / total) * 0.12) : 0;

  const score =
    0.2 +
    (dated / total) * 0.28 +
    (bothReal / total) * 0.25 +
    (sourceRich / total) * 0.15 +
    Math.min(0.12, total / 50) -
    dropPenalty -
    placeholderPenalty -
    finishedPenalty;

  return Number(clamp(score, 0, 1).toFixed(3));
}

export function shouldKeepPreviousMatches(params: {
  newMatches: readonly MatchQualityInput[];
  previousMatches: readonly MatchQualityInput[];
  newQualityScore: number;
  sourceHadError?: boolean;
}) {
  const previousCount = params.previousMatches.length;
  if (previousCount === 0) return false;

  if (params.newMatches.length === 0) return true;
  if (params.sourceHadError && params.newMatches.length < previousCount) return true;
  if (params.newQualityScore < 0.25 && params.newMatches.length < previousCount * 0.8) return true;
  if (
    params.newMatches.length < previousCount &&
    params.newMatches.length < Math.max(2, previousCount * 0.25)
  ) return true;

  return false;
}

function isFinishedMatch(match: MatchQualityInput) {
  const hasScores = match.scoreA !== null && match.scoreA !== undefined
    || match.scoreB !== null && match.scoreB !== undefined;
  const status = String(match.status || "").toLowerCase();
  return hasScores || /\b(finished|completed|complete|closed|done|walkover|cancelled|canceled)\b/.test(status);
}

function parseDateLike(value: Date | string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
