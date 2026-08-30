"use client";

import useSWR from "swr";

import { requestTLine } from "./api";

type HistoryItem = {
  id: string;
  trigger: string;
  state: string;
  periodFrom: string | null;
  periodTo: string | null;
  createdAt: string | null;
  counts: { total: number; processed: number; error: number; critical: number };
};

export function TLineHistoryPanel({ sportId, selectedRunId, onSelect }: {
  sportId: string;
  selectedRunId: string | null;
  onSelect: (runId: string | null) => void;
}) {
  const query = useSWR(
    sportId ? `/api/tline/history?sportId=${encodeURIComponent(sportId)}&limit=25` : null,
    loadHistory,
    { revalidateOnFocus: false },
  );
  const items = query.data ?? [];
  return (
    <section aria-label="История запусков" className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="text-sm font-black text-slate-900">История запусков</h2><p className="text-xs text-slate-500">Сохранённые снимки официального источника и Admin.</p></div>
        {selectedRunId && <button type="button" onClick={() => onSelect(null)} className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-black text-blue-700">Вернуться к последнему запуску</button>}
      </div>
      {query.isLoading && <p className="py-4 text-center text-sm text-slate-500">Загрузка истории…</p>}
      {query.error && <p role="alert" className="py-4 text-center text-sm font-bold text-red-700">Не удалось загрузить историю.</p>}
      {!query.isLoading && !query.error && items.length === 0 && <p className="py-4 text-center text-sm text-slate-500">История пока пуста.</p>}
      <div className="grid gap-2 lg:grid-cols-2">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={selectedRunId === item.id}
            onClick={() => onSelect(item.id)}
            className={`rounded-xl border p-3 text-left transition ${selectedRunId === item.id ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white hover:border-blue-200"}`}
          >
            <div className="flex items-center justify-between gap-3"><span className="text-xs font-black text-slate-900">{item.trigger === "SCHEDULED" ? "Автоматический" : "Ручной"} · {formatMoscow(item.createdAt)}</span><span className="text-[11px] font-black text-slate-500">{stateLabel(item.state)}</span></div>
            <p className="mt-1 text-xs text-slate-500">{formatMoscow(item.periodFrom)} — {formatMoscow(item.periodTo)}</p>
            <p className="mt-2 text-xs font-bold text-slate-700">Обработано {item.counts.processed}/{item.counts.total} · ошибок {item.counts.error + item.counts.critical}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

async function loadHistory(url: string): Promise<HistoryItem[]> {
  const data = await requestTLine<unknown>(url);
  const values = Array.isArray(data) ? data : [];
  return values.flatMap((value) => {
    if (!isRecord(value) || !asString(value.id)) return [];
    const counts = isRecord(value.counts) ? value.counts : {};
    return [{
      id: asString(value.id),
      trigger: asString(value.trigger),
      state: asString(value.state),
      periodFrom: nullableString(value.periodFrom),
      periodTo: nullableString(value.periodTo),
      createdAt: nullableString(value.createdAt),
      counts: {
        total: asNumber(counts.total),
        processed: asNumber(counts.processed),
        error: asNumber(counts.error),
        critical: asNumber(counts.critical),
      },
    }];
  });
}

function formatMoscow(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" }).format(date) + " МСК"
    : "—";
}

function stateLabel(value: string) {
  return ({ QUEUED: "В очереди", RUNNING: "Выполняется", SUCCEEDED: "Завершён", PARTIAL: "Частично", CANCELLED: "Остановлен", FAILED: "Ошибка" } as Record<string, string>)[value] ?? value;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function asString(value: unknown) { return typeof value === "string" ? value : typeof value === "number" ? String(value) : ""; }
function nullableString(value: unknown) { return asString(value) || null; }
function asNumber(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
