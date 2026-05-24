"use client";

import { useCallback, useState, useEffect } from "react";
import Link from "next/link";
import { Trophy, RotateCw, Loader2, Check, Star } from "lucide-react";
import { TournamentSkeleton } from "@/components/ui/Skeleton";
import LoadTournamentButton from "@/components/ui/LoadTournamentButton";


type HltvTournament = {
  title: string;
  url: string;
  id: string;
  status?: 'ongoing' | 'upcoming';
  isLinked?: boolean;
  dbId?: string | null;
  dates?: string;
  stars?: number;
};

export default function HltvTournamentsWidget({ disciplineSlug }: { disciplineSlug: string }) {
  const providerSlug = "counterstrike";
  const [tournaments, setTournaments] = useState<HltvTournament[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<{ status: 'online' | 'error' | 'loading', errorClass?: string | null }>({ status: 'loading' });
  const [hasLoaded, setHasLoaded] = useState(false);
  const [showUpcoming, setShowUpcoming] = useState(false);

  const ongoing = tournaments.filter(t => t.status === "ongoing") || [];
  const upcoming = tournaments.filter(t => t.status === "upcoming") || [];

  const fetchHltvTournaments = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const timestamp = Date.now();
      const queryParams = new URLSearchParams();
      queryParams.set("t", String(timestamp));
      if (force) {
        queryParams.set("force", "true");
      }
      const res = await fetch(`/api/${providerSlug}/hltv/events?${queryParams.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        const errorClass = data.errorClass || "unknown";
        setError(getHltvEventsErrorMessage(errorClass));
        setHealth({ status: 'error', errorClass });
        return;
      }
      
      if (data.ok && data.events) {
        setTournaments(data.events);
        setHealth({ status: 'online' });
      }
    } catch (err: any) {
      setError("Не удалось загрузить HLTV турниры");
      setHealth({ status: 'error', errorClass: err.message?.includes("403") || err.message?.includes("Cloudflare") ? "cloudflare_block" : "network_error" });
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  }, []);

  useEffect(() => {
    fetchHltvTournaments(false);
  }, [fetchHltvTournaments]);

  return (
    <aside className="premium-card h-fit flex flex-col border-slate-200 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h2 className="text-base font-black tracking-tight text-slate-950 uppercase flex items-center gap-2">
            <Trophy className="w-4 h-4 text-indigo-600" />
            Актуальные Турниры HLTV
          </h2>
          <div className="flex items-center gap-2 mt-1">
            {health.status === 'loading' ? (
              <div className="h-1.5 w-1.5 rounded-full bg-slate-200" />
            ) : health.status === 'online' ? (
              <div className="flex items-center gap-1.5">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                <span className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">Прокси Активен</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5" title={getHltvHealthTitle(health.errorClass)}>
                <div className="h-1.5 w-1.5 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]" />
                <span className="text-[9px] font-black text-rose-600 uppercase tracking-widest">
                  {getHltvHealthLabel(health.errorClass)}
                </span>
              </div>
            )}
          </div>
        </div>
        <button 
          onClick={() => fetchHltvTournaments(true)}
          disabled={loading}
          className="p-2 rounded-xl bg-slate-50 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
        </button>
      </div>

      <div className="p-0 overflow-y-auto max-h-[500px] custom-scrollbar min-h-[120px] flex flex-col">
        {loading && tournaments.length === 0 ? (
          <div className="p-4 space-y-3">
             {[...Array(5)].map((_, i) => (
               <TournamentSkeleton key={i} />
             ))}
          </div>
        ) : !hasLoaded && !loading ? (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
             <div className="h-16 w-16 rounded-full bg-slate-50 flex items-center justify-center mb-6 border border-slate-100">
                <Trophy className="w-8 h-8 text-slate-300" />
             </div>
             <button 
               onClick={() => fetchHltvTournaments(false)}
               className="text-sm font-black text-indigo-600 hover:text-indigo-700 uppercase tracking-widest underline decoration-indigo-200 underline-offset-8 transition-all"
             >
               Нажмите, чтобы загрузить список
             </button>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-sm font-bold text-rose-500">{error}</div>
        ) : tournaments.length === 0 && !loading ? (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
             <div className="text-sm font-black text-slate-400 uppercase tracking-widest">Турниры не найдены</div>
             <p className="text-[10px] font-bold text-slate-400 mt-2 uppercase">HLTV не вернул активных событий</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {ongoing.map((t, i) => (
              <TournamentRow
                key={`ongoing-${i}`}
                t={t}
                disciplineSlug={disciplineSlug}
              />
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
              <TournamentRow
                key={`upcoming-${i}`}
                t={t}
                disciplineSlug={disciplineSlug}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="p-6 border-t border-slate-100">
        <Link 
          href="/manual-import"
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-indigo-200 bg-indigo-50/50 px-4 py-3.5 text-[10px] font-black uppercase tracking-widest text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50 transition-all group shadow-sm"
        >
          <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" />
          </svg>
          Ручной импорт
        </Link>
      </div>
      <div className="p-4 border-t border-slate-100 text-center">
        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Загрузка данных только по запросу</span>
      </div>
    </aside>
  );
}

function getHltvHealthLabel(errorClass?: string | null) {
  if (errorClass === "cloudflare_block" || errorClass === "rate_limited") return "HLTV заблокировал";
  if (errorClass === "proxy_tunnel" || errorClass === "proxy_missing" || errorClass === "network_error") return "Прокси недоступен";
  if (errorClass === "selector_changed" || errorClass === "parse_failed") return "Парсер HLTV";
  return "HLTV ошибка";
}

function getHltvHealthTitle(errorClass?: string | null) {
  if (errorClass === "selector_changed") return "HLTV changed page markup";
  if (errorClass === "parse_failed") return "HLTV parser failed";
  if (errorClass === "proxy_tunnel" || errorClass === "proxy_missing" || errorClass === "network_error") return "Proxy/network error";
  if (errorClass === "cloudflare_block" || errorClass === "rate_limited") return "Blocked or rate limited by HLTV";
  return "HLTV error";
}

function getHltvEventsErrorMessage(errorClass?: string | null) {
  if (errorClass === "selector_changed") return "HLTV изменил блок турниров. Обновите список или используйте ручной импорт.";
  if (errorClass === "cloudflare_block" || errorClass === "rate_limited") return "HLTV ограничил доступ через текущий прокси.";
  if (errorClass === "proxy_tunnel" || errorClass === "proxy_missing" || errorClass === "network_error") return "Прокси не смог открыть HLTV.";
  return "Не удалось загрузить HLTV турниры";
}

function TournamentRow({ 
  t, 
  disciplineSlug 
}: { 
  t: HltvTournament; 
  disciplineSlug: string; 
}) {
  return (
    <li className="p-5 hover:bg-orange-500/[0.04] transition-colors group relative">
      <div className="flex justify-between items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1.5">
             <span className={`h-1.5 w-1.5 rounded-full ${t.status === 'ongoing' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-slate-300'}`} />
             <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
               {t.status === 'ongoing' ? 'Ongoing' : 'Upcoming'}
             </span>
             {t.isLinked && (
                <span className="flex items-center gap-1 text-[8px] font-black text-indigo-500 uppercase bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100">
                  <Check className="w-2.5 h-2.5" /> В базе данных
                </span>
             )}
             {t.stars !== undefined && t.stars > 0 && (
               <div className="flex items-center gap-0.5 ml-1">
                 {[...Array(5)].map((_, i) => (
                   <Star 
                     key={i} 
                     className={`w-2.5 h-2.5 ${i < t.stars! ? "text-amber-400 fill-amber-400" : "text-slate-200"}`} 
                   />
                 ))}
               </div>
             )}
          </div>
          <h3 className="text-sm font-black text-slate-950 leading-tight group-hover:text-indigo-600 transition-colors break-words" title={t.title}>
            {t.title}
          </h3>
          {t.dates && (
            <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-wide">
              {t.dates}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a 
            href={t.url} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-[10px] font-black text-slate-400 hover:text-slate-950 uppercase tracking-widest underline decoration-slate-200 underline-offset-4 transition-colors"
          >
            HLTV
          </a>
          {t.dbId && (
            <Link 
              href={`/counterstrike/tournament/${t.dbId}`}
              className="text-[10px] font-black text-slate-400 hover:text-slate-950 uppercase tracking-widest underline decoration-slate-200 underline-offset-4 transition-colors"
            >
              Открыть в админке
            </Link>
          )}
        </div>

        <LoadTournamentButton
          title={t.title}
          pageUrl={t.url}
          disciplineSlug="counterstrike"
          initialTournamentId={t.dbId || undefined}
          source="hltv"
          size="sm"
        />
      </div>
    </li>
  );
}
