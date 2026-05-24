import { getBestOfLabel } from "@/lib/matches/format";
import { hasExactMatchTime } from "@/lib/matches/time";
import { isPlaceholderTeam, isTbdPlaceholderTeam } from "@/lib/teams/teams";
import { supportsStageAnnouncements, type TournamentSource } from "@/lib/utils/tournamentSource";
import { cleanLiquipediaBracketLabel, isLikelyLiquipediaLayoutNoise } from "@/lib/liquipedia/bracketLabels";

export type TbdAnnouncementSide = "teamA" | "teamB" | "stage";

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
  stage?: string | null;
  round?: string | null;
};

export type ScheduleAnnouncementEntry<T extends ScheduleViewMatch> = T & {
  selectionId?: string;
  sourceMatchId?: string;
  singleAnnouncementSide?: TbdAnnouncementSide;
  singleAnnouncementTeamName?: string;
  isSingleTeamAnnouncement?: boolean;
  isStageAnnouncement?: boolean;
};

const TBD_ANNOUNCEMENT_SELECTION_SEPARATOR = "::";
type ScheduleViewOptions = { disciplineSlug?: string | null; source?: TournamentSource | null };

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

export function isUploadableScheduleEntry(match: ScheduleViewMatch, options: ScheduleViewOptions = {}) {
  if (isGeneratedScheduleMatrixRow(match)) return false;
  if (hasScore(match)) return false;
  if (!hasExactMatchTime(match)) return false;
  if (isStageSlotAnnouncement(match, options)) return true;

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

  const match = trimmed.match(/^(.*)::(teamA|teamB|stage)$/);
  if (!match || !match[1]) return { matchId: trimmed };
  return { matchId: match[1], side: match[2] as TbdAnnouncementSide };
}

export function getUploadableTbdAnnouncementSides(match: ScheduleViewMatch, options: ScheduleViewOptions = {}): TbdAnnouncementSide[] {
  if (isGeneratedScheduleMatrixRow(match)) return [];
  if (hasScore(match)) return [];
  if (!hasExactMatchTime(match)) return [];
  if (isStageSlotAnnouncement(match, options)) return ["stage"];

  const teamA = getScheduleTeamState(match.teamAName);
  const teamB = getScheduleTeamState(match.teamBName);
  if (!(teamA.tbd && teamB.tbd)) return [];

  const sides: TbdAnnouncementSide[] = [];
  if (teamA.tbd) sides.push("teamA");
  if (teamB.tbd) sides.push("teamB");
  return sides;
}

export function expandScheduleAnnouncementMatch<T extends ScheduleViewMatch>(
  match: T,
  options: ScheduleViewOptions = {}
): ScheduleAnnouncementEntry<T>[] {
  if (!isAnnouncementScheduleMatch(match)) return [];
  if (isStageSlotAnnouncement(match, options)) {
    const stageLabel = getExplicitStageSlotAnnouncementLabel(match) || getStageSlotAnnouncementLabel(match);
    const sourceMatchId = match.matchId || match.id;
    const selectionId = sourceMatchId
      ? buildTbdAnnouncementSelectionId(sourceMatchId, "stage")
      : undefined;
    return [{
      ...match,
      selectionId,
      sourceMatchId,
      singleAnnouncementSide: "stage",
      singleAnnouncementTeamName: stageLabel,
      isSingleTeamAnnouncement: true,
      isStageAnnouncement: true,
    }];
  }

  const sides = getUploadableTbdAnnouncementSides(match, options);
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
  return matches.flatMap((match) => expandScheduleAnnouncementMatch(match));
}

