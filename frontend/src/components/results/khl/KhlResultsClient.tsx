"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  KHL_TEAM_STATS,
  type KhlTargetBindingLabels,
  type KhlTargetBindingsTemplate,
} from "@/components/results/khl/KhlTargetBindingsForm";
import { KhlResultsWorkspace } from "@/components/results/khl/KhlResultsWorkspace";
import { KhlSettingsWorkspace } from "@/components/results/khl/KhlSettingsWorkspace";
import { KhlTabs } from "@/components/results/khl/KhlTabs";
import { KHL_ROOT_TABS, type KhlRootTab } from "@/components/results/khl/khlNavigation";
import {
  loadKhlMatchWindow,
  shouldApplyKhlMatchWindow,
} from "@/components/results/khl/khlMatchWindow";
import {
  getKhlMoscowDateKey,
  getKhlMoscowDayBounds,
} from "@/components/results/khl/khlResultsViewModel";
import type {
  ApiError,
  AutomationStatus,
  DiffState,
  MatchesResponse,
  PreviewState,
  ScheduleEvent,
  SettingsDirectory,
  SettingsPlayer,
  SettingsTeam,
  Stage,
  StoredMatch,
} from "@/components/results/khl/types";

const cutoffDateKey = "2026-05-01";
const currentDateKey = getKhlMoscowDateKey(new Date());
const defaultFrom = [cutoffDateKey, shiftDateKey(currentDateKey, -14)].sort().at(-1) || cutoffDateKey;
const defaultTo = shiftDateKey(currentDateKey, 14);

