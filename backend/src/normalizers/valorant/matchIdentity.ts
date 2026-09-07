/** Назначить стабильные ID → оценить полноту совпадений → выбрать запись при дубле. Поля ключа определяют различимость матчей. */
import type { NormalizedMatch } from "./types";
import { isPlaceholderTeam, generateInternalTeamId } from "@backend/teams/teams";
import { createHash } from "crypto";
import { hasExplicitTimeText } from "@backend/matches/time";
import { getBestOfLabel } from "@backend/matches/format";

export function normalizeMatchCandidate(candidate: NormalizedMatch, sourceTitle: string, indexHint: string): NormalizedMatch | null {
  const teamAName = candidate.teamAName?.trim() || null;
  const teamBName = candidate.teamBName?.trim() || null;

  if (!teamAName && !teamBName && !indexHint) return null;

  // Numbered TBD logic
  const matchIdx = parseInt(indexHint || "0", 10);
  const tbdAName = `TBD${(matchIdx * 2) + 1}`;
  const tbdBName = `TBD${(matchIdx * 2) + 2}`;

  const isA_TBD = !teamAName || isPlaceholderTeam(teamAName);
  const isB_TBD = !teamBName || isPlaceholderTeam(teamBName);

  const finalTeamAName = isA_TBD ? "TBD" : teamAName;
  const finalTeamBName = isB_TBD ? "TBD" : teamBName;

  const teamAId = isA_TBD ? `tbd` : generateInternalTeamId(teamAName!);
  const teamBId = isB_TBD ? `tbd` : generateInternalTeamId(teamBName!);

  const matchId = candidate.matchId ?? createStableMatchId({
    sourceTitle,
    matchDate: candidate.matchDate,
    matchDateTime: candidate.matchDateTime,
    teamAId,
    teamBId,
    stage: candidate.stage,
    round: candidate.round,
    extraHint: indexHint
  });

  const lpNumericalId = stringToNumericalId(matchId);

  return {
    ...candidate,
    matchId,
    lpNumericalId,
    teamAId,
    teamAName: finalTeamAName,
    teamBId,
    teamBName: finalTeamBName
  };
}

export function stringToNumericalId(str: string): bigint {
  const hash = createHash("md5").update(str).digest("hex").slice(0, 12);
  return BigInt("0x" + hash);
}

function createStableMatchId(input: {
  sourceTitle: string;
  matchDate?: Date | null;
  matchDateTime?: string | null;
  teamAId: string;
  teamBId: string;
  stage?: string | null;
  round?: string | null;
  extraHint: string
}): string {
  const data = [
    input.sourceTitle,
    input.matchDate?.toISOString() ?? "",
    input.matchDateTime ?? "",
    input.teamAId,
    input.teamBId,
    input.stage ?? "",
    input.round ?? "",
    input.extraHint
  ].join("|");
  return `match_${createHash("md5").update(data).digest("hex").slice(0, 12)}`;
}

/* ───── Deduplication ───── */

export function dedupeMatches(matches: NormalizedMatch[]): NormalizedMatch[] {
  const seen = new Map<string, NormalizedMatch>();
  for (const m of matches) {
    if (!m.matchId) continue;
    const existingById = seen.get(m.matchId);
    if (existingById) {
      if (scoreMatchCompleteness(m) > scoreMatchCompleteness(existingById)) seen.set(m.matchId, { ...existingById, ...m });
      continue;
    }

    const pairKey = matchDedupeKey(m);
    const existingByPair = [...seen.entries()].find(([, existing]) => matchDedupeKey(existing) === pairKey);
    if (existingByPair) {
      if (scoreMatchCompleteness(m) > scoreMatchCompleteness(existingByPair[1])) seen.set(existingByPair[0], m);
      continue;
    }

    seen.set(m.matchId, m);
  }
  return Array.from(seen.values());
}

function scoreMatchCompleteness(match: NormalizedMatch) {
  let score = 0;
  if (match.matchDate) score += 20;
  if (hasExplicitTimeText(match.matchDateTime, match.rawText)) score += 10;
  if (match.teamAName && !isPlaceholderTeam(match.teamAName)) score += 8;
  if (match.teamBName && !isPlaceholderTeam(match.teamBName)) score += 8;
  if (getBestOfLabel(match.format) || getBestOfLabel(match.rawText)) score += 5;
  if (match.stage) score += 2;
  if (match.round) score += 2;
  if (match.sourceUrl) score += 1;
  return score;
}

function matchDedupeKey(match: NormalizedMatch) {
  const teams = [
    (match.teamAName || "").toLowerCase().trim(),
    (match.teamBName || "").toLowerCase().trim()
  ].sort();
  return [
    teams[0],
    teams[1],
    match.matchDate?.getTime() ?? "",
    (match.matchDateTime || "").toLowerCase().trim(),
    (match.stage || "").toLowerCase().trim(),
    (match.round || "").toLowerCase().trim(),
    (match.format || "").toLowerCase().trim()
  ].join("|");
}
