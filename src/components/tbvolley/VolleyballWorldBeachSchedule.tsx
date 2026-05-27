"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock3, ExternalLink, Loader2, MapPin, RefreshCw, Radio, Trophy } from "lucide-react";
import type { VolleyballWorldBeachMatch, VolleyballWorldBeachSchedule, VolleyballWorldGender } from "@/lib/tbvolley/volleyballworld";

const genderTabs: Array<{ value: VolleyballWorldGender; label: string }> = [
  { value: "men", label: "Мужчины" },
  { value: "women", label: "Женщины" },
];

const statusLabels: Record<string, string> = {
  upcoming: "Скоро",
  live: "Live",
  finished: "Сыгран",
};

const statusClasses: Record<string, string> = {
  upcoming: "bg-sky-50 text-sky-700 ring-sky-100",
  live: "bg-rose-50 text-rose-700 ring-rose-100",
  finished: "bg-emerald-50 text-emerald-700 ring-emerald-100",
};

export default function VolleyballWorldBeachSchedule() {
  const [gender, setGender] = useState<VolleyballWorldGender>("men");
  const [fromDate, setFromDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [days, setDays] = useState("14");
  const [schedule, setSchedule] = useState<VolleyballWorldBeachSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSchedule = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ gender, fromDate, days });
      const response = await fetch(`/api/tbvolley/volleyballworld/matches?${query.toString()}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Не удалось загрузить расписание VolleyballWorld");
      setSchedule(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить расписание VolleyballWorld");
      setSchedule(null);
    } finally {
      setLoading(false);
    }
  }, [days, fromDate, gender]);

  useEffect(() => {
    loadSchedule();
  }, [loadSchedule]);

  const groupedMatches = useMemo(() => groupMatchesByDate(schedule?.matches || []), [schedule]);
  const visibleGenderLabel = genderTabs.find((tab) => tab.value === gender)?.label || "Мужчины";

  return (
    <div className="animate-in space-y-6">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-soft">
        <div className="grid gap-0 lg:grid-cols-[1fr_360px]">
          <div className="p-6 md:p-8">
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-700">
                <Radio className="h-3.5 w-3.5" />
                TBvolley
              </span>
              <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                VolleyballWorld
              </span>
              <span className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-amber-700">
                Beach
              </span>
            </div>

            <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
              <div className="min-w-0">
                <h1 className="text-3xl font-black tracking-tight text-slate-950 md:text-4xl">Beach Volleyball</h1>
                <p className="mt-2 max-w-2xl text-sm font-semibold leading-relaxed text-slate-600">
                  Расписание Volleyball World по пляжному волейболу, раздельно по мужской и женской сетке.
                </p>
              </div>

              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <label className="flex min-w-[160px] flex-col gap-1.5">
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Дата</span>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(event) => setFromDate(event.target.value)}
                    className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 shadow-sm outline-none transition-all focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
                  />
                </label>

                <label className="flex min-w-[130px] flex-col gap-1.5">
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Период</span>
                  <select
                    value={days}
                    onChange={(event) => setDays(event.target.value)}
                    className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 shadow-sm outline-none transition-all focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
                  >
                    <option value="7">7 дней</option>
                    <option value="14">14 дней</option>
                    <option value="30">30 дней</option>
                    <option value="60">60 дней</option>
                  </select>
                </label>

                <button
                  type="button"
                  onClick={loadSchedule}
                  disabled={loading}
                  className="mt-auto inline-flex h-11 w-11 items-center justify-center rounded-xl bg-slate-950 text-white shadow-sm transition-all hover:bg-emerald-600 active:scale-[0.95] disabled:opacity-50"
                  title="Обновить"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          <aside className="border-t border-slate-200 bg-slate-950 p-6 text-white lg:border-l lg:border-t-0 md:p-8">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Сводка</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Metric label="Матчи" value={schedule?.summary.total ?? 0} />
              <Metric label="Турниры" value={schedule?.summary.competitions ?? 0} />
              <Metric label="Live" value={schedule?.summary.live ?? 0} tone="text-rose-300" />
              <Metric label="Скоро" value={schedule?.summary.upcoming ?? 0} tone="text-sky-300" />
            </div>
            {schedule?.sourceUrl ? (
              <a
                href={schedule.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white transition-all hover:border-emerald-400/30 hover:bg-white/10"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Открыть источник
              </a>
            ) : null}
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
          {schedule ? `${schedule.fromDate} — ${schedule.toDate}` : visibleGenderLabel}
        </div>
      </div>

      {error ? (
        <section className="rounded-3xl border border-rose-100 bg-rose-50 p-8 text-sm font-bold text-rose-700 shadow-soft">
          {error}
        </section>
      ) : loading && !schedule ? (
        <LoadingGrid />
      ) : groupedMatches.length === 0 ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-12 text-center shadow-soft">
          <Trophy className="mx-auto h-10 w-10 text-slate-300" />
          <h2 className="mt-4 text-sm font-black uppercase tracking-widest text-slate-500">Матчи не найдены</h2>
          <p className="mt-2 text-xs font-bold uppercase tracking-wide text-slate-400">{visibleGenderLabel}, beach volleyball</p>
        </section>
      ) : (
        <div className="space-y-5">
          {groupedMatches.map((group) => (
            <section key={group.dateKey} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-soft">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4">
                <div className="flex items-center gap-2 text-sm font-black text-slate-950">
                  <CalendarDays className="h-4 w-4 text-emerald-600" />
                  {formatDateTitle(group.dateKey)}
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-400 ring-1 ring-slate-200">
                  {group.matches.length}
                </span>
              </div>
              <div className="divide-y divide-slate-100">
                {group.matches.map((match) => <MatchRow key={match.id} match={match} />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone = "text-white" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className={`text-2xl font-black tabular-nums ${tone}`}>{value}</div>
      <div className="mt-1 text-[9px] font-black uppercase tracking-widest text-slate-500">{label}</div>
    </div>
  );
}

function MatchRow({ match }: { match: VolleyballWorldBeachMatch }) {
  const location = [match.city, match.country].filter(Boolean).join(", ");
  const stage = [match.phase, match.round, match.court].filter(Boolean).join(" · ");

  return (
    <article className="grid gap-4 p-5 transition-colors hover:bg-emerald-500/[0.035] lg:grid-cols-[150px_1fr_190px] lg:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white">
          <Clock3 className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-black tabular-nums text-slate-950">{match.startTimeMoscow === "TBD" ? "TBD" : match.startTimeMoscow.slice(11, 16)}</p>
          <span className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-widest ring-1 ${statusClasses[match.status]}`}>
            {statusLabels[match.status]}
          </span>
        </div>
      </div>

      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="max-w-full truncate rounded-lg bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
            {match.tournamentName}
          </span>
          {match.matchNoInTournament ? (
            <span className="rounded-lg bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-700">
              #{match.matchNoInTournament}
            </span>
          ) : null}
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
          <BeachTeam team={match.teamA} score={match.score.teamA} winner={match.status === "finished" && (match.score.teamA ?? 0) > (match.score.teamB ?? 0)} align="right" />
          <div className="hidden text-[9px] font-black uppercase tracking-widest text-slate-300 md:block">vs</div>
          <BeachTeam team={match.teamB} score={match.score.teamB} winner={match.status === "finished" && (match.score.teamB ?? 0) > (match.score.teamA ?? 0)} align="left" />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
          {location ? (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3 w-3" />
              {location}
            </span>
          ) : null}
          {stage ? <span>{stage}</span> : null}
          {match.score.sets.length > 0 ? <span>{formatSets(match.score.sets)}</span> : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-start gap-2 lg:justify-end">
        <MatchLink href={match.links.matchCenter} label="Матч" />
        <MatchLink href={match.links.watch} label="Watch" />
        <MatchLink href={match.links.tickets} label="Tickets" />
      </div>
    </article>
  );
}

