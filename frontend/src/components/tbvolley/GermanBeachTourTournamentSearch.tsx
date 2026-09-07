"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ExternalLink, MapPin, Trophy, Users } from "lucide-react";
import { readJsonResponse } from "@/services/responseSchema";
import { searchDecoders } from "./searchResponse";
import { TournamentSearchForm } from "./TournamentSearchForm";
import TBvolleyTournamentBundleButton from "@/components/tbvolley/TBvolleyTournamentBundleButton";
import type { GermanBeachTourGender } from "@backend/sources/tbvolley/GermanBeachTour";

type GermanBeachTourTournamentSearch = ReturnType<typeof searchDecoders.germanbeachtour>;
type GermanBeachTourTournament = GermanBeachTourTournamentSearch["tournaments"][number];

const BEACH_VOLLEYBALL_SLUG = "beachvolleyball";

const searchGenders: GermanBeachTourGender[] = ["men", "women"];

type CombinedGermanBeachTourTournamentSearch = Omit<GermanBeachTourTournamentSearch, "gender"> & {
  gender: "all";
};

type GermanBeachTourTournamentGroup = {
  id: string;
  title: string;
  status: GermanBeachTourTournament["status"];
  type: string;
  location: string;
  dates: string;
  prizePool: string;
  teams: number;
  items: GermanBeachTourTournament[];
};

const statusLabels: Record<GermanBeachTourTournament["status"], string> = {
  finished: "Проведён",
  ongoing: "Идёт",
  upcoming: "Запланирован",
};

const statusClasses: Record<GermanBeachTourTournament["status"], string> = {
  finished: "border-slate-200 bg-slate-50 text-slate-600",
  ongoing: "border-rose-100 bg-rose-50 text-rose-700",
  upcoming: "border-sky-100 bg-sky-50 text-sky-700",
};

export default function GermanBeachTourTournamentSearch() {
  const [query, setQuery] = useState("");
  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  const [data, setData] = useState<CombinedGermanBeachTourTournamentSearch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const runSearch = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const searches = await Promise.all(searchGenders.map(async (gender) => {
        const params = new URLSearchParams({
          gender,
          query: query.trim(),
          year,
        });
        const response = await fetch(`/api/tbvolley/germanbeachtour/tournaments?${params.toString()}`, { cache: "no-store" });
        const payload = await readJsonResponse(response, searchDecoders.germanbeachtour, "Не удалось загрузить German Beach Tour");

        return payload;
      }));

      const first = searches[0];
      const tournaments = searches
        .flatMap((search) => search.tournaments)
        .sort(compareGermanBeachTourTournaments);
      const tournamentGroups = groupGermanBeachTourTournaments(tournaments);

      setData({
        ok: true,
        source: "germanbeachtour",
        sourceUrl: first.sourceUrl,
        year: first.year,
        fromDate: first.fromDate,
        toDate: first.toDate,
        windowDays: first.windowDays,
        gender: "all",
        query: query.trim(),
        tournaments,
        summary: {
          total: tournamentGroups.length,
          teams: tournaments.reduce((sum, tournament) => sum + (tournament.teams || 0), 0),
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить German Beach Tour");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [query, year]);

  useEffect(() => {
    runSearch();
  }, [runSearch, year]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runSearch();
  }

  const tournamentGroups = useMemo(
    () => groupGermanBeachTourTournaments(data?.tournaments ?? []),
    [data?.tournaments],
  );
  const windowLabel = useMemo(
    () => formatDateRange(data?.fromDate, data?.toDate),
    [data?.fromDate, data?.toDate],
  );

  return (
    <div className="animate-in space-y-6">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-soft">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-3 p-4 md:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-emerald-700">
                TBvolley
              </span>
              <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">
                beach.volleyball-verband.de
              </span>
              <span className="rounded-lg border border-red-100 bg-red-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-red-700">
                Germany
              </span>
            </div>

            <div>
              <h1 className="text-2xl font-black tracking-tight text-slate-950 md:text-3xl">German Beach Tour</h1>
              <p className="mt-1 text-sm font-semibold leading-relaxed text-slate-500">
                Ближайший месяц: туры DVV для пляжного волейбола
              </p>
            </div>

            <TournamentSearchForm
              query={{ label: "Турнир", placeholder: "Berlin, München, German Beach Tour...", value: query, onChange: setQuery }}
              fields={[{ type: "select", label: "Год", value: year, onChange: setYear, options: buildYearOptions().map((value) => ({ value, label: value })) }]}
              loading={loading}
              onSubmit={onSubmit}
            />
          </div>

          <aside className="border-t border-slate-200 bg-slate-950 p-4 text-white lg:border-l lg:border-t-0">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Сводка</p>
            <div className="mt-3 grid grid-cols-4 gap-2">
              <Metric label="Турниры" value={data?.summary.total ?? 0} />
              <Metric label="Команды" value={data?.summary.teams ?? 0} />
              <Metric label="Дней" value={data?.windowDays ?? 31} />
              <Metric label="Год" value={Number(data?.year || year)} />
            </div>
            <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Окно</p>
              <p className="mt-1 text-sm font-black text-white">{windowLabel}</p>
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
        <section role="alert" className="rounded-3xl border border-rose-100 bg-rose-50 p-8 text-sm font-bold text-rose-700 shadow-soft">
          {error}
        </section>
      ) : loading && !data ? (
        <LoadingGrid />
      ) : tournamentGroups.length === 0 ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-12 text-center shadow-soft">
          <Trophy className="mx-auto h-10 w-10 text-slate-300" />
          <h2 className="mt-4 text-sm font-black uppercase tracking-widest text-slate-500">Турниры не найдены</h2>
          <p className="mt-2 text-xs font-bold uppercase tracking-wide text-slate-400">
            {windowLabel} · обе сетки
          </p>
        </section>
      ) : (
        <div className="grid gap-4">
          {tournamentGroups.map((group) => (
            <TournamentCard key={group.id} group={group} />
          ))}
        </div>
      )}
    </div>
  );
}

