"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { dispatchTeamMappingsUpdated } from "@/lib/utils/clientEvents";
import { buildTeamMappingLookup, findTeamMapping } from "@/lib/teams/mappingLookup";

type TeamMappingRecord = {
  id: string;
  liquipediaName: string;
  alias: string | null;
  canonicalName: string | null;
  platformId: string | null;
  logoUrl?: string | null;
  confidenceScore: number | null;
  status: string;
  matchMethod: string | null;
  isManual: boolean;
  isLockedFromAutoMapping: boolean;
  displayAdminName?: string;
  adminTeamName?: string | null;
  nameSource?: "admin" | "manual" | "missing";
};

type MappingNotice = {
  type: "error" | "info" | "success";
  text: string;
};

type AutoMappingPreviewItem = {
  liquipediaName: string;
  platformId?: string | null;
  adminName?: string | null;
  score?: number | null;
  secondAdminName?: string | null;
  secondScore?: number | null;
  existingPlatformId?: string | null;
  reason?: string | null;
};

type AutoMappingPreview = {
  adminTeamsCount: number;
  liquipediaTeamsFound: number;
  alreadyMappedCount: number;
  auto: AutoMappingPreviewItem[];
  suggested: AutoMappingPreviewItem[];
  ambiguous: AutoMappingPreviewItem[];
  unmapped: AutoMappingPreviewItem[];
  invalid: AutoMappingPreviewItem[];
  conflicts: AutoMappingPreviewItem[];
};

