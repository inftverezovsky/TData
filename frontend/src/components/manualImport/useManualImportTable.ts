"use client";

import { shiftManualImportMatchDates } from "@backend/manualImport/timeShift";
import { createAllSelectedIndexes, getTeamCellKey, removeFromSet, shiftTeamCellSetAfterRemove, getTeamSideFromMatchField } from "./matchModel";
import type { ManualMatch } from "./types";
import type { ManualImportState } from "./useManualImportState";

export function useManualImportTable(state: ManualImportState) {
  const { matches, setMatches, setMappedMatches, setSelectedMatchIndexes, setPreview, setMessage, setMappingConflicts, setMappingSaveSummary, setLastServiceJsonUrl, timeShiftMinutes, setLockedTeamCells, setEditingTeamCells, setSavingTeamCells, tableMutationLocked } = state;

  function addEmptyMatch() {
    if (tableMutationLocked) return;
    setMatches((current) => [
      ...current,
      {
        tournament: "Manual Import",
        team1: "",
        team2: "",
        team1PlatformId: "",
        team2PlatformId: "",
        date: "",
      },
    ]);
    setSelectedMatchIndexes((current) => new Set([...current, matches.length]));
    setPreview(null);
    setMappingConflicts([]);
    setMappingSaveSummary(null);
    setLastServiceJsonUrl("");
  }

  function updateMatch(index: number, field: keyof ManualMatch, value: string) {
    if (tableMutationLocked) return;
    setMatches((current) => current.map((match, i) => (i === index ? { ...match, [field]: value } : match)));
    const side = getTeamSideFromMatchField(field);
    if (side) {
      const cellKey = getTeamCellKey(index, side);
      setLockedTeamCells((current) => removeFromSet(current, cellKey));
    }
    setPreview(null);
    setMappingConflicts([]);
    setMappingSaveSummary(null);
    setLastServiceJsonUrl("");
  }

  function removeMatch(index: number) {
    // После удаления сдвигаем индексы выбора и всех состояний ячеек вместе, чтобы они не привязались к соседнему матчу.
    if (tableMutationLocked) return;
    setMatches((current) => current.filter((_, i) => i !== index));
    setMappedMatches((current) => current.filter((_, i) => i !== index));
    setSelectedMatchIndexes((current) => {
      const next = new Set<number>();
      for (const selectedIndex of current) {
        if (selectedIndex < index) next.add(selectedIndex);
        if (selectedIndex > index) next.add(selectedIndex - 1);
      }
      return next;
    });
    setLockedTeamCells((current) => shiftTeamCellSetAfterRemove(current, index));
    setEditingTeamCells((current) => shiftTeamCellSetAfterRemove(current, index));
    setSavingTeamCells((current) => shiftTeamCellSetAfterRemove(current, index));
    setPreview(null);
    setMappingConflicts([]);
    setMappingSaveSummary(null);
    setLastServiceJsonUrl("");
  }

  function toggleMatchSelection(index: number) {
    if (tableMutationLocked) return;
    setSelectedMatchIndexes((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
    setPreview(null);
    setLastServiceJsonUrl("");
  }

  function toggleAllMatchesSelection() {
    if (tableMutationLocked) return;
    setSelectedMatchIndexes((current) =>
      current.size === matches.length ? new Set() : createAllSelectedIndexes(matches.length)
    );
    setPreview(null);
    setLastServiceJsonUrl("");
  }

  function applyTimeShift(direction: -1 | 1) {
    if (tableMutationLocked) return;
    const minutes = Math.trunc(Number(timeShiftMinutes.replace(",", ".")));
    if (!Number.isFinite(minutes) || minutes <= 0) {
      setMessage({ type: "error", text: "Введите количество минут больше нуля." });
      return;
    }
    if (matches.length === 0) {
      setMessage({ type: "error", text: "Сначала распознайте или добавьте матчи." });
      return;
    }

    const result = shiftManualImportMatchDates(matches, minutes * direction);
    if (result.changedCount === 0) {
      setMessage({ type: "error", text: "Не удалось сдвинуть время: в матчах нет распознанных дат." });
      return;
    }

    setMatches(result.matches);
    setMappedMatches((current) =>
      current.map((mapped, index) => ({
        ...mapped,
        date: result.matches[index]?.date || mapped.date,
      }))
    );
    setPreview(null);
    setMappingConflicts([]);
    setMappingSaveSummary(null);
    setLastServiceJsonUrl("");
    setMessage({
      type: "success",
      text: `Время ${direction > 0 ? "увеличено" : "уменьшено"} на ${minutes} мин. Изменено: ${
        result.changedCount
      }, пропущено: ${result.skippedCount}.`,
    });
  }

  return { addEmptyMatch, updateMatch, removeMatch, toggleMatchSelection, toggleAllMatchesSelection, applyTimeShift };
}
