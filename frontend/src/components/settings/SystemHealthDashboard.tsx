"use client";

import { useEffect, useState } from "react";

type TelemetryData = {
  status: "healthy" | "unhealthy";
  dbLatencyMs: number;
  metrics: {
    disciplineCount: number;
    tournamentCount: number;
    matchCount: number;
    proxyPool: {
      total: number;
      active: number;
      blocked: number;
      activeRatio: number;
    };
  };
  recentLogs: Array<{
    id: string;
    source: string;
    mode: string;
    route: string;
    errorClass: string | null;
    cacheHit: boolean;
    createdAt: string;
  }>;
};

export default function SystemHealthDashboard() {
  const [data, setData] = useState<TelemetryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTelemetry = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/health");
      if (!res.ok) throw new Error("Failed to load health telemetry");
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка при загрузке телеметрии");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTelemetry();
  }, []);

  return (
    <section className="rounded-3xl bg-white p-8 shadow-soft ring-1 ring-slate-200">
      <div className="flex items-center justify-between border-b border-slate-100 pb-6">
        <div>
          <h2 className="text-2xl font-black text-slate-950">Панель диагностики</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">
            Мониторинг состояния базы данных, пула прокси-серверов и активности парсера в реальном времени.
          </p>
        </div>
        <button
          onClick={fetchTelemetry}
          disabled={loading}
          className="flex items-center gap-2 rounded-xl bg-slate-50 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 hover:text-slate-950 transition active:scale-95 disabled:opacity-50"
        >
          {loading ? (
            <svg className="w-4 h-4 animate-spin text-slate-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 15H19" />
            </svg>
          )}
          Обновить
        </button>
      </div>

      {error && (
        <div className="mt-6 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-600">
          ⚠️ {error}
        </div>
      )}

      {loading && !data ? (
        <div className="py-20 flex justify-center items-center">
          <svg className="w-8 h-8 animate-spin text-indigo-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
      ) : data ? (
        <div className="mt-8 space-y-8 animate-in fade-in duration-500">
          {/* Diagnostic Metrics Grid */}
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            
            {/* Database Latency */}
            <div className="rounded-2xl border border-slate-100 p-5 hover:shadow-soft transition-all bg-slate-50/50">
              <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Пинг БД</span>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-black text-slate-950">{data.dbLatencyMs}</span>
                <span className="text-sm font-semibold text-slate-500">ms</span>
              </div>
              <div className="mt-3 flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-full ${data.dbLatencyMs < 100 ? "bg-emerald-500" : data.dbLatencyMs < 250 ? "bg-amber-500" : "bg-rose-500"}`} />
                <span className="text-xs font-bold text-slate-600">
                  {data.dbLatencyMs < 100 ? "Идеально" : data.dbLatencyMs < 250 ? "Средне" : "Повышенный пинг"}
                </span>
              </div>
            </div>

            {/* Proxy Health */}
            <div className="rounded-2xl border border-slate-100 p-5 hover:shadow-soft transition-all bg-slate-50/50">
              <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Пул Прокси</span>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-black text-slate-950">{data.metrics.proxyPool.activeRatio}</span>
                <span className="text-sm font-semibold text-slate-500">%</span>
              </div>
              <div className="mt-3 w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-indigo-600 h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${data.metrics.proxyPool.activeRatio}%` }}
                />
              </div>
              <span className="mt-2 block text-[10px] font-bold text-slate-500">
                Активно: {data.metrics.proxyPool.active} из {data.metrics.proxyPool.total}
              </span>
            </div>

            {/* Ingested Tournaments */}
            <div className="rounded-2xl border border-slate-100 p-5 hover:shadow-soft transition-all bg-slate-50/50">
              <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Турниры</span>
              <div className="mt-2">
                <span className="text-3xl font-black text-slate-950">{data.metrics.tournamentCount}</span>
              </div>
              <span className="mt-3 block text-xs font-semibold text-slate-500">
                Всего дисциплин: {data.metrics.disciplineCount}
              </span>
            </div>

            {/* Matches Total */}
            <div className="rounded-2xl border border-slate-100 p-5 hover:shadow-soft transition-all bg-slate-50/50">
              <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Матчи</span>
              <div className="mt-2">
                <span className="text-3xl font-black text-slate-950">{data.metrics.matchCount}</span>
              </div>
              <span className="mt-3 block text-xs font-semibold text-slate-500">
                Всего в базе данных
              </span>
            </div>

          </div>

          {/* Telemetry Log Viewer */}
          <div>
            <h3 className="text-lg font-bold text-slate-950 mb-4">Журнал запросов (Parser Activity Log)</h3>
            <div className="overflow-hidden rounded-2xl border border-slate-100">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm text-slate-500">
                  <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-700 border-b border-slate-100">
                    <tr>
                      <th className="px-6 py-4">Ресурс</th>
                      <th className="px-6 py-4">Действие</th>
                      <th className="px-6 py-4">Статус Кэша</th>
                      <th className="px-6 py-4">Результат</th>
                      <th className="px-6 py-4">Время</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.recentLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/50 transition">
                        <td className="px-6 py-4 font-semibold text-slate-800">
                          {log.source.toUpperCase()}
                        </td>
                        <td className="px-6 py-4 text-xs font-medium font-mono text-slate-600 max-w-[200px] truncate">
                          {log.route || log.mode || "GET /api"}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold ${log.cacheHit ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                            {log.cacheHit ? "CACHED" : "LIVE FETCH"}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          {log.errorClass ? (
                            <span className="inline-flex rounded-full bg-rose-50 px-2.5 py-1 text-[10px] font-bold text-rose-700">
                              {log.errorClass}
                            </span>
                          ) : (
                            <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">
                              SUCCESS
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-xs font-medium text-slate-400">
                          {new Date(log.createdAt).toLocaleTimeString()}
                        </td>
                      </tr>
                    ))}
                    {data.recentLogs.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-6 py-10 text-center font-semibold text-slate-400">
                          История парсинга пуста.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
