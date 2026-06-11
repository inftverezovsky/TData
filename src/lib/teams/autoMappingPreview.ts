import { isKnownStageAnnouncementLabel } from "@/lib/matches/scheduleView";
import {
  getNameMatchDetails,
  getPlatformTeamSearchNames,
  normalizeFuzzyName,
  type PlatformTeamMatchMethod,
  type PlatformTeamScore,
} from "@/lib/teams/fuzzyMatch";
import { buildTeamMappingLookup, findTeamMapping } from "@/lib/teams/mappingLookup";
import { isPlaceholderTeam, normalizeTeamName } from "@/lib/teams/teams";

const AUTO_MAP_MIN_SCORE = 85;
const AUTO_MAP_SUGGESTED_MIN_SCORE = 75;
const MANUAL_CONFLICT_MIN_SCORE = 92;

export type AutoMappingAdminTeam = {
  platformId: string;
  platformName: string;
  platformNameRu?: string | null;
  platformNameEn?: string | null;
  normalizedName?: string | null;
  normalizedNameRu?: string | null;
  normalizedNameEn?: string | null;
};

export type AutoMappingSourceMapping = {
  id?: string;
  liquipediaName: string;
  liquipediaNormalizedName?: string | null;
  platformId?: string | null;
  canonicalName?: string | null;
  status?: string | null;
  isManual?: boolean | null;
  isLockedFromAutoMapping?: boolean | null;
  alias?: string | null;
};

export type AutoMappingPreviewItem = {
  liquipediaName: string;
  normalizedName: string;
  platformId?: string | null;
  adminName?: string | null;
  matchedName?: string | null;
  score?: number | null;
  secondPlatformId?: string | null;
  secondAdminName?: string | null;
  secondScore?: number | null;
  existingPlatformId?: string | null;
  existingAdminName?: string | null;
  reason?: string | null;
  matchMethod?: string | null;
};

export type AutoMappingPreview = {
  adminTeamsCount: number;
  liquipediaTeamsFound: number;
  alreadyMappedCount: number;
  auto: AutoMappingPreviewItem[];
  suggested: AutoMappingPreviewItem[];
  ambiguous: AutoMappingPreviewItem[];
  unmapped: AutoMappingPreviewItem[];
  invalid: AutoMappingPreviewItem[];
  conflicts: AutoMappingPreviewItem[];
  diagnostics: AutoMappingPreviewDiagnostics;
};

export type AutoMappingSelection = {
  liquipediaName: string;
  platformId: string;
};

export type AutoMappingPreviewDiagnostics = {
  exactIndexHits: number;
  fuzzyCandidateComparisons: number;
  candidatePoolFallbacks: number;
  maxCandidatePoolSize: number;
  indexedNameKeys: number;
};

type IndexedAdminCandidate = {
  admin: AutoMappingAdminTeam;
  searchNames: string[];
};

type ExactIndexEntry = {
  candidate: IndexedAdminCandidate;
  matchedName: string;
  matchMethod: PlatformTeamMatchMethod;
};

type ExactIndexKey = {
  key: string;
  method: PlatformTeamMatchMethod;
  specificity: number;
};

type AutoMappingCandidateIndex = {
  candidates: IndexedAdminCandidate[];
  exact: Map<string, ExactIndexEntry[]>;
  tokenBuckets: Map<string, Set<IndexedAdminCandidate>>;
};

