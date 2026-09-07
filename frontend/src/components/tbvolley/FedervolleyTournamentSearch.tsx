"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { CalendarDays, ExternalLink, MapPin, Trophy } from "lucide-react";
import { readJsonResponse } from "@/services/responseSchema";
import { searchDecoders } from "./searchResponse";
import { TournamentSearchForm } from "./TournamentSearchForm";
import TBvolleyTournamentBundleButton from "@/components/tbvolley/TBvolleyTournamentBundleButton";
import type {
  FedervolleyCategory, FedervolleyGender } from "@backend/sources/tbvolley/Federvolley";

type FedervolleyTournamentSearch = ReturnType<typeof searchDecoders.federvolley>;
type FedervolleyTournament = FedervolleyTournamentSearch["tournaments"][number];

const BEACH_VOLLEYBALL_SLUG = "beachvolleyball";
const searchGenders: FedervolleyGender[] = ["men", "women"];

type CombinedFedervolleyTournamentSearch = Omit<FedervolleyTournamentSearch, "gender"> & {
  gender: "all";
};

type FedervolleyTournamentGroup = {
  id: string;
  title: string;
  status: FedervolleyTournament["status"];
  category: Exclude<FedervolleyCategory, "all">;
  categoryLabel: string;
  location: string;
  dates: string;
  prizePool: string;
  items: FedervolleyTournament[];
};

const categoryTabs: Array<{ value: FedervolleyCategory; label: string }> = [
  { value: "all", label: "Все" },
  { value: "assoluto", label: "Assoluto" },
  { value: "serie", label: "Serie beach" },
];

const statusLabels: Record<FedervolleyTournament["status"], string> = {
  finished: "Проведён",
  ongoing: "Идёт",
  upcoming: "Запланирован",
};

const statusClasses: Record<FedervolleyTournament["status"], string> = {
  finished: "border-slate-200 bg-slate-50 text-slate-600",
  ongoing: "border-rose-100 bg-rose-50 text-rose-700",
  upcoming: "border-sky-100 bg-sky-50 text-sky-700",
};

