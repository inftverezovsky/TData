"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Stage = {
  stageId: string;
  khlStageId: string;
  title: string;
  type: string;
  season: string;
  current: boolean;
};

type ScheduleEvent = {
  apiEventId: string;
  khlGameId: string;
  stageId: string;
  name: string;
  startsAt: string;
  status: string;
  score: { home: number; away: number };
  teams: {
    home: { khlTeamId: string; name: string };
    away: { khlTeamId: string; name: string };
  };
};

type StoredTeam = {
  khlTeamId: string;
  name: string;
  adminTeamId: string | null;
  adminBindingStatus: string;
};

type StoredMatch = {
  id: string;
  khlGameId: string;
  stageId: string;
  season: string;
  startsAt: string;
  status: string;
  officialHomeScore: number | null;
  officialAwayScore: number | null;
  regulationHomeScore: number | null;
  regulationAwayScore: number | null;
  adminMatchId: string | null;
  adminBindingStatus: string;
  homeTeam: StoredTeam;
  awayTeam: StoredTeam;
  activeRevision: {
    revisionNumber: number;
    state: string;
    normalizedHash: string;
    validationIssues: unknown;
  } | null;
  _count: { revisions: number; participants: number };
};

type ApiError = { error?: string; code?: string };
type PreviewState = {
  ready: boolean;
  issues: string[];
  revisionId?: string;
  payloadHash?: string;
  payload?: unknown;
};

type DiffState = {
  status: "BLOCKED" | "NEW" | "UNCHANGED" | "CHANGED";
  issues: string[];
  currentPayloadHash: string | null;
  baseline: null | {
    deliveryId: string;
    payloadHash: string;
    endpointVersion: string;
    state: string;
    createdAt: string;
  };
  changes: Array<{ path: string; before: unknown; after: unknown }>;
  truncated: boolean;
};

const today = new Date();
const defaultFrom = toDateInput(new Date(today.getTime() - 14 * 86_400_000));
const defaultTo = toDateInput(new Date(today.getTime() + 14 * 86_400_000));

