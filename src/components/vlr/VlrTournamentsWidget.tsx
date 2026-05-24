"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Loader2, RotateCw, Trophy } from "lucide-react";
import LoadTournamentButton from "@/components/ui/LoadTournamentButton";
import { TournamentSkeleton } from "@/components/ui/Skeleton";

type VlrTournament = {
  title: string;
  url: string;
  id: string;
  status?: "ongoing" | "upcoming" | "unknown";
  isLinked?: boolean;
  dbId?: string | null;
  dates?: string | null;
};

export default function VlrTournamentsWidget({ disciplineSlug }: { disciplineSlug: string }) {
  const [tournaments, setTournaments] = useState<VlrTournament[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<{ status: "online" | "error" | "loading"; errorClass?: string | null }>({ status: "loading" });
  const [hasLoaded, setHasLoaded] = useState(false);
  const [showUpcoming, setShowUpcoming] = useState(false);

  const ongoing = tournaments.filter((t) => t.status === "ongoing");
  const upcoming = tournaments.filter((t) => t.status !== "ongoing");

  const fetchVlrTournaments = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const queryParams = new URLSearchParams({ t: String(Date.now()) });
      if (force) queryParams.set("force", "true");
      const res = await fetch(`/api/${disciplineSlug}/vlr/events?${queryParams.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setError(getVlrEventsErrorMessage(data.errorClass));
        setHealth({ status: "error", errorClass: data.errorClass || "unknown" });
        return;
      }

      if (data.ok && data.events) {
        setTournaments(data.events);
        setHealth({ status: "online" });
      }
    } catch (err: any) {
      setError("Не удалось загрузить VLR турниры");
      setHealth({ status: "error", errorClass: err.message?.includes("timeout") ? "timeout" : "network_error" });
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  }, [disciplineSlug]);

  useEffect(() => {
    fetchVlrTournaments(false);
  }, [fetchVlrTournaments]);

  return (
    <aside className="premium-card flex h-fit flex-col overflow-hidden border-slate-200 shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 p-6">
        <div>
          <h2 className="flex items-center gap-2 text-base font-black uppercase tracking-tight text-slate-950">
            <Trophy className="h-4 w-4 text-rose-600" />
            Актуальные турниры VLR
          </h2>
          <div className="mt-1 flex items-center gap-2">
            {health.status === "loading" ? (
              <div className="h-1.5 w-1.5 rounded-full bg-slate-200" />
            ) : health.status === "online" ? (
              <div className="flex items-center gap-1.5">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                <span className="text-[9px] font-black uppercase tracking-widest text-emerald-600">VLR доступен</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5" title={getVlrHealthTitle(health.errorClass)}>
                <div className="h-1.5 w-1.5 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]" />
                <span className="text-[9px] font-black uppercase tracking-widest text-rose-600">{getVlrHealthLabel(health.errorClass)}</span>
              </div>
            )}
          </div>
        </div>
        <button
          onClick={() => fetchVlrTournaments(true)}
          disabled={loading}
          className="rounded-xl bg-slate-50 p-2 text-slate-400 transition-all hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
          title="Обновить VLR"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
        </button>
      </div>

      <div className="custom-scrollbar flex max-h-[500px] min-h-[120px] flex-col overflow-y-auto p-0">
        {loading && tournaments.length === 0 ? (
          <div className="space-y-3 p-4">
            {[...Array(5)].map((_, i) => <TournamentSkeleton key={i} />)}
          </div>
        ) : error ? (
          <div className="p-8 text-center text-sm font-bold text-rose-500">{error}</div>
        ) : tournaments.length === 0 && !loading && hasLoaded ? (
          <div className="flex flex-1 flex-col items-center justify-center p-12 text-center">
            <div className="text-sm font-black uppercase tracking-widest text-slate-400">Турниры не найдены</div>
            <p className="mt-2 text-[10px] font-bold uppercase text-slate-400">VLR не вернул активных событий</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {ongoing.map((t) => <TournamentRow key={`ongoing-${t.id}`} t={t} disciplineSlug={disciplineSlug} />)}
            {upcoming.length > 0 && (
              <div className="bg-slate-50/50 p-4">
                <button
                  onClick={() => setShowUpcoming(!showUpcoming)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-600 shadow-sm transition-all hover:border-rose-200 hover:text-rose-600"
                >
                  {showUpcoming ? "Скрыть ближайшие" : `Показать ближайшие (${upcoming.length})`}
                </button>
              </div>
            )}
            {showUpcoming && upcoming.map((t) => <TournamentRow key={`upcoming-${t.id}`} t={t} disciplineSlug={disciplineSlug} />)}
          </ul>
        )}
      </div>

      <div className="border-t border-slate-100 p-6">
        <Link href="/manual-import" className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-rose-200 bg-rose-50/50 px-4 py-3.5 text-[10px] font-black uppercase tracking-widest text-rose-600 shadow-sm transition-all hover:border-rose-300 hover:bg-rose-50">
          Ручной импорт
        </Link>
      </div>
      <div className="border-t border-slate-100 p-4 text-center">
        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Загрузка данных только по запросу</span>
      </div>
    </aside>
  );
}

function TournamentRow({ t, disciplineSlug }: { t: VlrTournament; disciplineSlug: string }) {
  return (
    <li className="group relative p-5 transition-colors hover:bg-rose-500/[0.04]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center gap-2">
            <span className={`h-1.5 w-1.5 rounded-full ${t.status === "ongoing" ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-slate-300"}`} />
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
              {t.status === "ongoing" ? "Ongoing" : "Upcoming"}
            </span>
            {t.isLinked && (
              <span className="flex items-center gap-1 rounded border border-rose-100 bg-rose-50 px-1.5 py-0.5 text-[8px] font-black uppercase text-rose-500">
                <Check className="h-2.5 w-2.5" /> В базе данных
              </span>
            )}
          </div>
          <h3 className="break-words text-sm font-black leading-tight text-slate-950 transition-colors group-hover:text-rose-600" title={t.title}>
            {t.title}
          </h3>
          {t.dates && <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">{t.dates}</p>}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-[10px] font-black uppercase tracking-widest text-slate-400 underline decoration-slate-200 underline-offset-4 transition-colors hover:text-slate-950">
            VLR
          </a>
          {t.dbId && (
            <Link href={`/valorant/tournament/${t.dbId}`} className="text-[10px] font-black uppercase tracking-widest text-slate-400 underline decoration-slate-200 underline-offset-4 transition-colors hover:text-slate-950">
              Открыть в админке
            </Link>
          )}
        </div>

        <LoadTournamentButton
          title={t.title}
          pageUrl={t.url}
          disciplineSlug="valorant"
          initialTournamentId={t.dbId || undefined}
          source="vlr"
          size="sm"
        />
      </div>
    </li>
  );
}

function getVlrHealthLabel(errorClass?: string | null) {
  if (errorClass === "selector_changed" || errorClass === "parse_failed") return "Парсер VLR";
  if (errorClass === "timeout" || errorClass === "network_error") return "VLR недоступен";
  if (errorClass === "rate_limited" || errorClass === "cloudflare_block") return "VLR ограничил";
  return "VLR ошибка";
}

function getVlrHealthTitle(errorClass?: string | null) {
  if (errorClass === "selector_changed" || errorClass === "parse_failed") return "VLR changed page markup";
  if (errorClass === "timeout" || errorClass === "network_error") return "VLR network error";
  if (errorClass === "rate_limited" || errorClass === "cloudflare_block") return "Blocked or rate limited by VLR";
  return "VLR error";
}

function getVlrEventsErrorMessage(errorClass?: string | null) {
  if (errorClass === "selector_changed" || errorClass === "parse_failed") return "VLR изменил блок турниров. Нужно обновить парсер.";
  if (errorClass === "timeout" || errorClass === "network_error") return "VLR не ответил вовремя.";
  if (errorClass === "rate_limited" || errorClass === "cloudflare_block") return "VLR ограничил доступ.";
  return "Не удалось загрузить VLR турниры";
}
