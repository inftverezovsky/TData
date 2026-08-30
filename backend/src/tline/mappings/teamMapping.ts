import { getNameMatchScore, normalizeFuzzyName } from "../../teams/fuzzyMatch";
import type {
  TLineAdminTeamCandidate,
  TLineExistingTeamMapping,
  TLineSourceTeam,
} from "../domain/types";

export const TLINE_AUTOMAP_MIN_SCORE = 0.95;
export const TLINE_AUTOMAP_MIN_GAP = 0.05;

export type ScoredTeamCandidate = {
  readonly adminTeamId: string;
  readonly score: number;
};

export type TLineTeamMappingResult =
  | {
      readonly kind: "mapped";
      readonly adminTeamId: string;
      readonly method: "locked" | "external_id" | "exact_ru" | "exact_en" | "alias" | "fuzzy";
      readonly score: number;
      readonly runnerUpScore: number | null;
    }
  | {
      readonly kind: "ambiguous";
      readonly candidateAdminTeamIds: readonly string[];
      readonly bestScore: number;
      readonly runnerUpScore: number;
    }
  | {
      readonly kind: "unmapped";
      readonly bestAdminTeamId: string | null;
      readonly bestScore: number;
      readonly runnerUpScore: number | null;
    };

export function chooseAutoMappingCandidate(
  candidates: readonly ScoredTeamCandidate[],
  options: { readonly minScore?: number; readonly minGap?: number } = {},
): ScoredTeamCandidate | null {
  const minScore = options.minScore ?? TLINE_AUTOMAP_MIN_SCORE;
  const minGap = options.minGap ?? TLINE_AUTOMAP_MIN_GAP;
  const sorted = [...candidates].sort((left, right) => right.score - left.score || left.adminTeamId.localeCompare(right.adminTeamId));
  const best = sorted[0];
  if (!best || best.score < minScore) return null;
  const runnerUp = sorted[1];
  if (runnerUp && best.score - runnerUp.score + Number.EPSILON < minGap) return null;
  return { ...best };
}

export function resolveTeamMapping(input: {
  readonly sourceTeam: TLineSourceTeam;
  readonly adminTeams: readonly TLineAdminTeamCandidate[];
  readonly existingMappings: readonly TLineExistingTeamMapping[];
}): TLineTeamMappingResult {
  const { sourceTeam, adminTeams } = input;
  const manualUnmapped = input.existingMappings.find(
    (mapping) =>
      mapping.locked
      && mapping.status === "MANUAL_UNMAPPED"
      && mapping.championshipId === sourceTeam.championshipId
      && mapping.sourceTeamId === sourceTeam.id,
  );
  if (manualUnmapped) {
    return { kind: "unmapped", bestAdminTeamId: null, bestScore: 0, runnerUpScore: null };
  }
  const locked = input.existingMappings.find(
    (mapping) =>
      mapping.locked &&
      mapping.championshipId === sourceTeam.championshipId &&
      mapping.sourceTeamId === sourceTeam.id &&
      adminTeams.some((candidate) => candidate.id === mapping.adminTeamId),
  );
  if (locked) return mapped(locked.adminTeamId, "locked");

  const byExternalId = sourceTeam.externalId
    ? adminTeams.filter((candidate) => candidate.platformId === sourceTeam.externalId)
    : [];
  if (byExternalId.length === 1) return mapped(byExternalId[0].id, "external_id");

  const exactRu = exactByName(sourceTeam.nameRu, adminTeams, (candidate) => candidate.nameRu);
  if (exactRu.length === 1) return mapped(exactRu[0].id, "exact_ru");

  const exactEn = exactByName(sourceTeam.nameEn, adminTeams, (candidate) => candidate.nameEn);
  if (exactEn.length === 1) return mapped(exactEn[0].id, "exact_en");

  const sourceNames = [sourceTeam.nameRu, sourceTeam.nameEn, ...sourceTeam.aliases].filter(isNonEmptyString);
  const sourcePrimaryNames = [sourceTeam.nameRu, sourceTeam.nameEn].filter(isNonEmptyString);
  const aliasMatches = adminTeams.filter((candidate) => {
    const candidatePrimaryNames = [candidate.nameRu, candidate.nameEn].filter(isNonEmptyString);
    return (
      candidate.aliases.some((alias) => sourcePrimaryNames.some((name) => sameNormalizedName(alias, name))) ||
      sourceTeam.aliases.some((alias) => candidatePrimaryNames.some((name) => sameNormalizedName(alias, name)))
    );
  });
  if (aliasMatches.length === 1) return mapped(aliasMatches[0].id, "alias");

  const scored = adminTeams
    .map((candidate) => ({
      adminTeamId: candidate.id,
      score: highestNameScore(sourceNames, [candidate.nameRu, candidate.nameEn, ...candidate.aliases].filter(isNonEmptyString)),
    }))
    .sort((left, right) => right.score - left.score || left.adminTeamId.localeCompare(right.adminTeamId));
  const selected = chooseAutoMappingCandidate(scored);
  if (selected) {
    return {
      kind: "mapped",
      adminTeamId: selected.adminTeamId,
      method: "fuzzy",
      score: selected.score,
      runnerUpScore: scored[1]?.score ?? null,
    };
  }

  const best = scored[0];
  const runnerUp = scored[1];
  if (best && runnerUp && best.score >= TLINE_AUTOMAP_MIN_SCORE && best.score - runnerUp.score < TLINE_AUTOMAP_MIN_GAP) {
    return {
      kind: "ambiguous",
      candidateAdminTeamIds: scored
        .filter((candidate) => best.score - candidate.score < TLINE_AUTOMAP_MIN_GAP)
        .map((candidate) => candidate.adminTeamId),
      bestScore: best.score,
      runnerUpScore: runnerUp.score,
    };
  }

  return {
    kind: "unmapped",
    bestAdminTeamId: best?.adminTeamId ?? null,
    bestScore: best?.score ?? 0,
    runnerUpScore: runnerUp?.score ?? null,
  };
}

function exactByName(
  name: string | null,
  candidates: readonly TLineAdminTeamCandidate[],
  selectName: (candidate: TLineAdminTeamCandidate) => string | null,
) {
  if (!name) return [];
  return candidates.filter((candidate) => sameNormalizedName(name, selectName(candidate)));
}

function sameNormalizedName(left: string | null, right: string | null) {
  if (!left || !right) return false;
  const normalizedLeft = normalizeFuzzyName(left);
  return normalizedLeft.length > 0 && normalizedLeft === normalizeFuzzyName(right);
}

function highestNameScore(leftNames: readonly string[], rightNames: readonly string[]) {
  return leftNames.reduce(
    (highest, left) => rightNames.reduce((score, right) => Math.max(score, getNameMatchScore(left, right)), highest),
    0,
  );
}

function mapped(
  adminTeamId: string,
  method: Extract<TLineTeamMappingResult, { kind: "mapped" }>["method"],
): TLineTeamMappingResult {
  return { kind: "mapped", adminTeamId, method, score: 1, runnerUpScore: null };
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
