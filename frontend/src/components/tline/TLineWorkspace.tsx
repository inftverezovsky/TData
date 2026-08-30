"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Filter,
  History,
  Play,
  RefreshCw,
  Search,
  Square,
} from "lucide-react";

import { jsonRequest, requestTLine } from "./api";
import { TLineChampionshipDecisionMenu, TLineDecisionMenu, type TLineDecision } from "./TLineDecisionMenu";
import { TLineHistoryPanel } from "./TLineHistoryPanel";
import { TLineInfoDialog } from "./TLineInfoDialog";
import type {
  TLineChampionshipResult,
  TLineComparison,
  TLineRun,
  TLineSchedule,
  TLineSport,
} from "./types";
import {
  championshipTone,
  countChampionshipFailures,
  defaultMoscowDateTime,
  emptyChampionshipMessage,
  filterTLineChampionships,
  formatTLineReasons,
  moscowInputToIso,
  normalizeTLineRun,
  statusPresentation,
  summarizeTLineRun,
} from "./viewModel";

type RunStartResponse = { run?: unknown; deduplicated?: boolean } | unknown;

export function TLineWorkspace() {
  const [sportId, setSportId] = useState("");
  const [from, setFrom] = useState(() => defaultMoscowDateTime(-1));
  const [to, setTo] = useState(() => defaultMoscowDateTime(7));
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedHistoryRunId, setSelectedHistoryRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const sportsQuery = useSWR("/api/tline/sports", loadSports, { revalidateOnFocus: false });
  const sports = sportsQuery.data ?? EMPTY_SPORTS;

  useEffect(() => {
    if (!sportId && sports.length > 0) setSportId(sports.find((sport) => sport.active)?.id ?? sports[0].id);
  }, [sportId, sports]);

  const runKey = selectedHistoryRunId
    ? `/api/tline/history/${encodeURIComponent(selectedHistoryRunId)}`
    : sportId ? `/api/tline/runs/latest?sportId=${encodeURIComponent(sportId)}` : null;
  const runQuery = useSWR(runKey, loadRun, {
    refreshInterval: (data) => selectedHistoryRunId ? 0 : data?.state === "QUEUED" || data?.state === "RUNNING" ? 2_500 : 15_000,
    revalidateOnFocus: true,
  });
  const scheduleQuery = useSWR<TLineSchedule>("/api/tline/schedule", loadSchedule, { revalidateOnFocus: false });

  const run = runQuery.data ?? null;
  const active = !selectedHistoryRunId && (run?.state === "QUEUED" || run?.state === "RUNNING");
  const summary = summarizeTLineRun(run);
  const visibleChampionships = useMemo(
    () => filterTLineChampionships(run?.championships ?? [], search, statusFilter),
    [run?.championships, search, statusFilter]
  );

  const startRun = async () => {
    if (!sportId) return;
    const wasViewingHistory = Boolean(selectedHistoryRunId);
    setSelectedHistoryRunId(null);
    setBusy("run");
    setActionError(null);
    setMessage(null);
    try {
      const response = await requestTLine<RunStartResponse>(
        "/api/tline/runs/manual",
        jsonRequest("POST", {
          sportId,
          from: moscowInputToIso(from),
          to: moscowInputToIso(to),
        })
      );
      const candidate = typeof response === "object" && response !== null && "run" in response
        ? response.run
        : response;
      const nextRun = normalizeTLineRun(candidate);
      if (nextRun && !wasViewingHistory) await runQuery.mutate(nextRun, { revalidate: false });
      const deduplicated = typeof response === "object" && response !== null && "deduplicated" in response && response.deduplicated;
      setMessage(deduplicated ? "Проверка уже выполняется — подключились к текущему запуску." : "Проверка поставлена в очередь.");
      if (!wasViewingHistory) await runQuery.mutate();
    } catch (cause) {
      setActionError(messageOf(cause));
    } finally {
      setBusy(null);
    }
  };

  const cancelRun = async () => {
    if (!run) return;
    setBusy("cancel");
    setActionError(null);
    try {
      await requestTLine(`/api/tline/runs/${encodeURIComponent(run.id)}/cancel`, jsonRequest("POST"));
      setMessage("Остановка запрошена. Уже полученные результаты сохраняются.");
      await runQuery.mutate();
    } catch (cause) {
      setActionError(messageOf(cause));
    } finally {
      setBusy(null);
    }
  };

  const toggleSchedule = async () => {
    const enabled = Boolean(scheduleQuery.data?.enabled);
    setBusy("schedule");
    setActionError(null);
    try {
      await requestTLine(`/api/tline/schedule/${enabled ? "stop" : "start"}`, jsonRequest("POST"));
      await scheduleQuery.mutate({ ...(scheduleQuery.data ?? emptySchedule), enabled: !enabled }, { revalidate: true });
      setMessage(enabled ? "Автопроверка выключена." : "Автопроверка включена.");
    } catch (cause) {
      setActionError(messageOf(cause));
    } finally {
      setBusy(null);
    }
  };

  const applyComparisonDecision = async (comparisonId: string, decision: TLineDecision, expiresAt?: string, adminMatchId?: string) => {
    setBusy(`comparison:${comparisonId}`);
    setActionError(null);
    try {
      const url = `/api/tline/comparisons/${encodeURIComponent(comparisonId)}/decision`;
      await requestTLine(url, decision === "RESET"
        ? jsonRequest("DELETE")
        : jsonRequest("POST", {
          decision,
          expiresAt: expiresAt ?? null,
          adminMatchId: adminMatchId ?? null,
          persistent: decision === "MANUAL_LINK" || decision === "IGNORE_UNTIL" || decision === "EXCLUDE",
        }));
      setMessage(decision === "RESET" ? "Ручное решение сброшено." : "Ручное решение сохранено.");
      await runQuery.mutate();
    } catch (cause) {
      setActionError(messageOf(cause));
      throw cause;
    } finally {
      setBusy(null);
    }
  };

  const applyChampionshipDecision = async (runChampionshipId: string, decision: TLineDecision) => {
    setBusy(`championship:${runChampionshipId}`);
    setActionError(null);
    try {
      const url = `/api/tline/run-championships/${encodeURIComponent(runChampionshipId)}/decision`;
      await requestTLine(url, decision === "RESET"
        ? jsonRequest("DELETE")
        : jsonRequest("POST", { decision }));
      setMessage(decision === "RESET" ? "Решение по чемпионату сброшено." : "Решение по чемпионату сохранено.");
      await runQuery.mutate();
    } catch (cause) {
      setActionError(messageOf(cause));
      throw cause;
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="relative min-h-[680px] pb-20">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-5 md:p-6">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Вид спорта">
              <select
                aria-label="Вид спорта"
                value={sportId}
                onChange={(event) => setSportId(event.target.value)}
                disabled={sportsQuery.isLoading || sports.length === 0}
                className="h-11 min-w-44 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50"
              >
                {sports.length === 0 && <option value="">Нет настроенных видов спорта</option>}
                {sports.map((sport) => <option key={sport.id} value={sport.id}>{sport.name}</option>)}
              </select>
            </Field>
            <Field label="Период">
              <div className="flex flex-wrap items-center gap-2">
                <DateTimeInput label="Начало периода" value={from} onChange={setFrom} />
                <span aria-hidden="true" className="text-slate-300">→</span>
                <DateTimeInput label="Конец периода" value={to} onChange={setTo} />
              </div>
            </Field>
            {active ? (
              <button
                type="button"
                onClick={cancelRun}
                disabled={busy !== null}
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-red-600 px-4 text-sm font-black text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
              >
                <Square aria-hidden="true" className="h-4 w-4" />
                Остановить проверку
              </button>
            ) : (
              <button
                type="button"
                onClick={startRun}
                disabled={busy !== null || !sportId || !from || !to}
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-black text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
              >
                <Play aria-hidden="true" className="h-4 w-4" />
                Запустить проверку
              </button>
            )}
            <div className={`inline-flex h-11 items-center rounded-xl border px-3 text-sm font-bold ${scheduleQuery.data?.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
              Автопроверка: {scheduleQuery.data?.enabled ? "включена" : "выключена"}
            </div>
            <button
              type="button"
              onClick={toggleSchedule}
              disabled={busy !== null || scheduleQuery.isLoading}
              className={`h-11 rounded-xl border px-4 text-sm font-black disabled:opacity-50 ${scheduleQuery.data?.enabled ? "border-red-300 text-red-700 hover:bg-red-50" : "border-emerald-300 text-emerald-700 hover:bg-emerald-50"}`}
            >
              {scheduleQuery.data?.enabled ? "Отключить автопроверку" : "Включить автопроверку"}
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen((value) => !value)}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-blue-200 px-3 text-sm font-bold text-blue-700 hover:bg-blue-50"
              >
                <Filter aria-hidden="true" className="h-4 w-4" /> Фильтры
              </button>
              <button
                type="button"
                aria-expanded={historyOpen}
                onClick={() => setHistoryOpen((value) => !value)}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                <History aria-hidden="true" className="h-4 w-4" /> История запусков
              </button>
            </div>
            <label className="relative min-w-[260px] flex-1 md:max-w-md">
              <span className="sr-only">Поиск</span>
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Поиск по чемпионатам, командам и ID..."
                className="h-10 w-full rounded-xl border border-slate-200 pl-10 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>
          </div>
          {filtersOpen && (
            <div className="mt-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <label className="text-xs font-black uppercase tracking-wide text-slate-500" htmlFor="tline-status-filter">Статус чемпионата</label>
              <select id="tline-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold">
                <option value="ALL">Все</option>
                <option value="OK">Без ошибок</option>
                <option value="ERROR">С ошибками</option>
              </select>
            </div>
          )}
          {historyOpen && <TLineHistoryPanel sportId={sportId} selectedRunId={selectedHistoryRunId} onSelect={setSelectedHistoryRunId} />}
        </div>

        {(actionError || message) && (
          <div role={actionError ? "alert" : "status"} className={`border-b px-5 py-3 text-sm font-bold ${actionError ? "border-red-200 bg-red-50 text-red-800" : "border-blue-200 bg-blue-50 text-blue-800"}`}>
            {actionError ?? message}
          </div>
        )}

        {selectedHistoryRunId && (
          <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-5 py-3 text-xs font-bold text-amber-900">
            <span>Открыт сохранённый запуск. Автоматическое обновление отключено.</span>
            <button type="button" onClick={() => setSelectedHistoryRunId(null)} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5">Вернуться к последнему</button>
          </div>
        )}

        <SummaryCards summary={summary} />

        {active && (
          <div className="border-y border-blue-100 bg-blue-50 px-5 py-3">
            <div className="flex items-center justify-between gap-4 text-xs font-black text-blue-800">
              <span className="inline-flex items-center gap-2"><RefreshCw aria-hidden="true" className="h-4 w-4 animate-spin" />Проверка выполняется</span>
              <span>{run.progress}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-blue-100"><div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${Math.min(100, Math.max(0, run.progress))}%` }} /></div>
          </div>
        )}

        <ComparisonTable
          run={run}
          championships={visibleChampionships}
          loading={sportsQuery.isLoading || runQuery.isLoading}
          error={sportsQuery.error || runQuery.error}
          search={search}
          busy={busy !== null}
          onComparisonDecision={applyComparisonDecision}
          onChampionshipDecision={applyChampionshipDecision}
        />
      </section>
      <TLineInfoDialog />
    </div>
  );
}

