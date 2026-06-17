"use client";

import { useEffect, useState } from "react";

type ProxyNode = {
  id: string;
  url: string;
  protocol: string;
  host: string;
  port: number;
  username: string | null;
  isActive: boolean;
  successCount: number;
  blockedCount: number;
  failCount: number;
  avgLatencyMs: number | null;
  lastError: string | null;
};

export default function ProxyManager() {
  const [proxies, setProxies] = useState<ProxyNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bulkText, setBulkText] = useState("");
  const [bulkLoading, setBulkLoading] = useState(false);

  const fetchProxies = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/proxies");
      if (!res.ok) throw new Error("Не удалось получить список прокси");
      const json = await res.json();
      setProxies(json.proxies || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка при загрузке прокси");
    } finally {
      setLoading(false);
    }
  };

  const handleBulkUpload = async () => {
    if (!bulkText.trim()) return;
    setBulkLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/proxies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxiesText: bulkText }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось загрузить прокси");
      alert(`Успешно добавлено/обновлено прокси: ${json.inserted}`);
      setBulkText("");
      fetchProxies();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка импорта");
    } finally {
      setBulkLoading(false);
    }
  };

  const handleAction = async (action: "clear-blocked" | "clear-all") => {
    if (!confirm(action === "clear-all" ? "Очистить весь пул прокси?" : "Удалить все заблокированные прокси?")) return;
    try {
      const res = await fetch("/api/admin/proxies", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error("Ошибка при выполнении операции");
      fetchProxies();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Ошибка удаления");
    }
  };

  useEffect(() => {
    fetchProxies();
  }, []);

  const total = proxies.length;
  const active = proxies.filter((p) => p.isActive).length;
  const blocked = total - active;

  const sortedProxies = [...proxies].sort((a, b) => {
    // Both active
    if (a.isActive && b.isActive) {
      const aLat = a.avgLatencyMs ?? null;
      const bLat = b.avgLatencyMs ?? null;
      if (aLat !== null && bLat !== null) {
        return aLat - bLat;
      }
      if (aLat !== null) return -1;
      if (bLat !== null) return 1;
      return 0;
    }
    // Only one active
    if (a.isActive) return -1;
    if (b.isActive) return 1;
    return 0;
  });

  return (
    <section className="rounded-3xl bg-white p-8 shadow-soft ring-1 ring-slate-200">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-6">
        <div>
          <h2 className="text-2xl font-black text-slate-950">Менеджер Прокси-Пула</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">
            Просматривайте состояние и добавляйте новые прокси-серверы для безопасного и стабильного скрапинга.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handleAction("clear-blocked")}
            className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-100 hover:text-slate-950 transition active:scale-95"
          >
            Удалить нерабочие
          </button>
          <button
            onClick={() => handleAction("clear-all")}
            className="rounded-xl bg-rose-50 border border-rose-100 px-4 py-2.5 text-xs font-bold text-rose-600 hover:bg-rose-100 hover:text-rose-700 transition active:scale-95"
          >
            Очистить пул
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-6 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-600">
          ⚠️ {error}
        </div>
      )}

      {/* Analytics Summary */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-100 p-4 bg-slate-50/50">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Всего в пуле</span>
          <div className="mt-1 text-2xl font-black text-slate-950">{total}</div>
        </div>
        <div className="rounded-2xl border border-indigo-100 p-4 bg-indigo-50/30">
          <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">Активные</span>
          <div className="mt-1 text-2xl font-black text-indigo-950">{active}</div>
        </div>
        <div className="rounded-2xl border border-rose-100 p-4 bg-rose-50/30">
          <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400">Заблокированные / Cooldown</span>
          <div className="mt-1 text-2xl font-black text-rose-950">{blocked}</div>
        </div>
      </div>

      {/* Bulk input */}
      <details className="mt-6 group">
        <summary className="flex cursor-pointer items-center justify-between list-none rounded-2xl bg-slate-50 p-4 font-bold text-slate-800 hover:bg-slate-100 transition shadow-sm">
          <span>📥 Добавить прокси списком (Bulk Import)</span>
          <div className="rounded-full bg-white p-1.5 group-open:rotate-180 transition-transform">
            <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </summary>
        <div className="mt-4 border border-slate-100 rounded-2xl p-4 bg-white space-y-4">
          <p className="text-xs font-bold text-slate-400">
            Формат ввода: по одному адресу на строку. Поддерживается: `http://user:pass@host:port` или обычный `host:port`.
          </p>
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder="http://185.120.30.40:8000&#10;socks5://user:pass@45.88.90.10:1080&#10;192.168.1.1:8080"
            rows={5}
            className="w-full rounded-xl border border-slate-200 p-3 text-xs font-mono text-slate-700 focus:border-indigo-600 focus:outline-none transition shadow-sm"
          />
          <button
            onClick={handleBulkUpload}
            disabled={bulkLoading || !bulkText.trim()}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-xs font-black text-white hover:bg-indigo-700 transition active:scale-95 disabled:opacity-50"
          >
            {bulkLoading ? "Загрузка..." : "Импортировать в пул"}
          </button>
        </div>
      </details>

      {/* Proxy Nodes Table */}
      <div className="mt-8 overflow-hidden rounded-2xl border border-slate-100">
        <div className="overflow-auto max-h-[400px] custom-scrollbar">
          <table className="w-full border-collapse text-left text-sm text-slate-500">
            <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-700 border-b border-slate-100 sticky top-0">
              <tr>
                <th className="px-6 py-4">Протокол / Адрес</th>
                <th className="px-6 py-4">Пароль / Авторизация</th>
                <th className="px-6 py-4">Статистика</th>
                <th className="px-6 py-4">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {sortedProxies.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/50 transition">
                  <td className="px-6 py-4 font-semibold text-slate-800">
                    <span className="text-[10px] font-black uppercase text-indigo-500 mr-2 bg-indigo-50 px-2 py-0.5 rounded-lg">
                      {p.protocol}
                    </span>
                    <span className="font-mono tabular-nums">{p.host}:{p.port}</span>
                  </td>
                  <td className="px-6 py-4">
                    {p.username ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                        🔒 Да ({p.username})
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-slate-300">Нет</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-xs font-bold tabular-nums">
                    <span className="text-emerald-600">✓ {p.successCount}</span>
                    <span className="text-slate-300 mx-1.5">/</span>
                    <span className="text-amber-500">⚠ {p.blockedCount}</span>
                    <span className="text-slate-300 mx-1.5">/</span>
                    <span className="text-rose-600">✗ {p.failCount}</span>
                    {p.avgLatencyMs !== undefined && p.avgLatencyMs !== null && (
                      <span className="ml-3 inline-flex items-center gap-0.5 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-black text-indigo-600">
                        ⚡ {p.avgLatencyMs}ms
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold ${
                        p.isActive
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-rose-50 text-rose-700"
                      }`}
                    >
                      {p.isActive ? "АКТИВЕН" : "ЗАБЛОКИРОВАН"}
                    </span>
                  </td>
                </tr>
              ))}
              {sortedProxies.length === 0 && !loading && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center font-semibold text-slate-400">
                    Пул пуст. Вставьте прокси списком выше.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
