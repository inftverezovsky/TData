"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ExternalLink, Loader2, MapPin, RefreshCw, Search, Trophy } from "lucide-react";
import TBvolleyTournamentBundleButton from "@/components/tbvolley/TBvolleyTournamentBundleButton";
import type {
  TwelveNdrGender,
  TwelveNdrSource,
  TwelveNdrTournament,
  TwelveNdrTournamentSearch,
} from "@backend/sources/tbvolley/TwelveNdr";

const BEACH_VOLLEYBALL_SLUG = "beachvolleyball";
const searchGenders: TwelveNdrGender[] = ["men", "women"];

type TwelveNdrSourceConfig = {
  source: TwelveNdrSource;
  apiPath: string;
  calendarMode: "csvp" | "oevv";
  title: string;
  subtitle: string;
  originLabel: string;
  regionLabel: string;
};

type CombinedTwelveNdrTournamentSearch = Omit<TwelveNdrTournamentSearch, "gender"> & {
  gender: "all";
};

type TwelveNdrTournamentGroup = {
  id: string;
  title: string;
  status: TwelveNdrTournament["status"];
  type: string;
  federation: string;
  location: string;
  dates: string;
  items: TwelveNdrTournament[];
};

const statusLabels: Record<TwelveNdrTournament["status"], string> = {
  finished: "Проведён",
  ongoing: "Идёт",
  upcoming: "Запланирован",
};

const statusClasses: Record<TwelveNdrTournament["status"], string> = {
  finished: "border-slate-200 bg-slate-50 text-slate-600",
  ongoing: "border-rose-100 bg-rose-50 text-rose-700",
  upcoming: "border-sky-100 bg-sky-50 text-sky-700",
};

const configs: Record<TwelveNdrSource, TwelveNdrSourceConfig> = {
  twelvendrcsvp: {
    source: "twelvendrcsvp",
    apiPath: "/api/tbvolley/twelvendrcsvp/tournaments",
    calendarMode: "csvp",
    title: "CSVP International",
    subtitle: "12ndr international calendar, только CSV-турниры из левого столбца",
    originLabel: "fivb.12ndr.at",
    regionLabel: "CSVP",
  },
  twelvendroevv: {
    source: "twelvendroevv",
    apiPath: "/api/tbvolley/twelvendroevv/tournaments",
    calendarMode: "oevv",
    title: "Austrian Beach Tour",
    subtitle: "ÖVV календарь 12ndr для Austrian Beach Tour",
    originLabel: "fivb.12ndr.at/oevv",
    regionLabel: "Austria",
  },
};

export function TwelveNdrCsvpTournamentSearch() {
  return <TwelveNdrTournamentSearch config={configs.twelvendrcsvp} />;
}

export function TwelveNdrOevvTournamentSearch() {
  return <TwelveNdrTournamentSearch config={configs.twelvendroevv} />;
}