export function buildAutoMappingPreviewFromData({
  teamNames,
  mappings,
  adminTeams,
  includeAutoMapped = false,
}: {
  teamNames: string[];
  mappings: AutoMappingSourceMapping[];
  adminTeams: AutoMappingAdminTeam[];
  includeAutoMapped?: boolean;
}): AutoMappingPreview {
  const preview: AutoMappingPreview = {
    adminTeamsCount: adminTeams.length,
    liquipediaTeamsFound: 0,
    alreadyMappedCount: 0,
    auto: [],
    suggested: [],
    ambiguous: [],
    unmapped: [],
    invalid: [],
    conflicts: [],
    diagnostics: {
      exactIndexHits: 0,
      fuzzyCandidateComparisons: 0,
      candidatePoolFallbacks: 0,
      maxCandidatePoolSize: 0,
      indexedNameKeys: 0,
    },
  };
  const names = normalizeInputTeamNames(teamNames);
  const mappingLookup = buildTeamMappingLookup(mappings);
  const exactMappings = new Map(mappings.map((mapping) => [mapping.liquipediaName.toLowerCase(), mapping]));
  const candidateIndex = buildAutoMappingCandidateIndex(adminTeams);
  preview.diagnostics.indexedNameKeys = candidateIndex.exact.size;

  for (const name of names) {
    const normalizedName = normalizeTeamName(name);
    const exactMapping = exactMappings.get(name.toLowerCase());
    const lookupMapping = findTeamMapping(mappingLookup, name);
    const existingMapping = exactMapping || lookupMapping;

    if (existingMapping) preview.liquipediaTeamsFound++;

    if (isInvalidAutoMappingName(name) && !existingMapping?.platformId) {
      preview.invalid.push({
        liquipediaName: name,
        normalizedName,
        reason: "invalid_source_name",
      });
      continue;
    }

    if (existingMapping?.isLockedFromAutoMapping) {
      const conflict = getLockedMappingConflict(name, existingMapping, candidateIndex);
      if (conflict) {
        preview.conflicts.push(conflict);
      } else if (existingMapping.platformId) {
        preview.alreadyMappedCount++;
      } else {
        preview.unmapped.push({
          liquipediaName: name,
          normalizedName,
          reason: "manual_locked_without_platform_id",
        });
      }
      continue;
    }

    if (existingMapping?.platformId && !includeAutoMapped) {
      preview.alreadyMappedCount++;
      continue;
    }

    if (adminTeams.length === 0) {
      preview.unmapped.push({
        liquipediaName: name,
        normalizedName,
        reason: "admin_team_source_missing",
      });
      continue;
    }

    const sourceMapping = exactMapping || {
      liquipediaName: name,
      liquipediaNormalizedName: normalizedName,
    };
    const decision = getTeamAutoMappingDecision(sourceMapping, candidateIndex);
    if (decision.exactIndexHit) preview.diagnostics.exactIndexHits++;
    preview.diagnostics.fuzzyCandidateComparisons += decision.fuzzyCandidateComparisons;
    if (decision.candidatePoolFallback) preview.diagnostics.candidatePoolFallbacks++;
    preview.diagnostics.maxCandidatePoolSize = Math.max(
      preview.diagnostics.maxCandidatePoolSize,
      decision.candidatePoolSize
    );
    const item = toPreviewItem(name, normalizedName, decision, existingMapping);

    if (!decision.bestAdminTeam || decision.bestScore < AUTO_MAP_SUGGESTED_MIN_SCORE) {
      preview.unmapped.push({
        ...item,
        reason: "score_below_threshold",
      });
      continue;
    }

    const scoreGap = decision.bestScore - decision.secondBestScore;
    const requiredGap = getRequiredAutoMapGap(decision.bestScore);
    if (decision.bestScore >= AUTO_MAP_MIN_SCORE && scoreGap >= requiredGap) {
      preview.auto.push(item);
    } else if (scoreGap >= 5) {
      preview.suggested.push({
        ...item,
        reason: "medium_confidence",
      });
    } else {
      preview.ambiguous.push({
        ...item,
        reason: "candidate_gap_too_small",
      });
    }
  }

  return preview;
}

export function isInvalidAutoMappingName(name: string | null | undefined) {
  const raw = String(name ?? "").trim();
  if (isKnownStageAnnouncementLabel(raw)) return false;
  if (!raw || isPlaceholderTeam(raw)) return true;
  if (raw.includes("{{") || raw.includes("}}") || raw.includes("-->") || raw.includes("<--")) return true;
  if (/^[-–—<>]+$/.test(raw)) return true;
  if (/^\d+$/.test(raw)) return true;

  const normalized = normalizeTeamName(raw);
  const compact = normalized.replace(/\s+/g, "");
  if (!compact) return true;
  return compact.length < 3 && !/\d/.test(compact);
}

export function normalizeInputTeamNames(teamNames: string[]) {
  return Array.from(new Set(teamNames.map((name) => String(name ?? "").trim()).filter(Boolean)));
}

export function autoMappingSelectionKey(liquipediaName: string, platformId: string) {
  return `${liquipediaName.trim().toLowerCase()}\u0000${platformId.trim()}`;
}

