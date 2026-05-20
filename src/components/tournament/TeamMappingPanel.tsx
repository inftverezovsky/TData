"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { dispatchTeamMappingsUpdated } from "@/lib/utils/clientEvents";
import { getTeamMappingLookupKeys } from "@/lib/teams/canonicalize";

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
};

type MappingNotice = {
  type: "error" | "info" | "success";
  text: string;
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
          canonicalName: entry.canonicalName,
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
    setNotice(null);
    try {
      const res = await fetch("/api/team-mapping/auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ disciplineSlug, liquipediaName: name })
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice({ type: "error", text: data.error || "Ошибка авто-маппинга" });
        return;
      }
      if (data.mapping) {
        setMappings((prev) => ({
          ...prev,
          [name]: { ...data.mapping, saved: true }
        }));
        setNotice({ type: "success", text: `Авто-маппинг для ${name} выполнен.` });
        dispatchTeamMappingsUpdated({ disciplineSlug });
        router.refresh();
      } else {
        setNotice({ type: "info", text: `Авто-маппинг не нашёл ID для ${name}.` });
      }
    } catch {
      setNotice({ type: "error", text: "Сетевая ошибка при авто-маппинге." });
    } finally {
      setSaving(null);
    }
  }

  async function handleAutoMapAll(confirmed = false) {
    if (!confirmed && !confirm(`Запустить авто-маппинг для всех неразмеченных команд ${disciplineSlug}?`)) return;
    setGlobalLoading(true);
    setNotice(null);
    try {
      const res = await fetch("/api/team-mapping/auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ disciplineSlug })
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice({ type: "error", text: data.error || "Ошибка авто-маппинга" });
        return;
      }
      setNotice({ type: "success", text: "Авто-маппинг всех команд выполнен." });
      dispatchTeamMappingsUpdated({ disciplineSlug });
      router.refresh();
    } catch {
      setNotice({ type: "error", text: "Сетевая ошибка при авто-маппинге." });
    } finally {
      setGlobalLoading(false);
    }
  }

  function handleChange(name: string, field: "canonicalName" | "platformId", value: string) {
    setMappings((prev) => ({
      ...prev,
      [name]: { ...prev[name], [field]: value, saved: false }
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
          <p className="text-sm font-medium text-slate-500">Настройте соответствие имен TCyber вашим внутренним Platform ID.</p>
        </div>
        <button
          onClick={() => handleAutoMapAll()}
          disabled={globalLoading}
          className="rounded-xl px-6 py-2.5 bg-slate-500/5 backdrop-blur-sm text-slate-600 font-medium text-xs uppercase tracking-widest border border-slate-200/50 hover:bg-slate-500/10 transition-all disabled:opacity-50"
        >
          {globalLoading ? 'Обработка...' : 'Авто-маппинг всех'}
        </button>
      </div>
      
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">
              <tr>
                <th className="py-4 px-6">TCyber Team</th>
                <th className="py-4 px-6">Name Team (Admin)</th>
                <th className="py-4 px-6">Platform ID</th>
                <th className="py-4 px-6">Status / Method</th>
                <th className="py-4 px-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((name) => {
                const entry = mappings[name] ?? { platformId: "", canonicalName: "", saved: false };
                const isSaving = saving === name;
                
                return (
                  <tr key={name} className="group hover:bg-slate-50/50 transition-colors">
                    <td className="py-4 px-6">
                      <span className="font-bold text-slate-900 group-hover:text-slate-600 transition-colors">{name}</span>
                    </td>
                    <td className="py-4 px-6">
                      <input
                        type="text"
                        value={entry.canonicalName || ""}
                        disabled={entry.saved}
                        onChange={(e) => handleChange(name, "canonicalName", e.target.value)}
                        placeholder="—"
                        className={`w-full rounded-lg border px-3 py-1.5 text-sm font-medium transition-all outline-none ${
                          entry.saved 
                            ? "bg-slate-50 border-slate-100 text-slate-400 cursor-not-allowed" 
                            : "bg-white border-slate-200 text-slate-900 focus:border-slate-400 focus:ring-slate-400/5"
                        }`}
                      />
                    </td>
                    <td className="py-4 px-6">
                      <input
                        type="text"
                        value={entry.platformId || ""}
                        disabled={entry.saved}
                        onChange={(e) => handleChange(name, "platformId", e.target.value)}
                        placeholder="—"
                        className={`w-full rounded-lg border px-3 py-1.5 text-sm font-bold transition-all outline-none tabular-nums ${
                          entry.saved 
                            ? "bg-slate-50 border-slate-100 text-slate-400 cursor-not-allowed" 
                            : "bg-white border-slate-200 text-slate-600 focus:border-slate-400 focus:ring-slate-400/5"
                        }`}
                      />
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex flex-col gap-1">
                        <span className={`inline-flex w-max items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-tighter
                          ${entry.status === 'auto_mapped' ? 'bg-slate-500/5 backdrop-blur-sm border border-slate-200/50 text-slate-600' : 
                            entry.status === 'manual_mapped' ? 'bg-emerald-50 text-emerald-600' :
                            entry.status === 'manual_unmapped' ? 'bg-rose-50 text-rose-600' :
                            entry.status === 'ambiguous' ? 'bg-amber-50 text-amber-600' :
                            'bg-slate-100 text-slate-400'}`}
                        >
                          {entry.status || 'unmapped'}
                        </span>
                        {entry.confidenceScore != null && (
                          <span className="text-[9px] font-bold text-slate-400">
                            {entry.confidenceScore.toFixed(1)}% via {entry.matchMethod}
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
                              : "bg-slate-500/5 backdrop-blur-sm text-slate-600 border border-slate-200/50 hover:bg-slate-500/10 rounded-lg"
                          }`}
                        >
                          {isSaving ? "..." : entry.saved ? "Saved" : "Save"}
                        </button>
                        <button
                          onClick={() => handleAutoMapSingle(name)}
                          disabled={isSaving}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-500/5 backdrop-blur-sm border border-slate-200/50 transition-all"
                          title="Auto-map"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                        </button>
                        <button
                          onClick={() => handleDelete(name)}
                          disabled={isSaving}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-all"
                          title="Delete"
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
  const mappingLookup = new Map<string, TeamMappingRecord>();

  for (const mapping of initialMappings) {
    mappingLookup.set(mapping.liquipediaName.toLowerCase(), mapping);
  }

  for (const mapping of initialMappings) {
    for (const key of getTeamMappingLookupKeys(mapping)) {
      if (key && !mappingLookup.has(key.toLowerCase())) {
        mappingLookup.set(key.toLowerCase(), mapping);
      }
    }
  }

  for (const name of teamNames) {
    const existing = mappingLookup.get(name.toLowerCase());
    map[name] = {
      ...existing,
      saved: !!existing?.platformId || existing?.status === 'manual_unmapped'
    };
  }
  return map;
}
