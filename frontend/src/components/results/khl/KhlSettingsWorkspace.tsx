"use client";

import { useEffect, useMemo, useState } from "react";

import {
  KhlAdminDirectoryPicker,
  KhlTargetBindingsForm,
  type KhlTargetBindingLabels,
  type KhlTargetBindingsTemplate,
} from "@/components/results/khl/KhlTargetBindingsForm";
import { KhlTabs } from "@/components/results/khl/KhlTabs";
import {
  filterKhlSettingsTeamPlayerGroups,
  groupKhlSettingsPlayersByTeam,
} from "@/components/results/khl/khlSettingsViewModel";
import {
  KHL_EXTRA_MAPPING_DRAFTS,
  KHL_SETTINGS_TABS,
  type KhlSettingsTab,
} from "@/components/results/khl/khlNavigation";
import type {
  DiffState,
  PreviewState,
  ScheduleEvent,
  SettingsDirectory,
  SettingsPlayer,
  SettingsTeam,
  Stage,
  StoredMatch,
} from "@/components/results/khl/types";

type StatTypeValues = Record<"TEAM" | "PLAYER", Record<string, string>>;

type Props = {
  directory: SettingsDirectory | null;
  matches: StoredMatch[];
  stages: Stage[];
  stageId: string;
  from: string;
  to: string;
  events: ScheduleEvent[];
  loading: boolean;
  busyKey: string | null;
  bindingValues: Record<string, string>;
  matchCandidateJson: Record<string, string>;
  targetJson: Record<string, string>;
  targetLabels: Record<string, KhlTargetBindingLabels>;
  previews: Record<string, PreviewState>;
  diffs: Record<string, DiffState>;
  onStageIdChange: (value: string) => void;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onLoadSchedule: () => void;
  onIngest: (event: ScheduleEvent) => void;
  onBindingValueChange: (key: string, value: string) => void;
  onMatchCandidateChange: (khlGameId: string, value: string) => void;
  onTargetJsonChange: (khlGameId: string, value: string) => void;
  onSaveTeam: (team: SettingsTeam) => void;
  onSavePlayer: (player: SettingsPlayer) => void;
  onSaveMatch: (match: StoredMatch) => void;
  onSaveStatTypes: (values: StatTypeValues) => void;
  onLoadTargetTemplate: (match: StoredMatch) => void;
  onSaveTargetBindings: (match: StoredMatch) => void;
  onConfirmTargetPlayer: (
    match: StoredMatch,
    player: KhlTargetBindingsTemplate["players"][number]
  ) => void;
  onLoadPreview: (match: StoredMatch) => void;
  onLoadDiff: (match: StoredMatch) => void;
  onStageDelivery: (match: StoredMatch) => void;
};

const STAT_LABELS: Record<string, string> = {
  shots_on_goal: "Броски в створ",
  faceoffs_won: "Выигранные вбрасывания",
  power_play_goals: "Голы в большинстве",
  penalty_minutes_2_4: "Штрафные минуты 2/4",
  goals: "Голы игроков",
  assists: "Передачи игроков",
  points: "Очки игроков",
};

export function KhlSettingsWorkspace(props: Props) {
  const [tab, setTab] = useState<KhlSettingsTab>("teams-players");

  return (
    <section data-testid="khl-settings-workspace" className="space-y-5">
      <KhlTabs
        items={KHL_SETTINGS_TABS}
        value={tab}
        onChange={setTab}
        label="Разделы настроек КХЛ"
      />
      {tab === "teams-players" && <TeamsPlayersSettings {...props} />}
      {tab === "matches" && <MatchesSettings {...props} />}
      {tab === "statistics" && <StatisticsSettings {...props} />}
      {tab === "extras" && <ExtrasSettings />}
    </section>
  );
}

