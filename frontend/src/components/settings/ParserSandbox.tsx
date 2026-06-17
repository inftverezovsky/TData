"use client";

import { useState } from "react";

type ParsedResult = {
  name?: string;
  sourceUrl?: string;
  disciplineSlug?: string;
  startDate?: string;
  endDate?: string;
  prizePool?: string;
  location?: string;
  organizer?: string;
  participants: Array<{ name: string; platformId?: string | null; seed?: string | null }>;
  matches: Array<{
    matchId: string;
    stage?: string | null;
    round?: string | null;
    teamAName?: string | null;
    teamBName?: string | null;
    scoreA?: number | null;
    scoreB?: number | null;
    matchDateTime?: string | null;
  }>;
};

export default function ParserSandbox() {
  const [disciplineSlug, setDisciplineSlug] = useState("counterstrike");
  const [wikitext, setWikitext] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ParsedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"summary" | "participants" | "matches" | "json">("summary");

  const handleTest = async () => {
    if (!wikitext.trim()) {
      setError("Пожалуйста, введите wikitext");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disciplineSlug, wikitext }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Неизвестная ошибка парсинга");
      setResult(data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка парсинга");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-3xl bg-white p-8 shadow-soft ring-1 ring-slate-200">
      <div className="border-b border-slate-100 pb-6">
        <h2 className="text-2xl font-black text-slate-950">Песочница парсинга Wikitext</h2>
        <p className="mt-1 text-sm font-medium text-slate-500">
          Вставьте сырой wikitext из Liquipedia, чтобы проверить извлечение данных до реального импорта в базу данных.
        </p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        {/* Input Panel */}
        <div className="lg:col-span-2 space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
              Дисциплина
            </label>
            <select
              value={disciplineSlug}
              onChange={(e) => setDisciplineSlug(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-800 focus:border-indigo-600 focus:bg-white focus:outline-none transition shadow-sm"
            >
              <option value="counterstrike">Counter-Strike</option>
              <option value="dota2">Dota 2</option>
              <option value="leagueoflegends">League of Legends</option>
              <option value="valorant">Valorant</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
              Сырой Wikitext
            </label>
            <textarea
              value={wikitext}
              onChange={(e) => setWikitext(e.target.value)}
              placeholder="Вставьте {{Infobox league ...}} или {{MatchList ...}}"
              rows={12}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-xs font-medium font-mono text-slate-700 placeholder:text-slate-300 focus:border-indigo-600 focus:bg-white focus:outline-none transition shadow-sm"
            />
          </div>

          <button
            onClick={handleTest}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-sm font-black text-white hover:bg-indigo-700 active:scale-[0.98] transition disabled:opacity-50 shadow-md shadow-indigo-600/10"
          >
            {loading ? (
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
            )}
            Протестировать парсинг
          </button>
        </div>

        {/* Results Panel */}
        <div className="lg:col-span-3 border border-slate-100 rounded-2xl p-6 bg-slate-50/50 flex flex-col min-h-[400px]">
          {error && (
            <div className="rounded-xl bg-rose-50 p-4 text-sm font-semibold text-rose-600">
              ⚠️ Ошибка: {error}
            </div>
          )}

          {!result && !error && !loading && (
            <div className="my-auto flex flex-col items-center justify-center text-slate-400">
              <svg className="w-16 h-16 stroke-1 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
              <span className="text-sm font-semibold">Результаты появятся здесь после запуска</span>
            </div>
          )}

          {result && (
            <div className="space-y-6 flex-1 flex flex-col animate-in fade-in duration-300">
              {/* Tab headers */}
              <div className="flex border-b border-slate-200">
                {(["summary", "participants", "matches", "json"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`border-b-2 px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-all -mb-px ${
                      activeTab === tab
                        ? "border-indigo-600 text-indigo-600"
                        : "border-transparent text-slate-400 hover:text-slate-900"
                    }`}
                  >
                    {tab === "summary" && "Общие"}
                    {tab === "participants" && `Участники (${result.participants.length})`}
                    {tab === "matches" && `Матчи (${result.matches.length})`}
                    {tab === "json" && "Сырой JSON"}
                  </button>
                ))}
              </div>

              {/* Tab contents */}
              <div className="flex-1">
                {activeTab === "summary" && (
                  <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="rounded-xl border border-slate-100 bg-white p-4">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Название турнира</span>
                        <div className="mt-1 text-base font-extrabold text-slate-950">{result.name || "Не определено"}</div>
                      </div>
                      <div className="rounded-xl border border-slate-100 bg-white p-4">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Призовой фонд</span>
                        <div className="mt-1 text-base font-extrabold text-slate-950">{result.prizePool || "Не указан"}</div>
                      </div>
                      <div className="rounded-xl border border-slate-100 bg-white p-4">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Организатор</span>
                        <div className="mt-1 text-base font-extrabold text-slate-950">{result.organizer || "Не указан"}</div>
                      </div>
                      <div className="rounded-xl border border-slate-100 bg-white p-4">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Локация</span>
                        <div className="mt-1 text-base font-extrabold text-slate-950">{result.location || "Не указана"}</div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "participants" && (
                  <div className="max-h-[300px] overflow-y-auto rounded-xl border border-slate-100 bg-white p-4 divide-y divide-slate-100">
                    {result.participants.map((p, idx) => (
                      <div key={idx} className="flex justify-between py-2 text-sm font-semibold text-slate-800">
                        <span>{p.name}</span>
                        {p.seed && <span className="text-xs font-bold text-slate-400">Seed: {p.seed}</span>}
                      </div>
                    ))}
                    {result.participants.length === 0 && (
                      <div className="py-8 text-center text-sm font-bold text-slate-400">Участники не найдены</div>
                    )}
                  </div>
                )}

                {activeTab === "matches" && (
                  <div className="max-h-[300px] overflow-y-auto rounded-xl border border-slate-100 bg-white p-4 divide-y divide-slate-100">
                    {result.matches.map((m, idx) => (
                      <div key={idx} className="py-2.5 flex items-center justify-between text-sm">
                        <div className="flex-1 font-semibold text-slate-800 flex items-center gap-2">
                          <span className="w-24 truncate text-left">{m.teamAName || "TBD"}</span>
                          <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-bold tabular-nums">
                            {m.scoreA !== undefined && m.scoreA !== null ? m.scoreA : "-"} : {m.scoreB !== undefined && m.scoreB !== null ? m.scoreB : "-"}
                          </span>
                          <span className="w-24 truncate text-right">{m.teamBName || "TBD"}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] block font-bold text-slate-400">{m.round || m.stage || "Раунд"}</span>
                          {m.matchDateTime && <span className="text-[10px] text-slate-400">{new Date(m.matchDateTime).toLocaleDateString()}</span>}
                        </div>
                      </div>
                    ))}
                    {result.matches.length === 0 && (
                      <div className="py-8 text-center text-sm font-bold text-slate-400">Матчи не найдены</div>
                    )}
                  </div>
                )}

                {activeTab === "json" && (
                  <pre className="max-h-[300px] overflow-y-auto rounded-xl bg-slate-950 p-4 text-[10px] font-medium font-mono text-emerald-400">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
