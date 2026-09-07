"use client";

import { readJsonResponse } from "@/services/responseSchema";
import { decodeManualResponse } from "./response";
import { mergeMatchesWithMappedIds, getTeamCellKey, mergeLockedTeamCellsFromSavedMappings, getTeamCellData, removeFromSet } from "./matchModel";
import type { TeamSide } from "./types";
import type { ManualImportState } from "./useManualImportState";

export function useManualImportMapping(state: ManualImportState) {
  const { disciplineId, matches, setMatches, mappedMatches, setMappedMatches, setPreview, message, setMessage, setAutoMapping, setMappingSaving, setMappingConflicts, setMappingSaveSummary, setLockedTeamCells, setEditingTeamCells, setSavingTeamCells, hasValidDisciplineId } = state;

  async function runAutoMap() {
    if (matches.length === 0) {
      setMessage({ type: "error", text: "Сначала добавьте или распознайте матчи." });
      return;
    }
    if (!hasValidDisciplineId) {
      setMessage({ type: "error", text: "Укажите ID дисциплины, чтобы сохранить привязки команд." });
      return;
    }

    setAutoMapping(true);
    setMessage(null);
    setPreview(null);

    try {
      const response = await fetch("/api/manual-import/automap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disciplineId, matches }),
      });
      const data = await readJsonResponse(response, decodeManualResponse, "Ошибка запроса ручного импорта");
      if (!response.ok || !data.ok) throw new Error(data.error || "Автомапинг не выполнен");

      const nextMappedMatches = data.mappedMatches || [];
      setMappedMatches(nextMappedMatches);
      setMatches((current) => mergeMatchesWithMappedIds(current, nextMappedMatches));
      const conflicts = Array.isArray(data.conflicts) ? data.conflicts : [];
      setMappingConflicts(conflicts);
      setMappingSaveSummary({
        savedCount: data.savedCount || 0,
        skippedCount: data.skippedCount || 0,
        conflictCount: data.conflictCount || conflicts.length,
        overwrittenCount: data.overwrittenCount || 0,
      });
      setLockedTeamCells((current) =>
        mergeLockedTeamCellsFromSavedMappings(current, matches, nextMappedMatches, data.savedMappings || [])
      );
      setEditingTeamCells(new Set());
      setMessage({
        type: conflicts.length > 0 ? "info" : "success",
        text: `Автомапинг готов: ${data.readyMatchesCount || 0} строк с ID. Сохранено привязок: ${
          data.savedCount || 0
        }. Конфликты: ${conflicts.length}.`,
      });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Ошибка автомапинга" });
    } finally {
      setAutoMapping(false);
    }
  }

  async function saveManualTeamMappings(overwriteConflicts = false) {
    if (matches.length === 0) {
      setMessage({ type: "error", text: "Сначала добавьте или распознайте матчи." });
      return;
    }
    if (!hasValidDisciplineId) {
      setMessage({ type: "error", text: "Укажите ID дисциплины перед сохранением ID команд." });
      return;
    }

    setMappingSaving(true);
    setMessage(null);

    try {
      const response = await fetch("/api/manual-import/team-mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disciplineId, matches, overwriteConflicts }),
      });
      const data = await readJsonResponse(response, decodeManualResponse, "Ошибка запроса ручного импорта");
      if (!response.ok || !data.ok) throw new Error(data.error || "Не удалось сохранить ID команд");

      const conflicts = Array.isArray(data.conflicts) ? data.conflicts : [];
      setMappingConflicts(conflicts);
      setMappingSaveSummary({
        savedCount: data.savedCount || 0,
        skippedCount: data.skippedCount || 0,
        conflictCount: data.conflictCount || conflicts.length,
        overwrittenCount: data.overwrittenCount || 0,
      });
      setLockedTeamCells((current) =>
        mergeLockedTeamCellsFromSavedMappings(current, matches, mappedMatches, data.savedMappings || [])
      );
      if (!conflicts.length) setEditingTeamCells(new Set());

      if (conflicts.length > 0) {
        setMessage({
          type: "info",
          text: `Есть конфликты ID: ${conflicts.length}. Без отдельного подтверждения они не перезаписаны.`,
        });
      } else {
        setMessage({
          type: "success",
          text: `ID сохранены: ${data.savedCount || 0}. Пропущено: ${data.skippedCount || 0}.`,
        });
      }
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Ошибка сохранения ID команд" });
    } finally {
      setMappingSaving(false);
    }
  }

  async function saveSingleTeamMapping(index: number, side: TeamSide, overwriteConflict = false) {
    // Сохранить конкретный ID → при конфликте запросить явную замену → заблокировать подтверждённую ячейку.
    const team = getTeamCellData(matches, mappedMatches, index, side);
    const cellKey = getTeamCellKey(index, side);

    if (!hasValidDisciplineId) {
      setMessage({ type: "error", text: "Укажите ID дисциплины, чтобы сохранить привязки команд." });
      return;
    }
    if (!team.name.trim() || !team.platformId.trim()) {
      setMessage({ type: "error", text: "Укажите название команды и ID перед сохранением." });
      return;
    }

    setSavingTeamCells((current) => new Set(current).add(cellKey));
    setMessage(null);

    try {
      const response = await fetch("/api/manual-import/team-mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          disciplineId,
          teamName: team.name,
          platformId: team.platformId,
          canonicalName: team.name,
          overwriteConflict,
        }),
      });
      const data = await readJsonResponse(response, decodeManualResponse, "Ошибка запроса ручного импорта");
      if (!response.ok || !data.ok) throw new Error(data.error || "Не удалось сохранить ID команды");

      const conflicts = Array.isArray(data.conflicts) ? data.conflicts : [];
      setMappingConflicts(conflicts);
      setMappingSaveSummary({
        savedCount: data.savedCount || 0,
        skippedCount: data.skippedCount || 0,
        conflictCount: data.conflictCount || conflicts.length,
        overwrittenCount: data.overwrittenCount || 0,
      });

      if (conflicts.length > 0 && !overwriteConflict) {
        const conflict = conflicts[0];
        const shouldOverwrite = window.confirm(
          `${conflict.teamName}: уже сохранён ID ${conflict.existingPlatformId}, введён ${conflict.incomingPlatformId}. Заменить сохранённый ID?`
        );
        if (shouldOverwrite) {
          await saveSingleTeamMapping(index, side, true);
          return;
        }

        setMessage({ type: "info", text: "Конфликт ID не перезаписан." });
        return;
      }

      if ((data.savedCount || 0) > 0) {
        setLockedTeamCells((current) => new Set(current).add(cellKey));
        setEditingTeamCells((current) => removeFromSet(current, cellKey));
        setMessage({ type: "success", text: `${team.name}: ID ${team.platformId} сохранён для дисциплины ${disciplineId}.` });
      } else {
        setMessage({ type: "info", text: `${team.name}: нечего сохранять. Проверьте название и ID.` });
      }
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Ошибка сохранения ID команды" });
    } finally {
      setSavingTeamCells((current) => removeFromSet(current, cellKey));
    }
  }

  return { runAutoMap, saveManualTeamMappings, saveSingleTeamMapping };
}
