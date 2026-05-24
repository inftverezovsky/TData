import { getBestOfLabel } from "@/lib/matches/format";
import { hasExactMatchTime } from "@/lib/matches/time";
import { isPlaceholderTeam } from "@/lib/teams/teams";

export type ScheduleViewMatch = {
  format?: string | null;
  rawText?: string | null;
  matchDate?: Date | string | number | null;
  matchDateTime?: string | null;
  sourceUrl?: string | null;
  scoreA?: number | null;
  scoreB?: number | null;
  teamAName?: string | null;
  teamBName?: string | null;
  hasPlaceholderTeams?: boolean | null;
};

export function isSchedulePlaceholderMatch(match: ScheduleViewMatch) {
  return Boolean(
    match.hasPlaceholderTeams ||
      isPlaceholderTeam(match.teamAName) ||
      isPlaceholderTeam(match.teamBName)
  );
}

export function isGeneratedScheduleMatrixRow(match: ScheduleViewMatch) {
  if (isSchedulePlaceholderMatch(match)) return false;
  if (hasExactMatchTime(match)) return false;

  const rawText = String(match.rawText || "").toLowerCase();
  const format = String(match.format || "").toLowerCase().trim();
  return format === "round robin" || rawText.includes("crosstable");
}

export function isUploadReadyScheduleMatch(match: ScheduleViewMatch) {
  if (isGeneratedScheduleMatrixRow(match)) return false;
  if (!hasExactMatchTime(match)) return false;
  return !hasScore(match);
}

export function isAnnouncementScheduleMatch(match: ScheduleViewMatch) {
  if (isGeneratedScheduleMatrixRow(match)) return false;
  if (hasExactMatchTime(match)) return false;
  return !hasScore(match);
}

export function getScheduleMatchBestOfLabel(match: ScheduleViewMatch) {
  return getBestOfLabel(match.format) || getBestOfLabel(match.rawText) || "BO?";
}

export function buildScheduleFormatGroups<T extends ScheduleViewMatch>(matches: T[]) {
  const groups = new Map<string, T[]>();

  for (const match of matches) {
    const label = getScheduleMatchBestOfLabel(match);
    const group = groups.get(label) || [];
    group.push(match);
    groups.set(label, group);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => {
      const formatDiff = getBestOfSortValue(a) - getBestOfSortValue(b);
      return formatDiff || a.localeCompare(b);
    })
    .map(([format, groupMatches]) => ({ format, matches: groupMatches }));
}

function hasScore(match: ScheduleViewMatch) {
  return match.scoreA != null || match.scoreB != null;
}

function getBestOfSortValue(label: string) {
  const match = label.match(/^BO(\d+)$/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}
