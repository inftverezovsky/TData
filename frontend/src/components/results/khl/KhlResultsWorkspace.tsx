"use client";

import { useMemo, useState } from "react";

import { KhlMatchProtocol } from "@/components/results/khl/KhlMatchProtocol";
import { KhlTabs } from "@/components/results/khl/KhlTabs";
import {
  KHL_MATCH_TABS,
  KHL_RESULTS_TABS,
  type KhlMatchTab,
  type KhlResultsTab,
} from "@/components/results/khl/khlNavigation";
import {
  aggregateKhlGameDay,
  getKhlMoscowDateKey,
  partitionKhlResultsMatches,
  getKhlRevisionPresentation,
} from "@/components/results/khl/khlResultsViewModel";
import type { StoredMatch } from "@/components/results/khl/types";

type Props = {
  matches: StoredMatch[];
  hasMoreMatches: boolean;
  busyKey: string | null;
  onRefresh: () => void;
  onLoadMore: () => void;
  onReingest?: (match: StoredMatch) => void;
};

const METRIC_ORDER = [
  "shots_on_goal",
  "faceoffs_won",
  "power_play_goals",
  "penalty_minutes_2_4",
] as const;

export function KhlResultsWorkspace({
  matches,
  hasMoreMatches,
  busyKey,
  onRefresh,
  onLoadMore,
  onReingest,
}: Props) {
  const [tab, setTab] = useState<KhlResultsTab>("today");
  const partition = useMemo(() => partitionKhlResultsMatches(matches), [matches]);
  const daily = useMemo(() => aggregateKhlGameDay(partition.today), [partition.today]);
  const tabItems = KHL_RESULTS_TABS.map((item) => ({
    ...item,
    count: item.id === "today"
      ? partition.today.length
      : item.id === "archive"
        ? partition.archive.length
        : daily.includedMatches,
  }));

  return (
    <section data-testid="khl-results-workspace" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <KhlTabs
          items={tabItems}
          value={tab}
          onChange={setTab}
          label="Разделы результатов КХЛ"
        />
        <button
          type="button"
          onClick={onRefresh}
          disabled={busyKey === "sync:all"}
          className="rounded-xl border border-blue-200 bg-blue-700 px-4 py-2 text-xs font-black text-white disabled:opacity-40"
        >
          {busyKey === "sync:all" ? "Постановка в очередь…" : "Собрать сейчас"}
        </button>
      </div>

      {tab === "today" && (
        <MatchList
          title="Матчи сегодня"
          description={`Московская дата: ${formatMoscowDay(new Date())}. Матчи отсортированы по времени начала.`}
          matches={partition.today}
          empty="Завершённых матчей КХЛ сегодня пока нет. Автопарсер добавит их после появления официального протокола."
          busyKey={busyKey}
          onReingest={onReingest}
        />
      )}
      {tab === "daily" && <DailyStatistics matches={partition.today} />}
      {tab === "archive" && (
        <ArchiveMatches
          matches={partition.archive}
          hasMoreMatches={hasMoreMatches}
          busyKey={busyKey}
          onLoadMore={onLoadMore}
          onReingest={onReingest}
        />
      )}
    </section>
  );
}

function ArchiveMatches({
  matches,
  hasMoreMatches,
  busyKey,
  onLoadMore,
  onReingest,
}: {
  matches: StoredMatch[];
  hasMoreMatches: boolean;
  busyKey: string | null;
  onLoadMore: () => void;
  onReingest?: (match: StoredMatch) => void;
}) {
  const [query, setQuery] = useState("");
  const [day, setDay] = useState("");
  const normalized = query.trim().toLocaleLowerCase("ru-RU");
  const filtered = matches.filter((match) => {
    if (day && getKhlMoscowDateKey(match.startsAt) !== day) return false;
    if (!normalized) return true;
    return [match.khlGameId, match.homeTeam.name, match.awayTeam.name, match.stageId, match.season]
      .some((value) => value.toLocaleLowerCase("ru-RU").includes(normalized));
  });

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-slate-200 bg-slate-50/60 p-5 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">Архив с 1 мая 2026 года</h2>
        <p className="mt-1 text-sm text-slate-600">Новые матчи сверху. Поиск не зависит от Admin-привязок.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_14rem]">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Команда, KHL game ID, этап или сезон"
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm"
          />
          <input
            type="date"
            min="2026-05-01"
            value={day}
            onChange={(event) => setDay(event.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold"
          />
        </div>
      </section>
      <MatchList
        title="Архивные матчи"
        description={`Показано: ${filtered.length} из ${matches.length} загруженных.`}
        matches={filtered}
        empty="В архиве нет матчей по выбранному фильтру."
        busyKey={busyKey}
        onReingest={onReingest}
      />
      {hasMoreMatches && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={busyKey === "matches:more"}
          className="mx-auto block rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700 disabled:opacity-40"
        >
          {busyKey === "matches:more" ? "Загрузка…" : "Загрузить более ранние матчи"}
        </button>
      )}
    </div>
  );
}