export default function TeamMappingPanel({
  teamNames,
  initialMappings,
  disciplineSlug
}: {
  teamNames: string[];
  initialMappings: TeamMappingRecord[];
  disciplineSlug: string;
}) {
  const router = useRouter();
  const [mappings, setMappings] = useState<Record<string, Partial<TeamMappingRecord> & { saved: boolean }>>(
    () => buildMappingState(teamNames, initialMappings)
  );

  const [saving, setSaving] = useState<string | null>(null);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [autoPreview, setAutoPreview] = useState<AutoMappingPreview | null>(null);
  const [selectedAutoMappings, setSelectedAutoMappings] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<MappingNotice | null>(null);

  useEffect(() => {
    setMappings(buildMappingState(teamNames, initialMappings));
  }, [teamNames, initialMappings]);

  async function handleSave(name: string) {
    setSaving(name);
    setNotice(null);
    try {
      const entry = mappings[name];
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
      const data = await res.json();
      if (!res.ok) {
        setNotice({ type: "error", text: data.error || "Ошибка сохранения маппинга" });
        return;
      }
      setMappings((prev) => ({
        ...prev,
        [name]: { ...data.mapping, saved: true }
      }));
      setAutoPreview(null);
      setNotice({ type: "success", text: `ID для ${name} сохранён.` });
      dispatchTeamMappingsUpdated({ disciplineSlug });
      router.refresh();
    } catch {
      setNotice({ type: "error", text: "Сетевая ошибка при сохранении маппинга." });
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
      const data = await res.json();
      if (!res.ok) {
        setNotice({ type: "error", text: data.error || "Ошибка удаления маппинга" });
        return;
      }
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
    } catch {
      setNotice({ type: "error", text: "Сетевая ошибка при удалении маппинга." });
    } finally {
      setSaving(null);
    }
  }

  async function handleAutoMapSingle(name: string) {
    setSaving(name);
    try {
      await previewAutoMap([name]);
    } catch {
      setNotice({ type: "error", text: "Сетевая ошибка при авто-маппинге." });
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
      const data = await res.json();
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
    } catch {
      setNotice({ type: "error", text: "Сетевая ошибка при применении авто-маппинга." });
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
      const data = await res.json();
      if (!res.ok) {
        setNotice({ type: "error", text: data.error || "Ошибка авто-маппинга" });
        return;
      }
      const preview = data.preview as AutoMappingPreview;
      setAutoPreview(preview);
      setSelectedAutoMappings(new Set(preview.auto.map((item) => getPreviewSelectionKey(item))));
      setNotice({
        type: preview.adminTeamsCount > 0 ? "info" : "error",
        text:
          preview.adminTeamsCount > 0
            ? `Предпросмотр готов: безопасных ${preview.auto.length}, предложений ${preview.suggested.length}, спорных ${preview.ambiguous.length}, без ID ${preview.unmapped.length}.`
            : "Для этой дисциплины справочник админ-команд не импортирован. Используйте ручной ввод ID.",
      });
    } catch {
      setNotice({ type: "error", text: "Сетевая ошибка при авто-маппинге." });
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
      const data = await res.json();
      if (!res.ok || !data.success) {
        setNotice({ type: "error", text: data.error || "Не удалось применить автомаппинг" });
        return;
      }

      setAutoPreview(null);
      setSelectedAutoMappings(new Set());
      setNotice({ type: "success", text: `Применено ID: ${data.result?.appliedCount || 0}.` });
      dispatchTeamMappingsUpdated({ disciplineSlug });
      router.refresh();
    } catch {
      setNotice({ type: "error", text: "Сетевая ошибка при применении автомаппинга." });
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
      const data = await res.json();
      if (!res.ok || !data.success) {
        setNotice({ type: "error", text: data.error || "Не удалось заменить конфликты" });
        return;
      }

      setAutoPreview(null);
      setSelectedAutoMappings(new Set());
      setNotice({ type: "success", text: `Конфликтующие ID заменены: ${data.result?.appliedCount || 0}.` });
      dispatchTeamMappingsUpdated({ disciplineSlug });
      router.refresh();
    } catch {
      setNotice({ type: "error", text: "Сетевая ошибка при замене конфликтов." });
    } finally {
      setGlobalLoading(false);
    }
  }

  async function saveBulkManualIds() {
    const parsed = parseBulkManualMappings(bulkText);
    if (parsed.length === 0) {
      setNotice({ type: "error", text: "Не найдено строк формата: Название команды 123456." });
      return;
    }

    setBulkSaving(true);
    setNotice(null);
    try {
      const res = await fetch("/api/team-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ disciplineSlug, mappings: parsed }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        setNotice({ type: "error", text: data.error || "Не удалось сохранить ID из массового ввода." });
        return;
      }

      setMappings((prev) => {
        const next = { ...prev };
        for (const mapping of data.mappings || []) {
          next[mapping.liquipediaName] = { ...mapping, saved: true };
        }
        return next;
      });
      setBulkText("");
      setBulkOpen(false);
      setAutoPreview(null);
      setNotice({ type: "success", text: `ID сохранены: ${data.savedCount || 0}.` });
      dispatchTeamMappingsUpdated({ disciplineSlug });
      router.refresh();
    } catch {
      setNotice({ type: "error", text: "Сетевая ошибка при массовом сохранении ID." });
    } finally {
      setBulkSaving(false);
    }
  }

  function handleChange(name: string, field: "canonicalName" | "platformId", value: string) {
    setMappings((prev) => ({
      ...prev,
      [name]: {
        ...prev[name],
        [field]: value,
        ...(field === "platformId" ? { displayAdminName: "", adminTeamName: null, nameSource: undefined } : {}),
        ...(field === "canonicalName" ? { displayAdminName: undefined, nameSource: undefined } : {}),
        saved: false,
      }
    }));
  }

  const sorted = [...teamNames].sort((a, b) => a.localeCompare(b));

  return (
    <div className="flex flex-col gap-6">
      {notice && (
        <div
          className={`rounded-2xl border p-4 ${
            notice?.type === "success"
              ? "border-emerald-100 bg-emerald-50 text-emerald-700"
              : notice?.type === "info"
                ? "border-sky-100 bg-sky-50 text-sky-700"
                : "border-rose-100 bg-rose-50 text-rose-700"
          }`}
        >
          <p className="text-sm font-bold">{notice.text}</p>
        </div>
      )}

      <div className="flex items-center justify-between rounded-2xl bg-slate-50 border border-slate-200 p-6">
        <div>
          <h3 className="text-lg font-bold text-slate-900">Синхронизация команд</h3>
          <p className="text-sm font-medium text-slate-500">Настройте соответствие названий TCyber вашим внутренним ID платформы.</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            onClick={() => setBulkOpen((open) => !open)}
            disabled={bulkSaving}
            className="rounded-xl px-4 py-2.5 bg-white text-slate-600 font-medium text-xs uppercase tracking-widest border border-slate-200 hover:bg-slate-50 transition-all disabled:opacity-50"
          >
            Массовый ввод ID
          </button>
          <button
            onClick={applySafeAutoMapAll}
            disabled={globalLoading}
            className="rounded-xl px-5 py-2.5 bg-indigo-600 text-white font-bold text-xs uppercase tracking-widest border border-indigo-600 hover:bg-indigo-700 transition-all disabled:bg-slate-200 disabled:border-slate-200 disabled:text-slate-400"
          >
            {globalLoading ? "Обработка..." : "Авто-маппинг"}
          </button>
          <button
            onClick={() => handleAutoMapAll()}
            disabled={globalLoading}
            className="rounded-xl px-6 py-2.5 bg-slate-50 text-slate-600 font-medium text-xs uppercase tracking-widest border border-slate-200 hover:bg-slate-100 transition-all disabled:opacity-50"
          >
            {globalLoading ? 'Обработка...' : 'Предпросмотр авто-маппинга'}
          </button>
        </div>
      </div>

      {bulkOpen && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3">
            <h4 className="text-sm font-black text-slate-900">Массовое добавление ID</h4>
            <p className="mt-1 text-xs font-medium text-slate-500">Форматы: Название команды 123456, Название команды;123456 или Название команды + tab + 123456.</p>
          </div>
          <textarea
            value={bulkText}
            onChange={(event) => setBulkText(event.target.value)}
            className="h-36 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-800 outline-none focus:border-slate-400"
            placeholder={"Team Liquid 211608\nG2 Esports;123456"}
          />
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => setBulkOpen(false)}
              className="rounded-xl border border-slate-200 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-500"
            >
              Закрыть
            </button>
            <button
              onClick={saveBulkManualIds}
              disabled={bulkSaving || !bulkText.trim()}
              className="rounded-xl bg-slate-900 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white disabled:bg-slate-100 disabled:text-slate-400"
            >
              {bulkSaving ? "Сохранение..." : "Сохранить ID"}
            </button>
          </div>
        </div>
      )}

      {autoPreview && (
        <AutoMappingPreviewPanel
          preview={autoPreview}
          selected={selectedAutoMappings}
          onToggle={(key) => {
            setSelectedAutoMappings((current) => {
              const next = new Set(current);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            });
          }}
          onApply={applyAutoPreview}
          onReplaceConflicts={replaceAutoConflicts}
          applying={globalLoading}
        />
      )}
      
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">
              <tr>
                <th className="py-4 px-6">Команда TCyber</th>
                <th className="py-4 px-6">Название в админе</th>
                <th className="py-4 px-6">ID платформы</th>
                <th className="py-4 px-6">Статус / способ</th>
                <th className="py-4 px-6 text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((name) => {
                const entry = mappings[name] ?? { platformId: "", canonicalName: "", saved: false };
                const isSaving = saving === name;
                const adminNameValue = entry.displayAdminName ?? entry.canonicalName ?? "";
                
                return (
                  <tr key={name} className="group hover:bg-slate-50/50 transition-colors">
                    <td className="py-4 px-6">
                      <span className="font-bold text-slate-900 group-hover:text-slate-600 transition-colors">{name}</span>
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={adminNameValue}
                          disabled={entry.saved}
                          onChange={(e) => handleChange(name, "canonicalName", e.target.value)}
                          placeholder="—"
                          className={`h-9 min-w-0 flex-1 rounded-lg border px-3 text-sm font-medium transition-all outline-none ${
                            entry.saved
                              ? "bg-slate-50 border-slate-100 text-slate-400 cursor-not-allowed"
                              : "bg-white border-slate-200 text-slate-900 focus:border-slate-400 focus:ring-slate-400/5"
                            }`}
                        />
                        <NameSourceIcon entry={entry} />
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <input
                        type="text"
                        value={entry.platformId || ""}
                        disabled={entry.saved}
                        onChange={(e) => handleChange(name, "platformId", e.target.value)}
                        placeholder="—"
                        className={`h-9 w-full rounded-lg border px-3 text-sm font-bold transition-all outline-none tabular-nums ${
                          entry.saved 
                            ? "bg-slate-50 border-slate-100 text-slate-400 cursor-not-allowed" 
                            : "bg-white border-slate-200 text-slate-600 focus:border-slate-400 focus:ring-slate-400/5"
                        }`}
                      />
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex flex-col gap-1">
                        <span className={`inline-flex w-max items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-tighter
                          ${entry.status === 'auto_mapped' ? 'bg-slate-50 border border-slate-200 text-slate-600' :
                            entry.status === 'manual_mapped' ? 'bg-emerald-50 text-emerald-600' :
                            entry.status === 'manual_unmapped' ? 'bg-rose-50 text-rose-600' :
                            entry.status === 'ambiguous' ? 'bg-amber-50 text-amber-600' :
                            'bg-slate-100 text-slate-400'}`}
                        >
                          {formatMappingStatus(entry.status)}
                        </span>
                        {entry.confidenceScore != null && (
                          <span className="text-[9px] font-bold text-slate-400">
                            {entry.confidenceScore.toFixed(1)}% · {formatMatchMethod(entry.matchMethod)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleSave(name)}
                          disabled={isSaving || entry.saved}
                          className={`min-w-[100px] px-3 py-1.5 rounded-full text-[10px] font-medium uppercase tracking-widest transition-all ${
                            entry.saved
                              ? "text-emerald-600 bg-emerald-50 border border-emerald-100 cursor-default"
                              : "bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100 rounded-lg"
                          }`}
                        >
                          {isSaving ? "..." : entry.saved ? "Сохранено" : "Сохранить"}
                        </button>
                        <button
                          onClick={() => handleAutoMapSingle(name)}
                          disabled={isSaving}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 border border-slate-200 transition-all"
                          title="Подобрать ID автоматически"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                        </button>
                        <button
                          onClick={() => handleDelete(name)}
                          disabled={isSaving}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-all"
                          title="Очистить маппинг"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function buildMappingState(teamNames: string[], initialMappings: TeamMappingRecord[]) {
  const map: Record<string, Partial<TeamMappingRecord> & { saved: boolean }> = {};
  const mappingLookup = buildTeamMappingLookup(initialMappings);

  for (const name of teamNames) {
    const existing = findTeamMapping(mappingLookup, name);
    map[name] = {
      ...existing,
      saved: !!existing?.platformId || existing?.status === 'manual_unmapped'
    };
  }
  return map;
}

function AutoMappingPreviewPanel({
  preview,
  selected,
  onToggle,
  onApply,
  onReplaceConflicts,
  applying,
}: {
  preview: AutoMappingPreview;
  selected: Set<string>;
  onToggle: (key: string) => void;
  onApply: () => void;
  onReplaceConflicts: () => void;
  applying: boolean;
}) {
  const selectable = [...preview.auto, ...preview.suggested].filter((item) => item.platformId);

  return (
    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h4 className="text-sm font-black text-slate-900">Предпросмотр авто-маппинга</h4>
          <p className="mt-1 text-xs font-bold text-slate-500">
            Безопасные {preview.auto.length} · Предложения {preview.suggested.length} · Спорные {preview.ambiguous.length} · Без ID {preview.unmapped.length} · Пропущено {preview.invalid.length}
          </p>
        </div>
        <button
          onClick={onApply}
          disabled={applying || selected.size === 0}
          className="rounded-xl bg-indigo-600 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:bg-slate-200 disabled:text-slate-400"
        >
          {applying ? "Применение..." : `Применить выбранные (${selected.size})`}
        </button>
        {preview.conflicts.length > 0 && (
          <button
            onClick={onReplaceConflicts}
            disabled={applying}
            className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-amber-700 disabled:bg-slate-100 disabled:text-slate-400"
          >
            Заменить конфликты ({preview.conflicts.length})
          </button>
        )}
      </div>

      {selectable.length > 0 && (
        <div className="mt-4 grid gap-2">
          {selectable.map((item) => {
            const key = getPreviewSelectionKey(item);
            return (
              <label key={key} className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-white bg-white/80 px-3 py-2 text-xs">
                <span className="min-w-0 font-bold text-slate-800">
                  {item.liquipediaName} → <span className="text-indigo-700">{item.adminName}</span>
                  <span className="ml-2 text-[10px] font-black text-slate-400">ID {item.platformId} · {formatScore(item.score)}%</span>
                </span>
                <input
                  type="checkbox"
                  checked={selected.has(key)}
                  onChange={() => onToggle(key)}
                  className="h-4 w-4"
                />
              </label>
            );
          })}
        </div>
      )}

      {(preview.ambiguous.length > 0 || preview.conflicts.length > 0 || preview.unmapped.length > 0 || preview.invalid.length > 0) && (
        <div className="mt-4 grid gap-3 text-[11px] font-bold text-slate-600 md:grid-cols-2">
          <PreviewList title="Спорные" items={preview.ambiguous} />
          <PreviewList title="Конфликты" items={preview.conflicts} />
          <PreviewList title="Без ID" items={preview.unmapped} />
          <PreviewList title="Пропущено" items={preview.invalid} />
        </div>
      )}
    </div>
  );
}

function PreviewList({ title, items }: { title: string; items: AutoMappingPreviewItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border border-white bg-white/70 p-3">
      <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">{title}: {items.length}</div>
      <div className="space-y-1">
        {items.slice(0, 8).map((item) => (
          <div key={`${title}-${item.liquipediaName}-${item.platformId || item.reason}`}>
            {item.liquipediaName}
            {item.adminName ? ` → ${item.adminName} (${formatScore(item.score)}%)` : ""}
            {item.reason ? ` · ${formatPreviewReason(item.reason)}` : ""}
          </div>
        ))}
        {items.length > 8 && <div>И ещё: {items.length - 8}</div>}
      </div>
    </div>
  );
}

function NameSourceIcon({ entry }: { entry: Partial<TeamMappingRecord> & { saved?: boolean } }) {
  if (!entry.platformId) return null;
  if (entry.nameSource !== "admin" && entry.nameSource !== "manual") return null;

  const label = entry.nameSource === "admin" ? "Имя из админа" : "Ручной ввод";
  const className =
    entry.nameSource === "admin"
      ? "border-emerald-200 bg-emerald-50 text-emerald-600"
      : "border-amber-300 bg-amber-50 text-amber-700";

  return (
    <span
      title={label}
      aria-label={label}
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${className}`}
    >
      <span className="h-2 w-2 rounded-full bg-current" />
    </span>
  );
}

function parseBulkManualMappings(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separated = line.match(/^(.+?)[\t;]\s*([1-9]\d*)$/);
      const spaced = line.match(/^(.+?)\s+([1-9]\d*)$/);
      const match = separated || spaced;
      if (!match) return null;
      return {
        liquipediaName: match[1].trim(),
        canonicalName: match[1].trim(),
        platformId: match[2].trim(),
      };
    })
    .filter((item): item is { liquipediaName: string; canonicalName: string; platformId: string } => Boolean(item?.liquipediaName && item.platformId));
}

function getPreviewSelectionKey(item: AutoMappingPreviewItem) {
  return `${item.liquipediaName.trim().toLowerCase()}\u0000${String(item.platformId || "").trim()}`;
}

function formatScore(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value).toFixed(1) : "0.0";
}

function formatMappingStatus(status: string | null | undefined) {
  switch (status) {
    case "auto_mapped":
      return "Авто";
    case "manual_mapped":
      return "Ручной";
    case "manual_unmapped":
      return "Очищено";
    case "ambiguous":
      return "Спорно";
    case "unmapped":
    case undefined:
    case null:
    case "":
      return "Без ID";
    default:
      return status.replace(/_/g, " ");
  }
}

function formatMatchMethod(method: string | null | undefined) {
  switch (method) {
    case "exact":
      return "точное совпадение";
    case "normalized_exact":
      return "точное совпадение после нормализации";
    case "token_fuzzy":
      return "похожее название";
    case "levenshtein":
      return "похожее написание";
    case "manual":
    case "manual_save":
      return "ручной ввод";
    case "manual_bulk":
      return "массовый ручной ввод";
    case "manual_conflict_replace":
      return "замена конфликта вручную";
    case "auto_apply":
      return "авто-применение";
    default:
      return method ? method.replace(/_/g, " ") : "не указан";
  }
}

function formatPreviewReason(reason: string | null | undefined) {
  switch (reason) {
    case "score_below_threshold":
      return "сходство ниже порога";
    case "parser_artifact":
      return "мусор парсинга";
    case "locked_manual_conflict":
      return "конфликт с ручным ID";
    case "no_admin_teams":
      return "справочник админ-команд не импортирован";
    case "no_candidates":
      return "нет кандидатов";
    case "already_mapped":
      return "уже привязано";
    default:
      return reason ? reason.replace(/_/g, " ") : "";
  }
}