function TeamsPlayersSettings({
  directory,
  busyKey,
  bindingValues,
  onBindingValueChange,
  onSaveTeam,
  onSavePlayer,
}: Props) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const groups = useMemo(() => filterKhlSettingsTeamPlayerGroups(
    groupKhlSettingsPlayersByTeam(directory?.players || [], directory?.teams || []),
    query,
    status
  ), [directory?.players, directory?.teams, query, status]);

  return (
    <SettingsPanel
      title="Команды и игроки"
      description="Сначала подтвердите Admin team ID. После этого раскроется список игроков команды; подтверждённые team/player ID сохраняются в базе и подставляются в следующих матчах."
    >
      <DirectoryFilters
        query={query}
        onQueryChange={setQuery}
        status={status}
        onStatusChange={setStatus}
        placeholder="Команда, игрок, KHL ID или Admin ID"
      />
      <div className="mt-4 space-y-3">
        {groups.map((group) => {
          const team = group.team;
          const teamKey = team ? `team:${team.khlTeamId}` : null;
          const teamConfirmed = team?.adminBindingStatus === "CONFIRMED";
          return (
            <article
              key={group.key}
              data-testid="khl-team-player-group"
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
            >
              <div className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="font-black text-slate-950">{group.teamName}</h4>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {team
                        ? `KHL ${team.khlTeamId} · ${team.location || "город не указан"} · матчей: ${team.matchCount}`
                        : "Команда игрока не определена"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-bold text-blue-700">
                      Игроков: {group.players.length}
                    </span>
                    <BindingBadge status={team?.adminBindingStatus || "UNMAPPED"} />
                  </div>
                </div>
                {team && teamKey && (
                  <>
                    <div className="mt-3">
                      <KhlAdminDirectoryPicker
                        defaultQuery={team.name}
                        disabled={teamConfirmed}
                        placeholder="Название команды или Admin ID"
                        onSelect={(suggestion) => onBindingValueChange(teamKey, suggestion.platformId)}
                      />
                    </div>
                    <div className="mt-3 flex gap-2">
                      <input
                        value={bindingValues[teamKey] ?? team.adminTeamId ?? ""}
                        disabled={teamConfirmed}
                        onChange={(event) => onBindingValueChange(teamKey, event.target.value)}
                        placeholder="Admin team ID"
                        className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs disabled:bg-emerald-50"
                      />
                      <button
                        type="button"
                        onClick={() => onSaveTeam(team)}
                        disabled={teamConfirmed || busyKey === teamKey}
                        className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white disabled:opacity-40"
                      >
                        {teamConfirmed ? "Сохранено" : busyKey === teamKey ? "Сохранение…" : "Подтвердить команду"}
                      </button>
                    </div>
                  </>
                )}
              </div>
              {group.playersUnlocked ? (
                <details data-testid="khl-team-players-disclosure" className="group border-t border-slate-200">
                  <summary
                    data-testid="khl-team-players-summary"
                    className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 bg-slate-50/70 px-4 py-3 text-xs font-black text-slate-800 hover:bg-slate-100 [&::-webkit-details-marker]:hidden"
                  >
                    <span>Игроки команды</span>
                    <span className="flex items-center gap-2">
                      <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">
                        Привязано: {group.confirmedCount} из {group.players.length}
                      </span>
                      <span className="min-w-16 text-right text-blue-700">
                        <span className="group-open:hidden">Открыть</span>
                        <span className="hidden group-open:inline">Свернуть</span>
                      </span>
                    </span>
                  </summary>
                  <div className="grid gap-3 bg-slate-50/60 p-4 xl:grid-cols-2">
                    {group.players.map((player) => (
                      <PlayerBindingCard
                        key={player.khlPlayerId}
                        player={player}
                        busyKey={busyKey}
                        bindingValues={bindingValues}
                        onBindingValueChange={onBindingValueChange}
                        onSavePlayer={onSavePlayer}
                      />
                    ))}
                    {group.players.length === 0 && (
                      <div className="xl:col-span-2"><EmptyState text="У команды пока нет сохранённых игроков КХЛ." /></div>
                    )}
                  </div>
                </details>
              ) : (
                <div data-testid="khl-team-players-locked" className="border-t border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-900">
                  Сначала подтвердите Admin team ID — после этого можно раскрыть и привязать игроков этой команды.
                </div>
              )}
            </article>
          );
        })}
      </div>
      {groups.length === 0 && <EmptyState text="Команды и игроки по выбранному фильтру не найдены." />}
    </SettingsPanel>
  );
}

