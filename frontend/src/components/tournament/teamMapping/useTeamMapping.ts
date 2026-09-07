"use client";

import { readJsonResponse, recordValue } from "@/services/responseSchema";
import { decodeAutoMappingResponse, decodeMappingSaveResponse } from "./response";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { dispatchTeamMappingsUpdated } from "@backend/utils/clientEvents";
import { buildMappingState, getPreviewSelectionKey, isValidPlatformId } from "./model";
import type { TeamMappingRecord, AutoMappingPreview, AdminTeamSuggestion, MappingNotice } from "./types";

/** Ручные ID, предпросмотр и применение автомаппинга разделяют единое состояние и проверку подтверждений. */
export function useTeamMapping(teamNames: string[], initialMappings: TeamMappingRecord[], disciplineSlug: string) {
  const router = useRouter();
  const [mappings, setMappings] = useState<Record<string, Partial<TeamMappingRecord> & { saved: boolean }>>(
    () => buildMappingState(teamNames, initialMappings)
  );

  const [saving, setSaving] = useState<string | null>(null);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [autoPreview, setAutoPreview] = useState<AutoMappingPreview | null>(null);
  const [selectedAutoMappings, setSelectedAutoMappings] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<MappingNotice | null>(null);

  useEffect(() => {
    setMappings(buildMappingState(teamNames, initialMappings));
  }, [teamNames, initialMappings]);

  async function handleSave(name: string) {
    setNotice(null);
    const entry = mappings[name];
    if (!isValidPlatformId(entry?.platformId)) {
      setNotice({ type: "error", text: "Введите корректный ID платформы перед сохранением." });
      return;
    }

    setSaving(name);
    try {
      const res = await fetch("/api/team-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          liquipediaName: name,
          disciplineSlug,
          alias: entry.alias,
          canonicalName: entry.canonicalName || entry.displayAdminName || name,
          platformId: entry.platformId,
          status: 'manual_mapped',
          isManual: true,
          isLockedFromAutoMapping: true
        })
      });
      const data = await readJsonResponse(res, decodeMappingSaveResponse, "Ошибка автомаппинга");

      setMappings((prev) => ({
        ...prev,
        [name]: { ...data.mapping, saved: true }
      }));
      setAutoPreview(null);
      setNotice({ type: "success", text: `ID для ${name} сохранён.` });
      dispatchTeamMappingsUpdated({ disciplineSlug });
      router.refresh();
    } catch (cause) {
      setNotice({ type: "error", text: cause instanceof Error ? cause.message : "Сетевая ошибка при сохранении маппинга." });
    } finally {
      setSaving(null);
    }
  }

  async function handleDelete(name: string, confirmed = false) {
    if (!confirmed && !confirm(`Удалить маппинг для "${name}"?`)) return;
    setSaving(name);
    setNotice(null);
    try {
      const res = await fetch(`/api/team-mapping?name=${encodeURIComponent(name)}&discipline=${disciplineSlug}`, {
        method: "DELETE",
        credentials: "same-origin"
      });
      await readJsonResponse(res, recordValue, "Ошибка удаления маппинга");
      setMappings((prev) => ({
        ...prev,
        [name]: {
          ...prev[name],
          platformId: null,
          canonicalName: null,
          alias: null,
          displayAdminName: "",
          adminTeamName: null,
          nameSource: "missing",
          status: 'manual_unmapped',
          matchMethod: null,
          confidenceScore: null,
          saved: false
        }
      }));
      setNotice({ type: "success", text: `Маппинг для ${name} очищен.` });
      dispatchTeamMappingsUpdated({ disciplineSlug });
      router.refresh();
    } catch (cause) {
      setNotice({ type: "error", text: cause instanceof Error ? cause.message : "Сетевая ошибка при удалении маппинга." });
    } finally {
      setSaving(null);
    }
  }

  async function handleAutoMapSingle(name: string) {
    setSaving(name);
    try {
      await previewAutoMap([name]);
    } catch (cause) {
      setNotice({ type: "error", text: cause instanceof Error ? cause.message : "Сетевая ошибка при авто-маппинге." });
    } finally {
      setSaving(null);
    }
  }

  async function handleAutoMapAll(confirmed = false) {
    void confirmed;
    setGlobalLoading(true);
    try {
      await previewAutoMap(teamNames);
    } finally {
      setGlobalLoading(false);
    }
  }

  async function applySafeAutoMapAll() {
    setGlobalLoading(true);
    setNotice(null);
    setAutoPreview(null);
    try {
      const res = await fetch("/api/team-mapping/auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ disciplineSlug, teamNames, apply: true }),
      });
      const data = await readJsonResponse(res, decodeAutoMappingResponse, "Ошибка автомаппинга");
      if (!res.ok || !data.success) {
        setNotice({ type: "error", text: data.error || "Не удалось применить авто-маппинг" });
        return;
      }

      const appliedCount = data.result?.appliedCount || 0;
      const adminTeamsCount = data.result?.preview?.adminTeamsCount || 0;
      if (adminTeamsCount === 0) {
        setNotice({ type: "error", text: "Для этой дисциплины справочник админ-команд не импортирован. Используйте ручной ввод ID." });
        return;
      }

      setSelectedAutoMappings(new Set());
      setNotice({ type: "success", text: `Авто-маппинг применён: ${appliedCount} ID.` });
      dispatchTeamMappingsUpdated({ disciplineSlug });
      router.refresh();
    } catch (cause) {
      setNotice({ type: "error", text: cause instanceof Error ? cause.message : "Сетевая ошибка при применении авто-маппинга." });
    } finally {
      setGlobalLoading(false);
    }
  }

  async function previewAutoMap(names: string[]) {
    setNotice(null);
    setAutoPreview(null);
    try {
      const res = await fetch("/api/team-mapping/auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ disciplineSlug, teamNames: names, dryRun: true })
      });
      const data = await readJsonResponse(res, decodeAutoMappingResponse, "Ошибка автомаппинга");
      if (!res.ok) {
        setNotice({ type: "error", text: data.error || "Ошибка авто-маппинга" });
        return;
      }
      const preview = data.preview;
      if (!preview) throw new Error("Сервер не вернул предпросмотр сопоставлений.");
      setAutoPreview(preview);
      setSelectedAutoMappings(new Set(preview.auto.map((item) => getPreviewSelectionKey(item))));
      setNotice({
        type: preview.adminTeamsCount > 0 ? "info" : "error",
        text:
          preview.adminTeamsCount > 0
            ? `Предпросмотр готов: безопасных ${preview.auto.length}, предложений ${preview.suggested.length}, спорных ${preview.ambiguous.length}, без ID ${preview.unmapped.length}.`
            : "Для этой дисциплины справочник админ-команд не импортирован. Используйте ручной ввод ID.",
      });
    } catch (cause) {
      setNotice({ type: "error", text: cause instanceof Error ? cause.message : "Сетевая ошибка при авто-маппинге." });
    }
  }

  async function applyAutoPreview() {
    if (!autoPreview) return;
    const selectable = [...autoPreview.auto, ...autoPreview.suggested];
    const selectedMappings = selectable
      .filter((item) => selectedAutoMappings.has(getPreviewSelectionKey(item)) && item.platformId)
      .map((item) => ({ liquipediaName: item.liquipediaName, platformId: item.platformId }));

    if (selectedMappings.length === 0) {
      setNotice({ type: "error", text: "Выберите хотя бы одно совпадение для применения." });
      return;
    }

    setGlobalLoading(true);
    setNotice(null);
    try {
      const res = await fetch("/api/team-mapping/auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ disciplineSlug, teamNames, apply: true, selectedMappings }),
      });
      const data = await readJsonResponse(res, decodeAutoMappingResponse, "Ошибка автомаппинга");
      if (!res.ok || !data.success) {
        setNotice({ type: "error", text: data.error || "Не удалось применить автомаппинг" });
        return;
      }

      setAutoPreview(null);
      setSelectedAutoMappings(new Set());
      setNotice({ type: "success", text: `Применено ID: ${data.result?.appliedCount || 0}.` });
      dispatchTeamMappingsUpdated({ disciplineSlug });
      router.refresh();
    } catch (cause) {
      setNotice({ type: "error", text: cause instanceof Error ? cause.message : "Сетевая ошибка при применении автомаппинга." });
    } finally {
      setGlobalLoading(false);
    }
  }

  async function replaceAutoConflicts() {
    if (!autoPreview || autoPreview.conflicts.length === 0) return;
    if (!confirm(`Заменить конфликтующие ручные ID? Будет заменено: ${autoPreview.conflicts.length}.`)) return;

    const selectedMappings = autoPreview.conflicts
      .filter((item) => item.platformId)
      .map((item) => ({ liquipediaName: item.liquipediaName, platformId: item.platformId }));

    setGlobalLoading(true);
    setNotice(null);
    try {
      const res = await fetch("/api/team-mapping/auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ disciplineSlug, teamNames, apply: true, replaceConflicts: true, selectedMappings }),
      });
      const data = await readJsonResponse(res, decodeAutoMappingResponse, "Ошибка автомаппинга");
      if (!res.ok || !data.success) {
        setNotice({ type: "error", text: data.error || "Не удалось заменить конфликты" });
        return;
      }

      setAutoPreview(null);
      setSelectedAutoMappings(new Set());
      setNotice({ type: "success", text: `Конфликтующие ID заменены: ${data.result?.appliedCount || 0}.` });
      dispatchTeamMappingsUpdated({ disciplineSlug });
      router.refresh();
    } catch (cause) {
      setNotice({ type: "error", text: cause instanceof Error ? cause.message : "Сетевая ошибка при замене конфликтов." });
    } finally {
      setGlobalLoading(false);
    }
  }

  function handleChange(name: string, field: "canonicalName" | "platformId", value: string) {
    setMappings((prev) => ({
      ...prev,
      [name]: {
        ...prev[name],
        [field]: value,
        ...(field === "platformId" ? { displayAdminName: undefined, adminTeamName: null, nameSource: undefined } : {}),
        ...(field === "canonicalName"
          ? {
              displayAdminName: undefined,
              adminTeamName: null,
              nameSource: undefined,
              ...(prev[name]?.nameSource === "admin" ? { platformId: "" } : {}),
            }
          : {}),
        saved: false,
      }
    }));
  }

  function handleAdminTeamSelect(name: string, suggestion: AdminTeamSuggestion) {
    setMappings((prev) => ({
      ...prev,
      [name]: {
        ...prev[name],
        canonicalName: suggestion.platformName,
        displayAdminName: suggestion.platformName,
        adminTeamName: suggestion.platformName,
        platformId: suggestion.platformId,
        nameSource: "admin",
        status: "manual_mapped",
        matchMethod: "manual_suggest",
        confidenceScore: suggestion.score * 100,
        saved: false,
      },
    }));
  }

  const sorted = [...teamNames].sort((a, b) => a.localeCompare(b));

  return { handleSave, handleDelete, handleAutoMapSingle, handleAutoMapAll, applySafeAutoMapAll, previewAutoMap, applyAutoPreview, replaceAutoConflicts, handleChange, handleAdminTeamSelect, mappings, saving, globalLoading, autoPreview, selectedAutoMappings, setSelectedAutoMappings, notice, sorted };
}
