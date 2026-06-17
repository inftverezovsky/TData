import {
  getStageSlotAnnouncementLabel,
  getUploadableTbdAnnouncementSides,
  isGeneratedScheduleMatrixRow,
  type ScheduleViewMatch,
  type TbdAnnouncementSide,
  resolveStageSlotAnnouncement,
} from "@backend/matches/scheduleView";
import { hasExactMatchTime } from "@backend/matches/time";
import { resolveTournamentTeamMappingDisciplineSlug as resolveBeachVolleyballTeamMappingDisciplineSlug } from "@backend/sources/tbvolley/config";
import { resolveTournamentTeamMappingDisciplineSlug as resolveTableTennisTeamMappingDisciplineSlug } from "@backend/sources/tablet/config";
import { isPlaceholderTeam, isTbdPlaceholderTeam } from "@backend/teams/teams";
import { detectTournamentSource, type TournamentSource } from "@backend/utils/tournamentSource";

export type UploadPolicyMatchContext = {
  disciplineSlug: string;
  source: TournamentSource;
};

export type UploadPolicy = {
  disciplineSlug: string;
  source: TournamentSource;
  teamMappingDisciplineSlug: string;
  scheduleLeadDisciplineSlug: string;
  matchContext: UploadPolicyMatchContext;
};

export function resolveUploadPolicy(input: {
  disciplineSlug: string;
  sourceUrl?: string | null;
  normalization?: unknown;
}): UploadPolicy {
  const source = detectTournamentSource(input.sourceUrl);
  const scheduleLeadDisciplineSlug = input.disciplineSlug;

  return {
    disciplineSlug: input.disciplineSlug,
    source,
    teamMappingDisciplineSlug: resolveTeamMappingDisciplineSlug(input.disciplineSlug, input.normalization),
    scheduleLeadDisciplineSlug,
    matchContext: {
      disciplineSlug: input.disciplineSlug,
      source,
    },
  };
}

function resolveTeamMappingDisciplineSlug(disciplineSlug: string, normalization: unknown) {
  const slug = disciplineSlug.trim().toLowerCase();
  if (slug === "beachvolleyball") return resolveBeachVolleyballTeamMappingDisciplineSlug(slug, normalization);
  if (slug === "tabletennis") return resolveTableTennisTeamMappingDisciplineSlug(slug, normalization);
  return slug;
}

export type UploadPolicyMatch = ScheduleViewMatch & {
  status?: string | null;
};

export type UploadPolicySkipReason =
  | "generated-matrix-row"
  | "missing-exact-time"
  | "finished-or-scored";

export type UploadPolicySkipDecision = {
  reason: UploadPolicySkipReason;
  message: string;
};

export function resolveUploadPolicyPreMappingSkip(match: UploadPolicyMatch): UploadPolicySkipDecision | null {
  if (isGeneratedScheduleMatrixRow(match)) {
    return {
      reason: "generated-matrix-row",
      message: "Generated crosstable rows are not upload-ready",
    };
  }

  if (!hasExactMatchTime(match)) {
    return {
      reason: "missing-exact-time",
      message: "Match has no exact start time",
    };
  }

  if (
    match.scoreA !== null &&
    match.scoreA !== undefined ||
    match.scoreB !== null &&
    match.scoreB !== undefined ||
    /\b(?:finished|completed|official)\b/.test(match.status?.toLowerCase() || "")
  ) {
    return {
      reason: "finished-or-scored",
      message: "Match already finished (has score or finished status)",
    };
  }

  return null;
}

export function getUploadPolicyTbdAnnouncementSides(policy: Pick<UploadPolicy, "matchContext">, match: ScheduleViewMatch): TbdAnnouncementSide[] {
  return getUploadableTbdAnnouncementSides(match, policy.matchContext);
}

export function isUploadPolicyStageAnnouncementSlot(policy: Pick<UploadPolicy, "matchContext">, match: ScheduleViewMatch): boolean {
  return getUploadPolicyTbdAnnouncementSides(policy, match).includes("stage");
}

export function isUploadPolicyStageAnnouncementRequested(input: {
  hasExplicitSelection: boolean;
  selectedFullMatch: boolean;
  selectedSides?: Set<TbdAnnouncementSide>;
}): boolean {
  const { hasExplicitSelection, selectedFullMatch, selectedSides } = input;
  return (
    !hasExplicitSelection ||
    selectedFullMatch ||
    Boolean(selectedSides && (selectedSides.has("stage") || selectedSides.has("teamA") || selectedSides.has("teamB")))
  );
}

export function getUploadPolicyRequestedTbdSides(input: {
  selectedSides?: Set<TbdAnnouncementSide>;
  selectedFullMatch: boolean;
  uploadableTbdSides: TbdAnnouncementSide[];
}): TbdAnnouncementSide[] {
  const { selectedSides, selectedFullMatch, uploadableTbdSides } = input;
  return selectedSides
    ? uploadableTbdSides.filter((side) => selectedSides.has(side))
    : selectedFullMatch
      ? uploadableTbdSides
      : [];
}

export type UploadPolicyPlaceholderDecision = {
  hasUnsupportedPlaceholder: boolean;
  teamAIsPlaceholder: boolean;
  teamBIsPlaceholder: boolean;
  teamAIsUploadableTbd: boolean;
  teamBIsUploadableTbd: boolean;
};

export function resolveUploadPolicyPlaceholderDecision(teamAName: string, teamBName: string): UploadPolicyPlaceholderDecision {
  const teamAIsPlaceholder = isPlaceholderTeam(teamAName);
  const teamBIsPlaceholder = isPlaceholderTeam(teamBName);
  const teamAIsUploadableTbd = isTbdPlaceholderTeam(teamAName);
  const teamBIsUploadableTbd = isTbdPlaceholderTeam(teamBName);

  return {
    hasUnsupportedPlaceholder:
      (teamAIsPlaceholder && !teamAIsUploadableTbd) ||
      (teamBIsPlaceholder && !teamBIsUploadableTbd),
    teamAIsPlaceholder,
    teamBIsPlaceholder,
    teamAIsUploadableTbd,
    teamBIsUploadableTbd,
  };
}

export function resolveUploadPolicyStageAnnouncementLabel(
  policy: Pick<UploadPolicy, "matchContext">,
  match: ScheduleViewMatch,
): string | null {
  return resolveStageSlotAnnouncement(match, policy.matchContext)?.label || getStageSlotAnnouncementLabel(match, policy.matchContext);
}