export function KhlResultsClient() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [stageId, setStageId] = useState("");
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [storedMatches, setStoredMatches] = useState<StoredMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bindingValues, setBindingValues] = useState<Record<string, string>>({});
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({});
  const [diffs, setDiffs] = useState<Record<string, DiffState>>({});
  const [targetJson, setTargetJson] = useState<Record<string, string>>({});
  const [matchCandidateJson, setMatchCandidateJson] = useState<Record<string, string>>({});

  const selectedStage = useMemo(
    () => stages.find((stage) => String(stage.stageId) === stageId),
    [stageId, stages]
  );

  const loadStoredMatches = useCallback(async () => {
    const data = await requestJson<{ matches: StoredMatch[] }>("/api/results/khl/matches");
    setStoredMatches(data.matches);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      requestJson<{ stages: Stage[] }>("/api/results/khl/stages"),
      requestJson<{ matches: StoredMatch[] }>("/api/results/khl/matches"),
    ]).then(([stageResult, matchResult]) => {
      if (cancelled) return;
      const errors: string[] = [];
      if (stageResult.status === "fulfilled") {
        setStages(stageResult.value.stages);
        const preferred = stageResult.value.stages.find((stage) => stage.current)
          || stageResult.value.stages[0];
        if (preferred) setStageId(preferred.stageId);
      } else {
        errors.push(`Stages: ${messageOf(stageResult.reason)}`);
      }
      if (matchResult.status === "fulfilled") {
        setStoredMatches(matchResult.value.matches);
      } else {
        errors.push(`Сохранённые матчи: ${messageOf(matchResult.reason)}`);
      }
      if (errors.length > 0) setError(errors.join(" "));
    });
    return () => { cancelled = true; };
  }, []);

  const loadSchedule = async () => {
    if (!stageId) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const fromIso = new Date(`${from}T00:00:00.000Z`).toISOString();
      const toIso = new Date(`${to}T23:59:59.999Z`).toISOString();
      const query = new URLSearchParams({ stageId, from: fromIso, to: toIso });
      const data = await requestJson<{ events: ScheduleEvent[] }>(
        `/api/results/khl/schedule?${query}`
      );
      setEvents(data.events);
      setMessage(`Получено матчей: ${data.events.length}`);
      await loadStoredMatches();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setLoading(false);
    }
  };

  const ingest = async (event: ScheduleEvent) => {
    const key = `ingest:${event.apiEventId}`;
    setBusyKey(key);
    setError(null);
    setMessage(null);
    try {
      const result = await requestJson<{
        revision: { revisionNumber: number; state: string };
        idempotency: { reusedRevision: boolean; activated: boolean };
      }>("/api/results/khl/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiEventId: event.apiEventId, stageId: event.stageId }),
      });
      setMessage(
        result.idempotency.reusedRevision
          ? `Матч ${event.khlGameId}: ревизия не изменилась.`
          : `Матч ${event.khlGameId}: сохранена ревизия ${result.revision.revisionNumber} (${result.revision.state}).`
      );
      setPreviews((state) => withoutKey(state, event.khlGameId));
      setDiffs((state) => withoutKey(state, event.khlGameId));
      await loadStoredMatches();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusyKey(null);
    }
  };

  const saveTeamBinding = async (team: StoredTeam) => {
    const key = `team:${team.khlTeamId}`;
    const value = (bindingValues[key] ?? team.adminTeamId ?? "").trim();
    setBusyKey(key);
    setError(null);
    try {
      await requestJson(`/api/results/khl/bindings/team`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ khlTeamId: team.khlTeamId, adminTeamId: value }),
      });
      setMessage(`Команда ${team.name} привязана к Admin ID ${value}.`);
      await loadStoredMatches();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusyKey(null);
    }
  };

  const saveMatchBinding = async (match: StoredMatch) => {
    const key = `match:${match.khlGameId}`;
    const value = (bindingValues[key] ?? match.adminMatchId ?? "").trim();
    setBusyKey(key);
    setError(null);
    try {
      const candidates = JSON.parse(matchCandidateJson[match.khlGameId] || "") as unknown;
      if (!Array.isArray(candidates)) {
        throw new Error("Admin match candidates JSON должен быть массивом.");
      }
      await requestJson(`/api/results/khl/bindings/match`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ khlGameId: match.khlGameId, adminMatchId: value, candidates }),
      });
      setMessage(`Матч KHL ${match.khlGameId} привязан к Admin match ${value}.`);
      await loadStoredMatches();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusyKey(null);
    }
  };

  const loadPreview = async (match: StoredMatch) => {
    const key = `preview:${match.khlGameId}`;
    setBusyKey(key);
    setError(null);
    try {
      const preview = await requestJson<PreviewState>(
        `/api/results/khl/preview?khlGameId=${match.khlGameId}`
      );
      setPreviews((state) => ({ ...state, [match.khlGameId]: preview }));
      setMessage(preview.ready
        ? `Preview готов. Payload hash: ${preview.payloadHash}`
        : `Preview заблокирован: ${preview.issues.length} причин.`);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusyKey(null);
    }
  };

  const loadDiff = async (match: StoredMatch) => {
    const key = `diff:${match.khlGameId}`;
    setBusyKey(key);
    setError(null);
    try {
      const diff = await requestJson<DiffState>(
        `/api/results/khl/diff?khlGameId=${match.khlGameId}`
      );
      setDiffs((state) => ({ ...state, [match.khlGameId]: diff }));
      setMessage(`Diff матча ${match.khlGameId}: ${diff.status}.`);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusyKey(null);
    }
  };

  const stageDelivery = async (match: StoredMatch) => {
    const key = `stage:${match.khlGameId}`;
    setBusyKey(key);
    setError(null);
    try {
      const preview = previews[match.khlGameId];
      if (!preview?.ready || !preview.revisionId || !preview.payloadHash) {
        throw new Error("Сначала сформируйте актуальный READY preview.");
      }
      const result = await requestJson<{
        transportExecuted: false;
        reused: boolean;
        delivery: { id: string; payloadHash: string; state: string };
      }>("/api/results/khl/delivery/stage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          khlGameId: match.khlGameId,
          expectedRevisionId: preview.revisionId,
          expectedPayloadHash: preview.payloadHash,
        }),
      });
      if (result.transportExecuted !== false) {
        throw new Error("Нарушен safety contract: staging не должен выполнять сетевую отправку.");
      }
      const diff = await requestJson<DiffState>(
        `/api/results/khl/diff?khlGameId=${match.khlGameId}`
      );
      setDiffs((state) => ({ ...state, [match.khlGameId]: diff }));
      setMessage(result.reused
        ? `Staging ${result.delivery.id} уже существовал; сетевой отправки не было.`
        : `Staging ${result.delivery.id} создан; сетевой отправки не было.`);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusyKey(null);
    }
  };

  const loadTargetTemplate = async (match: StoredMatch) => {
    const key = `targets-template:${match.khlGameId}`;
    setBusyKey(key);
    setError(null);
    try {
      const data = await requestJson<{ template: unknown }>(
        `/api/results/khl/bindings/targets?khlGameId=${match.khlGameId}`
      );
      setTargetJson((state) => ({
        ...state,
        [match.khlGameId]: JSON.stringify(data.template, null, 2),
      }));
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusyKey(null);
    }
  };

  const saveTargetBindings = async (match: StoredMatch) => {
    const key = `targets-save:${match.khlGameId}`;
    setBusyKey(key);
    setError(null);
    try {
      const parsed = JSON.parse(targetJson[match.khlGameId] || "") as unknown;
      await requestJson("/api/results/khl/bindings/targets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed),
      });
      setMessage(`Target mappings матча ${match.khlGameId} подтверждены.`);
      await loadPreview(match);
    } catch (cause) {
      setError(cause instanceof SyntaxError ? "JSON mappings содержит синтаксическую ошибку." : messageOf(cause));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <main className="mx-auto max-w-7xl space-y-6 py-8">
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600">Результаты</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">КХЛ</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              First-party KHL API → raw snapshot → проверенная ревизия → подтверждённые Admin ID.
              Отправка блокируется до полной и однозначной привязки.
            </p>
          </div>
          <span className="rounded-full bg-amber-50 px-4 py-2 text-xs font-bold text-amber-800 ring-1 ring-amber-200">
            Admin delivery отключён до подтверждения API-контракта
          </span>
        </div>
      </header>

      {(error || message) && (
        <div className={`rounded-2xl border px-5 py-4 text-sm font-semibold ${error
          ? "border-red-200 bg-red-50 text-red-800"
          : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
          {error || message}
        </div>
      )}

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">Расписание КХЛ</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-[2fr_1fr_1fr_auto]">
          <select value={stageId} onChange={(event) => setStageId(event.target.value)} className="rounded-xl border border-slate-200 px-4 py-3 text-sm">
            <option value="">Выберите этап</option>
            {stages.map((stage) => (
              <option key={stage.stageId} value={stage.stageId}>
                {stage.season} · {stage.title} · API {stage.stageId}
              </option>
            ))}
          </select>
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="rounded-xl border border-slate-200 px-4 py-3 text-sm" />
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="rounded-xl border border-slate-200 px-4 py-3 text-sm" />
          <button onClick={loadSchedule} disabled={loading || !selectedStage} className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">
            {loading ? "Загрузка…" : "Получить"}
          </button>
        </div>

        <div className="mt-5 space-y-2">
          {events.map((event) => (
            <div key={event.apiEventId} className="grid items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4 md:grid-cols-[1fr_auto_auto]">
              <div>
                <div className="font-bold text-slate-900">{event.teams.home.name} — {event.teams.away.name}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {new Date(event.startsAt).toLocaleString("ru-RU")} · KHL {event.khlGameId} · API event {event.apiEventId} · {event.status}
                </div>
              </div>
              <div className="text-xl font-black text-slate-900">{event.score.home}:{event.score.away}</div>
              <button onClick={() => ingest(event)} disabled={busyKey === `ingest:${event.apiEventId}`} className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
                {busyKey === `ingest:${event.apiEventId}` ? "Сохранение…" : "Ingest / обновить"}
              </button>
            </div>
          ))}
          {!loading && events.length === 0 && <p className="py-8 text-center text-sm text-slate-400">Задайте этап и диапазон дат.</p>}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-black text-slate-950">Сохранённые матчи и mappings</h2>
            <p className="text-sm text-slate-500">Названия показываются оператору, но не используются как ключ сопоставления.</p>
          </div>
          <button onClick={() => loadStoredMatches().catch((cause) => setError(messageOf(cause)))} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700">Обновить</button>
        </div>

        {storedMatches.map((match) => {
          const teamsMapped = match.homeTeam.adminBindingStatus === "CONFIRMED" && match.awayTeam.adminBindingStatus === "CONFIRMED";
          const preview = previews[match.khlGameId];
          const diff = diffs[match.khlGameId];
          return (
            <article key={match.id} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-black text-slate-950">{match.homeTeam.name} — {match.awayTeam.name}</h3>
                  <p className="mt-1 text-xs text-slate-500">KHL game {match.khlGameId} · stage {match.stageId} · {match.season} · {new Date(match.startsAt).toLocaleString("ru-RU")}</p>
                </div>
                <div className="text-right">
                  <div className="text-xl font-black">{match.officialHomeScore ?? "—"}:{match.officialAwayScore ?? "—"}</div>
                  <div className="text-xs text-slate-500">Admin total (P1–P3): {match.regulationHomeScore ?? "—"}:{match.regulationAwayScore ?? "—"}</div>
                </div>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {[match.homeTeam, match.awayTeam].map((team) => {
                  const key = `team:${team.khlTeamId}`;
                  return (
                    <div key={team.khlTeamId} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                      <div className="text-xs font-bold uppercase text-slate-500">KHL team {team.khlTeamId} · {team.adminBindingStatus}</div>
                      <div className="mt-1 font-bold">{team.name}</div>
                      <div className="mt-3 flex gap-2">
                        <input value={bindingValues[key] ?? team.adminTeamId ?? ""} onChange={(event) => setBindingValues((state) => ({ ...state, [key]: event.target.value }))} placeholder="Admin team ID" className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" />
                        <button onClick={() => saveTeamBinding(team)} disabled={busyKey === key} className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">Подтвердить</button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 rounded-2xl border border-slate-100 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-[220px] flex-1">
                    <div className="text-xs font-bold uppercase text-slate-500">Admin match · {match.adminBindingStatus}</div>
                    <input value={bindingValues[`match:${match.khlGameId}`] ?? match.adminMatchId ?? ""} onChange={(event) => setBindingValues((state) => ({ ...state, [`match:${match.khlGameId}`]: event.target.value }))} placeholder="Admin match ID" className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                  </div>
                  <button onClick={() => saveMatchBinding(match)} disabled={!teamsMapped || busyKey === `match:${match.khlGameId}`} className="rounded-xl bg-blue-600 px-5 py-3 text-xs font-bold text-white disabled:opacity-40">Подтвердить матч</button>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  Вставьте read-only candidates из Admin. Resolver требует ровно один совместимый матч по командам, сезону, stage и времени.
                </p>
                <textarea
                  value={matchCandidateJson[match.khlGameId] ?? ""}
                  onChange={(event) => setMatchCandidateJson((state) => ({
                    ...state,
                    [match.khlGameId]: event.target.value,
                  }))}
                  placeholder="Admin match candidates JSON"
                  spellCheck={false}
                  className="mt-2 h-28 w-full rounded-xl border border-slate-200 bg-slate-950 p-3 font-mono text-xs text-slate-100"
                />
                {!teamsMapped && <p className="mt-2 text-xs font-semibold text-amber-700">Сначала подтвердите обе команды.</p>}
              </div>

              <details className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                <summary className="cursor-pointer text-sm font-black text-slate-900">Player/stat target mappings (JSON)</summary>
                <p className="mt-2 text-xs text-slate-500">
                  Шаблон содержит всех заявленных игроков. Требуются ID типов статистики и конкретных записей Admin; подтверждённые значения становятся неизменяемыми.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => loadTargetTemplate(match)} disabled={!teamsMapped || match.adminBindingStatus !== "CONFIRMED" || busyKey === `targets-template:${match.khlGameId}`} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 disabled:opacity-40">
                    Загрузить шаблон
                  </button>
                  <button onClick={() => saveTargetBindings(match)} disabled={!targetJson[match.khlGameId] || busyKey === `targets-save:${match.khlGameId}`} className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">
                    Проверить и подтвердить IDs
                  </button>
                </div>
                {targetJson[match.khlGameId] !== undefined && (
                  <textarea
                    value={targetJson[match.khlGameId]}
                    onChange={(event) => setTargetJson((state) => ({ ...state, [match.khlGameId]: event.target.value }))}
                    spellCheck={false}
                    className="mt-3 h-64 w-full rounded-xl border border-slate-200 bg-slate-950 p-4 font-mono text-xs text-slate-100"
                  />
                )}
              </details>

              <div className="mt-4 grid gap-2 text-xs sm:grid-cols-3">
                <Status label="Ревизия" value={match.activeRevision ? `#${match.activeRevision.revisionNumber} ${match.activeRevision.state}` : "нет активной"} ok={Boolean(match.activeRevision)} />
                <Status label="Состав" value={`${match._count.participants} игроков`} ok={match._count.participants > 0} />
                <Status label="Готовность" value={match.adminBindingStatus === "CONFIRMED" ? "match mapping подтверждён" : "отправка заблокирована"} ok={match.adminBindingStatus === "CONFIRMED"} />
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-slate-900">Fail-closed preview / diff / staging</div>
                    <div className="text-xs text-slate-500">Проверяет все mappings. Staging сохраняет payload локально и никогда не выполняет HTTP-отправку.</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => loadPreview(match)} disabled={busyKey === `preview:${match.khlGameId}`} className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-xs font-bold text-blue-800 disabled:opacity-50">
                      {busyKey === `preview:${match.khlGameId}` ? "Проверка…" : "Сформировать preview"}
                    </button>
                    <button onClick={() => loadDiff(match)} disabled={busyKey === `diff:${match.khlGameId}`} className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-2 text-xs font-bold text-violet-800 disabled:opacity-50">
                      {busyKey === `diff:${match.khlGameId}` ? "Сравнение…" : "Diff со staging"}
                    </button>
                    <button onClick={() => stageDelivery(match)} disabled={!preview?.ready || busyKey === `stage:${match.khlGameId}`} className="rounded-xl bg-emerald-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">
                      {busyKey === `stage:${match.khlGameId}` ? "Staging…" : "Зафиксировать staging (без отправки)"}
                    </button>
                  </div>
                </div>
                {preview && (
                  <div className={`mt-3 rounded-xl p-3 text-xs ${preview.ready ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}>
                    {preview.ready ? (
                      <>
                        <div><b>READY</b> · SHA-256 {preview.payloadHash}</div>
                        {preview.payload !== undefined && (
                          <details className="mt-2">
                            <summary className="cursor-pointer font-bold">Canonical payload</summary>
                            <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] text-slate-100">{JSON.stringify(preview.payload, null, 2)}</pre>
                          </details>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="font-black">BLOCKED · причин: {preview.issues.length}</div>
                        <ul className="mt-2 list-disc space-y-1 pl-5">
                          {preview.issues.slice(0, 12).map((issue, index) => <li key={`${issue}:${index}`}>{issue}</li>)}
                        </ul>
                        {preview.issues.length > 12 && <div className="mt-2">Показаны первые 12 причин.</div>}
                      </>
                    )}
                  </div>
                )}
                {diff && (
                  <div className={`mt-3 rounded-xl p-3 text-xs ${diff.status === "CHANGED" || diff.status === "BLOCKED" ? "bg-amber-100 text-amber-950" : "bg-violet-100 text-violet-950"}`}>
                    <div className="font-black">DIFF · {diff.status}</div>
                    {diff.currentPayloadHash && <div className="mt-1 break-all">Current SHA-256: {diff.currentPayloadHash}</div>}
                    {diff.baseline && <div className="mt-1 break-all">Baseline: {diff.baseline.deliveryId} · {diff.baseline.state} · {diff.baseline.payloadHash}</div>}
                    {diff.status === "NEW" && <div className="mt-2">Для этого матча ещё нет staged payload.</div>}
                    {diff.status === "UNCHANGED" && <div className="mt-2">Текущий payload побайтно совпадает с последним staging по SHA-256.</div>}
                    {diff.status === "BLOCKED" && <div className="mt-2">Diff недоступен, пока preview заблокирован.</div>}
                    {diff.changes.length > 0 && (
                      <ul className="mt-2 space-y-2">
                        {diff.changes.slice(0, 20).map((change) => (
                          <li key={change.path} className="rounded-lg bg-white/70 p-2">
                            <div className="font-mono font-bold">{change.path}</div>
                            <div className="mt-1 break-all"><b>До:</b> {formatDiffValue(change.before)}</div>
                            <div className="break-all"><b>После:</b> {formatDiffValue(change.after)}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                    {(diff.changes.length > 20 || diff.truncated) && <div className="mt-2">Показана ограниченная часть diff.</div>}
                  </div>
                )}
              </div>
            </article>
          );
        })}
        {storedMatches.length === 0 && <div className="rounded-3xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400">Сохранённых матчей пока нет.</div>}
      </section>
    </main>
  );
}

function Status({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return <div className={`rounded-xl px-3 py-2 ${ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}><b>{label}:</b> {value}</div>;
}

async function requestJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({})) as ApiError & T;
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function formatDiffValue(value: unknown) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return "undefined";
  return serialized.length > 240 ? `${serialized.slice(0, 237)}…` : serialized;
}

function messageOf(value: unknown) {
  return value instanceof Error ? value.message : "Неизвестная ошибка";
}

function withoutKey<T>(state: Record<string, T>, key: string) {
  return Object.fromEntries(
    Object.entries(state).filter(([candidate]) => candidate !== key)
  ) as Record<string, T>;
}

function toDateInput(value: Date) {
  return value.toISOString().slice(0, 10);
}