function getLockedMappingConflict(
  name: string,
  existingMapping: AutoMappingSourceMapping,
  candidateIndex: AutoMappingCandidateIndex
): AutoMappingPreviewItem | null {
  if (!existingMapping.platformId || candidateIndex.candidates.length === 0) return null;

  const decision = getTeamAutoMappingDecision(
    {
      liquipediaName: name,
      liquipediaNormalizedName: normalizeTeamName(name),
    },
    candidateIndex
  );

  if (
    decision.bestAdminTeam &&
    decision.bestScore >= MANUAL_CONFLICT_MIN_SCORE &&
    decision.bestAdminTeam.platformId !== existingMapping.platformId
  ) {
    return {
      ...toPreviewItem(name, normalizeTeamName(name), decision, existingMapping),
      existingPlatformId: existingMapping.platformId,
      existingAdminName: existingMapping.canonicalName || null,
      reason: "manual_mapping_conflict",
    };
  }

  return null;
}

function getTeamAutoMappingDecision(
  mapping: { liquipediaName: string; liquipediaNormalizedName?: string | null },
  index: AutoMappingCandidateIndex
) {
  const liqName = mapping.liquipediaNormalizedName || normalizeTeamName(mapping.liquipediaName);
  if (!liqName) {
    return {
      bestScore: 0,
      secondBestScore: 0,
      bestAdminTeam: null,
      secondAdminTeam: null,
      bestMatch: null,
      secondMatch: null,
      exactIndexHit: false,
      fuzzyCandidateComparisons: 0,
      candidatePoolSize: 0,
      candidatePoolFallback: false,
    };
  }

  const indexedExact = getExactIndexedDecision(mapping.liquipediaName, index);
  if (indexedExact) return indexedExact;

  let pool = selectCandidatePool(mapping.liquipediaName, index);
  let scoredPool = scoreCandidatePool(mapping.liquipediaName, liqName, pool.candidates);

  if (!pool.usedFallback && scoredPool.bestScore < AUTO_MAP_SUGGESTED_MIN_SCORE) {
    pool = { candidates: index.candidates, usedFallback: true };
    const fallbackScoredPool = scoreCandidatePool(mapping.liquipediaName, liqName, pool.candidates);
    scoredPool = {
      ...fallbackScoredPool,
      fuzzyCandidateComparisons:
        scoredPool.fuzzyCandidateComparisons + fallbackScoredPool.fuzzyCandidateComparisons,
    };
  }

  return {
    bestScore: scoredPool.bestScore,
    secondBestScore: scoredPool.secondBestScore,
    bestAdminTeam: scoredPool.bestAdminTeam,
    secondAdminTeam: scoredPool.secondAdminTeam,
    bestMatch: scoredPool.bestMatch,
    secondMatch: scoredPool.secondMatch,
    exactIndexHit: false,
    fuzzyCandidateComparisons: scoredPool.fuzzyCandidateComparisons,
    candidatePoolSize: pool.candidates.length,
    candidatePoolFallback: pool.usedFallback,
  };
}

function scoreCandidatePool(noisyName: string, normalizedName: string, candidates: IndexedAdminCandidate[]) {
  let best: { admin: AutoMappingAdminTeam; score: number; match: PlatformTeamScore } | null = null;
  let secondDistinct: { admin: AutoMappingAdminTeam; score: number; match: PlatformTeamScore } | null = null;
  let fuzzyCandidateComparisons = 0;

  for (const candidate of candidates) {
    const rawMatch = scoreIndexedCandidateDetailed(noisyName, candidate);
    const normalizedMatch = scoreIndexedCandidateDetailed(normalizedName, candidate, noisyName);
    const bestMatch = rawMatch.score >= normalizedMatch.score ? rawMatch : normalizedMatch;
    const scored = {
      admin: candidate.admin,
      score: bestMatch.score * 100,
      match: bestMatch,
    };
    fuzzyCandidateComparisons++;

    if (!best || scored.score > best.score) {
      if (best && best.admin.platformId !== scored.admin.platformId) {
        secondDistinct = best;
      }
      best = scored;
    } else if (
      best.admin.platformId !== scored.admin.platformId &&
      (!secondDistinct || scored.score > secondDistinct.score)
    ) {
      secondDistinct = scored;
    }
  }

  return {
    bestScore: best?.score ?? 0,
    secondBestScore: secondDistinct?.score ?? 0,
    bestAdminTeam: best?.admin ?? null,
    secondAdminTeam: secondDistinct?.admin ?? null,
    bestMatch: best?.match ?? null,
    secondMatch: secondDistinct?.match ?? null,
    fuzzyCandidateComparisons,
  };
}

