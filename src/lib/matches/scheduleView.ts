import { getBestOfLabel } from "@/lib/matches/format";
import { hasExactMatchTime } from "@/lib/matches/time";
import { isPlaceholderTeam, isTbdPlaceholderTeam } from "@/lib/teams/teams";

export type TbdAnnouncementSide = "teamA" | "teamB";

export type ScheduleViewMatch = {
  id?: string;
  matchId?: string;
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

export type ScheduleAnnouncementEntry<T extends ScheduleViewMatch> = T & {
  selectionId?: string;
  sourceMatchId?: string;
  singleAnnouncementSide?: TbdAnnouncementSide;
  singleAnnouncementTeamName?: string;
  isSingleTeamAnnouncement?: boolean;
};

const TBD_ANNOUNCEMENT_SELECTION_SEPARATOR = "::";

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
  if (hasScore(match)) return false;

  const teamA = getScheduleTeamState(match.teamAName);
  const teamB = getScheduleTeamState(match.teamBName);

  if (teamA.unsupportedPlaceholder || teamB.unsupportedPlaceholder) return false;
  if (teamA.placeholder && teamB.placeholder) return false;

  return true;
}

export function isUploadableScheduleEntry(match: ScheduleViewMatch) {
  if (isGeneratedScheduleMatrixRow(match)) return false;
  if (hasScore(match)) return false;
  if (!hasExactMatchTime(match)) return false;

  const teamA = getScheduleTeamState(match.teamAName);
  const teamB = getScheduleTeamState(match.teamBName);

  return (
    (!teamA.placeholder || teamA.tbd) &&
    (!teamB.placeholder || teamB.tbd)
  );
}

export function isAnnouncementScheduleMatch(match: ScheduleViewMatch) {
  if (isGeneratedScheduleMatrixRow(match)) return false;
  if (hasScore(match)) return false;
  if (!hasExactMatchTime(match)) return false;

  const teamA = getScheduleTeamState(match.teamAName);
  const teamB = getScheduleTeamState(match.teamBName);

  if (teamA.real || teamB.real) {
    return teamA.unsupportedPlaceholder || teamB.unsupportedPlaceholder;
  }

  return Boolean(match.hasPlaceholderTeams || teamA.placeholder || teamB.placeholder);
}

export function buildTbdAnnouncementSelectionId(matchId: string, side: TbdAnnouncementSide) {
  return `${matchId}${TBD_ANNOUNCEMENT_SELECTION_SEPARATOR}${side}`;
}

export function parseScheduleSelectionId(selectionId: string): { matchId: string; side?: TbdAnnouncementSide } | null {
  const trimmed = selectionId.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(.*)::(teamA|teamB)$/);
  if (!match || !match[1]) return { matchId: trimmed };
  return { matchId: match[1], side: match[2] as TbdAnnouncementSide };
}

export function getUploadableTbdAnnouncementSides(match: ScheduleViewMatch): TbdAnnouncementSide[] {
  if (isGeneratedScheduleMatrixRow(match)) return [];
  if (hasScore(match)) return [];
  if (!hasExactMatchTime(match)) return [];

  const teamA = getScheduleTeamState(match.teamAName);
  const teamB = getScheduleTeamState(match.teamBName);
  if (!(teamA.tbd && teamB.tbd)) return [];

  const sides: TbdAnnouncementSide[] = [];
  if (teamA.tbd) sides.push("teamA");
  if (teamB.tbd) sides.push("teamB");
  return sides;
}

export function expandScheduleAnnouncementMatch<T extends ScheduleViewMatch>(
  match: T
): ScheduleAnnouncementEntry<T>[] {
  if (!isAnnouncementScheduleMatch(match)) return [];

  const sides = getUploadableTbdAnnouncementSides(match);
  if (sides.length === 0) return [match];

  const sourceMatchId = match.matchId || match.id;
  if (!sourceMatchId) return [match];

  return sides.map((side) => ({
    ...match,
    selectionId: buildTbdAnnouncementSelectionId(sourceMatchId, side),
    sourceMatchId,
    singleAnnouncementSide: side,
    singleAnnouncementTeamName: side === "teamA" ? match.teamAName || "TBD" : match.teamBName || "TBD",
    isSingleTeamAnnouncement: true,
  }));
}

export function expandScheduleAnnouncements<T extends ScheduleViewMatch>(matches: T[]) {
  return matches.flatMap(expandScheduleAnnouncementMatch);
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

function getScheduleTeamState(name: string | null | undefined) {
  const tbd = isTbdPlaceholderTeam(name);
  const placeholder = isPlaceholderTeam(name);
  return {
    tbd,
    placeholder,
    real: Boolean(name && !placeholder),
    unsupportedPlaceholder: placeholder && !tbd,
  };
}

function getBestOfSortValue(label: string) {
  const match = label.match(/^BO(\d+)$/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}
