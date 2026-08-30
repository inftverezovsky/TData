import type {
  AdminLineMatch,
  OfficialSourceMatch,
  TLineAutomaticStatus,
  TLineComparisonResult,
} from "../domain/types";

export interface CompareTLineMatchesInput {
  readonly sourceMatches: readonly OfficialSourceMatch[];
  readonly adminMatches: readonly AdminLineMatch[];
  readonly allowedTimeDriftMinutes: number;
  readonly candidateMatchWindowMinutes: number;
  readonly persistentLinks?: readonly { readonly sourceMatchId: string; readonly adminMatchId: string }[];
}

type OrderedComparison = TLineComparisonResult & { readonly order: number };
type MatchAssignment = {
  readonly source: OfficialSourceMatch;
  readonly admin: AdminLineMatch;
  readonly deltaMinutes: number;
};

export function compareTLineMatches(input: CompareTLineMatchesInput): readonly TLineComparisonResult[] {
  validateOptions(input);

  const sourceOrder = new Map(input.sourceMatches.map((match, index) => [match.id, index]));
  const adminOrder = new Map(input.adminMatches.map((match, index) => [match.id, index]));
  const handledSources = new Set<string>();
  const handledAdmins = new Set<string>();
  const results: OrderedComparison[] = [];
  const add = (result: TLineComparisonResult) => {
    const order = result.sourceMatchId != null
      ? sourceOrder.get(result.sourceMatchId) ?? Number.MAX_SAFE_INTEGER
      : input.sourceMatches.length + (adminOrder.get(result.adminMatchId ?? "") ?? Number.MAX_SAFE_INTEGER);
    results.push({ ...result, order });
  };

  for (const link of input.persistentLinks ?? []) {
    const source = input.sourceMatches.find((candidate) => candidate.id === link.sourceMatchId);
    const admin = input.adminMatches.find((candidate) => candidate.id === link.adminMatchId);
    if (!source || !admin || source.championshipId !== admin.championshipId || handledSources.has(source.id) || handledAdmins.has(admin.id)) continue;
    add({ ...compareMatchedPair(source, admin, input.allowedTimeDriftMinutes), manualLinked: true });
    handledSources.add(source.id);
    handledAdmins.add(admin.id);
  }

  for (const source of input.sourceMatches) {
    if (handledSources.has(source.id)) continue;
    if (!hasMappedTeams(source)) {
      add(singleSidedResult(source.id, null, "TEAM_UNMAPPED"));
      handledSources.add(source.id);
    }
  }

  for (const duplicates of duplicateGroups(
    input.sourceMatches.filter((source) => !handledSources.has(source.id) && hasMappedTeams(source)),
    sourceIdentityKey,
  )) {
    if (duplicates.length < 2) continue;
    for (const source of duplicates) {
      add(singleSidedResult(source.id, null, "DUPLICATE_SOURCE"));
      handledSources.add(source.id);
    }
    for (const admin of input.adminMatches) {
      const deltaMinutes = candidateDeltaMinutes(duplicates[0], admin);
      if (
        pairKeyForSource(duplicates[0]) === pairKeyForAdmin(admin) &&
        deltaMinutes != null &&
        deltaMinutes <= input.candidateMatchWindowMinutes
      ) {
        handledAdmins.add(admin.id);
      }
    }
  }

  for (const duplicates of duplicateGroups(input.adminMatches.filter((admin) => !handledAdmins.has(admin.id)), adminIdentityKey)) {
    if (duplicates.length < 2 || duplicates.some((admin) => handledAdmins.has(admin.id))) continue;
    const matchingSources = input.sourceMatches.filter(
      (source) =>
        !handledSources.has(source.id) &&
        hasMappedTeams(source) &&
        pairKeyForSource(source) === pairKeyForAdmin(duplicates[0]) &&
        isCandidateInsideWindow(source, duplicates[0], input.candidateMatchWindowMinutes),
    );

    if (matchingSources.length > 0) {
      const source = matchingSources[0];
      add({
        ...baseResult(source.id, null, "DUPLICATE_ADMIN"),
        candidateAdminMatchIds: duplicates.map((admin) => admin.id),
      });
      handledSources.add(source.id);
    } else {
      for (const admin of duplicates) add(singleSidedResult(null, admin.id, "DUPLICATE_ADMIN"));
    }
    for (const admin of duplicates) handledAdmins.add(admin.id);
  }

  const pairKeys = Array.from(
    new Set([
      ...input.sourceMatches.filter(hasMappedTeams).map(pairKeyForSource),
      ...input.adminMatches.map(pairKeyForAdmin),
    ]),
  ).sort();

  for (const pairKey of pairKeys) {
    const sources = input.sourceMatches.filter(
      (match) => !handledSources.has(match.id) && hasMappedTeams(match) && pairKeyForSource(match) === pairKey,
    );
    const admins = input.adminMatches.filter((match) => !handledAdmins.has(match.id) && pairKeyForAdmin(match) === pairKey);

    for (const source of sources) {
      if (handledSources.has(source.id)) continue;
      const candidates = admins
        .filter((admin) => !handledAdmins.has(admin.id))
        .map((admin) => ({ admin, deltaMinutes: candidateDeltaMinutes(source, admin) }))
        .filter((candidate): candidate is { admin: AdminLineMatch; deltaMinutes: number } =>
          candidate.deltaMinutes != null && candidate.deltaMinutes <= input.candidateMatchWindowMinutes,
        )
        .sort((left, right) => left.deltaMinutes - right.deltaMinutes);
      const bestDelta = candidates[0]?.deltaMinutes;
      const equalBest = bestDelta == null
        ? []
        : candidates.filter((candidate) => Math.abs(candidate.deltaMinutes - bestDelta) < 1e-9);
      if (equalBest.length > 1) {
        const candidateIds = equalBest.map((candidate) => candidate.admin.id);
        add({
          ...baseResult(source.id, null, "MATCH_AMBIGUOUS"),
          candidateAdminMatchIds: candidateIds,
          timeDeltaMinutes: bestDelta,
        });
        handledSources.add(source.id);
        for (const candidate of equalBest) handledAdmins.add(candidate.admin.id);
      }
    }

    const remainingSources = sources.filter((source) => !handledSources.has(source.id));
    const remainingAdmins = admins.filter((admin) => !handledAdmins.has(admin.id));
    const assignments = findMinimumCostAssignments(
      remainingSources,
      remainingAdmins,
      input.candidateMatchWindowMinutes,
    );

    for (const assignment of assignments) {
      add(compareMatchedPair(assignment.source, assignment.admin, input.allowedTimeDriftMinutes));
      handledSources.add(assignment.source.id);
      handledAdmins.add(assignment.admin.id);
    }
  }

  for (const source of input.sourceMatches) {
    if (!handledSources.has(source.id)) {
      add(singleSidedResult(source.id, null, source.startTimeUtc == null ? "SOURCE_TIME_UNDEFINED" : "SOURCE_ONLY"));
      handledSources.add(source.id);
    }
  }
  for (const admin of input.adminMatches) {
    if (!handledAdmins.has(admin.id)) {
      add(singleSidedResult(null, admin.id, "ADMIN_ONLY"));
      handledAdmins.add(admin.id);
    }
  }

  return results
    .sort((left, right) => left.order - right.order)
    .map(({ order: _order, ...result }) => Object.freeze({ ...result, candidateAdminMatchIds: Object.freeze([...result.candidateAdminMatchIds]), reasons: Object.freeze([...result.reasons]) }));
}