function buildAutoMappingCandidateIndex(adminTeams: AutoMappingAdminTeam[]): AutoMappingCandidateIndex {
  const index: AutoMappingCandidateIndex = {
    candidates: adminTeams.map((admin) => ({
      admin,
      searchNames: getPlatformTeamSearchNames(admin),
    })),
    exact: new Map(),
    tokenBuckets: new Map(),
  };

  for (const candidate of index.candidates) {
    const bucketTokens = new Set<string>();

    for (const searchName of candidate.searchNames) {
      for (const exactKey of getExactIndexKeys(searchName)) {
        addExactIndexEntry(index.exact, exactKey.key, {
          candidate,
          matchedName: searchName,
          matchMethod: exactKey.method,
        });
      }

      for (const token of getCandidateBucketTokens(searchName)) {
        bucketTokens.add(token);
      }
    }

    for (const token of bucketTokens) {
      const bucket = index.tokenBuckets.get(token) ?? new Set<IndexedAdminCandidate>();
      bucket.add(candidate);
      index.tokenBuckets.set(token, bucket);
    }
  }

  return index;
}

function addExactIndexEntry(index: Map<string, ExactIndexEntry[]>, key: string, entry: ExactIndexEntry) {
  const entries = index.get(key) ?? [];
  if (!entries.some((item) => item.candidate.admin.platformId === entry.candidate.admin.platformId && item.matchedName === entry.matchedName)) {
    entries.push(entry);
  }
  index.set(key, entries);
}

function getExactIndexedDecision(sourceName: string, index: AutoMappingCandidateIndex) {
  const sourceKeys = getExactIndexKeys(sourceName).sort((a, b) => b.specificity - a.specificity);
  const specificities = Array.from(new Set(sourceKeys.map((key) => key.specificity)));
  let entries = new Map<string, ExactIndexEntry>();

  for (const specificity of specificities) {
    entries = new Map<string, ExactIndexEntry>();
    for (const exactKey of sourceKeys.filter((key) => key.specificity === specificity)) {
      for (const entry of index.exact.get(exactKey.key) ?? []) {
        const existing = entries.get(entry.candidate.admin.platformId);
        if (!existing || getMatchMethodPriority(entry.matchMethod) < getMatchMethodPriority(existing.matchMethod)) {
          entries.set(entry.candidate.admin.platformId, entry);
        }
      }
    }
    if (entries.size > 0) break;
  }

  if (entries.size === 0) return null;

  const ranked = Array.from(entries.values()).sort(
    (left, right) => getMatchMethodPriority(left.matchMethod) - getMatchMethodPriority(right.matchMethod)
  );
  const best = ranked[0];
  const second = ranked.find((entry) => entry.candidate.admin.platformId !== best.candidate.admin.platformId) ?? null;
  const bestMatch: PlatformTeamScore = {
    score: 1,
    matchedName: best.matchedName,
    matchMethod: best.matchMethod,
  };
  const secondMatch: PlatformTeamScore | null = second
    ? {
        score: 1,
        matchedName: second.matchedName,
        matchMethod: second.matchMethod,
      }
    : null;

  return {
    bestScore: 100,
    secondBestScore: second ? 100 : 0,
    bestAdminTeam: best.candidate.admin,
    secondAdminTeam: second?.candidate.admin ?? null,
    bestMatch,
    secondMatch,
    exactIndexHit: true,
    fuzzyCandidateComparisons: 0,
    candidatePoolSize: 0,
    candidatePoolFallback: false,
  };
}