export default function FedervolleyTournamentSearch() {
  const [category, setCategory] = useState<FedervolleyCategory>("all");
  const [query, setQuery] = useState("");
  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  const [data, setData] = useState<CombinedFedervolleyTournamentSearch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const runSearch = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const searches = await Promise.all(searchGenders.map(async (gender) => {
        const params = new URLSearchParams({
          gender,
          category,
          year,
          query: query.trim(),
        });
        const response = await fetch(`/api/tbvolley/federvolley/tournaments?${params.toString()}`, { cache: "no-store" });
        const payload = await readJsonResponse(response, searchDecoders.federvolley, "Не удалось загрузить Federvolley");

        return payload;
      }));

      const first = searches[0];
      const tournaments = searches.flatMap((search) => search.tournaments).sort(compareFedervolleyTournaments);
      const tournamentGroups = groupFedervolleyTournaments(tournaments);

      setData({
        ok: true,
        source: "federvolley",
        sourceUrl: first.sourceUrl,
        year: first.year,
        category,
        gender: "all",
        query: query.trim(),
        tournaments,
        summary: {
          total: tournamentGroups.length,
          assoluto: tournamentGroups.filter((group) => group.category === "assoluto").length,
          serie: tournamentGroups.filter((group) => group.category === "serie").length,
          matches: tournaments.reduce((sum, tournament) => sum + (tournament.matchCount || 0), 0),
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить Federvolley");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [category, query, year]);

  useEffect(() => {
    runSearch();
  }, [runSearch]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runSearch();
  }

  const tournamentGroups = useMemo(
    () => groupFedervolleyTournaments(data?.tournaments ?? []),
    [data?.tournaments],
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
                beachvolley.federvolley.it
              </span>
              <span className="rounded-lg border border-red-100 bg-red-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-red-700">
                Italy
              </span>
            </div>

            <div>
              <h1 className="text-2xl font-black tracking-tight text-slate-950 md:text-3xl">Italy Federvolley</h1>
              <p className="mt-1 text-sm font-semibold leading-relaxed text-slate-500">
                Campionato Assoluto и Serie Beach с импортом турниров из Drupal + Matchshare
              </p>
            </div>

            <TournamentSearchForm
              query={{ label: "Турнир", placeholder: "Caorle, Serie Beach 2, Finale...", value: query, onChange: setQuery }}
              fields={[{ type: "select", label: "Год", value: year, onChange: setYear, options: buildYearOptions().map((value) => ({ value, label: value })) }]}
              loading={loading}
              onSubmit={onSubmit}
            />
          </div>

          <aside className="border-t border-slate-200 bg-slate-950 p-4 text-white lg:border-l lg:border-t-0">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Сводка</p>
            <div className="mt-3 grid grid-cols-4 gap-2">
              <Metric label="Турниры" value={data?.summary.total ?? 0} />
              <Metric label="Assoluto" value={data?.summary.assoluto ?? 0} />
              <Metric label="Serie" value={data?.summary.serie ?? 0} />
              <Metric label="Матчи" value={data?.summary.matches ?? 0} />
            </div>
            <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Scope</p>
              <p className="mt-1 text-sm font-black text-white">Assoluto + Serie Beach</p>
              <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Обе сетки</p>
            </div>
          </aside>
        </div>
      </section>

      <div className="flex min-w-0 items-center justify-between gap-4 border-b border-slate-200">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {categoryTabs.map((tab) => (
            <TabButton key={tab.value} active={tab.value === category} onClick={() => setCategory(tab.value)}>
              {tab.label}
            </TabButton>
          ))}
        </div>
        <div className="pb-3 text-[10px] font-black uppercase tracking-widest text-slate-400">
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
          <p className="mt-2 text-xs font-bold uppercase tracking-wide text-slate-400">Italy · обе сетки</p>
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

function groupFedervolleyTournaments(tournaments: FedervolleyTournament[]): FedervolleyTournamentGroup[] {
  const groups = new Map<string, FedervolleyTournamentGroup>();

  for (const tournament of tournaments) {
    const key = [
      normalizeGroupKey(tournament.title),
      normalizeGroupKey(tournament.location),
      tournament.startDate || "",
      tournament.endDate || "",
      tournament.category,
    ].join("|");
    const group = groups.get(key);

    if (!group) {
      groups.set(key, {
        id: key,
        title: tournament.title,
        status: tournament.status,
        category: tournament.category,
        categoryLabel: tournament.categoryLabel,
        location: tournament.location,
        dates: tournament.dates,
        prizePool: tournament.prizePool,
        items: [tournament],
      });
      continue;
    }

    group.items.push(tournament);
    group.status = pickGroupStatus(group.items);
    if (!group.prizePool && tournament.prizePool) group.prizePool = tournament.prizePool;
  }

  return Array.from(groups.values())
    .map((group) => ({ ...group, items: sortByGender(group.items) }))
    .sort((left, right) => compareDateText(left.items[0]?.startDate, right.items[0]?.startDate) || left.title.localeCompare(right.title));
}

function TournamentCard({ group }: { group: FedervolleyTournamentGroup }) {
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
              {group.categoryLabel}
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
              source: "federvolley",
              extraPayload: {
                federvolleyNodeId: tournament.nodeId,
                matchshareLid: tournament.matchshareLid,
                category: tournament.category,
                gender: tournament.gender,
              },
            }))}
          />
        </div>
      </div>
    </article>
  );
}

function compareFedervolleyTournaments(left: FedervolleyTournament, right: FedervolleyTournament) {
  return compareDateText(left.startDate, right.startDate)
    || left.title.localeCompare(right.title)
    || compareGender(left.gender, right.gender);
}

function compareDateText(left: string | null | undefined, right: string | null | undefined) {
  return (left || "9999-12-31").localeCompare(right || "9999-12-31");
}

function compareGender(left: FedervolleyGender, right: FedervolleyGender) {
  return searchGenders.indexOf(left) - searchGenders.indexOf(right);
}

function normalizeGroupKey(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function sortByGender<T extends { gender: FedervolleyGender }>(items: T[]) {
  return [...items].sort((left, right) => compareGender(left.gender, right.gender));
}

function pickGroupStatus(items: FedervolleyTournament[]) {
  if (items.some((item) => item.status === "ongoing")) return "ongoing";
  if (items.some((item) => item.status === "upcoming")) return "upcoming";
  return "finished";
}

function formatGroupGenderLabel(items: Array<{ gender: FedervolleyGender }>) {
  const genders = new Set(items.map((item) => item.gender));
  if (genders.size > 1) return "Обе сетки";
  return genders.has("women") ? "Женщины" : "Мужчины";
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
