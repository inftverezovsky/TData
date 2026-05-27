"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { CalendarDays, ExternalLink, Loader2, MapPin, RefreshCw, Search, Trophy } from "lucide-react";
import LoadTournamentButton from "@/components/ui/LoadTournamentButton";
import type {
  BeachVolleyRuGender,
  BeachVolleyRuTournament,
  BeachVolleyRuTournamentKind,
  BeachVolleyRuTournamentSearch,
} from "@/lib/tbvolley/beachVolleyRu";

const BEACH_VOLLEYBALL_SLUG = "beachvolleyball";

const genderTabs: Array<{ value: BeachVolleyRuGender; label: string }> = [
  { value: "men", label: "Мужчины" },
  { value: "women", label: "Женщины" },
];

const kindTabs: Array<{ value: BeachVolleyRuTournamentKind; label: string }> = [
  { value: "all", label: "Все" },
  { value: "cup", label: "Кубок" },
  { value: "championship", label: "Чемпионат" },
];

const statusLabels: Record<BeachVolleyRuTournament["status"], string> = {
  finished: "Проведён",
  ongoing: "Идёт",
  upcoming: "Запланирован",
};

const statusClasses: Record<BeachVolleyRuTournament["status"], string> = {
  finished: "border-slate-200 bg-slate-50 text-slate-600",
  ongoing: "border-rose-100 bg-rose-50 text-rose-700",
  upcoming: "border-sky-100 bg-sky-50 text-sky-700",
};

const kindLabels: Record<Exclude<BeachVolleyRuTournamentKind, "all">, string> = {
  cup: "Кубок России",
  championship: "Чемпионат России",
};

export default function BeachVolleyRuTournamentSearch() {
  const [gender, setGender] = useState<BeachVolleyRuGender>("men");
  const [kind, setKind] = useState<BeachVolleyRuTournamentKind>("all");
  const [query, setQuery] = useState("");
  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  const [data, setData] = useState<BeachVolleyRuTournamentSearch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const runSearch = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        gender,
        kind,
        query: query.trim(),
        year,
      });
      const response = await fetch(`/api/tbvolley/beachvolleyru/tournaments?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as BeachVolleyRuTournamentSearch & { error?: string };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Не удалось загрузить календарь beach.volley.ru");
      }

      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить календарь beach.volley.ru");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [gender, kind, query, year]);

  useEffect(() => {
    runSearch();
  }, [gender, kind, runSearch, year]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runSearch();
  }

  const tournaments = data?.tournaments || [];
  const currentGenderLabel = useMemo(
    () => genderTabs.find((tab) => tab.value === gender)?.label || "Мужчины",
    [gender],
  );
  const windowLabel = useMemo(
    () => formatDateRange(data?.fromDate, data?.toDate),
    [data?.fromDate, data?.toDate],
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
                beach.volley.ru
              </span>
              <span className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-amber-700">
                Россия
              </span>
            </div>

            <div>
              <h1 className="text-3xl font-black tracking-tight text-slate-950 md:text-4xl">Пляжный волейбол</h1>
              <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-500">
                Ближайший месяц: Кубок и Чемпионат России
              </p>
            </div>

            <form onSubmit={onSubmit} className="grid gap-3 xl:grid-cols-[minmax(220px,1fr)_120px_52px] xl:items-end">
              <label className="min-w-0 space-y-1.5">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Турнир</span>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Тула, Зеленоградск, финал..."
                    className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm font-bold text-slate-950 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100 placeholder:text-slate-300"
                  />
                </div>
              </label>

              <label className="space-y-1.5">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Год</span>
                <select
                  value={year}
                  onChange={(event) => setYear(event.target.value)}
                  className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                >
                  {buildYearOptions().map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
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
              <Metric label="Кубок" value={data?.summary.cup ?? 0} />
              <Metric label="Чемпионат" value={data?.summary.championship ?? 0} />
              <Metric label="Дней" value={data?.windowDays ?? 31} />
            </div>
            <div className="mt-5 rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Окно</p>
              <p className="mt-2 text-sm font-black text-white">{windowLabel}</p>
              <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-slate-500">{currentGenderLabel}</p>
            </div>
          </aside>
        </div>
      </section>

      <div className="space-y-3 border-b border-slate-200">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {genderTabs.map((tab) => (
            <TabButton key={tab.value} active={tab.value === gender} onClick={() => setGender(tab.value)}>
              {tab.label}
            </TabButton>
          ))}
        </div>
        <div className="flex min-w-0 items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
            {kindTabs.map((tab) => (
              <TabButton key={tab.value} active={tab.value === kind} onClick={() => setKind(tab.value)}>
                {tab.label}
              </TabButton>
            ))}
          </div>
          <div className="pb-3 text-[10px] font-black uppercase tracking-widest text-slate-400">
            {loading ? "Обновление" : `Найдено: ${tournaments.length}`}
          </div>
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
          <p className="mt-2 text-xs font-bold uppercase tracking-wide text-slate-400">
            {windowLabel} · {currentGenderLabel}
          </p>
        </section>
      ) : (
        <div className="grid gap-4">
          {tournaments.map((tournament) => (
            <TournamentCard key={`${tournament.gender}-${tournament.eventId}`} tournament={tournament} />
          ))}
        </div>
      )}
    </div>
  );
}

function TournamentCard({ tournament }: { tournament: BeachVolleyRuTournament }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-emerald-200 hover:bg-emerald-500/[0.025]">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className={`rounded-lg border px-2.5 py-1 text-[9px] font-black uppercase tracking-widest ${statusClasses[tournament.status]}`}>
              {statusLabels[tournament.status]}
            </span>
            <span className="rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-emerald-700">
              {tournament.gender === "women" ? "Женщины" : "Мужчины"}
            </span>
            <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-slate-500">
              {kindLabels[tournament.kind]}
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
            {tournament.prizePool ? <span>{tournament.prizePool}</span> : null}
          </div>
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
            source="beachvolleyru"
            targetBasePath="/tbvolley/tournament"
            extraPayload={{
              eventId: tournament.eventId,
              gender: tournament.gender,
            }}
          />
        </div>
      </div>
    </article>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative shrink-0 px-7 py-4 text-xs font-black uppercase tracking-[0.2em] transition-all active:scale-[0.96] ${
        active ? "text-emerald-700" : "text-slate-400 hover:bg-white/60 hover:text-slate-700"
      }`}
    >
      {children}
      {active ? <span className="absolute inset-x-0 bottom-0 h-1 rounded-t-full bg-emerald-600 animate-slide-in" /> : null}
    </button>
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

function buildYearOptions() {
  const current = new Date().getFullYear();
  return [current + 1, current, current - 1, current - 2, current - 3].map(String);
}

function formatDateRange(fromDate?: string, toDate?: string) {
  if (!fromDate || !toDate) return "Ближайший месяц";
  return `${formatDateLabel(fromDate)} - ${formatDateLabel(toDate)}`;
}

function formatDateLabel(value: string) {
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}.${month}.${year}`;
}
