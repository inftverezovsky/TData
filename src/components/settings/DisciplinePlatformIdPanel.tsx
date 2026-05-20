"use client";

import { useState, useEffect } from "react";

export default function DisciplinePlatformIdPanel({ disciplineSlug }: { disciplineSlug: string }) {
  const [platformId, setPlatformId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`/api/disciplines/${disciplineSlug}/platform-id`)
      .then(res => res.json())
      .then(data => {
        setPlatformId(data.platformId || "");
        setLoading(false);
      });
  }, [disciplineSlug]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await fetch(`/api/disciplines/${disciplineSlug}/platform-id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platformId: platformId.trim() })
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      console.error(error);
      alert("Ошибка при сохранении глобального ID");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!confirm("Удалить глобальный ID дисциплины?")) return;
    setSaving(true);
    try {
      await fetch(`/api/disciplines/${disciplineSlug}/platform-id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platformId: "" })
      });
      setPlatformId("");
    } catch (error) {
      console.error(error);
      alert("Ошибка при удалении глобального ID");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="h-10 w-full animate-pulse rounded-xl bg-slate-100" />;

  return (
    <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-base font-black text-indigo-950 uppercase tracking-tight">Глобальный ID дисциплины (Admin)</h2>
          <p className="text-sm font-bold text-indigo-700/80 mt-1">Матчи будут привязаны к этой родительской категории в вашей админке.</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={platformId}
            onChange={(e) => setPlatformId(e.target.value)}
            placeholder="Platform ID"
            className="w-[200px] rounded-xl border border-indigo-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-950 focus:border-indigo-600 focus:outline-none focus:ring-4 focus:ring-indigo-600/5 tabular-nums placeholder:text-slate-300 shadow-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-black text-white shadow-md shadow-indigo-600/20 transition-all hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? "..." : saved ? "Готово ✓" : "Сохранить"}
            </button>
            <button
              onClick={handleRemove}
              disabled={saving}
              className="rounded-xl bg-white border border-rose-200 px-4 py-2.5 text-xs font-black text-rose-600 transition-all hover:bg-rose-50 disabled:opacity-50"
            >
              Удалить
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