function scoreIndexedCandidateDetailed(
  noisyTeamName: string,
  candidate: IndexedAdminCandidate,
  safetySourceName = noisyTeamName
): PlatformTeamScore {
  let best: PlatformTeamScore = { score: 0, matchedName: null, matchMethod: "none" };

  for (const name of candidate.searchNames) {
    const details = applyPersonPairSafetyCap(
      safetySourceName,
      name,
      getNameMatchDetails(noisyTeamName, name),
      candidate.searchNames
    );
    if (details.score > best.score) {
      best = {
        score: details.score,
        matchedName: name,
        matchMethod: details.matchMethod,
      };
    }
  }

  return best;
}

function applyPersonPairSafetyCap(
  sourceName: string,
  candidateName: string,
  details: ReturnType<typeof getNameMatchDetails>,
  candidateSearchNames: string[] = [candidateName]
) {
  if (details.score < 0.75) return details;

  const sourceParts = splitPairSourceParts(sourceName);
  if (sourceParts.length < 2) {
    return details;
  }

  const candidatePairNames = Array.from(new Set([candidateName, ...candidateSearchNames]))
    .filter((name) => splitPairSourceParts(name).length === sourceParts.length);
  if (candidatePairNames.length === 0) return details;
  if (candidatePairNames.some((name) => hasCompatiblePersonPairFamilies(sourceName, name))) return details;

  return { ...details, score: Math.min(details.score, 0.72) };
}

function hasCompatiblePersonPairFamilies(sourceName: string, candidateName: string) {
  const sourceParts = splitPairSourceParts(sourceName);
  const candidateParts = splitPairSourceParts(candidateName);
  if (sourceParts.length < 2 || candidateParts.length < 2 || sourceParts.length !== candidateParts.length) {
    return true;
  }

  const candidateFamilyAliases = candidateParts.map((part) => getPersonFamilyAliases(part));
  const used = new Set<number>();

  return sourceParts.every((sourcePart) => {
    const sourceAliases = getPersonFamilyAliases(sourcePart);
    for (let index = 0; index < candidateFamilyAliases.length; index += 1) {
      if (used.has(index)) continue;
      if (setsIntersect(sourceAliases, candidateFamilyAliases[index])) {
        used.add(index);
        return true;
      }
    }
    return false;
  });
}

function getPersonFamilyAliases(value: string) {
  return new Set(
    getPersonPartKeyOptions(value)
      .map((option) => option.key.split(":")[0])
      .filter((part) => part && part.length >= 2)
  );
}

function setsIntersect(left: Set<string>, right: Set<string>) {
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
}

function selectCandidatePool(sourceName: string, index: AutoMappingCandidateIndex) {
  const sourceTokens = getCandidateBucketTokens(sourceName);
  const hits = new Map<IndexedAdminCandidate, number>();

  for (const token of sourceTokens) {
    const bucket = index.tokenBuckets.get(token);
    if (!bucket) continue;
    for (const candidate of bucket) {
      hits.set(candidate, (hits.get(candidate) ?? 0) + 1);
    }
  }

  if (hits.size === 0) {
    return { candidates: index.candidates, usedFallback: true };
  }

  const minimumHits = sourceTokens.length >= 4 ? 2 : 1;
  const filtered = Array.from(hits.entries())
    .filter(([, count]) => count >= minimumHits)
    .map(([candidate]) => candidate);
  const candidates = filtered.length > 0 ? filtered : Array.from(hits.keys());

  return {
    candidates,
    usedFallback: false,
  };
}

function getExactIndexKeys(value: string) {
  const normalized = normalizeFuzzyName(value);
  const keys: ExactIndexKey[] = [];

  if (normalized) {
    keys.push({ key: `name:${normalized}`, method: "exact", specificity: 10_000 + normalized.length });
  }

  const compact = getCompactNameKey(normalized);
  if (compact && compact !== normalized && compact.length >= 4) {
    keys.push({ key: `compact:${compact}`, method: "alias_exact", specificity: 9_000 + compact.length });
  }

  for (const pairKey of getPairPersonKeys(value)) {
    keys.push({ key: `pair:${pairKey.key}`, method: "pair_exact", specificity: 1_000 + pairKey.specificity });
  }

  return keys;
}

function getCandidateBucketTokens(value: string) {
  const normalized = normalizeFuzzyName(value);
  const tokens = new Set(
    normalized
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  );

  for (const personKey of getPairPersonPartKeys(value)) {
    const [family, ...givenParts] = personKey.split(":");
    if (family?.length >= 2) tokens.add(family);
    for (const part of givenParts) {
      if (part.length >= 2) tokens.add(part);
    }
  }

  return Array.from(tokens);
}

