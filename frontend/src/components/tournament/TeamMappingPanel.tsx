"use client";

import type { TeamMappingRecord } from "./teamMapping/types";
import { useTeamMapping } from "./teamMapping/useTeamMapping";
import { AdminTeamNameCombobox } from "./teamMapping/AdminTeamNameCombobox";
import { AutoMappingPreviewPanel } from "./teamMapping/AutoMappingPreviewPanel";
import { NameSourceIcon } from "./teamMapping/NameSourceIcon";
import { formatMappingStatus, isValidPlatformId } from "./teamMapping/model";

export default function TeamMappingPanel({
  teamNames,
  initialMappings,
  disciplineSlug
}: {
  teamNames: string[];
  initialMappings: TeamMappingRecord[];
  disciplineSlug: string;
}) {
  const { handleSave, handleDelete, handleAutoMapSingle, handleAutoMapAll, applySafeAutoMapAll, applyAutoPreview, replaceAutoConflicts, handleChange, handleAdminTeamSelect, mappings, saving, globalLoading, autoPreview, selectedAutoMappings, setSelectedAutoMappings, notice, sorted } = useTeamMapping(teamNames, initialMappings, disciplineSlug);

  return (
    <div className="flex flex-col gap-6">
      {notice && (
        <div
          role={notice.type === "error" ? "alert" : "status"}
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
          <p className="text-sm font-medium text-slate-500">Настройте соответствие названий TData вашим внутренним ID платформы.</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
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
                <th className="py-4 px-6">Команда TData</th>
                <th className="min-w-[288px] py-4 px-6">Название в админе</th>
                <th className="py-4 px-6">ID платформы</th>
                <th className="min-w-[120px] py-4 px-6">Статус</th>
                <th className="py-4 px-6 text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((name) => {
                const entry = mappings[name] ?? { platformId: "", canonicalName: "", saved: false };
                const isSaving = saving === name;
                const adminNameValue = entry.displayAdminName ?? entry.canonicalName ?? "";
                const isPersistedMapping = Boolean(entry.saved && entry.platformId);
                const canSave = !isPersistedMapping && isValidPlatformId(entry.platformId);
                
                return (
                  <tr key={name} className="group hover:bg-slate-50/50 transition-colors">
                    <td className="py-4 px-6">
                      <span className="font-bold text-slate-900 group-hover:text-slate-600 transition-colors">{name}</span>
                    </td>
                    <td className="min-w-[288px] py-4 px-6">
                      <div className="flex items-center gap-2">
                        <AdminTeamNameCombobox
                          label={`Название в админе для ${name}`}
                          value={adminNameValue}
                          disciplineSlug={disciplineSlug}
                          disabled={isPersistedMapping}
                          onChange={(value) => handleChange(name, "canonicalName", value)}
                          onSelect={(suggestion) => handleAdminTeamSelect(name, suggestion)}
                        />
                        <NameSourceIcon entry={entry} />
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <input
                        type="text"
                        aria-label={`ID платформы для ${name}`}
                        value={entry.platformId || ""}
                        disabled={isPersistedMapping}
                        onChange={(e) => handleChange(name, "platformId", e.target.value)}
                        placeholder="—"
                        className={`h-9 w-full rounded-lg border px-3 text-sm font-bold transition-all outline-none tabular-nums ${
                          isPersistedMapping
                            ? "bg-slate-50 border-slate-100 text-slate-400 cursor-not-allowed" 
                            : "bg-white border-slate-200 text-slate-600 focus:border-slate-400 focus:ring-slate-400/5"
                        }`}
                      />
                    </td>
                    <td className="min-w-[120px] py-4 px-6">
                      <div className="flex min-w-[96px] flex-col items-start gap-1">
                        <span className={`inline-flex w-max whitespace-nowrap items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-tighter
                          ${entry.status === 'auto_mapped' ? 'bg-slate-50 border border-slate-200 text-slate-600' :
                            entry.status === 'manual_mapped' ? 'bg-emerald-50 text-emerald-600' :
                            entry.status === 'manual_unmapped' ? 'bg-rose-50 text-rose-600' :
                            entry.status === 'ambiguous' ? 'bg-amber-50 text-amber-600' :
                            'bg-slate-100 text-slate-400'}`}
                        >
                          {formatMappingStatus(entry.status)}
                        </span>
                        {entry.confidenceScore != null && (
                          <span className="whitespace-nowrap text-[10px] font-bold leading-none text-slate-400">
                            {entry.confidenceScore.toFixed(1)}%
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleSave(name)}
                          disabled={isSaving || !canSave}
                          className={`min-w-[100px] px-3 py-1.5 rounded-full text-[10px] font-medium uppercase tracking-widest transition-all ${
                            isPersistedMapping
                              ? "text-emerald-600 bg-emerald-50 border border-emerald-100 cursor-default"
                              : !canSave
                                ? "bg-slate-50 text-slate-300 border border-slate-100 cursor-not-allowed rounded-lg"
                              : "bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100 rounded-lg"
                          }`}
                        >
                          {isSaving ? "..." : isPersistedMapping ? "Сохранено" : "Сохранить"}
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
