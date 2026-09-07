"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { CalendarDays, ExternalLink, MapPin, Trophy, UsersRound } from "lucide-react";
import { readJsonResponse } from "@/services/responseSchema";
import { searchDecoders } from "./searchResponse";
import { TournamentSearchForm } from "./TournamentSearchForm";
import TBvolleyTournamentBundleButton from "@/components/tbvolley/TBvolleyTournamentBundleButton";
import type { VolleyballWorldGender } from "@backend/sources/tbvolley/VolleyballWorld";

type VolleyballWorldBeachTournamentSearch = ReturnType<typeof searchDecoders.volleyballworld>;
type VolleyballWorldBeachTournament = VolleyballWorldBeachTournamentSearch["tournaments"][number];

const BEACH_VOLLEYBALL_SLUG = "beachvolleyball";

const searchGenders: VolleyballWorldGender[] = ["men", "women"];

type CombinedVolleyballWorldTournamentSearch = Omit<VolleyballWorldBeachTournamentSearch, "gender"> & {
  gender: "all";
};

type VolleyballWorldTournamentGroup = {
  id: string;
  title: string;
  pageUrl: string;
  status: VolleyballWorldBeachTournament["status"];
  subCompetitionType: string;
  location: string;
  dates: string;
  matchCount: number;
  firstMatchTimeMoscow: string | null;
  items: VolleyballWorldBeachTournament[];
};

const statusLabels: Record<VolleyballWorldBeachTournament["status"], string> = {
  ongoing: "Live/идет",
  upcoming: "Скоро",
};

const statusClasses: Record<VolleyballWorldBeachTournament["status"], string> = {
  ongoing: "border-rose-100 bg-rose-50 text-rose-700",
  upcoming: "border-sky-100 bg-sky-50 text-sky-700",
};

