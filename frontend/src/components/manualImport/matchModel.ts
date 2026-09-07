import type { ManualMatch, MappedMatch, TeamSide } from "./types";

/** Чистые преобразования таблицы: исходные массивы и Set вызывающего кода не изменяются. */
export function mergeMatchesWithMappedIds(matches: ManualMatch[], mappedMatches: MappedMatch[]) {
  return matches.map((match, index) => {
    const mapped = mappedMatches[index];
    return {
      ...match,
      team1PlatformId: match.team1PlatformId || mapped?.team1.platformId || "",
      team2PlatformId: match.team2PlatformId || mapped?.team2.platformId || "",
    };
  });
}

export function clearManualMatchPlatformIds(match: ManualMatch): ManualMatch {
  return {
    ...match,
    team1PlatformId: "",
    team2PlatformId: "",
  };
}

export function createAllSelectedIndexes(length: number) {
  return new Set(Array.from({ length }, (_, index) => index));
}

export function isValidManualAdminId(value: string) {
  return /^[1-9]\d*$/.test(value.trim());
}

export function getTeamCellKey(index: number, side: TeamSide) {
  return `${index}:${side}`;
}

export function createLockedTeamCellsFromMappedMatches(mappedMatches: MappedMatch[]) {
  const locked = new Set<string>();
  mappedMatches.forEach((match, index) => {
    if (match.team1.platformId && match.team1.source === "manual") locked.add(getTeamCellKey(index, "team1"));
    if (match.team2.platformId && match.team2.source === "manual") locked.add(getTeamCellKey(index, "team2"));
  });
  return locked;
}

export function mergeLockedTeamCellsFromSavedMappings(
  current: Set<string>,
  matches: ManualMatch[],
  mappedMatches: MappedMatch[],
  savedMappings: Array<{ teamName?: string; normalizedTeamName?: string; platformId?: string }>
) {
  const savedNames = new Set(
    savedMappings
      .flatMap((mapping) => [
        mapping.normalizedTeamName || "",
        normalizeManualTeamNameForClient(mapping.teamName || ""),
      ])
      .filter(Boolean)
  );
  if (savedNames.size === 0) return current;

  const next = new Set(current);
  matches.forEach((match, index) => {
    for (const side of ["team1", "team2"] as const) {
      const team = getTeamCellData(matches, mappedMatches, index, side);
      const normalizedTeamName = normalizeManualTeamNameForClient(team.name);
      if (team.platformId && (savedNames.has(normalizedTeamName) || savedNames.has(normalizedTeamName.replace(/\s+/g, "")))) {
        next.add(getTeamCellKey(index, side));
      }
    }
  });
  return next;
}

export function getTeamCellData(matches: ManualMatch[], mappedMatches: MappedMatch[], index: number, side: TeamSide) {
  const match = matches[index];
  const mapped = mappedMatches[index];
  if (side === "team1") {
    return {
      name: match?.team1 || mapped?.team1.name || "",
      platformId: match?.team1PlatformId || mapped?.team1.platformId || "",
    };
  }

  return {
    name: match?.team2 || mapped?.team2.name || "",
    platformId: match?.team2PlatformId || mapped?.team2.platformId || "",
  };
}

function normalizeManualTeamNameForClient(value: string) {
  return value.trim().toLowerCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ");
}

export function removeFromSet<T>(set: Set<T>, value: T) {
  const next = new Set(set);
  next.delete(value);
  return next;
}

export function shiftTeamCellSetAfterRemove(set: Set<string>, removedIndex: number) {
  const next = new Set<string>();
  for (const key of set) {
    const [rawIndex, side] = key.split(":") as [string, TeamSide | undefined];
    const index = Number(rawIndex);
    if (!Number.isSafeInteger(index) || (side !== "team1" && side !== "team2")) continue;
    if (index < removedIndex) next.add(key);
    if (index > removedIndex) next.add(getTeamCellKey(index - 1, side));
  }
  return next;
}

export function getTeamSideFromMatchField(field: keyof ManualMatch): TeamSide | null {
  if (field === "team1" || field === "team1PlatformId") return "team1";
  if (field === "team2" || field === "team2PlatformId") return "team2";
  return null;
}

export function getSelectedMatches(matches: ManualMatch[], selectedIndexes: Set<number>) {
  return matches.filter((_, index) => selectedIndexes.has(index));
}

export function mergeSelectedMatchesWithMappedIds(
  matches: ManualMatch[],
  selectedIndexes: Set<number>,
  mappedMatches: MappedMatch[]
) {
  // API возвращает только выбранные строки в порядке таблицы; индекс ответа не равен индексу исходного массива.
  let mappedIndex = 0;
  return matches.map((match, index) => {
    if (!selectedIndexes.has(index)) return match;
    const mapped = mappedMatches[mappedIndex++];
    return {
      ...match,
      team1PlatformId: match.team1PlatformId || mapped?.team1.platformId || "",
      team2PlatformId: match.team2PlatformId || mapped?.team2.platformId || "",
    };
  });
}

export function mergeSelectedMappedMatches(
  currentMappedMatches: MappedMatch[],
  selectedIndexes: Set<number>,
  nextMappedMatches: MappedMatch[]
) {
  // Set хранит порядок кликов. Перед объединением восстанавливаем порядок строк, принятый серверным ответом.
  let mappedIndex = 0;
  const merged = [...currentMappedMatches];
  for (const selectedIndex of Array.from(selectedIndexes).sort((a, b) => a - b)) {
    const mapped = nextMappedMatches[mappedIndex++];
    if (mapped) merged[selectedIndex] = mapped;
  }
  return merged;
}