function compareMatchedPair(
  source: OfficialSourceMatch,
  admin: AdminLineMatch,
  allowedTimeDriftMinutes: number,
): TLineComparisonResult {
  const swappedSides =
    source.home.adminTeamId === admin.away.adminTeamId && source.away.adminTeamId === admin.home.adminTeamId;

  if (source.status !== admin.status) {
    return matchedResult(source.id, admin.id, "STATUS_MISMATCH", swappedSides, timeDeltaMinutes(source, admin));
  }

  if (source.startTimeUtc == null || admin.startTimeUtc == null) {
    if (source.startTimeUtc == null && admin.startTimeUtc == null && isUnambiguousSpecialStatus(source.status)) {
      return matchedResult(source.id, admin.id, "AUTO_OK", swappedSides, null);
    }
    return matchedResult(source.id, admin.id, "SOURCE_TIME_UNDEFINED", swappedSides, null);
  }

  const deltaMinutes = timeDeltaMinutes(source, admin);
  if (deltaMinutes == null) return matchedResult(source.id, admin.id, "SOURCE_TIME_UNDEFINED", swappedSides, null);
  if (moscowDate(source.startTimeUtc) !== moscowDate(admin.startTimeUtc) || deltaMinutes > 30) {
    return matchedResult(source.id, admin.id, "TIME_CRITICAL", swappedSides, deltaMinutes);
  }
  if (deltaMinutes <= allowedTimeDriftMinutes) {
    return matchedResult(source.id, admin.id, "AUTO_OK", swappedSides, deltaMinutes);
  }
  if (deltaMinutes <= 5) return matchedResult(source.id, admin.id, "TIME_WARNING", swappedSides, deltaMinutes);
  return matchedResult(source.id, admin.id, "TIME_ERROR", swappedSides, deltaMinutes);
}