export default function VolleyballWorldTournamentSearch() {
  const [query, setQuery] = useState("");
  const [fromDate, setFromDate] = useState(() => getTodayInputValue());
  const [days, setDays] = useState("14");
  const [data, setData] = useState<CombinedVolleyballWorldTournamentSearch | null>(null);
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
          fromDate,
          days,
        });
        const response = await fetch(`/api/tbvolley/volleyballworld/tournaments?${params.toString()}`, { cache: "no-store" });
        const payload = await readJsonResponse(response, searchDecoders.volleyballworld, "Не удалось загрузить турниры VolleyballWorld");

        return payload;
      }));

      const first = searches[0];
      const tournaments = searches
        .flatMap((search) => search.tournaments)
        .sort(compareVolleyballWorldTournaments);
      const tournamentGroups = groupVolleyballWorldTournaments(tournaments);

      setData({
        ok: true,
        source: "volleyballworld",
        fromDate: first.fromDate,
        toDate: first.toDate,
        gender: "all",
        query: query.trim(),
        tournaments,
        summary: {
          total: tournamentGroups.length,
          matches: tournaments.reduce((sum, tournament) => sum + tournament.matchCount, 0),
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить турниры VolleyballWorld");
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
  const tournamentGroups = groupVolleyballWorldTournaments(tournaments);

  return (
    <div className="animate-in space-y-6">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-soft">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-3 p-4 md:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-emerald-700">
                TBvolley
              </span>
              <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">
                VolleyballWorld
              </span>
              <span className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-amber-700">
                Beach
              </span>
            </div>

            <div>
              <h1 className="text-2xl font-black tracking-tight text-slate-950 md:text-3xl">Beach Volleyball</h1>
              <p className="mt-1 text-sm font-semibold leading-relaxed text-slate-500">
                VolleyballWorld tournaments
              </p>
            </div>

            <TournamentSearchForm
              query={{ label: "Турнир", placeholder: "Ostrava, Elite16, Challenge...", value: query, onChange: setQuery }}
              fields={[{ type: "date", label: "Дата", value: fromDate, onChange: setFromDate }, { type: "select", label: "Период", value: days, onChange: setDays, options: [7, 14, 30, 60].map((value) => ({ value: String(value), label: `${value} дней` })) }]}
              loading={loading}
              onSubmit={onSubmit}
            />
          </div>

          <aside className="border-t border-slate-200 bg-slate-950 p-4 text-white lg:border-l lg:border-t-0">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Сводка</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Metric label="Турниры" value={data?.summary.total ?? 0} />
              <Metric label="Матчи" value={data?.summary.matches ?? 0} />
            </div>
            <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Выборка</p>
              <p className="mt-1 text-sm font-black text-white">Обе сетки</p>
              <p className="mt-1 text-xs font-bold text-slate-400">{data ? `${data.fromDate} — ${data.toDate}` : fromDate}</p>
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
          <p className="mt-2 text-xs font-bold uppercase tracking-wide text-slate-400">Обе сетки</p>
        </section>
      ) : (
        <div className="grid gap-4">
          {tournamentGroups.map((group) => (
            <TournamentCard
              key={group.id}
              group={group}
              fromDate={data?.fromDate || fromDate}
              days={days}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function compareVolleyballWorldTournaments(left: VolleyballWorldBeachTournament, right: VolleyballWorldBeachTournament) {
  return compareDateText(left.startDate, right.startDate)
    || left.title.localeCompare(right.title)
    || compareGender(left.gender, right.gender);
}

function compareDateText(left: string | null | undefined, right: string | null | undefined) {
  return (left || "9999-12-31").localeCompare(right || "9999-12-31");
}

function compareGender(left: VolleyballWorldGender, right: VolleyballWorldGender) {
  return searchGenders.indexOf(left) - searchGenders.indexOf(right);
}

function groupVolleyballWorldTournaments(tournaments: VolleyballWorldBeachTournament[]): VolleyballWorldTournamentGroup[] {
  const groups = new Map<string, VolleyballWorldTournamentGroup>();

  for (const tournament of tournaments) {
    const key = [
      normalizeGroupKey(tournament.title),
      normalizeGroupKey(tournament.location),
      normalizeGroupKey(tournament.subCompetitionType),
      tournament.startDate?.slice(0, 10) || "",
      tournament.endDate?.slice(0, 10) || "",
    ].join("|");
    const group = groups.get(key);

    if (!group) {
      groups.set(key, {
        id: key,
        title: tournament.title,
        pageUrl: tournament.pageUrl,
        status: tournament.status,
        subCompetitionType: tournament.subCompetitionType,
        location: tournament.location,
        dates: tournament.dates,
        matchCount: tournament.matchCount,
        firstMatchTimeMoscow: tournament.firstMatchTimeMoscow,
        items: [tournament],
      });
      continue;
    }

    group.items.push(tournament);
    group.status = group.items.some((item) => item.status === "ongoing") ? "ongoing" : "upcoming";
    group.matchCount = group.items.reduce((sum, item) => sum + item.matchCount, 0);
    group.firstMatchTimeMoscow = pickFirstMatchTime(group.items);
  }

  return Array.from(groups.values())
    .map((group) => ({ ...group, items: sortByGender(group.items) }))
    .sort((left, right) => compareDateText(left.items[0]?.startDate, right.items[0]?.startDate) || left.title.localeCompare(right.title));
}

function normalizeGroupKey(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function sortByGender<T extends { gender: VolleyballWorldGender }>(items: T[]) {
  return [...items].sort((left, right) => compareGender(left.gender, right.gender));
}

function pickFirstMatchTime(items: VolleyballWorldBeachTournament[]) {
  return items
    .map((item) => ({ startDate: item.startDate, label: item.firstMatchTimeMoscow }))
    .filter((item): item is { startDate: string; label: string } => Boolean(item.startDate && item.label))
    .sort((left, right) => left.startDate.localeCompare(right.startDate))[0]?.label || null;
}

function formatGroupGenderLabel(items: Array<{ gender: VolleyballWorldGender }>) {
  const genders = new Set(items.map((item) => item.gender));
  if (genders.size > 1) return "Обе сетки";
  return genders.has("women") ? "Женщины" : "Мужчины";
}

function TournamentCard({
  group,
  fromDate,
  days,
}: {
  group: VolleyballWorldTournamentGroup;
  fromDate: string;
  days: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-emerald-200 hover:bg-emerald-500/[0.025]">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className={`rounded-lg border px-2.5 py-1 text-[9px] font-black uppercase tracking-widest ${statusClasses[group.status]}`}>
              {statusLabels[group.status]}
            </span>
            <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-slate-500">
              {group.subCompetitionType}
            </span>
            <span className="rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-emerald-700">
              {formatGroupGenderLabel(group.items)}
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
            <span className="inline-flex items-center gap-1.5">
              <UsersRound className="h-3.5 w-3.5 text-emerald-600" />
              Матчей: {group.matchCount}
            </span>
          </div>

          {group.firstMatchTimeMoscow ? (
            <p className="mt-3 text-xs font-bold text-slate-400">Первый матч: {group.firstMatchTimeMoscow}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <a
            href={group.pageUrl}
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
              source: "volleyballworld",
              extraPayload: {
                tournamentNo: tournament.tournamentNo,
                gender: tournament.gender,
                fromDate,
                days,
              },
            }))}
          />
        </div>
      </div>
    </article>
  );
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