function PlayerBindingCard({
  player,
  busyKey,
  bindingValues,
  onBindingValueChange,
  onSavePlayer,
}: Pick<Props, "busyKey" | "bindingValues" | "onBindingValueChange" | "onSavePlayer"> & {
  player: SettingsPlayer;
}) {
  const key = `player-global:${player.khlPlayerId}`;
  const confirmed = player.adminBindingStatus === "CONFIRMED";
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h5 className="font-black text-slate-950">{player.name}</h5>
          <p className="mt-1 text-[11px] text-slate-500">
            KHL {player.khlPlayerId} · {player.role || "роль не указана"} · матчей: {player.matchCount}
          </p>
          {player.recentAppearance && (
            <p className="mt-1 text-[11px] font-bold text-blue-700">
              Последний матч KHL {player.recentAppearance.khlGameId}
            </p>
          )}
        </div>
        <BindingBadge status={player.adminBindingStatus} />
      </div>
      <div className="mt-3">
        <KhlAdminDirectoryPicker
          defaultQuery={player.name}
          disabled={confirmed}
          placeholder="Фамилия, имя или Admin ID"
          onSelect={(suggestion) => onBindingValueChange(key, suggestion.platformId)}
        />
      </div>
      <div className="mt-3 flex gap-2">
        <input
          value={bindingValues[key] ?? player.adminPlayerId ?? ""}
          disabled={confirmed}
          onChange={(event) => onBindingValueChange(key, event.target.value)}
          placeholder="Admin player ID"
          className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs disabled:bg-emerald-50"
        />
        <button
          type="button"
          onClick={() => onSavePlayer(player)}
          disabled={confirmed || !player.recentAppearance || busyKey === key}
          className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white disabled:opacity-40"
        >
          {confirmed ? "Сохранено" : busyKey === key ? "Сохранение…" : "Подтвердить игрока"}
        </button>
      </div>
    </article>
  );
}

function MatchesSettings(props: Props) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLocaleLowerCase("ru-RU");
  const matches = props.matches.filter((match) => !normalized || [
    match.khlGameId,
    match.adminMatchId || "",
    match.homeTeam.name,
    match.awayTeam.name,
  ].some((value) => value.toLocaleLowerCase("ru-RU").includes(normalized)));

  return (
    <div className="space-y-5">
      <ManualSchedule {...props} />
      <SettingsPanel
        title="Привязка матчей"
        description="Admin match ID подтверждается отдельно от команд и статистики. Resolver по-прежнему блокирует ноль или несколько кандидатов."
      >
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Команды, KHL game ID или Admin match ID"
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm"
        />
        <div className="mt-4 space-y-3">
          {matches.map((match) => (
            <MatchBindingCard key={match.id} match={match} {...props} />
          ))}
        </div>
        {matches.length === 0 && <EmptyState text="Матчи по выбранному фильтру не найдены." />}
      </SettingsPanel>
    </div>
  );
}

function MatchBindingCard({
  match,
  busyKey,
  bindingValues,
  matchCandidateJson,
  previews,
  diffs,
  onBindingValueChange,
  onMatchCandidateChange,
  onSaveMatch,
  onLoadPreview,
  onLoadDiff,
  onStageDelivery,
}: Props & { match: StoredMatch }) {
  const teamsMapped = match.homeTeam.adminBindingStatus === "CONFIRMED"
    && match.awayTeam.adminBindingStatus === "CONFIRMED";
  const preview = previews[match.khlGameId];
  const diff = diffs[match.khlGameId];
  const key = `match:${match.khlGameId}`;

  return (
    <details className="rounded-2xl border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-black text-slate-950">{match.homeTeam.name} — {match.awayTeam.name}</div>
            <div className="mt-1 text-[11px] text-slate-500">
              {formatMoscowDateTime(match.startsAt)} · KHL {match.khlGameId}
            </div>
          </div>
          <BindingBadge status={match.adminBindingStatus} />
        </div>
      </summary>
      <div className="mt-4 border-t border-slate-100 pt-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
          <label className="text-xs font-bold text-slate-600">
            Admin match ID
            <input
              value={bindingValues[key] ?? match.adminMatchId ?? ""}
              onChange={(event) => onBindingValueChange(key, event.target.value)}
              placeholder="Admin match ID"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => onSaveMatch(match)}
            disabled={!teamsMapped || busyKey === key}
            className="rounded-xl bg-blue-700 px-5 py-2.5 text-xs font-black text-white disabled:opacity-40"
          >
            {busyKey === key ? "Проверка…" : "Подтвердить матч"}
          </button>
        </div>
        <label className="mt-3 block text-xs font-bold text-slate-600">
          Read-only Admin match candidates JSON
          <textarea
            value={matchCandidateJson[match.khlGameId] ?? ""}
            onChange={(event) => onMatchCandidateChange(match.khlGameId, event.target.value)}
            placeholder="[]"
            spellCheck={false}
            className="mt-1 h-28 w-full rounded-xl border border-slate-200 bg-slate-950 p-3 font-mono text-xs text-slate-100"
          />
        </label>
        {!teamsMapped && <p className="mt-2 text-xs font-bold text-amber-700">Сначала подтвердите обе команды во вкладке «Команды».</p>}
        <DeliveryControls
          match={match}
          busyKey={busyKey}
          preview={preview}
          diff={diff}
          onLoadPreview={onLoadPreview}
          onLoadDiff={onLoadDiff}
          onStageDelivery={onStageDelivery}
        />
      </div>
    </details>
  );
}