export function expandScheduleAnnouncementsForDiscipline<T extends ScheduleViewMatch>(
  matches: T[],
  disciplineSlug?: string | null,
  source?: TournamentSource | null,
) {
  return matches.flatMap((match) => expandScheduleAnnouncementMatch(match, { disciplineSlug, source }));
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

function isStageSlotAnnouncement(match: ScheduleViewMatch, options: ScheduleViewOptions) {
  if (!supportsStageAnnouncements(options.source)) return false;
  const teamA = getScheduleTeamState(match.teamAName);
  const teamB = getScheduleTeamState(match.teamBName);
  return teamA.placeholder && teamB.placeholder && Boolean(getExplicitStageSlotAnnouncementLabel(match));
}

export function getStageSlotAnnouncementLabel(match: ScheduleViewMatch) {
  return getExplicitStageSlotAnnouncementLabel(match) || "Group Stage";
}

function getExplicitStageSlotAnnouncementLabel(match: ScheduleViewMatch) {
  return normalizeStageSlotLabel(match.round)
    || normalizeStageSlotLabel(match.stage)
    || normalizeStageSlotLabel(match.rawText);
}

function normalizeStageSlotLabel(value: string | null | undefined) {
  const cleanedValue = cleanLiquipediaBracketLabel(value);
  if (!hasStageSlotLabelHint(cleanedValue) && isLikelyLiquipediaLayoutNoise(value)) return "";

  const text = cleanedValue
    .replace(/&nbsp;/gi, " ")
    .replace(/\bTBD\d*\b/gi, " ")
    .replace(/\bvs\.?\b/gi, " ")
    .replace(/\b0\s*[-:]\s*0\b/g, " ")
    .replace(/\b(?:Best of|BO)\s*\d+\b/gi, " ")
    .replace(/\b(?:upcoming|scheduled|предстоящие|match|матч)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "";
  if (/^(?:r\d+m\d+|m\d+|slot\s*\d+)$/i.test(text) || /^[#\d\s-]+$/.test(text)) return "";

  const known = [
    /\bSwiss\s+Round\s+\d+(?:\s*#\d+)?\b/i,
    /\bGroup\s+Stage\b/i,
    /\bRound\s+Robin\b/i,
    /\bRegular\s+Season\b/i,
    /\bStage\s+\d+\b/i,
    /\bWeek\s+\d+\b/i,
    /\bRound\s+of\s+\d+\b/i,
    /\bWinners?'?\s+Round\s+\d+\b/i,
    /\bLosers?'?\s+Round\s+\d+\b/i,
    /\bLCQ\s+Round\s+\d+\b/i,
    /\bUpper\s+Bracket\s+(?:Round\s+\d+|Quarter[-\s]?finals?|Semi[-\s]?finals?|Finals?)\b/i,
    /\bLower\s+Bracket\s+(?:Round\s+\d+|Quarter[-\s]?finals?|Semi[-\s]?finals?|Finals?)\b/i,
    /\bTo\s+Playoffs?\b/i,
    /\bAdvance\s+to\s+Playoffs?\b/i,
    /\bQuarter[-\s]?finals?\b/i,
    /\bSemi[-\s]?finals?\b/i,
    /\bWinners?'?\s+Finals?\b/i,
    /\bLosers?'?\s+Finals?\b/i,
    /\bGrand\s+Finals?\b/i,
    /\bPlayoffs?\b/i,
    /\bFinals?\b/i,
  ];

  for (const pattern of known) {
    const match = text.match(pattern);
    if (match?.[0]) {
      return normalizeKnownStageName(match[0]);
    }
  }

  const withoutTournamentPrefix = text
    .replace(/^.+?\b(?:Group Stage|Regular\s+Season|Stage\s+\d+|Week\s+\d+|Round\s+of\s+\d+|LCQ\s+Round\s+\d+|Upper\s+Bracket\s+(?:Round\s+\d+|Quarter[-\s]?finals?|Semi[-\s]?finals?|Finals?)|Lower\s+Bracket\s+(?:Round\s+\d+|Quarter[-\s]?finals?|Semi[-\s]?finals?|Finals?)|Winners?'?\s+Round\s+\d+|Losers?'?\s+Round\s+\d+|To\s+Playoffs?|Advance\s+to\s+Playoffs?|Playoffs?|Quarter[-\s]?finals?|Semi[-\s]?finals?|Winners?'?\s+Finals?|Losers?'?\s+Finals?|Grand\s+Finals?)\b/i, (match) => {
      const stage = match.match(/\b(?:Group Stage|Regular\s+Season|Stage\s+\d+|Week\s+\d+|Round\s+of\s+\d+|LCQ\s+Round\s+\d+|Upper\s+Bracket\s+(?:Round\s+\d+|Quarter[-\s]?finals?|Semi[-\s]?finals?|Finals?)|Lower\s+Bracket\s+(?:Round\s+\d+|Quarter[-\s]?finals?|Semi[-\s]?finals?|Finals?)|Winners?'?\s+Round\s+\d+|Losers?'?\s+Round\s+\d+|To\s+Playoffs?|Advance\s+to\s+Playoffs?|Playoffs?|Quarter[-\s]?finals?|Semi[-\s]?finals?|Winners?'?\s+Finals?|Losers?'?\s+Finals?|Grand\s+Finals?)\b/i);
      return stage?.[0] || match;
    })
    .trim();

  return withoutTournamentPrefix && withoutTournamentPrefix !== text ? withoutTournamentPrefix.slice(0, 80) : "";
}

function hasStageSlotLabelHint(value: string) {
  return /\b(?:Group Stage|Round Robin|Regular\s+Season|Stage\s+\d+|Week\s+\d+|Round\s+of\s+\d+|LCQ\s+Round\s+\d+|Upper\s+Bracket|Lower\s+Bracket|Winners?'?\s+Round\s+\d+|Losers?'?\s+Round\s+\d+|To\s+Playoffs?|Advance\s+to\s+Playoffs?|Playoffs?|Quarter[-\s]?finals?|Semi[-\s]?finals?|Winners?'?\s+Finals?|Losers?'?\s+Finals?|Grand\s+Finals?|Finals?)\b/i.test(value);
}

function normalizeKnownStageName(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  if (/round robin/i.test(text)) return "Group Stage";
  if (/regular\s+season/i.test(text)) return "Regular Season";
  if (/advance\s+to\s+playoffs?/i.test(text) || /^to\s+playoffs?/i.test(text)) return "To Playoff";
  const lcqRound = text.match(/lcq\s+round\s+\d+/i);
  if (lcqRound) return titleCaseStage(lcqRound[0]).replace(/^Lcq\b/, "LCQ");
  const upperBracket = text.match(/upper\s+bracket\s+(?:round\s+\d+|quarter[-\s]?finals?|semi[-\s]?finals?|finals?)/i);
  if (upperBracket) return normalizeBracketStageName(upperBracket[0], "Upper");
  const lowerBracket = text.match(/lower\s+bracket\s+(?:round\s+\d+|quarter[-\s]?finals?|semi[-\s]?finals?|finals?)/i);
  if (lowerBracket) return normalizeBracketStageName(lowerBracket[0], "Lower");
  const numberedStage = text.match(/stage\s+\d+/i);
  if (numberedStage) return titleCaseStage(numberedStage[0]);
  const week = text.match(/week\s+\d+/i);
  if (week) return titleCaseStage(week[0]);
  const roundOf = text.match(/round\s+of\s+\d+/i);
  if (roundOf) return titleCaseStage(roundOf[0]);
  const winnersRound = text.match(/winners?'?\s+round\s+\d+/i);
  if (winnersRound) return titleCaseStage(winnersRound[0]).replace(/^Winners'?/, "Winners'");
  const losersRound = text.match(/losers?'?\s+round\s+\d+/i);
  if (losersRound) return titleCaseStage(losersRound[0]).replace(/^Losers'?/, "Losers'");
  if (/quarter/i.test(text)) return "Quarterfinals";
  if (/semi/i.test(text)) return "Semifinals";
  if (/winners?/i.test(text)) return "Winners' Finals";
  if (/losers?/i.test(text)) return "Losers' Finals";
  if (/grand/i.test(text)) return "Grand Finals";
  if (/group stage/i.test(text)) return "Group Stage";
  if (/playoffs?/i.test(text)) return "Playoffs";
  if (/^final/i.test(text)) return "Finals";
  return text;
}

function normalizeBracketStageName(value: string, bracket: "Upper" | "Lower") {
  if (/quarter/i.test(value)) return `${bracket} Bracket Quarterfinals`;
  if (/semi/i.test(value)) return `${bracket} Bracket Semifinals`;
  if (/final/i.test(value)) return `${bracket} Bracket Final`;
  const round = value.match(/round\s+\d+/i);
  if (round) return `${bracket} Bracket ${titleCaseStage(round[0])}`;
  return titleCaseStage(value);
}

function titleCaseStage(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    .replace(/\bOf\b/g, "of");
}

function getBestOfSortValue(label: string) {
  const match = label.match(/^BO(\d+)$/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}
