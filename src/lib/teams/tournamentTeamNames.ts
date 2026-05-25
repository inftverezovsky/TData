import { isPlaceholderTeam, isTbdPlaceholderTeam, normalizeTeamName } from "@/lib/teams/teams";
import { getStageSlotAnnouncementLabel, getUploadableTbdAnnouncementSides } from "@/lib/matches/scheduleView";
import { hasExactMatchTime } from "@/lib/matches/time";
import {
  buildTeamNameCanonicalizer,
  type TeamNameSource,
} from "@/lib/teams/canonicalize";
import { supportsStageAnnouncements, type TournamentSource } from "@/lib/utils/tournamentSource";

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
};

type TournamentTeamParticipant = TeamNameSource & {
  name?: string | null;
};

export function collectTournamentTeamNames({
  matches,
  participants,
  mappings = [],
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

  for (const match of matches) {
    if (
      shouldExposeStageAnnouncements &&
      hasExactMatchTime(match) &&
      !hasFinishedResult(match) &&
      isPlaceholderTeam(match.teamAName) &&
      isPlaceholderTeam(match.teamBName)
    ) {
      const uploadableTbdSides = getUploadableTbdAnnouncementSides(match, { source });
      if (uploadableTbdSides.includes("stage")) {
        const stageName = getStageSlotAnnouncementLabel(match);
        addTeamName(rawNames, stageName, true);
        forcedNames.add(normalizeTeamName(stageName));
        continue;
      }
    }
    addTeamName(rawNames, match.teamAName);
    addTeamName(rawNames, match.teamBName);
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

function shouldExposeTeamName(name: string | null | undefined) {
  const value = String(name ?? "").trim();
  if (!value) return false;
  return !isPlaceholderTeam(value) || isTbdPlaceholderTeam(value);
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