function StatisticsSettings(props: Props) {
  const [selectedId, setSelectedId] = useState("");
  const selected = props.matches.find((match) => match.khlGameId === selectedId)
    || props.matches[0]
    || null;
  useEffect(() => {
    if (!selectedId && props.matches[0]) setSelectedId(props.matches[0].khlGameId);
  }, [props.matches, selectedId]);

  return (
    <div className="space-y-5">
      <StatTypeSettings {...props} />
      <SettingsPanel
        title="Целевые записи статистики по матчу и команде"
        description="У хозяев и гостей разные Admin target record ID. Игровые target ID также сохраняются для конкретного участника матча."
      >
        <select
          value={selected?.khlGameId || ""}
          onChange={(event) => setSelectedId(event.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold"
        >
          {props.matches.map((match) => (
            <option key={match.khlGameId} value={match.khlGameId}>
              {formatMoscowDateTime(match.startsAt)} · {match.homeTeam.name} — {match.awayTeam.name} · KHL {match.khlGameId}
            </option>
          ))}
        </select>
        {selected ? <TargetBindingEditor match={selected} {...props} /> : <EmptyState text="Сохранённых матчей пока нет." />}
      </SettingsPanel>
    </div>
  );
}

function StatTypeSettings({ directory, busyKey, onSaveStatTypes }: Props) {
  const [values, setValues] = useState<StatTypeValues>({ TEAM: {}, PLAYER: {} });
  useEffect(() => {
    setValues((current) => {
      const next: StatTypeValues = {
        TEAM: { ...current.TEAM },
        PLAYER: { ...current.PLAYER },
      };
      for (const mapping of directory?.statMappings || []) {
        if (
          mapping.adminBindingStatus === "CONFIRMED"
          || next[mapping.scope][mapping.semanticCode] === undefined
        ) {
          next[mapping.scope][mapping.semanticCode] = mapping.adminStatTypeId || "";
        }
      }
      return next;
    });
  }, [directory?.statMappings]);
  const mappings = directory?.statMappings || [];
  const complete = mappings.length === 7 && mappings.every((mapping) => (
    Boolean((values[mapping.scope][mapping.semanticCode] || "").trim())
  ));

  return (
    <SettingsPanel
      title="Типы статистики Admin"
      description="Semantic type ID задаётся один раз. Это отдельная привязка; конкретные записи каждой команды задаются ниже."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {(["TEAM", "PLAYER"] as const).map((scope) => (
          <div key={scope} className="rounded-2xl border border-slate-200 bg-white p-4">
            <h4 className="text-xs font-black uppercase tracking-wide text-violet-700">
              {scope === "TEAM" ? "Командная статистика" : "Статистика игроков"}
            </h4>
            <div className="mt-3 space-y-3">
              {mappings.filter((mapping) => mapping.scope === scope).map((mapping) => {
                const confirmed = mapping.adminBindingStatus === "CONFIRMED";
                return (
                  <label key={mapping.semanticCode} className="block text-xs font-bold text-slate-600">
                    {STAT_LABELS[mapping.semanticCode] || mapping.semanticCode}
                    <span className="ml-2 font-mono text-[9px] text-slate-400">{mapping.semanticCode}</span>
                    <input
                      value={values[scope][mapping.semanticCode] || ""}
                      disabled={confirmed}
                      onChange={(event) => setValues((current) => ({
                        ...current,
                        [scope]: { ...current[scope], [mapping.semanticCode]: event.target.value },
                      }))}
                      placeholder="Admin stat type ID"
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs disabled:bg-emerald-50"
                    />
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onSaveStatTypes(values)}
        disabled={!complete || busyKey === "stat-types:save"}
        className="mt-4 rounded-xl bg-violet-700 px-5 py-2.5 text-xs font-black text-white disabled:opacity-40"
      >
        {busyKey === "stat-types:save" ? "Сохранение…" : "Подтвердить типы статистики"}
      </button>
    </SettingsPanel>
  );
}

function TargetBindingEditor({
  match,
  busyKey,
  targetJson,
  targetLabels,
  onTargetJsonChange,
  onLoadTargetTemplate,
  onSaveTargetBindings,
  onConfirmTargetPlayer,
}: Props & { match: StoredMatch }) {
  const template = parseTargetTemplate(targetJson[match.khlGameId]);
  const labels = targetLabels[match.khlGameId];
  const readyForTemplate = match.adminBindingStatus === "CONFIRMED"
    && match.homeTeam.adminBindingStatus === "CONFIRMED"
    && match.awayTeam.adminBindingStatus === "CONFIRMED";

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onLoadTargetTemplate(match)}
          disabled={!readyForTemplate || busyKey === `targets-template:${match.khlGameId}`}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-700 disabled:opacity-40"
        >
          {busyKey === `targets-template:${match.khlGameId}` ? "Загрузка…" : "Загрузить сохранённые IDs"}
        </button>
        <button
          type="button"
          onClick={() => onSaveTargetBindings(match)}
          disabled={!template || busyKey === `targets-save:${match.khlGameId}`}
          className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-black text-white disabled:opacity-40"
        >
          {busyKey === `targets-save:${match.khlGameId}` ? "Проверка…" : "Подтвердить target IDs"}
        </button>
      </div>
      {!readyForTemplate && (
        <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-800">
          Сначала подтвердите команды и матч в соответствующих вкладках.
        </p>
      )}
      {template && labels && (
        <KhlTargetBindingsForm
          template={template}
          labels={labels}
          protocol={match.protocol}
          busyKey={busyKey}
          showStatTypes={false}
          onChange={(next) => onTargetJsonChange(match.khlGameId, JSON.stringify(next, null, 2))}
          onConfirmPlayer={(player) => onConfirmTargetPlayer(match, player)}
        />
      )}
    </div>
  );
}

function ManualSchedule({
  stages,
  stageId,
  from,
  to,
  events,
  loading,
  busyKey,
  onStageIdChange,
  onFromChange,
  onToChange,
  onLoadSchedule,
  onIngest,
}: Props) {
  return (
    <details className="rounded-3xl border border-slate-200 bg-white shadow-sm">
      <summary className="cursor-pointer list-none px-6 py-5 text-sm font-black text-slate-700">
        Ручная проверка расписания · резервный режим
      </summary>
      <div className="border-t border-slate-100 p-6">
        <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_auto]">
          <select value={stageId} onChange={(event) => onStageIdChange(event.target.value)} className="rounded-xl border border-slate-200 px-4 py-3 text-sm">
            <option value="">Выберите этап</option>
            {stages.map((stage) => <option key={stage.stageId} value={stage.stageId}>{stage.season} · {stage.title}</option>)}
          </select>
          <input type="date" min="2026-05-01" value={from} onChange={(event) => onFromChange(event.target.value)} className="rounded-xl border border-slate-200 px-4 py-3 text-sm" />
          <input type="date" min="2026-05-01" value={to} onChange={(event) => onToChange(event.target.value)} className="rounded-xl border border-slate-200 px-4 py-3 text-sm" />
          <button type="button" onClick={onLoadSchedule} disabled={loading || !stageId} className="rounded-xl bg-blue-700 px-5 py-3 text-sm font-black text-white disabled:opacity-40">
            {loading ? "Загрузка…" : "Получить"}
          </button>
        </div>
        <div className="mt-4 space-y-2">
          {events.map((event) => (
            <div key={event.apiEventId} className="grid items-center gap-3 rounded-xl bg-slate-50 p-3 md:grid-cols-[1fr_auto_auto]">
              <div>
                <div className="text-sm font-black">{event.teams.home.name} — {event.teams.away.name}</div>
                <div className="text-[11px] text-slate-500">{formatMoscowDateTime(event.startsAt)} · KHL {event.khlGameId}</div>
              </div>
              <div className="font-black">{event.score.home}:{event.score.away}</div>
              <button type="button" onClick={() => onIngest(event)} disabled={busyKey === `ingest:${event.apiEventId}`} className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-black text-white disabled:opacity-40">
                {busyKey === `ingest:${event.apiEventId}` ? "Сохранение…" : "Ingest / обновить"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}

function ExtrasSettings() {
  return (
    <SettingsPanel
      title="Дополнительные привязки"
      description="Раздел уже отделён от матчей и статистики. Поля ID появятся после согласования точного списка событий и их Admin-контракта."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {KHL_EXTRA_MAPPING_DRAFTS.map((item) => (
          <div key={item.id} className="rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-4">
            <div className="font-black text-amber-950">{item.label}</div>
            <div className="mt-2 text-xs font-bold text-amber-700">Будет настроено на следующем этапе</div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-slate-500">
        Сюда можно будет добавить другие дополнительные показатели без изменения разделов команд, матчей и основной статистики.
      </p>
    </SettingsPanel>
  );
}

function DeliveryControls({
  match,
  busyKey,
  preview,
  diff,
  onLoadPreview,
  onLoadDiff,
  onStageDelivery,
}: {
  match: StoredMatch;
  busyKey: string | null;
  preview?: PreviewState;
  diff?: DiffState;
  onLoadPreview: (match: StoredMatch) => void;
  onLoadDiff: (match: StoredMatch) => void;
  onStageDelivery: (match: StoredMatch) => void;
}) {
  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-sm font-black text-slate-900">Preview / diff / staging без HTTP-отправки</div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => onLoadPreview(match)} disabled={busyKey === `preview:${match.khlGameId}`} className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-800 disabled:opacity-40">Preview</button>
        <button type="button" onClick={() => onLoadDiff(match)} disabled={busyKey === `diff:${match.khlGameId}`} className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-black text-violet-800 disabled:opacity-40">Diff</button>
        <button type="button" onClick={() => onStageDelivery(match)} disabled={!preview?.ready || busyKey === `stage:${match.khlGameId}`} className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-black text-white disabled:opacity-40">Staging без отправки</button>
      </div>
      {preview && (
        <div className={`mt-3 rounded-xl p-3 text-xs ${preview.ready ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}>
          <div className="font-black">{preview.ready ? "READY" : `BLOCKED · ${preview.issues.length}`}</div>
          {preview.payloadHash && <div className="mt-1 break-all">SHA-256 {preview.payloadHash}</div>}
          {!preview.ready && <ul className="mt-2 list-disc pl-5">{preview.issues.slice(0, 8).map((issue, index) => <li key={`${issue}:${index}`}>{issue}</li>)}</ul>}
          {preview.ready && preview.payload !== undefined && (
            <details className="mt-2"><summary className="cursor-pointer font-bold">Canonical payload</summary><pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 text-[10px] text-slate-100">{JSON.stringify(preview.payload, null, 2)}</pre></details>
          )}
        </div>
      )}
      {diff && (
        <div className="mt-3 rounded-xl bg-violet-100 p-3 text-xs text-violet-950">
          <div className="font-black">DIFF · {diff.status}</div>
          {diff.currentPayloadHash && <div className="mt-1 break-all">Current SHA-256: {diff.currentPayloadHash}</div>}
          {diff.baseline && <div className="mt-1 break-all">Baseline: {diff.baseline.payloadHash}</div>}
          {diff.changes.length > 0 && <div className="mt-2">Изменений: {diff.changes.length}{diff.truncated ? "+" : ""}</div>}
        </div>
      )}
    </div>
  );
}

function DirectoryFilters({
  query,
  onQueryChange,
  status,
  onStatusChange,
  placeholder,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  status: string;
  onStatusChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
      <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={placeholder} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm" />
      <select value={status} onChange={(event) => onStatusChange(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold">
        <option value="ALL">Все привязки</option>
        <option value="UNMAPPED">Не привязаны</option>
        <option value="CONFIRMED">Подтверждены</option>
      </select>
    </div>
  );
}

function SettingsPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-slate-50/60 p-5 shadow-sm sm:p-6">
      <h3 className="text-lg font-black text-slate-950">{title}</h3>
      <p className="mt-1 mb-4 text-sm text-slate-600">{description}</p>
      {children}
    </section>
  );
}

function BindingBadge({ status }: { status: string }) {
  const confirmed = status === "CONFIRMED";
  return <span className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-black ${confirmed ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{confirmed ? "Привязано" : "Не привязано"}</span>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="mt-4 rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">{text}</div>;
}

function parseTargetTemplate(value: string | undefined): KhlTargetBindingsTemplate | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<KhlTargetBindingsTemplate>;
    if (!parsed || typeof parsed !== "object" || typeof parsed.khlGameId !== "string" || !parsed.teamStatTypes || !parsed.playerStatTypes || !parsed.teams?.home || !parsed.teams.away || !Array.isArray(parsed.players)) return null;
    return parsed as KhlTargetBindingsTemplate;
  } catch {
    return null;
  }
}

function formatMoscowDateTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