function groupGermanBeachTourTournaments(tournaments: GermanBeachTourTournament[]): GermanBeachTourTournamentGroup[] {
  const groups = new Map<string, GermanBeachTourTournamentGroup>();

  for (const tournament of tournaments) {
    const key = [
      normalizeGroupKey(tournament.title),
      normalizeGroupKey(tournament.location),
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
        location: tournament.location,
        dates: tournament.dates,
        prizePool: tournament.prizePool,
        teams: tournament.teams || 0,
        items: [tournament],
      });
      continue;
    }

    group.items.push(tournament);
    group.status = pickGroupStatus(group.items);
    group.teams = group.items.reduce((sum, item) => sum + (item.teams || 0), 0);
    if (!group.prizePool && tournament.prizePool) group.prizePool = tournament.prizePool;
  }

  return Array.from(groups.values())
    .map((group) => ({ ...group, items: sortByGender(group.items) }))
    .sort((left, right) => compareDateText(left.items[0]?.startDate, right.items[0]?.startDate) || left.title.localeCompare(right.title));
}

function normalizeGroupKey(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function sortByGender<T extends { gender: GermanBeachTourGender }>(items: T[]) {
  return [...items].sort((left, right) => compareGender(left.gender, right.gender));
}

function pickGroupStatus(items: GermanBeachTourTournament[]) {
  if (items.some((item) => item.status === "ongoing")) return "ongoing";
  if (items.some((item) => item.status === "upcoming")) return "upcoming";
  return "finished";
}

function formatGroupGenderLabel(items: Array<{ gender: GermanBeachTourGender }>) {
  const genders = new Set(items.map((item) => item.gender));
  if (genders.size > 1) return "Обе сетки";
  return genders.has("women") ? "Женщины" : "Мужчины";
}

function TournamentCard({ group }: { group: GermanBeachTourTournamentGroup }) {
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
              {group.type}
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
            {group.teams ? (
              <span className="inline-flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-emerald-600" />
                {group.teams}
              </span>
            ) : null}
            {group.prizePool ? <span>{group.prizePool}</span> : null}
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
              source: "germanbeachtour",
              extraPayload: {
                tournamentId: tournament.tournamentId,
                gender: tournament.gender,
              },
            }))}
          />
        </div>
      </div>
    </article>
  );
}

function compareGermanBeachTourTournaments(left: GermanBeachTourTournament, right: GermanBeachTourTournament) {
  return compareDateText(left.startDate, right.startDate)
    || left.title.localeCompare(right.title)
    || compareGender(left.gender, right.gender);
}

function compareDateText(left: string | null | undefined, right: string | null | undefined) {
  return (left || "9999-12-31").localeCompare(right || "9999-12-31");
}

function compareGender(left: GermanBeachTourGender, right: GermanBeachTourGender) {
  return searchGenders.indexOf(left) - searchGenders.indexOf(right);
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

function formatDateRange(fromDate?: string, toDate?: string) {
  if (!fromDate || !toDate) return "Ближайший месяц";
  return `${formatDateLabel(fromDate)} - ${formatDateLabel(toDate)}`;
}

function formatDateLabel(value: string) {
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}.${month}.${year}`;
}