function SummaryCards({ summary }: { summary: ReturnType<typeof summarizeTLineRun> }) {
  const cards = [
    ["Всего чемпионатов", summary.totalChampionships, "text-slate-950"],
    ["Обработано", summary.processedChampionships, "text-emerald-700"],
    ["С ошибками", summary.errorChampionships, "text-red-600"],
    ["Не обработано", summary.unprocessedChampionships, "text-slate-600"],
  ] as const;
  return (
    <div className="grid border-b border-slate-200 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map(([label, value, tone]) => (
        <div key={label} className="border-b border-slate-200 px-5 py-4 last:border-b-0 sm:border-r lg:border-b-0">
          <p className="text-xs font-bold text-slate-500">{label}</p>
          <p className={`mt-1 text-2xl font-black ${tone}`}>{value}</p>
        </div>
      ))}
    </div>
  );
}

function ComparisonTable({
  run,
  championships,
  loading,
  error,
  search,
  busy,
  onComparisonDecision,
  onChampionshipDecision,
}: {
  run: TLineRun | null;
  championships: TLineChampionshipResult[];
  loading: boolean;
  error: unknown;
  search: string;
  busy: boolean;
  onComparisonDecision: (comparisonId: string, decision: TLineDecision, expiresAt?: string, adminMatchId?: string) => Promise<void>;
  onChampionshipDecision: (runChampionshipId: string, decision: TLineDecision) => Promise<void>;
}) {
  if (loading) return <EmptyState icon={<RefreshCw className="h-5 w-5 animate-spin" />} text="Загружаем результаты TLine…" />;
  if (error) return <EmptyState tone="red" text={`Не удалось загрузить данные: ${messageOf(error)}`} />;
  if (!run) return <EmptyState text="Проверок пока нет. Выберите период и запустите первую проверку." />;
  if (championships.length === 0) return <EmptyState text={search ? "По вашему запросу ничего не найдено." : "В этой проверке нет чемпионатов."} />;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[960px]">
        <div className="grid grid-cols-[minmax(0,1fr)_174px_minmax(0,1fr)] border-b border-slate-200 bg-slate-50 text-xs font-black text-slate-600">
          <div className="px-5 py-3">Официальный сайт</div>
          <div className="border-x border-slate-200 px-4 py-3 text-center">Статус</div>
          <div className="px-5 py-3">Бетсити (Админ)</div>
        </div>
        {championships.map((championship) => <ChampionshipGroup key={championship.id} championship={championship} busy={busy} onComparisonDecision={onComparisonDecision} onChampionshipDecision={onChampionshipDecision} />)}
      </div>
    </div>
  );
}

