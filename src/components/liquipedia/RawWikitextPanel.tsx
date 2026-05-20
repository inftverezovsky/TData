"use client";

import { useState } from "react";

type Props = {
  disciplineSlug: string;
  tournamentId: string;
};

export default function RawWikitextPanel({ disciplineSlug, tournamentId }: Props) {
  const [rawWikitext, setRawWikitext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadRawWikitext() {
    if (rawWikitext || loading) return;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/${disciplineSlug}/tournament/${tournamentId}/raw`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось загрузить Raw Wikitext");
      setRawWikitext(data.rawWikitext || "Нет данных");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить Raw Wikitext");
    } finally {
      setLoading(false);
    }
  }

  return (
    <details
      className="rounded-2xl bg-white/5 border border-white/10 p-4"
      onToggle={(event) => {
        if (event.currentTarget.open) void loadRawWikitext();
      }}
    >
      <summary className="cursor-pointer text-sm font-bold text-slate-400 hover:text-white transition">
        Показать Raw Wikitext
      </summary>
      {loading ? (
        <div className="mt-6 text-xs font-bold uppercase tracking-widest text-slate-500">Загрузка...</div>
      ) : error ? (
        <div className="mt-6 rounded-lg border border-rose-500/20 bg-rose-500/10 p-4 text-xs font-bold text-rose-200">
          {error}
        </div>
      ) : (
        <pre className="mt-6 max-h-[500px] overflow-auto text-[10px] leading-relaxed text-slate-400 font-mono scrollbar-hide">
          {rawWikitext ?? "Откройте блок, чтобы загрузить данные"}
        </pre>
      )}
    </details>
  );
}
