"use client";

import type { AutomationStatus } from "./types";
import type { KhlSyncRunView } from "@backend/results/khl/syncQueue";

const RUN_LABELS: Record<KhlSyncRunView["status"], string> = {
  QUEUED: "Ожидает сборщика",
  RUNNING: "Получаем данные КХЛ",
  SUCCEEDED: "Проверка завершена",
  PARTIAL: "Проверка завершена с замечаниями",
  FAILED: "Сбор завершился ошибкой",
  CANCELLED: "Сбор остановлен",
};

export function KhlAutomationPanel({ automation, busyKey, onToggle, now = new Date() }: {
  automation: AutomationStatus | null;
  busyKey: string | null;
  onToggle: () => void;
  now?: Date;
}) {
  const heartbeat = automation?.workerHeartbeatAt;
  const workerHealthy = Boolean(heartbeat && now.getTime() - Date.parse(heartbeat) < 90_000);
  const run = automation?.activeRun || automation?.latestRun;
  const summary = run?.summary;
  const title = !automation ? "Загружаем состояние автопарсинга…"
    : !automation.configured ? "Автопарсинг не настроен на сервере"
    : automation.paused ? "Автопарсинг остановлен"
    : !workerHealthy ? "Нет связи с фоновым сборщиком"
    : "Автопарсинг включён";
  const healthy = automation?.enabled && workerHealthy;

  return (
    <section data-testid="khl-automation" className={`rounded-3xl border p-5 shadow-sm ${healthy
      ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-black text-slate-950">{title}</h2>
          <p className="mt-1 text-xs text-slate-700">
            Только завершённые матчи с 01.05.2026 · каждые {automation?.intervalMinutes || 10} минут.
            {automation?.paused && " Ручной сбор доступен."}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            {workerHealthy ? "Фоновый сборщик работает." : "Задания сохраняются в очереди до восстановления сборщика."}
          </p>
        </div>
        {automation?.configured && (
          <button type="button" onClick={onToggle} disabled={busyKey === "automation:toggle"}
            className={`rounded-xl px-4 py-2 text-xs font-black text-white disabled:opacity-40 ${automation.paused ? "bg-emerald-700" : "bg-red-700"}`}>
            {busyKey === "automation:toggle" ? "Сохранение…" : automation.paused ? "Включить автопарсинг" : "Остановить автопарсинг"}
          </button>
        )}
      </div>
      <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <Timestamp label="Последняя проверка источника" value={automation?.lastAttemptAt} />
        <Timestamp label="Последний успешный проход" value={automation?.lastSuccessAt} />
        <Timestamp label="Последнее изменение данных" value={automation?.lastChangedAt} />
        <Timestamp label="Следующий автоматический проход" value={automation?.enabled ? automation.nextRunAt : null} />
      </dl>
      {run && (
        <div data-testid="khl-sync-run" role="status" aria-live="polite" className="mt-4 border-t border-slate-200 pt-3 text-xs text-slate-700">
          <p className="font-black">
            {RUN_LABELS[run.status]} · {run.trigger === "AUTOMATIC" ? "автоматический" : "ручной"}
            {run.khlGameId ? ` · матч ${run.khlGameId}` : run.full ? " · с 1 мая 2026" : " · последние 14 дней"}
          </p>
          {summary && (
            <p className="mt-1">
              Проверено протоколов: {summary.events.checked} · обновлено: {summary.events.newlyChanged}
              {" · "}без изменений: {summary.events.reusedRevisions} · проблем: {summary.failures.length}
            </p>
          )}
          {run.status === "SUCCEEDED" && summary?.events.newlyChanged === 0 && (
            <p className="mt-1">Источник проверен. Новых данных нет.</p>
          )}
          {run.error && <p className="mt-2 text-red-800">{run.error}</p>}
          {Boolean(summary?.failures.length) && (
            <details className="mt-2 text-red-800">
              <summary className="cursor-pointer font-bold">Замечания к протоколам</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {summary!.failures.slice(0, 8).map((failure, index) => (
                  <li key={`${failure.khlGameId}:${index}`}>
                    {failure.khlGameId ? `Матч ${failure.khlGameId}: ` : "Расписание: "}{failure.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

function Timestamp({ label, value }: { label: string; value?: string | null }) {
  const date = value ? new Date(value) : null;
  return <div><dt className="text-slate-500">{label}</dt><dd className="mt-1 font-bold text-slate-800">
    {date && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short",
    }).format(date) : "—"}
  </dd></div>;
}
