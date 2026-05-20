"use client";

import { useState, useCallback, useEffect } from "react";
import LoadTournamentButton from "@/components/ui/LoadTournamentButton";
import { TournamentSkeleton } from "@/components/ui/Skeleton";

type PortalTournament = {
  title: string;
  url: string;
  dates: string;
  status: "ongoing" | "upcoming" | "completed";
  tier?: string;
  dbStatus?: 'not_loaded' | 'announcements' | 'ready' | 'synced';
  dbId?: string;
};

type PortalData = {
  slug: string;
  name: string;
  tournaments: PortalTournament[];
};

export default function UpcomingTournamentsWidget({ disciplineSlug }: { disciplineSlug: string }) {
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTournaments = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      // Append a timestamp to force bypass cache if manual refresh
      const url = `/api/${disciplineSlug}/portal${forceRefresh ? `?t=${Date.now()}` : ""}`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (!res.ok) throw new Error("Failed to fetch");
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError("Не удалось загрузить турниры");
    } finally {
      setLoading(false);
    }
  }, [disciplineSlug]);

  useEffect(() => {
    fetchTournaments(false);
  }, [fetchTournaments]);

  const [showUpcoming, setShowUpcoming] = useState(false);

  const ongoing = data?.tournaments.filter(t => t.status === "ongoing") || [];
  const upcoming = data?.tournaments.filter(t => t.status === "upcoming") || [];

  return (
    <aside className="premium-card h-fit flex flex-col border-slate-200 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h2 className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-950">Актуальные Турниры</h2>
          <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-widest">Текущие и ближайшие (до 7 дней)</p>
        </div>
        <button
          onClick={() => fetchTournaments(true)}
          disabled={loading}
          className="rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-indigo-600 hover:bg-indigo-100 transition-colors disabled:opacity-50"
          title="Обновить список"
        >
          <svg className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
        </button>
      </div>

      <div className="p-0 overflow-y-auto max-h-[700px] custom-scrollbar min-h-[120px] flex flex-col">
        {loading && !data ? (
          <div className="p-4 space-y-3">
             {[...Array(5)].map((_, i) => (
               <TournamentSkeleton key={i} />
             ))}
          </div>
        ) : !data && !loading ? (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
             <div className="h-16 w-16 rounded-full bg-slate-50 flex items-center justify-center mb-6 border border-slate-100">
                <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
             </div>
             <button 
               onClick={() => fetchTournaments(true)}
               className="text-sm font-black text-indigo-600 hover:text-indigo-700 uppercase tracking-widest underline decoration-indigo-200 underline-offset-8 transition-all"
             >
               Нажмите, чтобы загрузить список
             </button>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-sm font-bold text-rose-500">{error}</div>
        ) : (ongoing.length === 0 && upcoming.length === 0) ? (
          <div className="p-8 text-center text-sm font-bold text-slate-400">Нет актуальных турниров</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {ongoing.map((t, i) => (
              <TournamentRow key={`ongoing-${i}`} t={t} disciplineSlug={disciplineSlug} />
            ))}

            {upcoming.length > 0 && (
              <div className="p-4 bg-slate-50/50">
                <button
                  onClick={() => setShowUpcoming(!showUpcoming)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-600 hover:border-indigo-200 hover:text-indigo-600 transition-all shadow-sm"
                >
                  {showUpcoming ? "Скрыть ближайшие" : `Показать ближайшие (${upcoming.length})`}
                  <svg className={`w-3 h-3 transition-transform ${showUpcoming ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
            )}

            {showUpcoming && upcoming.map((t, i) => (
              <TournamentRow key={`upcoming-${i}`} t={t} disciplineSlug={disciplineSlug} />
            ))}
          </ul>
        )}
      </div>
      <div className="p-4 border-t border-slate-100 text-center">
        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Загрузка данных только по запросу</span>
      </div>
    </aside>
  );
}

function TournamentRow({ t, disciplineSlug }: { t: PortalTournament, disciplineSlug: string }) {
  return (
    <li className="p-5 hover:bg-indigo-500/[0.04] transition-colors group">
      <div className="flex justify-between items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            {t.dbStatus === 'synced' ? (
              <div className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <svg className="h-2.5 w-2.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            ) : (
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                t.dbStatus === 'ready' ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" :
                t.dbStatus === 'announcements' ? "bg-slate-400" :
                "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]"
              }`} />
            )}
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 truncate">
              {t.status === "ongoing" ? "Ongoing" : "Upcoming"}
            </span>
            {t.tier && (
              <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 text-[8px] font-black uppercase tracking-wider border border-indigo-100/50">
                {t.tier}
              </span>
            )}
          </div>
          <h3 className="text-sm font-black text-slate-950 leading-tight group-hover:text-indigo-600 transition-colors break-words" title={t.title}>
            {t.title}
          </h3>
          <p className="text-[10px] font-bold text-slate-500 mt-1">{t.dates || "Даты неизвестны"}</p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <a href={t.url} target="_blank" rel="noreferrer" className="text-[10px] font-black text-slate-400 hover:text-slate-900 uppercase tracking-widest underline decoration-slate-200 underline-offset-4">
          Wiki
        </a>
        <LoadTournamentButton
          pageId={0}
          title={t.title}
          pageUrl={t.url}
          disciplineSlug={disciplineSlug}
          initialTournamentId={t.dbId}
          size="sm"
        />
      </div>
    </li>
  );
}
