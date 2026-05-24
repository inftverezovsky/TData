"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Loader2, Trash2 } from "lucide-react";

type VlrEvent = {
  id: string;
  title: string;
  url: string;
  dates?: string | null;
  status?: string;
};

type VlrSearchResponse = {
  ok?: boolean;
  results?: VlrEvent[];
  error?: string;
  userMessage?: string | null;
};

export default function SearchVlr({ disciplineSlug }: { disciplineSlug: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VlrEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);
  const router = useRouter();

  async function runSearch(force = false) {
    setLoading(true);
    setError(null);
    setResults([]);

    try {
      const response = await fetch(`/api/${disciplineSlug}/search-vlr?query=${encodeURIComponent(query)}${force ? "&force=true" : ""}`);
      const data = await response.json().catch(() => ({})) as VlrSearchResponse;
      if (!response.ok) {
        setError(data.userMessage || data.error || "Не удалось найти турниры VLR");
        return;
      }
      setResults(data.results ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось найти турниры VLR");
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runSearch(false);
  }

  async function handleImport(vlrEvent: VlrEvent) {
    setImportingId(vlrEvent.id);
    setError(null);
    try {
      const response = await fetch(`/api/${disciplineSlug}/import-tournament`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: vlrEvent.title,
          pageUrl: vlrEvent.url,
          source: "vlr",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Import failed");
      if (data.tournament?.id) router.push(`/${disciplineSlug}/tournament/${data.tournament.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить турнир VLR");
    } finally {
      setImportingId(null);
    }
  }

  return (
    <section className="premium-card min-h-[188px] border-slate-200 bg-white shadow-sm">
      <form onSubmit={onSubmit} className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-950" htmlFor="vlr-query">
            Поиск VLR
          </label>
          <span className="rounded-full border border-rose-100 bg-rose-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-rose-600">
            VLR
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_112px]">
          <input
            id="vlr-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Название турнира"
            className="min-h-[50px] rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-none transition placeholder:text-slate-300 focus:border-rose-600 focus:ring-4 focus:ring-rose-600/5"
          />
          <button
            type="submit"
            disabled={loading || query.trim().length < 2}
            className="min-h-[50px] rounded-lg bg-slate-950 px-5 text-xs font-black uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-rose-600 disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none"
          >
            {loading ? "Поиск..." : "Найти"}
          </button>
        </div>
      </form>

      {error && (
        <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-bold text-rose-700">
          {error}
        </div>
      )}

      <div className="mt-8 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {results.length > 0 && (
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Results: {results.length}
              </span>
            )}
            <button
              type="button"
              onClick={() => runSearch(true)}
              disabled={loading || query.trim().length < 2}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-rose-100 bg-rose-50 px-3 text-[10px] font-black uppercase tracking-widest text-rose-600 transition-colors hover:bg-rose-100 disabled:opacity-40"
              title="Обновить принудительно, минуя кеш"
            >
              <Loader2 className={`h-3 w-3 ${loading ? "animate-spin" : "hidden"}`} />
              Обновить
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!confirm("Очистить кэш поиска VLR? Это не затронет привязки команд.")) return;
                const res = await fetch("/api/settings/clear-search-cache", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ source: "vlr", disciplineSlug }),
                });
                const data = await res.json();
                if (data.ok) {
                  setResults([]);
                  alert(`Кэш очищен (${data.deletedCount} файлов)`);
                }
              }}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 text-[10px] font-black uppercase tracking-widest text-slate-500 transition-colors hover:border-red-100 hover:bg-red-50 hover:text-red-600"
              title="Очистить временный кэш поиска"
            >
              <Trash2 className="h-3 w-3" />
              Очистить кеш поиска
            </button>
          </div>
          {results.length > 0 && (
            <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-900">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-600 shadow-[0_0_8px_rgba(225,29,72,0.5)]" />
              VLR DATABASE
            </span>
          )}
        </div>

        {results.map((result) => (
          <article key={result.id} className="group rounded-lg border border-slate-100/50 bg-slate-50/20 p-5 transition-colors hover:border-rose-200/60 hover:bg-rose-500/[0.04]">
            <div className="flex flex-col gap-4">
              <div className="min-w-0 flex-1 space-y-3">
                <h3 className="break-words text-lg font-bold leading-tight text-slate-900 sm:text-xl">
                  {result.title}
                </h3>
                {result.dates && (
                  <div className="flex w-fit items-center gap-2 rounded-lg border border-slate-200 bg-slate-100 px-3 py-1 text-slate-600">
                    <Calendar className="h-4 w-4" />
                    <span className="text-xs font-bold uppercase tracking-wide">{result.dates}</span>
                  </div>
                )}
                <a href={result.url} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-slate-400 transition-colors hover:text-rose-500">
                  {result.url}
                </a>
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-300">ID: {result.id}</span>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
                <a href={result.url} target="_blank" rel="noreferrer" className="flex h-11 min-w-0 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-[10px] font-black uppercase tracking-widest text-slate-900 transition-all hover:bg-slate-50 sm:px-6">
                  VLR
                </a>
                <button
                  onClick={() => handleImport(result)}
                  disabled={!!importingId}
                  className="flex h-11 min-w-0 items-center justify-center rounded-xl bg-slate-950 px-4 text-[10px] font-black uppercase tracking-widest text-white shadow-lg shadow-slate-200 transition-all hover:bg-rose-600 disabled:opacity-50 sm:px-8"
                >
                  {importingId === result.id ? "ЗАГРУЗКА..." : "ЗАГРУЗИТЬ"}
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