function ChampionshipGroup({ championship, busy, onComparisonDecision, onChampionshipDecision }: {
  championship: TLineChampionshipResult;
  busy: boolean;
  onComparisonDecision: (comparisonId: string, decision: TLineDecision, expiresAt?: string, adminMatchId?: string) => Promise<void>;
  onChampionshipDecision: (runChampionshipId: string, decision: TLineDecision) => Promise<void>;
}) {
  const storageKey = `tline:collapsed:${championship.id}`;
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(storageKey) === "1");
  }, [storageKey]);

  const toggle = () => setCollapsed((current) => {
    const next = !current;
    window.localStorage.setItem(storageKey, next ? "1" : "0");
    return next;
  });
  const failed = countChampionshipFailures(championship);
  const tone = championshipTone(championship);
  const groupReason = formatTLineReasons(championship.reasons, championship.status, null);

  return (
    <section className="border-b border-slate-200 last:border-b-0">
      <div className="flex items-center gap-3 bg-slate-50/70 px-4 py-2">
        <button type="button" aria-expanded={!collapsed} onClick={toggle} className="flex min-w-0 flex-1 items-center justify-between gap-4 py-1 text-left hover:text-blue-700">
          <span className="inline-flex min-w-0 items-center gap-2 text-sm font-black text-slate-900">
            {collapsed ? <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0" /> : <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0" />}
            <span className="truncate">{championship.name}</span>
          </span>
          <span title={failed > 0 ? groupReason : undefined} className={`shrink-0 text-xs font-black ${groupToneClass(tone)}`}>{failed > 0 ? `— / ${championship.comparisons.length}` : `ok / ${championship.comparisons.length}`}</span>
        </button>
        <TLineChampionshipDecisionMenu disabled={busy} manual={isManualStatus(championship.status)} onDecision={(decision) => onChampionshipDecision(championship.id, decision)} />
      </div>
      {!collapsed && (
        <div>
          {championship.comparisons.length === 0
            ? <div className="px-5 py-5 text-center text-sm text-slate-500">{emptyChampionshipMessage(championship)}</div>
            : championship.comparisons.map((comparison) => <ComparisonRow key={comparison.id} comparison={comparison} busy={busy} onDecision={onComparisonDecision} />)}
        </div>
      )}
    </section>
  );
}

