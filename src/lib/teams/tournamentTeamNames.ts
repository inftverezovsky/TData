import { isPlaceholderTeam, normalizeTeamName } from "@/lib/teams/teams";
import {
  buildTeamNameCanonicalizer,
  type TeamNameSource,
} from "@/lib/teams/canonicalize";

type TournamentTeamMatch = {
  teamAName?: string | null;
  teamBName?: string | null;
};

type TournamentTeamParticipant = TeamNameSource & {
  name?: string | null;
};

export function collectTournamentTeamNames({
  matches,
  participants,
  mappings = [],
}: {
  matches: TournamentTeamMatch[];
  participants: TournamentTeamParticipant[];
  mappings?: TeamNameSource[];
}) {
  const rawNames = new Set<string>();

  for (const match of matches) {
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
    if (!shouldExposeTeamName(canonicalName)) continue;

    const normalized = normalizeTeamName(canonicalName);
    const existing = byNormalizedName.get(normalized);
    byNormalizedName.set(normalized, preferDisplayName(existing, canonicalName));
  }

  return Array.from(byNormalizedName.values()).sort((a, b) => a.localeCompare(b));
}

function addTeamName(names: Set<string>, name: string | null | undefined) {
  const trimmed = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!shouldExposeTeamName(trimmed)) return;
  names.add(trimmed);
}

function shouldExposeTeamName(name: string | null | undefined) {
  const value = String(name ?? "").trim();
  if (!value) return false;
  return !isPlaceholderTeam(value) || /^TBD\d+$/i.test(value);
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
