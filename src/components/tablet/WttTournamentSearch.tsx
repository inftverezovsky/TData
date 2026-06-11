"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { CalendarDays, ExternalLink, Loader2, MapPin, RefreshCw, Search, Table2, Trophy, UsersRound } from "lucide-react";
import WttTournamentBundleButton from "@/components/tablet/WttTournamentBundleButton";
import type { WttTournamentEvent, WttTournamentSearch as WttTournamentSearchResult } from "@/lib/sources/tablet/WTT";

const TABLE_TENNIS_SLUG = "tabletennis";

const statusLabels: Record<WttTournamentEvent["status"], string> = {
  ongoing: "Live/идет",
  upcoming: "Скоро",
};

const statusClasses: Record<WttTournamentEvent["status"], string> = {
  ongoing: "border-rose-100 bg-rose-50 text-rose-700",
  upcoming: "border-sky-100 bg-sky-50 text-sky-700",
};

export default function WttTournamentSearch() {
  const [query, setQuery] = useState("");
  const [fromDate, setFromDate] = useState(() => getTodayInputValue());
  const [days, setDays] = useState("14");
  const [data, setData] = useState<WttTournamentSearchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const runSearch = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        query: query.trim(),
        fromDate,
        days,
      });
      const response = await fetch(`/api/tablet/wtt/tournaments?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as WttTournamentSearchResult & { error?: string };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Не удалось загрузить турниры WTT");
      }

      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить турниры WTT");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [days, fromDate, query]);

  useEffect(() => {
    runSearch();
  }, [days, fromDate, runSearch]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runSearch();
  }

  const tournaments = data?.tournaments || [];

  return (
    <div className="animate-in space-y-6">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-soft">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-3 p-4 md:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg border border-cyan-100 bg-cyan-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-cyan-700">
                TableT
              </span>
              <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">
                WTT
              </span>
              <span className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-amber-700">
                Moscow time
              </span>
            </div>

            <div>
              <h1 className="text-2xl font-black tracking-tight text-slate-950 md:text-3xl">Table Tennis</h1>
              <p className="mt-1 text-sm font-semibold leading-relaxed text-slate-500">
                World Table Tennis events
              </p>
            </div>

            <form onSubmit={onSubmit} className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_164px_140px_52px] lg:items-end">
              <label className="min-w-0 space-y-1.5">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Турнир</span>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Zagreb, Smash, Champions..."
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm font-bold text-slate-950 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100 placeholder:text-slate-300"
                  />
                </div>
              </label>

              <label className="space-y-1.5">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Дата</span>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(event) => setFromDate(event.target.value)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100"
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Период</span>
                <select
                  value={days}
                  onChange={(event) => setDays(event.target.value)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100"
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
                className="flex h-10 w-full items-center justify-center rounded-xl bg-slate-950 text-white transition hover:bg-cyan-600 active:scale-[0.96] disabled:opacity-50"
                title="Найти"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </button>
            </form>
          </div>

          <aside className="border-t border-slate-200 bg-slate-950 p-4 text-white lg:border-l lg:border-t-0">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Сводка</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Metric label="Турниры" value={data?.summary.total ?? 0} />
              <Metric label="Матчи" value={data?.summary.matches ?? 0} />
            </div>
            <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Выборка</p>
              <p className="mt-1 text-sm font-black text-white">Senior only</p>
              <p className="mt-1 text-xs font-bold text-slate-400">{data ? `${data.fromDate} - ${data.toDate}` : fromDate}</p>
            </div>
          </aside>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-4 border-b border-slate-200 pb-3">
        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
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
          <p className="mt-2 text-xs font-bold uppercase tracking-wide text-slate-400">WTT senior events</p>
        </section>
      ) : (
        <div className="grid gap-4">
          {tournaments.map((tournament) => (
            <TournamentCard
              key={tournament.eventId}
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
  tournament: WttTournamentEvent;
  fromDate: string;
  days: string;
}) {
  const loadUnavailableReason = getWttLoadUnavailableReason(tournament);
  const bundleItems = loadUnavailableReason ? [] : resolveTournamentBundleItems(tournament, fromDate, days);

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-cyan-200 hover:bg-cyan-500/[0.025]">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className={`rounded-lg border px-2.5 py-1 text-[9px] font-black uppercase tracking-widest ${statusClasses[tournament.status]}`}>
              {statusLabels[tournament.status]}
            </span>
            {tournament.categoryName || tournament.tierName ? (
              <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-slate-500">
                {tournament.categoryName || tournament.tierName}
              </span>
            ) : null}
            {tournament.timeZoneCode ? (
              <span className="rounded-lg border border-cyan-100 bg-cyan-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-cyan-700">
                {tournament.timeZoneCode}
              </span>
            ) : null}
          </div>

          <h2 className="break-words text-xl font-black leading-tight text-slate-950">{tournament.title}</h2>

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-bold uppercase tracking-wide text-slate-500">
            {tournament.location ? (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-cyan-600" />
                {tournament.location}
              </span>
            ) : null}
            {tournament.dates ? (
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5 text-cyan-600" />
                {tournament.dates}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1.5">
              <UsersRound className="h-3.5 w-3.5 text-cyan-600" />
              Матчей: {tournament.matchCount}
            </span>
            {tournament.venueName ? (
              <span className="inline-flex items-center gap-1.5">
                <Table2 className="h-3.5 w-3.5 text-cyan-600" />
                {tournament.venueName}
              </span>
            ) : null}
          </div>

          {tournament.firstMatchTimeMoscow ? (
            <p className="mt-3 text-xs font-bold text-slate-400">Первый матч: {tournament.firstMatchTimeMoscow}</p>
          ) : null}

          {tournament.categories.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {tournament.categories.map((category) => (
                <span
                  key={category.scope}
                  className="rounded-md border border-cyan-100 bg-cyan-50 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-cyan-700"
                >
                  {category.label}: {category.matchCount}
                </span>
              ))}
            </div>
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
          <WttTournamentBundleButton
            disciplineSlug={TABLE_TENNIS_SLUG}
            targetBasePath="/tablet/tournament"
            items={bundleItems}
            disabledReason={loadUnavailableReason}
          />
        </div>
      </div>
    </article>
  );
}

function resolveTournamentBundleItems(tournament: WttTournamentEvent, fromDate: string, days: string) {
  const categories = tournament.categories;

  return categories.map((category) => ({
    title: `${tournament.title} — ${category.label} [WTT:${tournament.eventId}:${category.scope}]`,
    pageUrl: tournament.pageUrl,
    extraPayload: {
      eventId: tournament.eventId,
      timeZoneId: tournament.timeZoneId,
      categoryScope: category.scope,
      fromDate,
      days,
    },
  }));
}

function getWttLoadUnavailableReason(tournament: WttTournamentEvent) {
  if (!tournament.timeZoneId || !tournament.timeZoneCode) {
    return "WTT не отдал часовой пояс. Обновите список позже.";
  }

  if (tournament.matchCount <= 0 || tournament.categories.length === 0) {
    return "Нет актуальных матчей для загрузки.";
  }

  return null;
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="text-xl font-black tabular-nums text-white">{value}</div>
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
