"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ExternalLink, MapPin, Trophy } from "lucide-react";
import { readJsonResponse } from "@/services/responseSchema";
import { searchDecoders } from "./searchResponse";
import { TournamentSearchForm } from "./TournamentSearchForm";
import TBvolleyTournamentBundleButton from "@/components/tbvolley/TBvolleyTournamentBundleButton";
import type { CBVGender } from "@backend/sources/tbvolley/CBV";

type CBVTournamentSearch = ReturnType<typeof searchDecoders.cbv>;
type CBVTournament = CBVTournamentSearch["tournaments"][number];

const BEACH_VOLLEYBALL_SLUG = "beachvolleyball";
const searchGenders: CBVGender[] = ["men", "women"];

type CombinedCBVTournamentSearch = Omit<CBVTournamentSearch, "gender"> & {
  gender: "all";
};

type CBVTournamentGroup = {
  id: string;
  title: string;
  status: CBVTournament["status"];
  championship: string;
  category: string;
  location: string;
  dates: string;
  items: CBVTournament[];
};

const statusLabels: Record<CBVTournament["status"], string> = {
  finished: "Проведён",
  ongoing: "Идёт",
  upcoming: "Запланирован",
};

const statusClasses: Record<CBVTournament["status"], string> = {
  finished: "border-slate-200 bg-slate-50 text-slate-600",
  ongoing: "border-rose-100 bg-rose-50 text-rose-700",
  upcoming: "border-sky-100 bg-sky-50 text-sky-700",
};

export default function CBVTournamentSearch() {
  const [query, setQuery] = useState("");
  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  const [data, setData] = useState<CombinedCBVTournamentSearch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const runSearch = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const searches = await Promise.all(searchGenders.map(async (gender) => {
        const params = new URLSearchParams({
          gender,
          year,
          query: query.trim(),
        });
        const response = await fetch(`/api/tbvolley/cbv/tournaments?${params.toString()}`, { cache: "no-store" });
        const payload = await readJsonResponse(response, searchDecoders.cbv, "Не удалось загрузить CBV");

        return payload;
      }));

      const first = searches[0];
      const tournaments = searches
        .flatMap((search) => search.tournaments)
        .filter(isUpcomingCBVTournament)
        .sort(compareCBVTournaments);
      const tournamentGroups = groupCBVTournaments(tournaments);

      setData({
        ok: true,
        source: "cbv",
        sourceUrl: first.sourceUrl,
        year: first.year,
        gender: "all",
        query: query.trim(),
        tournaments,
        summary: {
          total: tournamentGroups.length,
          matches: tournaments.reduce((sum, tournament) => sum + (tournament.matchCount || 0), 0),
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить CBV");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [query, year]);

  useEffect(() => {
    runSearch();
  }, [runSearch]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runSearch();
  }

  const tournamentGroups = useMemo(
    () => groupCBVTournaments(data?.tournaments ?? []),
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
                evolleyball.cbv.com.br
              </span>
              <span className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-amber-700">
                Brasil
              </span>
            </div>

            <div>
              <h1 className="text-2xl font-black tracking-tight text-slate-950 md:text-3xl">CBV Brasil</h1>
              <p className="mt-1 text-sm font-semibold leading-relaxed text-slate-500">
                Adulto CBVP: этапы и матчи CBV с быстрым поиском по Brasilia, Ravenna, Open и другим stop-ам
              </p>
            </div>

            <TournamentSearchForm
              query={{ label: "Этап", placeholder: "Brasilia, Open, Final...", value: query, onChange: setQuery }}
              fields={[{ type: "select", label: "Год", value: year, onChange: setYear, options: buildYearOptions().map((value) => ({ value, label: value })) }]}
              loading={loading}
              onSubmit={onSubmit}
            />
          </div>

          <aside className="border-t border-slate-200 bg-slate-950 p-4 text-white lg:border-l lg:border-t-0">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Сводка</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Metric label="Турниры" value={data?.summary.total ?? 0} />
              <Metric label="Матчи" value={data?.summary.matches ?? 0} />
              <Metric label="Год" value={Number(data?.year || year)} />
            </div>
            <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Фильтр</p>
              <p className="mt-1 text-sm font-black text-white">CBVP ADULTO</p>
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
          <p className="mt-2 text-xs font-bold uppercase tracking-wide text-slate-400">CBVP ADULTO · обе сетки</p>
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

function groupCBVTournaments(tournaments: CBVTournament[]): CBVTournamentGroup[] {
  const groups = new Map<string, CBVTournamentGroup>();

  for (const tournament of tournaments) {
    const key = [
      normalizeGroupKey(tournament.title),
      normalizeGroupKey(tournament.location),
      tournament.startDate || "",
      tournament.endDate || "",
      normalizeGroupKey(tournament.championship),
      normalizeGroupKey(tournament.category),
    ].join("|");
    const group = groups.get(key);

    if (!group) {
      groups.set(key, {
        id: key,
        title: tournament.title,
        status: tournament.status,
        championship: tournament.championship,
        category: tournament.category,
        location: tournament.location,
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

function TournamentCard({ group }: { group: CBVTournamentGroup }) {
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
              {group.category}
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
            {group.championship ? <span>{group.championship}</span> : null}
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
              source: "cbv",
              extraPayload: {
                campeonatoId: tournament.campeonatoId,
                temporadaId: tournament.temporadaId,
                etapaId: tournament.etapaId,
                gender: tournament.gender,
              },
            }))}
          />
        </div>
      </div>
    </article>
  );
}

function compareCBVTournaments(left: CBVTournament, right: CBVTournament) {
  return compareDateText(left.startDate, right.startDate)
    || left.title.localeCompare(right.title)
    || compareGender(left.gender, right.gender);
}

function isUpcomingCBVTournament(tournament: CBVTournament) {
  if (tournament.status === "finished") return false;
  const endDate = tournament.endDate || tournament.startDate;
  if (!endDate) return false;
  return endDate >= getTodayDateKey();
}

function getTodayDateKey() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function compareDateText(left: string | null | undefined, right: string | null | undefined) {
  return (left || "9999-12-31").localeCompare(right || "9999-12-31");
}

function compareGender(left: CBVGender, right: CBVGender) {
  return searchGenders.indexOf(left) - searchGenders.indexOf(right);
}

function normalizeGroupKey(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function sortByGender<T extends { gender: CBVGender }>(items: T[]) {
  return [...items].sort((left, right) => compareGender(left.gender, right.gender));
}

function pickGroupStatus(items: CBVTournament[]) {
  if (items.some((item) => item.status === "ongoing")) return "ongoing";
  if (items.some((item) => item.status === "upcoming")) return "upcoming";
  return "finished";
}

function formatGroupGenderLabel(items: Array<{ gender: CBVGender }>) {
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
