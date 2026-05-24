"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RotateCw } from "lucide-react";
import LoadTournamentButton from "@/components/ui/LoadTournamentButton";
import { TournamentSkeleton } from "@/components/ui/Skeleton";

type FandomTournament = {
  id: string;
  title: string;
  url: string;
  dates?: string | null;
  status?: "ongoing" | "upcoming";
  isLinked?: boolean;
  dbId?: string | null;
};

export default function FandomTournamentsWidget({ disciplineSlug }: { disciplineSlug: string }) {
  const [tournaments, setTournaments] = useState<FandomTournament[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const fetchFandomTournaments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/${disciplineSlug}/fandom/events?t=${Date.now()}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.userMessage || data.error || "Не удалось загрузить Fandom турниры");
        return;
      }
      setTournaments(data.events || []);
    } catch {
      setError("Не удалось загрузить Fandom турниры");
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  }, [disciplineSlug]);

  useEffect(() => {
    fetchFandomTournaments();
  }, [fetchFandomTournaments]);

  return (
    <aside className="premium-card flex h-fit flex-col overflow-hidden border-slate-200 shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 p-6">
        <div>
          <h2 className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-950">Актуальные турниры</h2>
          <p className={`mt-1 text-[10px] font-bold uppercase tracking-widest ${error ? "text-rose-600" : "text-slate-400"}`}>
            {error ? "Fandom ошибка" : "Leaguepedia"}
          </p>
        </div>
        <button
          onClick={fetchFandomTournaments}
          disabled={loading}
          className="rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-indigo-600 transition-colors hover:bg-indigo-100 disabled:opacity-50"
          title="Обновить список Fandom"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
        </button>
      </div>

      <div className="custom-scrollbar flex max-h-[700px] min-h-[120px] flex-col overflow-y-auto p-0">
        {loading && tournaments.length === 0 ? (
          <div className="space-y-3 p-4">
            {[...Array(5)].map((_, index) => <TournamentSkeleton key={index} />)}
          </div>
        ) : error ? (
          <div className="p-8 text-center text-sm font-bold text-rose-500">{error}</div>
        ) : tournaments.length === 0 && hasLoaded ? (
          <div className="flex flex-1 flex-col items-center justify-center p-12 text-center">
            <div className="text-sm font-black uppercase tracking-widest text-slate-400">Турниры не найдены</div>
            <p className="mt-2 text-[10px] font-bold uppercase text-slate-400">Fandom не вернул активных событий</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {tournaments.map((tournament) => (
              <li key={`${tournament.id}-${tournament.url}`} className="group p-5 transition-colors hover:bg-sky-500/[0.04]">
                <div className="mb-4 min-w-0">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                      {tournament.status || "upcoming"}
                    </span>
                  </div>
                  <h3 className="break-words text-sm font-black leading-tight text-slate-950 transition-colors group-hover:text-sky-700" title={tournament.title}>
                    {tournament.title}
                  </h3>
                  {tournament.dates && (
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">{tournament.dates}</p>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <a href={tournament.url} target="_blank" rel="noopener noreferrer" className="text-[10px] font-black uppercase tracking-widest text-slate-400 underline decoration-slate-200 underline-offset-4 transition-colors hover:text-slate-950">
                      Fandom
                    </a>
                  </div>
                  <LoadTournamentButton
                    title={tournament.title}
                    pageUrl={tournament.url}
                    disciplineSlug={disciplineSlug}
                    initialTournamentId={tournament.dbId || undefined}
                    source="fandom"
                    size="sm"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-slate-100 p-4 text-center">
        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Данные Fandom загружаются по запросу</span>
      </div>
    </aside>
  );
}