function findMinimumCostAssignments(
  sources: readonly OfficialSourceMatch[],
  admins: readonly AdminLineMatch[],
  candidateWindowMinutes: number,
): readonly MatchAssignment[] {
  type Solution = { readonly pairs: readonly MatchAssignment[]; readonly cost: number };
  const memo = new Map<string, Solution>();
  const solve = (sourceIndex: number, availableAdmins: readonly AdminLineMatch[]): Solution => {
    if (sourceIndex >= sources.length) return { pairs: [], cost: 0 };
    const memoKey = `${sourceIndex}:${availableAdmins.map((admin) => admin.id).sort().join(",")}`;
    const cached = memo.get(memoKey);
    if (cached) return cached;
    const source = sources[sourceIndex];
    const withoutSource = solve(sourceIndex + 1, availableAdmins);
    let best: Solution = withoutSource;

    for (const admin of availableAdmins) {
      const deltaMinutes = candidateDeltaMinutes(source, admin);
      if (deltaMinutes == null || deltaMinutes > candidateWindowMinutes) continue;
      const tail = solve(sourceIndex + 1, availableAdmins.filter((candidate) => candidate.id !== admin.id));
      const candidate: Solution = {
        pairs: [{ source, admin, deltaMinutes }, ...tail.pairs],
        cost: deltaMinutes + tail.cost,
      };
      if (
        candidate.pairs.length > best.pairs.length ||
        (candidate.pairs.length === best.pairs.length && candidate.cost < best.cost)
      ) {
        best = candidate;
      }
    }
    memo.set(memoKey, best);
    return best;
  };

  return solve(0, admins).pairs;
}

function validateOptions(input: CompareTLineMatchesInput) {
  if (!Number.isFinite(input.allowedTimeDriftMinutes) || input.allowedTimeDriftMinutes < 0 || input.allowedTimeDriftMinutes > 5) {
    throw new RangeError("allowedTimeDriftMinutes must be between 0 and 5");
  }
  if (!Number.isFinite(input.candidateMatchWindowMinutes) || input.candidateMatchWindowMinutes < 0) {
    throw new RangeError("candidateMatchWindowMinutes must be a non-negative number");
  }
}

function hasMappedTeams(match: OfficialSourceMatch): boolean {
  return Boolean(match.home.adminTeamId && match.away.adminTeamId);
}