function ComparisonRow({ comparison, busy, onDecision }: {
  comparison: TLineComparison;
  busy: boolean;
  onDecision: (comparisonId: string, decision: TLineDecision, expiresAt?: string, adminMatchId?: string) => Promise<void>;
}) {
  const presentation = statusPresentation(comparison.effectiveStatus, comparison.manual, comparison.swappedSides);
  const reason = formatTLineReasons(comparison.reasons, comparison.effectiveStatus, comparison.timeDeltaMinutes);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_174px_minmax(0,1fr)] border-t border-slate-100 text-sm">
      <MatchSide side={comparison.source} />
      <div className="flex items-center justify-center border-x border-slate-100 px-3 py-4">
        <TLineDecisionMenu
          label={`${presentation.label}${comparison.timeDeltaMinutes !== null && presentation.tone !== "emerald" ? ` (${signedMinutes(comparison.timeDeltaMinutes)})` : ""}`}
          description={reason}
          toneClass={statusTone(presentation.tone)}
          manual={comparison.manual}
          disabled={busy}
          onDecision={(decision, expiresAt, adminMatchId) => onDecision(comparison.id, decision, expiresAt, adminMatchId)}
        />
      </div>
      <MatchSide side={comparison.admin} missingText="Матч отсутствует в Админе" />
    </div>
  );
}