function MatchList({
  title,
  description,
  matches,
  empty,
  busyKey,
  onReingest,
}: {
  title: string;
  description: string;
  matches: StoredMatch[];
  empty: string;
  busyKey?: string | null;
  onReingest?: (match: StoredMatch) => void;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-black text-slate-950">{title}</h2>
        <p className="text-sm text-slate-500">{description}</p>
      </div>
      {matches.map((match) => <KhlResultMatchCard key={match.id} match={match} busyKey={busyKey} onReingest={onReingest} />)}
      {matches.length === 0 && (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          {empty}
        </div>
      )}
    </section>
  );
}

export function KhlResultMatchCard({ match, busyKey, onReingest }: {
  match: StoredMatch;
  busyKey?: string | null;
  onReingest?: (match: StoredMatch) => void;
}) {
  const [tab, setTab] = useState<KhlMatchTab>("overview");
  const playerCount = match.protocol?.players.length ?? match._count.participants;
  const revision = getKhlRevisionPresentation(match);

  return (
    <article className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <details data-testid="khl-match-disclosure" className="group">
        <summary
          data-testid="khl-match-summary"
          className="cursor-pointer list-none p-5 transition-colors hover:bg-slate-50 [&::-webkit-details-marker]:hidden"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-[260px] flex-1">
              <div className="text-xs font-bold text-slate-500">
                {formatMoscowDateTime(match.startsAt)} · KHL game {match.khlGameId} · stage {match.stageId} · {match.season}
              </div>
              <h3 className="mt-1 text-lg font-black text-slate-950">
                {match.homeTeam.name} — {match.awayTeam.name}
              </h3>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold">
                <span
                  data-testid="khl-revision-badge"
                  className={`rounded-full px-3 py-1 ${revisionBadgeClass(revision.badgeTone)}`}
                >
                  {revision.badgeLabel}
                </span>
                <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-800">Игроков: {playerCount}</span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
                  Данные доступны без Admin ID
                </span>
                {revision.excludeFromDaily && (
                  <span className="rounded-full bg-red-50 px-3 py-1 text-red-800">
                    {match.activeRevision
                      ? "Новая REJECTED-ревизия не входит в статистику дня / delivery"
                      : "Не входит в статистику дня / delivery"}
                  </span>
                )}
                {revision.badgeTone === "warning" && (
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800">Учтён в статистике дня · staging заблокирован</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-2xl font-black text-slate-950">
                  {match.officialHomeScore ?? "—"}:{match.officialAwayScore ?? "—"}
                </div>
                <div className="text-[11px] text-slate-500">
                  P1–P3: {match.regulationHomeScore ?? "—"}:{match.regulationAwayScore ?? "—"}
                </div>
              </div>
              <div className="flex min-w-24 items-center justify-end gap-2 text-xs font-black text-blue-700">
                <span className="group-open:hidden">Открыть</span>
                <span className="hidden group-open:inline">Свернуть</span>
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 transition-transform group-open:rotate-180">
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.51a.75.75 0 0 1-1.08 0l-4.25-4.51a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
                </svg>
              </div>
            </div>
          </div>
          {revision.warning && (
            <div
              data-testid="khl-revision-warning"
              className={`mt-4 rounded-2xl border p-4 text-xs ${revision.badgeTone === "warning"
                ? "border-amber-200 bg-amber-50 text-amber-950" : "border-red-200 bg-red-50 text-red-950"}`}
            >
              <div className="font-black">{revision.warning.title}</div>
              <p className="mt-1 font-semibold">{revision.warning.description}</p>
              {revision.warning.issues.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {revision.warning.issues.slice(0, 8).map((issue, index) => (
                    <li key={`${issue}:${index}`}>{issue}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </summary>
        <div className="space-y-4 border-t border-slate-200 p-5 sm:p-6">
          {onReingest && (
            <button type="button" onClick={() => onReingest(match)}
              disabled={busyKey === `sync:${match.khlGameId}`}
              className="rounded-xl border border-blue-200 px-4 py-2 text-xs font-black text-blue-700 disabled:opacity-40">
              {busyKey === `sync:${match.khlGameId}` ? "Постановка в очередь…" : "Переполучить протокол"}
            </button>
          )}
          <KhlTabs
            items={KHL_MATCH_TABS}
            value={tab}
            onChange={setTab}
            label={`Данные матча ${match.homeTeam.name} — ${match.awayTeam.name}`}
            compact
          />
          <KhlMatchProtocol protocol={match.protocol} section={tab} />
        </div>
      </details>
    </article>
  );
}

function revisionBadgeClass(tone: "validated" | "warning" | "rejected" | "empty") {
  if (tone === "validated") return "bg-emerald-50 text-emerald-800";
  if (tone === "rejected") return "bg-red-50 text-red-800";
  return "bg-amber-50 text-amber-800";
}

function DailyStatistics({ matches }: { matches: StoredMatch[] }) {
  const summary = useMemo(() => aggregateKhlGameDay(matches), [matches]);

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-slate-200 bg-slate-50/60 p-5 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">Статистика игрового дня</h2>
        <p className="mt-1 text-sm text-slate-600">
          Суммы P1–P3 за {formatMoscowDay(new Date())}. Овертаймы не увеличивают эти значения.
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-black">
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">Учтено матчей: {summary.includedMatches}</span>
          {summary.warningMatches > 0 && <span data-testid="khl-day-identity-warning" className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">Учтено с предупреждением об ID: {summary.warningMatches}</span>}
          {summary.skippedMatches > 0 && <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">Не агрегировано непроверенных: {summary.skippedMatches}</span>}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="font-black text-slate-950">Команды</h3>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="px-3 py-2 font-black">Команда</th>
                <th className="px-3 py-2 text-center font-black">Матчи</th>
                <th className="px-3 py-2 text-center font-black">Голы P1–P3</th>
                {METRIC_ORDER.map((code) => <th key={code} className="px-3 py-2 text-center font-black">{metricShortLabel(code)}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summary.teams.map((team) => {
                const metrics = new Map(team.metrics.map((metric) => [metric.code, metric.regulationTotal]));
                return (
                  <tr key={team.khlTeamId} data-testid="khl-day-team">
                    <td className="px-3 py-2"><div className="font-black text-slate-900">{team.name}</div><div className="text-[10px] text-slate-400">KHL {team.khlTeamId}</div></td>
                    <td className="px-3 py-2 text-center">{team.matchCount}</td>
                    <td className="bg-blue-50 px-3 py-2 text-center font-black text-blue-900">{team.regulationGoals}</td>
                    {METRIC_ORDER.map((code) => <td key={code} className="px-3 py-2 text-center tabular-nums">{metrics.get(code) ?? 0}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="font-black text-slate-950">Игроки</h3>
        <p className="mt-1 text-xs text-slate-500">Показаны все заявленные игроки, включая нулевые значения. Игроки без ID КХЛ показаны отдельно по каждому матчу и не объединяются по имени.</p>
        <div className="mt-3 max-h-[36rem] overflow-auto rounded-2xl border border-slate-200">
          <table className="min-w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-100 text-slate-600">
              <tr><th className="px-3 py-2 font-black">Игрок</th><th className="px-3 py-2 text-center font-black">Матчи</th><th className="px-3 py-2 text-center font-black">Голы</th><th className="px-3 py-2 text-center font-black">Передачи</th><th className="px-3 py-2 text-center font-black">Очки</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summary.players.map((player) => (
                <tr key={player.rowKey} data-testid="khl-day-player" data-identity={player.khlPlayerId === null ? "unresolved" : "resolved"}>
                  <td className="px-3 py-2"><div className="font-black text-slate-900">{player.name}</div>
                    {player.khlPlayerId === null
                      ? <div className="text-[10px] text-amber-800">ID КХЛ отсутствует · матч {player.sourceMatchId} · API {player.apiPlayerId}</div>
                      : <div className="text-[10px] text-slate-400">KHL {player.khlPlayerId} · team {player.khlTeamId}</div>}
                  </td>
                  <td className="px-3 py-2 text-center">{player.matchCount}</td>
                  <td className="px-3 py-2 text-center font-black">{player.goals}</td>
                  <td className="px-3 py-2 text-center font-black">{player.assists}</td>
                  <td className="bg-blue-50 px-3 py-2 text-center font-black text-blue-900">{player.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {summary.players.length === 0 && <div className="py-8 text-center text-sm text-slate-400">Проверенной статистики за сегодня пока нет.</div>}
      </section>
    </div>
  );
}

function metricShortLabel(code: typeof METRIC_ORDER[number]) {
  if (code === "shots_on_goal") return "Броски";
  if (code === "faceoffs_won") return "Вбрасывания";
  if (code === "power_play_goals") return "ГБ";
  return "Штраф 2/4";
}

function formatMoscowDateTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatMoscowDay(value: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    dateStyle: "long",
  }).format(value);
}
