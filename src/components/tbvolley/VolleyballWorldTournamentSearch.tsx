"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ExternalLink, Loader2, MapPin, RefreshCw, Search, Trophy, UsersRound } from "lucide-react";
import LoadTournamentButton from "@/components/ui/LoadTournamentButton";
import type {
  VolleyballWorldBeachTournament,
  VolleyballWorldBeachTournamentSearch,
  VolleyballWorldGender,
} from "@/lib/tbvolley/volleyballworld";

const BEACH_VOLLEYBALL_SLUG = "beachvolleyball";

const genderTabs: Array<{ value: VolleyballWorldGender; label: string }> = [
  { value: "men", label: "Мужчины" },
  { value: "women", label: "Женщины" },
];

const statusLabels: Record<VolleyballWorldBeachTournament["status"], string> = {
  ongoing: "Live/идет",
  upcoming: "Скоро",
};

const statusClasses: Record<VolleyballWorldBeachTournament["status"], string> = {
  ongoing: "border-rose-100 bg-rose-50 text-rose-700",
  upcoming: "border-sky-100 bg-sky-50 text-sky-700",
};

export default function VolleyballWorldTournamentSearch() {
  const [gender, setGender] = useState<VolleyballWorldGender>("men");
  const [query, setQuery] = useState("");
  const [fromDate, setFromDate] = useState(() => getTodayInputValue());
  const [days, setDays] = useState("14");
  const [data, setData] = useState<VolleyballWorldBeachTournamentSearch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const runSearch = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        gender,
        query: query.trim(),
        fromDate,
        days,
      });
      const response = await fetch(`/api/tbvolley/volleyballworld/tournaments?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as VolleyballWorldBeachTournamentSearch & { error?: string };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Не удалось загрузить турниры VolleyballWorld");
      }

      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить турниры VolleyballWorld");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [days, fromDate, gender, query]);

  useEffect(() => {
    runSearch();
  }, [days, fromDate, gender, runSearch]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runSearch();
  }

  const tournaments = data?.tournaments || [];
  const currentGenderLabel = useMemo(
    () => genderTabs.find((tab) => tab.value === gender)?.label || "Мужчины",
    [gender],
  );

  return (
    <div className="animate-in space-y-6">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-soft">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-6 p-6 md:p-8">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-700">
                TBvolley
              </span>
              <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                VolleyballWorld
              </span>
              <span className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-amber-700">
                Beach
              </span>
            </div>

            <div>
              <h1 className="text-3xl font-black tracking-tight text-slate-950 md:text-4xl">Beach Volleyball</h1>
              <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-500">
                VolleyballWorld tournaments
              </p>
            </div>

            <form onSubmit={onSubmit} className="grid gap-3 xl:grid-cols-[minmax(220px,1fr)_164px_140px_52px] xl:items-end">
              <label className="min-w-0 space-y-1.5">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Турнир</span>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Ostrava, Elite16, Challenge..."
                    className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm font-bold text-slate-950 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100 placeholder:text-slate-300"
                  />
                </div>
              </label>

              <label className="space-y-1.5">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Дата</span>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(event) => setFromDate(event.target.value)}
                  className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Период</span>
                <select
                  value={days}
                  onChange={(event) => setDays(event.target.value)}
                  className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                >
                  <option value="7">7 дней</option>
                  <option value="14">14 дней</option>
                  <option value="30">30 дней</option>
                  <option value="60">60 дней</option>
                </select>
              </label>

              <button
                type="submit"
                disabled={loading}
                className="flex h-12 w-full items-center justify-center rounded-xl bg-slate-950 text-white transition hover:bg-emerald-600 active:scale-[0.96] disabled:opacity-50"
                title="Найти"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </button>
            </form>
          </div>

          <aside className="border-t border-slate-200 bg-slate-950 p-6 text-white lg:border-l lg:border-t-0 md:p-8">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Сводка</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Metric label="Турниры" value={data?.summary.total ?? 0} />
              <Metric label="Матчи" value={data?.summary.matches ?? 0} />
            </div>
            <div className="mt-5 rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Выборка</p>
              <p className="mt-2 text-sm font-black text-white">{currentGenderLabel}</p>
              <p className="mt-1 text-xs font-bold text-slate-400">{data ? `${data.fromDate} — ${data.toDate}` : fromDate}</p>
            </div>
          </aside>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {genderTabs.map((tab) => {
            const active = tab.value === gender;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => setGender(tab.value)}
                className={`relative shrink-0 px-7 py-4 text-xs font-black uppercase tracking-[0.2em] transition-all active:scale-[0.96] ${
                  active ? "text-emerald-700" : "text-slate-400 hover:bg-white/60 hover:text-slate-700"
                }`}
              >
                {tab.label}
                {active ? <span className="absolute inset-x-0 bottom-0 h-1 rounded-t-full bg-emerald-600 animate-slide-in" /> : null}
              </button>
            );
          })}
        </div>
        <div className="pb-3 text-[10px] font-black uppercase tracking-widest text-slate-400">
          {loading ? "Обновление" : `Найдено: ${tournaments.length}`}
        </div>
      </div>

      {error ? (
        <section className="rounded-3xl border border-rose-100 bg-rose-50 p-8 text-sm font-bold text-rose-700 shadow-soft">
          {error}
        </section>
      ) : loading && !data ? (
        <LoadingGrid />
      ) : tournaments.length === 0 ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-12 text-center shadow-soft">
          <Trophy className="mx-auto h-10 w-10 text-slate-300" />
          <h2 className="mt-4 text-sm font-black uppercase tracking-widest text-slate-500">Турниры не найдены</h2>
          <p className="mt-2 text-xs font-bold uppercase tracking-wide text-slate-400">{currentGenderLabel}</p>
        </section>
      ) : (
        <div className="grid gap-4">
          {tournaments.map((tournament) => (
            <TournamentCard
              key={`${tournament.gender}-${tournament.tournamentNo || tournament.id}`}
              tournament={tournament}
              fromDate={data?.fromDate || fromDate}
              days={days}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TournamentCard({
  tournament,
  fromDate,
  days,
}: {
  tournament: VolleyballWorldBeachTournament;
  fromDate: string;
  days: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-emerald-200 hover:bg-emerald-500/[0.025]">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className={`rounded-lg border px-2.5 py-1 text-[9px] font-black uppercase tracking-widest ${statusClasses[tournament.status]}`}>
              {statusLabels[tournament.status]}
            </span>
            <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-slate-500">
              {tournament.subCompetitionType}
            </span>
            <span className="rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-emerald-700">
              {tournament.gender === "women" ? "Женщины" : "Мужчины"}
            </span>
          </div>

          <h2 className="break-words text-xl font-black leading-tight text-slate-950">{tournament.title}</h2>

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-bold uppercase tracking-wide text-slate-500">
            {tournament.location ? (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-emerald-600" />
                {tournament.location}
              </span>
            ) : null}
            {tournament.dates ? (
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5 text-emerald-600" />
                {tournament.dates}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1.5">
              <UsersRound className="h-3.5 w-3.5 text-emerald-600" />
              Матчей: {tournament.matchCount}
            </span>
          </div>

          {tournament.firstMatchTimeMoscow ? (
            <p className="mt-3 text-xs font-bold text-slate-400">Первый матч: {tournament.firstMatchTimeMoscow}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <a
            href={tournament.pageUrl}
            target="_blank"
            rel="noreferrer"
            className="flex h-11 min-w-0 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-[10px] font-black uppercase tracking-widest text-slate-900 transition-all hover:bg-slate-50 sm:px-5"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Source
          </a>
          <LoadTournamentButton
            title={tournament.title}
            pageUrl={tournament.pageUrl}
            disciplineSlug={BEACH_VOLLEYBALL_SLUG}
            source="volleyballworld"
            targetBasePath="/tbvolley/tournament"
            extraPayload={{
              tournamentNo: tournament.tournamentNo,
              gender: tournament.gender,
              fromDate,
              days,
            }}
          />
        </div>
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="text-2xl font-black tabular-nums text-white">{value}</div>
      <div className="mt-1 text-[9px] font-black uppercase tracking-widest text-slate-500">{label}</div>
    </div>
  );
}

function LoadingGrid() {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map((item) => (
        <div key={item} className="h-32 animate-pulse rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="h-full rounded-2xl bg-gradient-to-r from-slate-50 via-white to-slate-50" />
        </div>
      ))}
    </div>
  );
}

function getTodayInputValue() {
  const date = new Date();
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}
