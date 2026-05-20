"use client";

import { useState } from "react";

export default function TournamentPlatformIdPanel({
  tournamentId,
  initialPlatformId,
  disciplineSlug
}: {
  tournamentId: string;
  initialPlatformId: string | null;
  disciplineSlug: string;
}) {
  const [platformId, setPlatformId] = useState(initialPlatformId || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await fetch(`/api/${disciplineSlug}/tournament/${tournamentId}/platform-id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platformId: platformId.trim() })
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      console.error(error);
      alert("Ошибка при сохранении ID");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!confirm("Удалить ID шапки турнира?")) return;
    setSaving(true);
    try {
      await fetch(`/api/${disciplineSlug}/tournament/${tournamentId}/platform-id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platformId: "" })
      });
      setPlatformId("");
    } catch (error) {
      console.error(error);
      alert("Ошибка при удалении ID");
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    const selectedIds = (window as any).selectedMatchIds || [];
    if (selectedIds.length === 0) {
      alert("Сначала выбери матчи чекбоксами!");
      return;
    }
    if (!platformId.trim()) {
      alert("Сначала укажи ID шапки!");
      return;
    }

    setExporting(true);
    try {
      console.log(`Exporting matches ${selectedIds.join(", ")} to platform header ${platformId}`);
      await new Promise(resolve => setTimeout(resolve, 1500));
      alert(`Готово! ${selectedIds.length} матчей успешно подготовлены для заливки в шапку ${platformId}. (Это демо-заглушка)`);
    } catch (error) {
      console.error(error);
      alert("Ошибка при экспорте");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="mt-6 border-t border-slate-200 pt-6">
      <label htmlFor="tournament-platform-id" className="block text-xs font-black uppercase tracking-[0.2em] text-slate-900">
        ID шапки турнира
      </label>
      <div className="mt-3 flex flex-wrap gap-3">
        <input
          id="tournament-platform-id"
          type="text"
          value={platformId}
          onChange={(e) => setPlatformId(e.target.value)}
          placeholder="Например: 554332"
          className="w-[240px] rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-950 focus:border-indigo-600 focus:outline-none focus:ring-4 focus:ring-indigo-600/5 placeholder:text-slate-300"
        />
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-xl bg-slate-100 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-900 transition-all hover:bg-slate-200 disabled:opacity-50"
          >
            {saving ? "..." : saved ? "Готово ✓" : "Save ID"}
          </button>
          
          <button
            onClick={handleRemove}
            disabled={saving}
            className="rounded-xl bg-rose-50 border border-rose-100 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-rose-600 transition-all hover:bg-rose-100 disabled:opacity-50"
          >
            Удалить
          </button>
        </div>
        
        <button
          onClick={handleExport}
          disabled={exporting}
          className="btn-primary px-8 text-xs disabled:opacity-50"
        >
          {exporting ? "Заливка..." : "Залить в платформу"}
        </button>
      </div>
      <p className="mt-2 text-[10px] font-bold text-slate-500 uppercase tracking-tight">
        Выберите матчи выше и нажмите кнопку заливки.
      </p>
    </div>
  );
}
