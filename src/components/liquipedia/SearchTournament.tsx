"use client";

import { FormEvent, useState } from "react";
import LoadTournamentButton from "@/components/ui/LoadTournamentButton";
import UpcomingTournamentsWidget from "@/components/liquipedia/UpcomingTournamentsWidget";
import { Loader2, Calendar, Trash2 } from "lucide-react";
import { getLiquipediaUserMessage } from "@/lib/liquipedia/userFacingErrors";

type SearchResult = {
  pageId: number;
  title: string;
  pageUrl: string;
  snippet?: string | null;
  score?: number | null;
  wordCount?: number | null;
  dates?: string | null;
};

type SearchResponse = {
  results?: SearchResult[];
  error?: string;
  userMessage?: string | null;
  errorClass?: string | null;
};

function toPlainSnippet(snippet: string) {
  return snippet
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export default function SearchTournament({ disciplineSlug, hideSidebar = false }: { disciplineSlug: string, hideSidebar?: boolean }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runSearch(force = false) {
    setLoading(true);
    setError(null);
    setResults([]);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 minutes for retries

    try {
      const response = await fetch(`/api/${disciplineSlug}/search-tournament`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, force }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      const data = await response.json().catch(() => ({})) as SearchResponse;
      if (!response.ok) {
        throw new Error(data.userMessage || getLiquipediaUserMessage(data.errorClass, data.error ?? "Search failed"));
      }
      setResults(data.results ?? []);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setError("Поиск занял слишком много времени. Попробуйте еще раз.");
      } else {
        setError(getLiquipediaUserMessage(null, err instanceof Error ? err.message : "Search error"));
      }
    } finally {
      setLoading(false);
      clearTimeout(timeoutId);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runSearch(false);
  }

  const searchCard = (
    <section className="premium-card min-h-[188px] border-slate-200 bg-white shadow-sm">
      <form onSubmit={onSubmit} className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-950" htmlFor="tournament-query">
            Поиск Liquipedia
          </label>
          <span className="rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-indigo-600">
            Wiki
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_112px]">
          <input
            id="tournament-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Название турнира"
            className="min-h-[50px] rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-none transition focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/5 placeholder:text-slate-300"
          />
          <button
            type="submit"
            disabled={loading || query.trim().length < 2}
            className="min-h-[50px] rounded-lg bg-slate-950 px-5 text-xs font-black uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-indigo-600 disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none"
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
              className="flex h-8 items-center gap-1.5 rounded-lg border border-indigo-100 bg-indigo-50 px-3 text-[10px] font-black uppercase tracking-widest text-indigo-600 transition-colors hover:bg-indigo-100 disabled:opacity-40"
              title="Обновить принудительно, минуя кеш"
            >
              <Loader2 className={`w-3 h-3 ${loading ? "animate-spin" : "hidden"}`} />
              Обновить
            </button>
            <button
              onClick={async () => {
                if (confirm('Очистить кэш поиска? Это не затронет привязки команд.')) {
                  const res = await fetch('/api/settings/clear-search-cache', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ source: 'liquipedia', disciplineSlug }),
                  });
                  const data = await res.json();
                  if (data.ok) {
                    setResults([]);
                    alert(`Кэш очищен (${data.deletedCount} файлов)`);
                  }
                }
              }}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 text-[10px] font-black uppercase tracking-widest text-slate-500 transition-colors hover:border-red-100 hover:bg-red-50 hover:text-red-600"
              title="Очистить временный кэш поиска"
            >
              <Trash2 className="w-3 h-3" />
              Очистить кеш поиска
            </button>
          </div>
          {results.length > 0 && (
            <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-indigo-600">
               <span className="h-1.5 w-1.5 rounded-full bg-indigo-600 shadow-[0_0_8px_rgba(79,70,229,0.5)]" />
               LIQUIPEDIA WIKI
            </span>
          )}
        </div>

        {results.map((result) => (
          <article key={`${result.pageId}-${result.title}`} className="rounded-lg border border-slate-100/50 bg-slate-50/20 p-5 transition-colors hover:border-indigo-200/60 hover:bg-indigo-500/[0.04]">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 flex-1 min-w-0">
                <h3 className="break-words text-lg font-bold leading-tight text-slate-900 sm:text-xl">
                  {result.title}
                </h3>
                
                {result.dates && (
                  <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-slate-100 border border-slate-200 text-slate-600 w-fit">
                    <Calendar className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-wide">
                      {result.dates}
                    </span>
                  </div>
                )}

                <a 
                  href={result.pageUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-xs text-slate-400 hover:text-indigo-500 truncate transition-colors"
                >
                  {result.pageUrl}
                </a>
                {result.snippet && (
                  <p className="mt-4 text-sm font-bold leading-relaxed text-slate-900">
                    {toPlainSnippet(result.snippet)}
                  </p>
                )}
              </div>
              
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
                <a
                  href={result.pageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-11 min-w-0 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-[10px] font-black uppercase tracking-widest text-slate-900 transition-all hover:bg-slate-50 sm:px-6"
                >
                  Wiki
                </a>
                <LoadTournamentButton
                  pageId={result.pageId}
                  title={result.title}
                  pageUrl={result.pageUrl}
                  disciplineSlug={disciplineSlug}
                />
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );

  if (hideSidebar) {
    return searchCard;
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_380px]">
      {searchCard}
      <UpcomingTournamentsWidget disciplineSlug={disciplineSlug} />
    </div>
  );
}