function MatchSide({ side, missingText = "Матч отсутствует на официальном сайте" }: { side: TLineComparison["source"]; missingText?: string }) {
  if (!side) return <div className="flex items-center px-5 py-4 text-xs font-bold text-red-600">{missingText}</div>;
  return (
    <div className="min-w-0 px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-semibold text-slate-500">
        {side.sourceUrl && side.externalId
          ? <a href={side.sourceUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline decoration-blue-200 underline-offset-2 hover:text-blue-800">#{side.externalId}</a>
          : <span>#{side.externalId ?? "—"}</span>}
        <time>{formatMoscow(side.startsAt, side.sourceTimeText)}</time>
      </div>
      <div className="mt-2 space-y-1 font-bold text-slate-800">
        <p>{side.teamHome || "Команда не определена"}</p>
        <p>{side.teamAway || "Команда не определена"}</p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-black text-slate-600">{label}</span>{children}</label>;
}

function DateTimeInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="relative block">
      <span className="sr-only">{label}</span>
      <input type="datetime-local" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="h-11 rounded-xl border border-slate-200 bg-white px-3 pr-9 text-sm font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
      <CalendarDays aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
    </label>
  );
}

function EmptyState({ text, icon, tone = "slate" }: { text: string; icon?: React.ReactNode; tone?: "slate" | "red" }) {
  return <div className={`flex min-h-44 items-center justify-center gap-2 px-6 py-12 text-center text-sm font-semibold ${tone === "red" ? "text-red-700" : "text-slate-500"}`}>{icon}{text}</div>;
}

const emptySchedule: TLineSchedule = { enabled: false, slots: [], nextRunAt: null };
const EMPTY_SPORTS: TLineSport[] = [];

async function loadSports(url: string): Promise<TLineSport[]> {
  const data = await requestTLine<unknown>(url);
  const values = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.sports) ? data.sports : [];
  return values.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = stringValue(value.id);
    const name = stringValue(value.name);
    if (!id || !name) return [];
    return [{ id, name, slug: stringValue(value.slug) || id, active: value.active !== false, autoEnabled: Boolean(value.autoEnabled) }];
  });
}

async function loadRun(url: string) {
  const data = await requestTLine<unknown>(url);
  const candidate = isRecord(data) && "run" in data ? data.run : data;
  return normalizeTLineRun(candidate);
}

async function loadSchedule(url: string): Promise<TLineSchedule> {
  const data = await requestTLine<unknown>(url);
  if (!isRecord(data)) return emptySchedule;
  return {
    enabled: Boolean(data.enabled),
    slots: Array.isArray(data.slots) ? data.slots.filter((value): value is string => typeof value === "string") : [],
    nextRunAt: typeof data.nextRunAt === "string" ? data.nextRunAt : null,
  };
}

function formatMoscow(value: string | null, fallback: string | null) {
  if (!value) return fallback || "Время не определено";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback || value;
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" }).format(parsed) + " МСК";
}

function signedMinutes(value: number) {
  return `${value > 0 ? "+" : ""}${Math.round(value)}м`;
}

function statusTone(tone: "emerald" | "amber" | "red" | "slate") {
  if (tone === "emerald") return "bg-emerald-100 text-emerald-800";
  if (tone === "amber") return "bg-amber-100 text-amber-800";
  if (tone === "red") return "bg-red-100 text-red-800";
  return "bg-slate-100 text-slate-600";
}

function groupToneClass(tone: "emerald" | "amber" | "red" | "slate") {
  if (tone === "emerald") return "text-emerald-700";
  if (tone === "amber") return "text-amber-700";
  if (tone === "red") return "text-red-600";
  return "text-slate-500";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

function messageOf(value: unknown) {
  return value instanceof Error ? value.message : "Неизвестная ошибка";
}

function isManualStatus(status: string) {
  return status === "MANUAL_OK" || status === "MANUAL_ERROR" || status === "IGNORED";
}