function pairKeyForSource(match: OfficialSourceMatch): string {
  return `${match.championshipId}\u0001${unorderedPairKey(match.home.adminTeamId ?? "", match.away.adminTeamId ?? "")}`;
}

function pairKeyForAdmin(match: AdminLineMatch): string {
  return `${match.championshipId}\u0001${unorderedPairKey(match.home.adminTeamId, match.away.adminTeamId)}`;
}

function unorderedPairKey(left: string, right: string): string {
  return [left, right].sort().join("\u0000");
}

function sourceIdentityKey(match: OfficialSourceMatch): string {
  return `${pairKeyForSource(match)}\u0000${match.startTimeUtc ?? match.startTimeRaw}\u0000${match.status}`;
}

function adminIdentityKey(match: AdminLineMatch): string {
  return `${pairKeyForAdmin(match)}\u0000${match.startTimeUtc ?? "undefined"}\u0000${match.status}`;
}

function duplicateGroups<T>(items: readonly T[], keyOf: (item: T) => string): readonly (readonly T[])[] {
  const byKey = items.reduce<Map<string, readonly T[]>>((groups, item) => {
    const key = keyOf(item);
    const existing = groups.get(key) ?? [];
    return new Map(groups).set(key, [...existing, item]);
  }, new Map());
  return Array.from(byKey.values());
}

function isCandidateInsideWindow(
  source: OfficialSourceMatch,
  admin: AdminLineMatch,
  candidateMatchWindowMinutes: number,
): boolean {
  const deltaMinutes = candidateDeltaMinutes(source, admin);
  return deltaMinutes != null && deltaMinutes <= candidateMatchWindowMinutes;
}

function candidateDeltaMinutes(source: OfficialSourceMatch, admin: AdminLineMatch): number | null {
  if (source.startTimeUtc == null || admin.startTimeUtc == null) {
    return source.startTimeUtc == null && admin.startTimeUtc == null && source.status === admin.status ? 0 :
      source.startTimeUtc == null ? 0 : null;
  }
  return timeDeltaMinutes(source, admin);
}

function timeDeltaMinutes(source: OfficialSourceMatch, admin: AdminLineMatch): number | null {
  if (!source.startTimeUtc || !admin.startTimeUtc) return null;
  const sourceTime = new Date(source.startTimeUtc).getTime();
  const adminTime = new Date(admin.startTimeUtc).getTime();
  if (!Number.isFinite(sourceTime) || !Number.isFinite(adminTime)) return null;
  return Math.abs(adminTime - sourceTime) / 60_000;
}

function moscowDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function isUnambiguousSpecialStatus(status: OfficialSourceMatch["status"]) {
  return status === "TBD" || status === "POSTPONED" || status === "CANCELLED";
}

function matchedResult(
  sourceMatchId: string,
  adminMatchId: string,
  status: TLineAutomaticStatus,
  swappedSides: boolean,
  timeDeltaMinutesValue: number | null,
): TLineComparisonResult {
  return {
    sourceMatchId,
    adminMatchId,
    candidateAdminMatchIds: [adminMatchId],
    automaticStatus: status,
    reasons: [status],
    swappedSides,
    timeDeltaMinutes: timeDeltaMinutesValue,
  };
}

function singleSidedResult(
  sourceMatchId: string | null,
  adminMatchId: string | null,
  status: TLineAutomaticStatus,
): TLineComparisonResult {
  return baseResult(sourceMatchId, adminMatchId, status);
}

function baseResult(
  sourceMatchId: string | null,
  adminMatchId: string | null,
  status: TLineAutomaticStatus,
): TLineComparisonResult {
  return {
    sourceMatchId,
    adminMatchId,
    candidateAdminMatchIds: adminMatchId ? [adminMatchId] : [],
    automaticStatus: status,
    reasons: [status],
    swappedSides: false,
    timeDeltaMinutes: null,
  };
}
