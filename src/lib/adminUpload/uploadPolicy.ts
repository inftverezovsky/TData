import {
  getStageSlotAnnouncementLabel,
  getUploadableTbdAnnouncementSides,
  type ScheduleViewMatch,
  type TbdAnnouncementSide,
  resolveStageSlotAnnouncement,
} from "@/lib/matches/scheduleView";
import { resolveTournamentTeamMappingDisciplineSlug } from "@/lib/tbvolley/config";
import { detectTournamentSource, type TournamentSource } from "@/lib/utils/tournamentSource";

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
    teamMappingDisciplineSlug: resolveTournamentTeamMappingDisciplineSlug(input.disciplineSlug, input.normalization),
    scheduleLeadDisciplineSlug,
    matchContext: {
      disciplineSlug: input.disciplineSlug,
      source,
    },
  };
}

export function getUploadPolicyTbdAnnouncementSides(policy: Pick<UploadPolicy, "matchContext">, match: ScheduleViewMatch): TbdAnnouncementSide[] {
  return getUploadableTbdAnnouncementSides(match, policy.matchContext);
}

export function resolveUploadPolicyStageAnnouncementLabel(
  policy: Pick<UploadPolicy, "matchContext">,
  match: ScheduleViewMatch,
): string | null {
  return resolveStageSlotAnnouncement(match, policy.matchContext)?.label || getStageSlotAnnouncementLabel(match, policy.matchContext);
}