function BeachTeam({
  team,
  score,
  winner,
  align,
}: {
  team: VolleyballWorldBeachMatch["teamA"];
  score: number | null;
  winner: boolean;
  align: "left" | "right";
}) {
  return (
    <div className={`flex min-w-0 items-center gap-3 ${align === "right" ? "md:justify-end md:text-right" : ""}`}>
      {align === "left" ? <TeamFlag team={team} /> : null}
      <div className="min-w-0">
        <p className={`truncate text-sm font-black ${winner ? "text-emerald-700" : "text-slate-950"}`}>{team.name}</p>
        <p className="mt-0.5 truncate text-[10px] font-bold uppercase tracking-wide text-slate-400">
          {[team.code, team.country].filter(Boolean).join(" · ") || "TBD"}
        </p>
      </div>
      {score !== null ? <div className={`w-7 shrink-0 text-center text-xl font-black tabular-nums ${winner ? "text-emerald-700" : "text-slate-300"}`}>{score}</div> : null}
      {align === "right" ? <TeamFlag team={team} /> : null}
    </div>
  );
}

function TeamFlag({ team }: { team: VolleyballWorldBeachMatch["teamA"] }) {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200">
      {/* eslint-disable-next-line @next/next/no-img-element -- Flags are external Volleyball World URLs. */}
      {team.flagUrl ? <img src={team.flagUrl} alt="" className="h-full w-full object-cover" /> : <span className="text-[9px] font-black text-slate-400">TBD</span>}
    </div>
  );
}

function MatchLink({ href, label }: { href: string | null; label: string }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[9px] font-black uppercase tracking-widest text-slate-500 shadow-sm transition-all hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
    >
      <ExternalLink className="h-3 w-3" />
      {label}
    </a>
  );
}

function LoadingGrid() {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map((item) => (
        <div key={item} className="h-36 animate-pulse rounded-3xl border border-slate-200 bg-white shadow-soft">
          <div className="h-full rounded-3xl bg-gradient-to-r from-slate-50 via-white to-slate-50" />
        </div>
      ))}
    </div>
  );
}

function groupMatchesByDate(matches: VolleyballWorldBeachMatch[]) {
  const groups = new Map<string, VolleyballWorldBeachMatch[]>();
  for (const match of matches) {
    const key = match.dateKey || "TBD";
    groups.set(key, [...(groups.get(key) || []), match]);
  }
  return Array.from(groups.entries()).map(([dateKey, groupMatches]) => ({ dateKey, matches: groupMatches }));
}

function formatDateTitle(dateKey: string) {
  if (dateKey === "TBD") return "Dates TBD";
  const date = new Date(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatSets(sets: VolleyballWorldBeachMatch["score"]["sets"]) {
  return sets.map((set) => `${set.teamA}:${set.teamB}`).join(", ");
}