export function KhlResultsClient() {
  const [rootTab, setRootTab] = useState<KhlRootTab>("results");
  const [stages, setStages] = useState<Stage[]>([]);
  const [stageId, setStageId] = useState("");
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [storedMatches, setStoredMatches] = useState<StoredMatch[]>([]);
  const [settingsDirectory, setSettingsDirectory] = useState<SettingsDirectory | null>(null);
  const [automation, setAutomation] = useState<AutomationStatus | null>(null);
  const [hasMoreMatches, setHasMoreMatches] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bindingValues, setBindingValues] = useState<Record<string, string>>({});
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({});
  const [diffs, setDiffs] = useState<Record<string, DiffState>>({});
  const [targetJson, setTargetJson] = useState<Record<string, string>>({});
  const [targetLabels, setTargetLabels] = useState<Record<string, KhlTargetBindingLabels>>({});
  const [matchCandidateJson, setMatchCandidateJson] = useState<Record<string, string>>({});
  const loadedMatchDepthRef = useRef(100);

  const loadStoredMatches = useCallback(async (requestedCount?: number) => {
    const requestedDepth = Math.max(100, requestedCount ?? loadedMatchDepthRef.current);
    let refreshedAutomation: AutomationStatus | null = null;
    const window = await loadKhlMatchWindow(
      requestedDepth,
      async (offset, limit) => {
        const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
        const data = await requestJson<MatchesResponse>(`/api/results/khl/matches?${query}`);
        refreshedAutomation ||= data.automation;
        return data;
      }
    );
    if (!shouldApplyKhlMatchWindow(requestedDepth, loadedMatchDepthRef.current)) return;
    loadedMatchDepthRef.current = window.loadedDepth;
    setStoredMatches(window.matches);
    if (refreshedAutomation) setAutomation(refreshedAutomation);
    setHasMoreMatches(window.hasMore);
  }, []);

  const loadSettingsDirectory = useCallback(async () => {
    setSettingsDirectory(await requestJson<SettingsDirectory>("/api/results/khl/settings"));
  }, []);

  const refreshData = useCallback(async () => {
    await Promise.all([loadStoredMatches(), loadSettingsDirectory()]);
  }, [loadSettingsDirectory, loadStoredMatches]);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      requestJson<{ stages: Stage[] }>("/api/results/khl/stages"),
      requestJson<MatchesResponse>("/api/results/khl/matches?limit=100"),
      requestJson<SettingsDirectory>("/api/results/khl/settings"),
    ]).then(([stageResult, matchResult, settingsResult]) => {
      if (cancelled) return;
      const errors: string[] = [];
      if (stageResult.status === "fulfilled") {
        setStages(stageResult.value.stages);
        const preferred = stageResult.value.stages.find((stage) => stage.current)
          || stageResult.value.stages[0];
        if (preferred) setStageId(preferred.stageId);
      } else errors.push(`Stages: ${messageOf(stageResult.reason)}`);
      if (matchResult.status === "fulfilled") {
        setStoredMatches(matchResult.value.matches);
        setAutomation(matchResult.value.automation);
        setHasMoreMatches(matchResult.value.pagination.hasMore);
        loadedMatchDepthRef.current = matchResult.value.pagination.hasMore
          ? Math.max(100, matchResult.value.matches.length)
          : matchResult.value.matches.length;
      } else errors.push(`Матчи: ${messageOf(matchResult.reason)}`);
      if (settingsResult.status === "fulfilled") {
        setSettingsDirectory(settingsResult.value);
      } else errors.push(`Настройки: ${messageOf(settingsResult.reason)}`);
      if (errors.length > 0) setError(errors.join(" "));
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      refreshData().catch((cause) => setError(messageOf(cause)));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [refreshData]);

  const loadSchedule = async () => runWithLoading(async () => {
    if (!stageId) return;
    const query = new URLSearchParams({
      stageId,
      from: getKhlMoscowDayBounds(from).gte,
      to: getKhlMoscowDayBounds(to).lt,
    });
    const data = await requestJson<{ events: ScheduleEvent[] }>(
      `/api/results/khl/schedule?${query}`
    );
    setEvents(data.events);
    setMessage(`Получено матчей: ${data.events.length}`);
    await refreshData();
  });

  const ingest = async (event: ScheduleEvent) => runBusy(
    `ingest:${event.apiEventId}`,
    async () => {
      const result = await requestJson<{
        revision: { revisionNumber: number; state: string };
        idempotency: { reusedRevision: boolean; activated: boolean };
      }>("/api/results/khl/ingest", jsonPost({
        apiEventId: event.apiEventId,
        stageId: event.stageId,
      }));
      setMessage(result.idempotency.reusedRevision
        ? `Матч ${event.khlGameId}: ревизия не изменилась.`
        : `Матч ${event.khlGameId}: сохранена ревизия ${result.revision.revisionNumber}.`);
      setPreviews((current) => withoutKey(current, event.khlGameId));
      setDiffs((current) => withoutKey(current, event.khlGameId));
      await refreshData();
    }
  );

  const loadMoreMatches = async () => runBusy("matches:more", async () => {
    await loadStoredMatches(loadedMatchDepthRef.current + 100);
  });

  const toggleAutomation = async () => {
    if (!automation?.configured) return;
    const nextPaused = !automation.paused;
    await runBusy("automation:toggle", async () => {
      const result = await requestJson<{ automation: AutomationStatus }>(
        "/api/results/khl/automation",
        jsonPost({ paused: nextPaused })
      );
      setAutomation((current) => current ? { ...current, ...result.automation } : current);
      setMessage(nextPaused
        ? "Автоматическое обновление КХЛ остановлено."
        : "Автоматическое обновление КХЛ запущено.");
    });
  };

  const saveTeamBinding = async (team: SettingsTeam) => {
    const key = `team:${team.khlTeamId}`;
    const adminTeamId = (bindingValues[key] ?? team.adminTeamId ?? "").trim();
    await runBusy(key, async () => {
      await requestJson("/api/results/khl/bindings/team", jsonPost({
        khlTeamId: team.khlTeamId,
        adminTeamId,
      }));
      setMessage(`Команда ${team.name} привязана к Admin ID ${adminTeamId}.`);
      await refreshData();
    });
  };

  const saveDirectoryPlayer = async (player: SettingsPlayer) => {
    const key = `player-global:${player.khlPlayerId}`;
    const adminPlayerId = (bindingValues[key] ?? player.adminPlayerId ?? "").trim();
    if (!player.recentAppearance) {
      setError("Игрок не найден ни в одном матче после 1 мая 2026 года.");
      return;
    }
    await runBusy(key, async () => {
      await requestJson("/api/results/khl/bindings/player", jsonPost({
        khlGameId: player.recentAppearance!.khlGameId,
        khlPlayerId: player.khlPlayerId,
        adminPlayerId,
        adminMatchPlayerId: null,
      }));
      setMessage(`Игрок ${player.name} привязан постоянно к Admin ID ${adminPlayerId}.`);
      await refreshData();
    });
  };

  const saveTeamStatBindings = async (team: SettingsTeam) => {
    const key = `team-stats:${team.khlTeamId}`;
    const teamStats = Object.fromEntries(KHL_TEAM_STATS.map(([code]) => {
      const stored = team.statBindings.find((binding) => binding.semanticCode === code);
      const value = bindingValues[`${key}:${code}`] ?? stored?.adminTeamStatId ?? "";
      return [code, value.trim()];
    }));
    await runBusy(key, async () => {
      await requestJson("/api/results/khl/bindings/team-stats", jsonPost({
        khlTeamId: team.khlTeamId,
        teamStats,
      }));
      setMessage(`Статистические ID команды ${team.name} сохранены постоянно.`);
      await refreshData();
    });
  };

  const saveMatchBinding = async (match: StoredMatch) => {
    const key = `match:${match.khlGameId}`;
    const adminMatchId = (bindingValues[key] ?? match.adminMatchId ?? "").trim();
    await runBusy(key, async () => {
      const candidates = JSON.parse(matchCandidateJson[match.khlGameId] || "[]") as unknown;
      if (!Array.isArray(candidates)) {
        throw new Error("Admin match candidates JSON должен быть массивом.");
      }
      await requestJson("/api/results/khl/bindings/match", jsonPost({
        khlGameId: match.khlGameId,
        adminMatchId,
        candidates,
      }));
      setMessage(`Матч KHL ${match.khlGameId} привязан к Admin match ${adminMatchId}.`);
      await refreshData();
    }, true);
  };

  const loadTargetTemplate = async (match: StoredMatch) => runBusy(
    `targets-template:${match.khlGameId}`,
    async () => {
      const data = await requestJson<{
        template: KhlTargetBindingsTemplate;
        labels: KhlTargetBindingLabels;
      }>(`/api/results/khl/bindings/targets?khlGameId=${match.khlGameId}`);
      setTargetJson((current) => ({
        ...current,
        [match.khlGameId]: JSON.stringify(data.template, null, 2),
      }));
      setTargetLabels((current) => ({ ...current, [match.khlGameId]: data.labels }));
    }
  );

  const saveTargetPlayer = async (
    match: StoredMatch,
    player: KhlTargetBindingsTemplate["players"][number]
  ) => runBusy(`player:${match.khlGameId}:${player.khlPlayerId}`, async () => {
    await requestJson("/api/results/khl/bindings/player", jsonPost({
      khlGameId: match.khlGameId,
      khlPlayerId: player.khlPlayerId,
      adminPlayerId: player.adminPlayerId,
      adminMatchPlayerId: player.adminMatchPlayerId || null,
    }));
    setMessage(`Игрок KHL ${player.khlPlayerId} сохранён в базе.`);
    await Promise.all([loadTargetTemplate(match), loadSettingsDirectory()]);
  });

  const saveTargetBindings = async (match: StoredMatch) => runBusy(
    `targets-save:${match.khlGameId}`,
    async () => {
      const parsed = JSON.parse(targetJson[match.khlGameId] || "") as unknown;
      await requestJson("/api/results/khl/bindings/targets", jsonPost(parsed));
      setMessage(`Статистика матча ${match.khlGameId} подтверждена и сохранена.`);
      await Promise.all([
        loadTargetTemplate(match),
        loadSettingsDirectory(),
        loadPreview(match),
      ]);
    },
    true
  );

  const loadPreview = async (match: StoredMatch) => runBusy(
    `preview:${match.khlGameId}`,
    async () => {
      const preview = await requestJson<PreviewState>(
        `/api/results/khl/preview?khlGameId=${match.khlGameId}`
      );
      setPreviews((current) => ({ ...current, [match.khlGameId]: preview }));
      setMessage(preview.ready
        ? `Preview READY · ${preview.payloadHash}`
        : `Preview BLOCKED · причин: ${preview.issues.length}`);
    }
  );

  const loadDiff = async (match: StoredMatch) => runBusy(
    `diff:${match.khlGameId}`,
    async () => {
      const diff = await requestJson<DiffState>(
        `/api/results/khl/diff?khlGameId=${match.khlGameId}`
      );
      setDiffs((current) => ({ ...current, [match.khlGameId]: diff }));
      setMessage(`Diff матча ${match.khlGameId}: ${diff.status}.`);
    }
  );

  const stageDelivery = async (match: StoredMatch) => runBusy(
    `stage:${match.khlGameId}`,
    async () => {
      const preview = previews[match.khlGameId];
      if (!preview?.ready || !preview.revisionId || !preview.payloadHash) {
        throw new Error("Сначала сформируйте актуальный READY preview.");
      }
      const result = await requestJson<{
        transportExecuted: false;
        reused: boolean;
        delivery: { id: string };
      }>("/api/results/khl/delivery/stage", jsonPost({
        khlGameId: match.khlGameId,
        expectedRevisionId: preview.revisionId,
        expectedPayloadHash: preview.payloadHash,
      }));
      if (result.transportExecuted !== false) {
        throw new Error("Нарушен safety contract: staging не должен отправлять HTTP.");
      }
      const diff = await requestJson<DiffState>(
        `/api/results/khl/diff?khlGameId=${match.khlGameId}`
      );
      setDiffs((current) => ({ ...current, [match.khlGameId]: diff }));
      setMessage(result.reused
        ? `Staging ${result.delivery.id} уже существовал; HTTP не выполнялся.`
        : `Staging ${result.delivery.id} создан; HTTP не выполнялся.`);
    }
  );

  async function runBusy(
    key: string,
    action: () => Promise<void>,
    syntaxAware = false
  ) {
    setBusyKey(key);
    setError(null);
    setMessage(null);
    try {
      await action();
    } catch (cause) {
      setError(syntaxAware && cause instanceof SyntaxError
        ? "JSON содержит синтаксическую ошибку."
        : messageOf(cause));
    } finally {
      setBusyKey(null);
    }
  }

  async function runWithLoading(action: () => Promise<void>) {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      await action();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6 py-8">
      <AutomationPanel automation={automation} busyKey={busyKey} onToggle={toggleAutomation} />

      {(error || message) && (
        <div className={`rounded-2xl border px-5 py-4 text-sm font-semibold ${error
          ? "border-red-200 bg-red-50 text-red-800"
          : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
          {error || message}
        </div>
      )}

      <KhlTabs
        items={KHL_ROOT_TABS}
        value={rootTab}
        onChange={setRootTab}
        label="КХЛ: настройки или результаты"
        compact
      />

      {rootTab === "results" ? (
        <KhlResultsWorkspace
          matches={storedMatches}
          hasMoreMatches={hasMoreMatches}
          busyKey={busyKey}
          onRefresh={() => refreshData().catch((cause) => setError(messageOf(cause)))}
          onLoadMore={loadMoreMatches}
        />
      ) : (
        <KhlSettingsWorkspace
          directory={settingsDirectory}
          matches={storedMatches}
          stages={stages}
          stageId={stageId}
          from={from}
          to={to}
          events={events}
          loading={loading}
          busyKey={busyKey}
          bindingValues={bindingValues}
          matchCandidateJson={matchCandidateJson}
          targetJson={targetJson}
          targetLabels={targetLabels}
          previews={previews}
          diffs={diffs}
          onStageIdChange={setStageId}
          onFromChange={setFrom}
          onToChange={setTo}
          onLoadSchedule={loadSchedule}
          onIngest={ingest}
          onBindingValueChange={(key, value) => setBindingValues((current) => ({
            ...current,
            [key]: value,
          }))}
          onMatchCandidateChange={(id, value) => setMatchCandidateJson((current) => ({
            ...current,
            [id]: value,
          }))}
          onTargetJsonChange={(id, value) => setTargetJson((current) => ({
            ...current,
            [id]: value,
          }))}
          onSaveTeam={saveTeamBinding}
          onSaveTeamStats={saveTeamStatBindings}
          onSavePlayer={saveDirectoryPlayer}
          onSaveMatch={saveMatchBinding}
          onLoadTargetTemplate={loadTargetTemplate}
          onSaveTargetBindings={saveTargetBindings}
          onConfirmTargetPlayer={saveTargetPlayer}
          onLoadPreview={loadPreview}
          onLoadDiff={loadDiff}
          onStageDelivery={stageDelivery}
        />
      )}
    </main>
  );
}

function AutomationPanel({
  automation,
  busyKey,
  onToggle,
}: {
  automation: AutomationStatus | null;
  busyKey: string | null;
  onToggle: () => void;
}) {
  const tone = automation?.enabled ? "emerald" : automation?.paused ? "red" : "amber";
  return (
    <section className={`rounded-3xl border p-5 shadow-sm ${tone === "emerald"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "red"
        ? "border-red-200 bg-red-50"
        : "border-amber-200 bg-amber-50"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black text-slate-950">
            {automation?.enabled
              ? "Автоматическое обновление включено"
              : automation?.paused
                ? "Автоматическое обновление остановлено"
                : "Автоматическое обновление не настроено"}
          </h2>
          <p className="mt-1 text-xs text-slate-700">
            Только завершённые матчи с 01.05.2026 · каждые {automation?.intervalMinutes || 10} минут · последнее получение: {automation?.lastFetchedAt ? formatMoscowDateTime(automation.lastFetchedAt) : "ещё не выполнялось"}
          </p>
        </div>
        {automation?.configured && (
          <button
            type="button"
            onClick={onToggle}
            disabled={busyKey === "automation:toggle"}
            className={`rounded-xl px-4 py-2 text-xs font-black text-white disabled:opacity-40 ${automation.paused ? "bg-emerald-700" : "bg-red-700"}`}
          >
            {busyKey === "automation:toggle"
              ? "Сохранение…"
              : automation.paused
                ? "Запустить автообновление"
                : "Остановить автообновление"}
          </button>
        )}
      </div>
    </section>
  );
}

function jsonPost(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function requestJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({})) as ApiError & T;
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function withoutKey<T>(state: Record<string, T>, key: string) {
  return Object.fromEntries(
    Object.entries(state).filter(([candidate]) => candidate !== key)
  ) as Record<string, T>;
}

function messageOf(value: unknown) {
  return value instanceof Error ? value.message : "Неизвестная ошибка";
}

function shiftDateKey(value: string, days: number) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatMoscowDateTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
