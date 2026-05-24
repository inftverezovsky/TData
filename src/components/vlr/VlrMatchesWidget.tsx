"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Clock, Loader2, Zap } from "lucide-react";

type VlrMatch = {
  id: string;
  tournament: string;
  team1: { name: string; platformId: string | null };
  team2: { name: string; platformId: string | null };
  date: string;
  isReady: boolean;
  isLive?: boolean;
};

export default function VlrMatchesWidget() {
  const [matches, setMatches] = useState<VlrMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchMatches() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/valorant/vlr/matches");
      const data = await res.json();
      if (data.ok) setMatches(data.matches.slice(0, 5));
      else setError(data.error);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="premium-card animate-pulse border-slate-200 p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-rose-600" />
          <div className="text-xs font-black uppercase tracking-widest text-slate-500">Загрузка VLR по запросу...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <aside className="premium-card border-slate-200 p-6 shadow-sm">
        <div className="mb-2 flex items-center gap-2 text-rose-500">
          <AlertCircle className="h-4 w-4" />
          <h2 className="text-xs font-black uppercase tracking-widest">Ошибка VLR</h2>
        </div>
        <p className="mb-4 text-[10px] font-bold uppercase leading-relaxed text-slate-400">{error}</p>
        <Link href="/manual-import" className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:bg-rose-700">
          Ручной импорт
        </Link>
      </aside>
    );
  }

  return (
    <aside className="premium-card flex flex-col overflow-hidden border-slate-200 shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 p-6">
        <div>
          <h2 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-slate-950">
            <Zap className="h-4 w-4 fill-rose-600 text-rose-600" />
            Лента VLR
          </h2>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">Ближайшие матчи из VLR</p>
        </div>
      </div>

      <div className="custom-scrollbar max-h-[500px] overflow-y-auto p-0">
        {matches.length === 0 ? (
          <div className="p-8 text-center">
            <button onClick={fetchMatches} className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-[10px] font-black uppercase tracking-widest text-rose-600 transition-all hover:border-rose-300 hover:bg-rose-50/30">
              Нажмите, чтобы загрузить
            </button>
            <p className="mt-4 text-[9px] font-black uppercase tracking-widest text-slate-400">VLR данные загружаются только по запросу</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {matches.map((m) => (
              <li key={m.id} className="group p-4 transition-colors hover:bg-rose-500/[0.04]">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex min-w-0 items-center gap-2">
                    {m.isLive && (
                      <span className="flex items-center gap-1 rounded-md bg-rose-500 px-1.5 py-0.5 text-[7px] font-black uppercase text-white">
                        <Zap className="h-2 w-2 fill-white" /> Идёт
                      </span>
                    )}
                    <span className="max-w-[120px] truncate text-[8px] font-black uppercase tracking-widest text-slate-400">{m.tournament}</span>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-[9px] font-bold tabular-nums text-slate-900">
                    <Clock className="h-3 w-3 text-slate-300" />
                    {m.isLive ? "Сейчас" : m.date.split(" ")[1]}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1 text-right">
                    <div className="truncate text-[11px] font-black text-slate-900">{m.team1.name}</div>
                  </div>
                  <div className="text-[8px] font-black text-slate-300">против</div>
                  <div className="min-w-0 flex-1 text-left">
                    <div className="truncate text-[11px] font-black text-slate-900">{m.team2.name}</div>
                  </div>
                </div>

                <div className="mt-2 flex items-center justify-between">
                  <div className="flex gap-1">
                    <div className={`h-1.5 w-1.5 rounded-full ${m.team1.platformId ? "bg-emerald-500" : "bg-rose-400"}`} />
                    <div className={`h-1.5 w-1.5 rounded-full ${m.team2.platformId ? "bg-emerald-500" : "bg-rose-400"}`} />
                  </div>
                  {m.isReady ? (
                    <span className="flex items-center gap-1 text-[8px] font-black uppercase text-emerald-600">
                      <CheckCircle2 className="h-2.5 w-2.5" /> Готово
                    </span>
                  ) : (
                    <span className="text-[8px] font-black uppercase text-rose-400">Без ID</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