function getPairPersonKeys(value: string) {
  const parts = splitPairSourceParts(value);
  if (parts.length < 2) return [];

  const partKeyOptions = parts.map((part) => getPersonPartKeyOptions(part));
  if (partKeyOptions.some((options) => options.length === 0)) return [];

  const keys = new Map<string, number>();
  buildPairKeyCombinations(partKeyOptions, 0, [], keys);
  return Array.from(keys.entries()).map(([key, specificity]) => ({ key, specificity }));
}

function getPairPersonPartKeys(value: string) {
  return splitPairSourceParts(value).flatMap((part) => getPersonPartKeyOptions(part).map((option) => option.key));
}

function splitPairSourceParts(value: string) {
  return String(value ?? "")
    .split(/[\\/|&+]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildPairKeyCombinations(
  options: Array<Array<{ key: string; specificity: number }>>,
  index: number,
  current: Array<{ key: string; specificity: number }>,
  keys: Map<string, number>
) {
  if (index >= options.length) {
    const sorted = [...current].sort((left, right) => left.key.localeCompare(right.key));
    const key = sorted.map((item) => item.key).join("|");
    const specificity = sorted.reduce((total, item) => total + item.specificity, 0);
    keys.set(key, Math.max(keys.get(key) ?? 0, specificity));
    return;
  }

  for (const option of options[index]) {
    buildPairKeyCombinations(options, index + 1, [...current, option], keys);
  }
}

function getPersonPartKeyOptions(value: string) {
  const tokens = normalizeFuzzyName(value).split(" ").filter(Boolean);
  if (tokens.length === 0) return [];
  if (tokens.length === 1) return [{ key: tokens[0], specificity: tokens[0].length * 5 }];

  const keys = new Map<string, number>();
  const leadingInitials = tokens.slice(0, -1);
  const trailingInitials = tokens.slice(1);

  if (leadingInitials.length > 0 && leadingInitials.every(isInitialLikeToken)) {
    addPersonKeyOptions(keys, tokens[tokens.length - 1], leadingInitials);
  }

  if (trailingInitials.length > 0 && trailingInitials.every(isInitialLikeToken)) {
    addPersonKeyOptions(keys, tokens[0], trailingInitials);
  }

  addPersonKeyOptions(keys, tokens[0], tokens.slice(1));
  addPersonKeyOptions(keys, tokens[tokens.length - 1], tokens.slice(0, -1));

  return Array.from(keys.entries())
    .map(([key, specificity]) => ({ key, specificity }))
    .sort((left, right) => right.specificity - left.specificity);
}

function addPersonKeyOptions(keys: Map<string, number>, family: string, givenTokens: string[]) {
  if (!family || givenTokens.length === 0) return;

  for (const option of getGivenPartOptions(givenTokens)) {
    const key = [family, ...option.parts].join(":");
    const specificity = family.length * 5 + option.specificity;
    keys.set(key, Math.max(keys.get(key) ?? 0, specificity));
  }
}

function getGivenPartOptions(tokens: string[]) {
  const options = new Map<string, { parts: string[]; specificity: number }>();
  const add = (parts: string[], specificity: number) => {
    const filtered = parts.filter(Boolean);
    if (filtered.length === 0) return;
    const key = filtered.join(":");
    const existing = options.get(key);
    if (!existing || specificity > existing.specificity) {
      options.set(key, { parts: filtered, specificity });
    }
  };

  add(tokens, 20 + tokens.join("").length * 4);
  add(tokens.map((token) => token[0]), 8 + tokens.length * 3);

  const pinyinInitials = tokens.flatMap((token) => {
    const syllables = splitPinyinSyllables(token);
    return syllables.length > 1 ? syllables.map((syllable) => syllable[0]) : [token[0]];
  });
  add(pinyinInitials, 12 + pinyinInitials.length * 4);

  for (const parts of combineInitialLikeTokenVariants(tokens)) {
    add(parts, 14 + parts.length * 4);
  }

  return Array.from(options.values()).sort((left, right) => right.specificity - left.specificity);
}

function combineInitialLikeTokenVariants(tokens: string[]) {
  if (!tokens.every(isInitialLikeToken)) return [];

  const variants = tokens.map((token) => getInitialLikeTokenPartVariants(token));
  const combined: string[][] = [];
  combineTokenPartVariants(variants, 0, [], combined);
  return combined;
}

function combineTokenPartVariants(variants: string[][][], index: number, current: string[], combined: string[][]) {
  if (index >= variants.length) {
    combined.push(current);
    return;
  }

  for (const variant of variants[index]) {
    combineTokenPartVariants(variants, index + 1, [...current, ...variant], combined);
  }
}

function getInitialLikeTokenPartVariants(token: string) {
  if (/^\p{L}$/u.test(token)) return [[token]];
  if (token === "ch" || token === "sh" || token === "zh") {
    return [[token], [token[0]], token.split("")];
  }
  if (/^[bcdfghjklmnpqrstvwxz]{2,4}$/u.test(token)) {
    return [token.split(""), [token]];
  }
  return [[token]];
}

function isInitialLikeToken(token: string) {
  return /^\p{L}$/u.test(token)
    || token === "ch"
    || token === "sh"
    || token === "zh"
    || /^[bcdfghjklmnpqrstvwxz]{2,4}$/u.test(token);
}

function splitPinyinSyllables(token: string) {
  const normalized = normalizeFuzzyName(token).replace(/\s+/g, "");
  if (normalized.length < 4) return [];

  const result = splitPinyinSyllablesRecursive(normalized, new Map<string, string[] | null>());
  return result ?? [];
}

function splitPinyinSyllablesRecursive(value: string, memo: Map<string, string[] | null>): string[] | null {
  if (memo.has(value)) return memo.get(value) ?? null;
  if (isLikelyPinyinSyllable(value)) {
    memo.set(value, [value]);
    return [value];
  }

  for (let index = 2; index <= value.length - 2; index += 1) {
    const left = value.slice(0, index);
    if (!isLikelyPinyinSyllable(left)) continue;

    const right = splitPinyinSyllablesRecursive(value.slice(index), memo);
    if (right && right.length > 0) {
      const result = [left, ...right];
      memo.set(value, result);
      return result;
    }
  }

  memo.set(value, null);
  return null;
}

function isLikelyPinyinSyllable(value: string) {
  if (!value || value.length > 6) return false;
  const initials = ["zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "r", "z", "c", "s", "y", "w"];
  const finals = [
    "a", "o", "e", "ai", "ei", "ao", "ou", "an", "en", "ang", "eng", "ong", "er",
    "i", "ia", "ie", "iao", "iu", "ian", "in", "iang", "ing", "iong",
    "u", "ua", "uo", "uai", "ui", "uan", "un", "uang", "ueng",
    "ue", "ve",
  ];

  if (finals.includes(value)) return true;
  return initials.some((initial) => value.startsWith(initial) && finals.includes(value.slice(initial.length)));
}

function getCompactNameKey(value: string) {
  return normalizeFuzzyName(value).replace(/\s+/g, "");
}

function getMatchMethodPriority(method: PlatformTeamMatchMethod) {
  switch (method) {
    case "pair_exact":
      return 0;
    case "exact":
      return 1;
    case "alias_exact":
      return 2;
    default:
      return 3;
  }
}

function toPreviewItem(
  liquipediaName: string,
  normalizedName: string,
  decision: ReturnType<typeof getTeamAutoMappingDecision>,
  existingMapping?: AutoMappingSourceMapping
): AutoMappingPreviewItem {
  return {
    liquipediaName,
    normalizedName,
    platformId: decision.bestAdminTeam?.platformId || null,
    adminName: decision.bestAdminTeam?.platformName || null,
    matchedName: decision.bestMatch?.matchedName || null,
    score: decision.bestScore,
    secondPlatformId: decision.secondAdminTeam?.platformId || null,
    secondAdminName: decision.secondAdminTeam?.platformName || null,
    secondScore: decision.secondBestScore,
    existingPlatformId: existingMapping?.platformId || null,
    existingAdminName: existingMapping?.canonicalName || null,
    matchMethod: decision.bestMatch?.matchMethod || "token_fuzzy",
  };
}

function getRequiredAutoMapGap(score: number) {
  if (score >= 95) return 3;
  if (score >= 90) return 5;
  return 10;
}
