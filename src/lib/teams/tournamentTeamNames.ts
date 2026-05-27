import { isPlaceholderTeam, isTbdPlaceholderTeam, normalizeTeamName } from "@/lib/teams/teams";
import {
  expandScheduleAnnouncementMatch,
  getUploadableTbdAnnouncementSides,
} from "@/lib/matches/scheduleView";
import {
  buildTeamNameCanonicalizer,
  type TeamNameSource,
} from "@/lib/teams/canonicalize";
import {
  isBeachVolleyballTournamentSource,
  supportsStageAnnouncements,
  type TournamentSource,
} from "@/lib/utils/tournamentSource";
import { isBeachVolleyballScopeSlug } from "@/lib/tbvolley/config";

type TournamentTeamMatch = {
  teamAName?: string | null;
  teamBName?: string | null;
  stage?: string | null;
  round?: string | null;
  rawText?: string | null;
  matchDate?: Date | string | number | null;
  matchDateTime?: string | null;
  scoreA?: number | null;
  scoreB?: number | null;
  status?: string | null;
  hasPlaceholderTeams?: boolean | null;
};

type TournamentTeamParticipant = TeamNameSource & {
  name?: string | null;
};

export function collectTournamentTeamNames({
  matches,
  participants,
  mappings = [],
  disciplineSlug,
  source,
}: {
  matches: TournamentTeamMatch[];
  participants: TournamentTeamParticipant[];
  mappings?: TeamNameSource[];
  disciplineSlug?: string | null;
  source?: TournamentSource | null;
}) {
  const rawNames = new Set<string>();
  const forcedNames = new Set<string>();
  const shouldExposeStageAnnouncements = supportsStageAnnouncements(source);
  const shouldExposeMappedPlaceholderAnnouncements = supportsMappedPlaceholderAnnouncements({
    disciplineSlug,
    source,
  });

  for (const match of matches) {
    if (
      shouldExposeStageAnnouncements &&
      isPlaceholderTeam(match.teamAName) &&
      isPlaceholderTeam(match.teamBName)
    ) {
      if (!hasFinishedResult(match)) {
        const stageAnnouncement = expandScheduleAnnouncementMatch(match, { disciplineSlug, source })
          .find((entry) => entry.isStageAnnouncement && entry.singleAnnouncementTeamName);
        if (stageAnnouncement?.singleAnnouncementTeamName) {
          addForcedTeamName(rawNames, forcedNames, stageAnnouncement.singleAnnouncementTeamName);
        }
      }
      continue;
    }

    const forceTeamA = shouldExposeMappedPlaceholderAnnouncements
      && shouldExposeMappedPlaceholderTeamName(match.teamAName, match, { disciplineSlug, source });
    const forceTeamB = shouldExposeMappedPlaceholderAnnouncements
      && shouldExposeMappedPlaceholderTeamName(match.teamBName, match, { disciplineSlug, source });

    if (forceTeamA) addForcedTeamName(rawNames, forcedNames, match.teamAName);
    else addTeamName(rawNames, match.teamAName);

    if (forceTeamB) addForcedTeamName(rawNames, forcedNames, match.teamBName);
    else addTeamName(rawNames, match.teamBName);
  }

  for (const participant of participants) {
    addTeamName(rawNames, participant.name);
  }

  const namesWithoutShortAliases = collapseObviousShortAliases(Array.from(rawNames));
  const canonicalizer = buildTeamNameCanonicalizer({
    participants,
    mappings,
    extraNames: namesWithoutShortAliases,
  });

  const byNormalizedName = new Map<string, string>();
  for (const name of namesWithoutShortAliases) {
    const canonicalName = canonicalizer.canonicalizeName(name) || name;
    const normalized = normalizeTeamName(canonicalName);
    if (!forcedNames.has(normalized) && !shouldExposeTeamName(canonicalName)) continue;

    const existing = byNormalizedName.get(normalized);
    byNormalizedName.set(normalized, preferDisplayName(existing, canonicalName));
  }

  return Array.from(byNormalizedName.values()).sort((a, b) => a.localeCompare(b));
}

function hasFinishedResult(match: TournamentTeamMatch) {
  if (match.scoreA != null || match.scoreB != null) return true;
  const status = String(match.status || "").toLowerCase();
  return status.includes("finished") || status.includes("completed");
}

function addTeamName(names: Set<string>, name: string | null | undefined, force = false) {
  const trimmed = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!force && !shouldExposeTeamName(trimmed)) return;
  names.add(trimmed);
}

function addForcedTeamName(names: Set<string>, forcedNames: Set<string>, name: string | null | undefined) {
  const trimmed = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!trimmed) return;
  addTeamName(names, trimmed, true);
  forcedNames.add(normalizeTeamName(trimmed));
}

function shouldExposeTeamName(name: string | null | undefined) {
  const value = String(name ?? "").trim();
  if (!value) return false;
  return !isPlaceholderTeam(value) || isTbdPlaceholderTeam(value);
}

function shouldExposeMappedPlaceholderTeamName(
  name: string | null | undefined,
  match: TournamentTeamMatch,
  options: { disciplineSlug?: string | null; source?: TournamentSource | null },
) {
  const value = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!value || !isPlaceholderTeam(value) || isTbdPlaceholderTeam(value)) return false;
  if (hasFinishedResult(match)) return false;

  const normalizedValue = normalizeTeamName(value);
  return getUploadableTbdAnnouncementSides(match, options).some((side) => {
    if (side === "stage") return false;
    const sideName = side === "teamA" ? match.teamAName : match.teamBName;
    return normalizeTeamName(sideName || "") === normalizedValue;
  });
}

function supportsMappedPlaceholderAnnouncements(options: { disciplineSlug?: string | null; source?: TournamentSource | null }) {
  return isBeachVolleyballTournamentSource(options.source)
    || isBeachVolleyballScopeSlug(options.disciplineSlug);
}

function collapseObviousShortAliases(names: string[]) {
  return names.filter((name) => {
    const key = normalizeTeamName(name);
    if (!/^[a-z0-9]$/i.test(key)) return true;

    const candidates = names.filter((candidate) => {
      if (candidate === name || !shouldExposeTeamName(candidate)) return false;
      const candidateKey = normalizeTeamName(candidate);
      return candidateKey.startsWith(key) && candidateKey.length <= 4 && /\d/.test(candidateKey);
    });

    return candidates.length !== 1;
  });
}

function preferDisplayName(existing: string | undefined, next: string) {
  if (!existing) return next;
  if (existing.length === next.length) return existing.localeCompare(next) <= 0 ? existing : next;
  return existing.length > next.length ? existing : next;
}