export default function TwelveNdrTournamentSearch({ config }: { config: TwelveNdrSourceConfig }) {
  const [query, setQuery] = useState("");
  const [season, setSeason] = useState(() => String(new Date().getFullYear()));
  const [data, setData] = useState<CombinedTwelveNdrTournamentSearch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const runSearch = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const searches = await Promise.all(searchGenders.map(async (gender) => {
        const params = new URLSearchParams({
          gender,
          season,
          query: query.trim(),
        });
        const response = await fetch(`${config.apiPath}?${params.toString()}`, { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as TwelveNdrTournamentSearch & { error?: string };

        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || `Не удалось загрузить ${config.title}`);
        }

        return payload;
      }));

      const first = searches[0];
      const tournaments = searches.flatMap((search) => search.tournaments).sort(compareTwelveNdrTournaments);
      const tournamentGroups = groupTwelveNdrTournaments(tournaments);

      setData({
        ok: true,
        source: config.source,
        sourceUrl: first.sourceUrl,
        season: first.season,
        calendarMode: first.calendarMode,
        gender: "all",
        query: query.trim(),
        tournaments,
        summary: {
          total: tournamentGroups.length,
          matches: tournaments.reduce((sum, tournament) => sum + (tournament.matchCount || 0), 0),
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : `Не удалось загрузить ${config.title}`);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [config, query, season]);

  useEffect(() => {
    runSearch();
  }, [runSearch]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runSearch();
  }

  const tournamentGroups = useMemo(
    () => groupTwelveNdrTournaments(data?.tournaments ?? []),
    [data?.tournaments],
  );

  return (
    <div className="animate-in space-y-6">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-soft">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-3 p-4 md:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-emerald-700">
                TBvolley
              </span>
              <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">
                {config.originLabel}
              </span>
              <span className="rounded-lg border border-cyan-100 bg-cyan-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-cyan-700">
                {config.regionLabel}
              </span>
            </div>

            <div>
              <h1 className="text-2xl font-black tracking-tight text-slate-950 md:text-3xl">{config.title}</h1>
              <p className="mt-1 text-sm font-semibold leading-relaxed text-slate-500">{config.subtitle}</p>
            </div>

            <form onSubmit={onSubmit} className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_120px_52px] lg:items-end">
              <label className="min-w-0 space-y-1.5">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Турнир</span>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={config.source === "twelvendrcsvp" ? "CSV, Lima, Futures..." : "Vienna, Baden, ÖVV..."}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm font-bold text-slate-950 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100 placeholder:text-slate-300"
                  />
                </div>
              </label>

              <label className="space-y-1.5">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Сезон</span>
                <select
                  value={season}
                  onChange={(event) => setSeason(event.target.value)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                >
                  {buildYearOptions().map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>

              <button
                type="submit"
                disabled={loading}
                className="flex h-10 w-full items-center justify-center rounded-xl bg-slate-950 text-white transition hover:bg-emerald-600 active:scale-[0.96] disabled:opacity-50"
                title="Найти"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </button>
            </form>
          </div>

          <aside className="border-t border-slate-200 bg-slate-950 p-4 text-white lg:border-l lg:border-t-0">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Сводка</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Metric label="Турниры" value={data?.summary.total ?? 0} />
              <Metric label="Матчи" value={data?.summary.matches ?? 0} />
              <Metric label="Сезон" value={Number(data?.season || season)} />
            </div>
            <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Календарь</p>
              <p className="mt-1 text-sm font-black text-white">{config.regionLabel}</p>
              <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Обе сетки</p>
            </div>
          </aside>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-4 border-b border-slate-200 pb-3">
        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
          {loading ? "Обновление" : `Найдено: ${tournamentGroups.length}`}
        </div>
      </div>

      {error ? (
        <section className="rounded-3xl border border-rose-100 bg-rose-50 p-8 text-sm font-bold text-rose-700 shadow-soft">
          {error}
        </section>
      ) : loading && !data ? (
        <LoadingGrid />
      ) : tournamentGroups.length === 0 ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-12 text-center shadow-soft">
          <Trophy className="mx-auto h-10 w-10 text-slate-300" />
          <h2 className="mt-4 text-sm font-black uppercase tracking-widest text-slate-500">Турниры не найдены</h2>
          <p className="mt-2 text-xs font-bold uppercase tracking-wide text-slate-400">Сезон {season} · обе сетки</p>
        </section>
      ) : (
        <div className="grid gap-4">
          {tournamentGroups.map((group) => (
            <TournamentCard key={group.id} group={group} source={config.source} calendarMode={config.calendarMode} />
          ))}
        </div>
      )}
    </div>
  );
}

function groupTwelveNdrTournaments(tournaments: TwelveNdrTournament[]): TwelveNdrTournamentGroup[] {
  const groups = new Map<string, TwelveNdrTournamentGroup>();

  for (const tournament of tournaments) {
    const key = [
      normalizeGroupKey(tournament.title),
      normalizeGroupKey(tournament.location || tournament.country),
      tournament.startDate || "",
      tournament.endDate || "",
      normalizeGroupKey(tournament.type),
    ].join("|");
    const group = groups.get(key);

    if (!group) {
      groups.set(key, {
        id: key,
        title: tournament.title,
        status: tournament.status,
        type: tournament.type,
        federation: tournament.federation,
        location: tournament.location || tournament.country,
        dates: tournament.dates,
        items: [tournament],
      });
      continue;
    }

    group.items.push(tournament);
    group.status = pickGroupStatus(group.items);
  }

  return Array.from(groups.values())
    .map((group) => ({ ...group, items: sortByGender(group.items) }))
    .sort((left, right) => compareDateText(left.items[0]?.startDate, right.items[0]?.startDate) || left.title.localeCompare(right.title));
}

function TournamentCard({
  group,
  source,
  calendarMode,
}: {
  group: TwelveNdrTournamentGroup;
  source: TwelveNdrSource;
  calendarMode: "csvp" | "oevv";
}) {
  const primary = group.items[0];

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-emerald-200 hover:bg-emerald-500/[0.025]">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className={`rounded-lg border px-2.5 py-1 text-[9px] font-black uppercase tracking-widest ${statusClasses[group.status]}`}>
              {statusLabels[group.status]}
            </span>
            <span className="rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-emerald-700">
              {formatGroupGenderLabel(group.items)}
            </span>
            <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-slate-500">
              {group.type || group.federation}
            </span>
          </div>

          <h2 className="break-words text-xl font-black leading-tight text-slate-950">{group.title}</h2>

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-bold uppercase tracking-wide text-slate-500">
            {group.location ? (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-emerald-600" />
                {group.location}
              </span>
            ) : null}
            {group.dates ? (
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5 text-emerald-600" />
                {group.dates}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <a
            href={primary?.pageUrl || "#"}
            target="_blank"
            rel="noreferrer"
            className="flex h-11 min-w-0 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-[10px] font-black uppercase tracking-widest text-slate-900 transition-all hover:bg-slate-50 sm:px-5"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Source
          </a>
          <TBvolleyTournamentBundleButton
            disciplineSlug={BEACH_VOLLEYBALL_SLUG}
            targetBasePath="/tbvolley/tournament"
            items={group.items.map((tournament) => ({
              title: tournament.title,
              pageUrl: tournament.pageUrl,
              source,
              extraPayload: {
                tcode: tournament.tcode,
                timezone: tournament.timezone,
                calendarMode,
                gender: tournament.gender,
              },
            }))}
          />
        </div>
      </div>
    </article>
  );
}

function compareTwelveNdrTournaments(left: TwelveNdrTournament, right: TwelveNdrTournament) {
  return compareDateText(left.startDate, right.startDate)
    || left.title.localeCompare(right.title)
    || compareGender(left.gender, right.gender);
}

function compareDateText(left: string | null | undefined, right: string | null | undefined) {
  return (left || "9999-12-31").localeCompare(right || "9999-12-31");
}

function compareGender(left: TwelveNdrGender, right: TwelveNdrGender) {
  return searchGenders.indexOf(left) - searchGenders.indexOf(right);
}

function normalizeGroupKey(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function sortByGender<T extends { gender: TwelveNdrGender }>(items: T[]) {
  return [...items].sort((left, right) => compareGender(left.gender, right.gender));
}

function pickGroupStatus(items: TwelveNdrTournament[]) {
  if (items.some((item) => item.status === "ongoing")) return "ongoing";
  if (items.some((item) => item.status === "upcoming")) return "upcoming";
  return "finished";
}

function formatGroupGenderLabel(items: Array<{ gender: TwelveNdrGender }>) {
  const genders = new Set(items.map((item) => item.gender));
  if (genders.size > 1) return "Обе сетки";
  return genders.has("women") ? "Женщины" : "Мужчины";
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-2">
      <div className="text-lg font-black tabular-nums text-white">{value}</div>
      <div className="mt-1 text-[8px] font-black uppercase tracking-widest text-slate-500">{label}</div>
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
