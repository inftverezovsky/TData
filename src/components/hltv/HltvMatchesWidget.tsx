"use client";

import { useState } from "react";
import Link from "next/link";
import { Clock, Zap, AlertCircle, CheckCircle2, ArrowRight, Loader2 } from "lucide-react";

type HltvMatch = {
  id: string;
  tournament: string;
  team1: { name: string; platformId: string | null };
  team2: { name: string; platformId: string | null };
  date: string;
  isReady: boolean;
  isLive?: boolean;
};

export default function HltvMatchesWidget() {
  const [matches, setMatches] = useState<HltvMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchMatches() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/counterstrike/hltv/matches');
      const data = await res.json();
      if (data.ok) {
        setMatches(data.matches.slice(0, 5)); // Show only top 5
      } else {
        setError(data.error);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="premium-card p-6 border-slate-200 shadow-sm animate-pulse">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
          <div className="text-xs font-black uppercase tracking-widest text-slate-500">Загрузка HLTV по запросу...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <aside className="premium-card p-6 border-slate-200 shadow-sm">
        <div className="flex items-center gap-2 text-rose-500 mb-2">
          <AlertCircle className="w-4 h-4" />
          <h2 className="text-xs font-black uppercase tracking-widest">Ошибка HLTV</h2>
        </div>
        <p className="text-[10px] font-bold text-slate-400 uppercase leading-relaxed mb-4">
          {error.includes("Cloudflare") || error.includes("403") 
            ? "HLTV заблокировал запрос (Cloudflare). Используйте прокси или ручной импорт."
            : error}
        </p>
        <Link 
          href="/manual-import"
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-colors"
        >
          Ручной импорт
        </Link>
      </aside>
    );
  }
  return (
    <aside className="premium-card flex flex-col border-slate-200 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h2 className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-950 flex items-center gap-2">
            <Zap className="w-4 h-4 text-indigo-600 fill-indigo-600" />
            Лента HLTV
          </h2>
          <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-widest">Ближайшие матчи из HLTV</p>
        </div>
        <Link 
          href="/manual-import"
          className="rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-indigo-600 hover:bg-indigo-100 transition-colors"
          title="Открыть ручной импорт"
        >
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      <div className="p-0 overflow-y-auto max-h-[500px] custom-scrollbar">
        {error ? (
          <div className="p-8 text-center">
            <AlertCircle className="w-8 h-8 text-rose-500 mx-auto mb-2" />
            <p className="text-[10px] font-bold text-slate-500 uppercase leading-relaxed">
              HLTV заблокировал запрос (Cloudflare).<br/>
              Запустите локальный прокси.
            </p>
          </div>
        ) : matches.length === 0 ? (
          <div className="p-8 text-center">
            <button
              onClick={fetchMatches}
              className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-[10px] font-black uppercase tracking-widest text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all"
            >
              Нажмите, чтобы загрузить
            </button>
            <p className="mt-4 text-[9px] font-black uppercase tracking-widest text-slate-400">HLTV данные загружаются только по запросу</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {matches.map((m) => (
              <li key={m.id} className="p-4 hover:bg-indigo-500/[0.04] transition-colors group">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {m.isLive && (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-rose-500 text-[7px] font-black text-white uppercase animate-pulse">
                        <Zap className="w-2 h-2 fill-white" /> Идёт
                      </span>
                    )}
                    <span className="text-[8px] font-black uppercase tracking-widest text-slate-400 truncate max-w-[120px]">
                      {m.tournament}
                    </span>
                  </div>
                  <span className="text-[9px] font-bold text-slate-900 tabular-nums flex items-center gap-1 shrink-0">
                    <Clock className="w-3 h-3 text-slate-300" />
                    {m.isLive ? "Сейчас" : m.date.split(' ')[1]}
                  </span>
                </div>
                
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0 text-right">
                    <div className="text-[11px] font-black text-slate-900 truncate">{m.team1.name}</div>
                  </div>
                  <div className="text-[8px] font-black text-slate-300">против</div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="text-[11px] font-black text-slate-900 truncate">{m.team2.name}</div>
                  </div>
                </div>

                <div className="mt-2 flex items-center justify-between">
                   <div className="flex gap-1">
                      <div className={`h-1.5 w-1.5 rounded-full ${m.team1.platformId ? 'bg-emerald-500' : 'bg-rose-400'}`} />
                      <div className={`h-1.5 w-1.5 rounded-full ${m.team2.platformId ? 'bg-emerald-500' : 'bg-rose-400'}`} />
                   </div>
                   {m.isReady ? (
                     <span className="text-[8px] font-black text-emerald-600 uppercase flex items-center gap-1">
                        <CheckCircle2 className="w-2.5 h-2.5" /> Готово
                     </span>
                   ) : (
                     <span className="text-[8px] font-black text-rose-400 uppercase">Без ID</span>
                   )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Link 
        href="/manual-import"
        className="p-4 border-t border-slate-100 text-center hover:bg-indigo-500/[0.04] transition-colors"
      >
        <span className="text-[9px] font-black text-indigo-600 uppercase tracking-widest">Открыть ручной импорт</span>
      </Link>
    </aside>
  );
}
