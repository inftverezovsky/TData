"use client";

import { useState, useEffect } from "react";

export function ExternalPlatformSettings() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/settings")
      .then(r => r.json())
      .then(data => {
        setSettings(data);
        setLoading(false);
      });
  }, []);

  const saveSetting = async (key: string, value: string) => {
    await fetch("/api/settings", {
      method: "POST",
      body: JSON.stringify({ key, value }),
    });
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  if (loading) return <div className="animate-pulse h-40 bg-slate-100 rounded-3xl" />;

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-white p-8 shadow-soft ring-1 ring-slate-200">
        <h2 className="text-xl font-bold text-slate-950 mb-6 flex items-center gap-2">
          <span>🚀 Интеграция с внешней платформой</span>
        </h2>
        
        <div className="grid gap-6 md:grid-cols-3">
          {/* ... existing URL and API Key inputs ... */}
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
              URL Приемника (Webhook)
            </label>
            <input
              type="text"
              placeholder="https://your-api.com/sync"
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 transition"
              value={settings["external_platform_url"] || ""}
              onChange={(e) => setSettings(p => ({ ...p, external_platform_url: e.target.value }))}
              onBlur={(e) => saveSetting("external_platform_url", e.target.value)}
            />
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
              API Key / Token
            </label>
            <input
              type="password"
              placeholder="Bearer token..."
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 transition"
              value={settings["external_platform_api_key"] || ""}
              onChange={(e) => setSettings(p => ({ ...p, external_platform_api_key: e.target.value }))}
              onBlur={(e) => saveSetting("external_platform_api_key", e.target.value)}
            />
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
              Global Platform ID (Fallback)
            </label>
            <input
              type="text"
              placeholder="63016"
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 transition font-mono"
              value={settings["external_platform_global_id"] || ""}
              onChange={(e) => setSettings(p => ({ ...p, external_platform_global_id: e.target.value }))}
              onBlur={(e) => saveSetting("external_platform_global_id", e.target.value)}
            />
          </div>
        </div>

        <div className="mt-8 pt-8 border-t border-slate-100">
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest mb-6">Привязка Дисциплин (Глобальные Шапки)</h3>
          <div className="grid gap-6 md:grid-cols-4">
            {["dota2", "counterstrike", "leagueoflegends", "valorant"].map(slug => (
              <div key={slug}>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">
                  {slug === "leagueoflegends" ? "LoL" : slug === "counterstrike" ? "CS" : slug.toUpperCase()} ID
                </label>
                <input
                  type="text"
                  placeholder="ID..."
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 transition font-mono"
                  value={settings[`discipline_id_${slug}`] || ""}
                  onChange={(e) => setSettings(p => ({ ...p, [`discipline_id_${slug}`]: e.target.value }))}
                  onBlur={(e) => saveSetting(`discipline_id_${slug}`, e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-3xl bg-white p-8 shadow-soft ring-1 ring-slate-200">
        <h2 className="text-xl font-bold text-slate-950 mb-6 flex items-center gap-2">
          <span>🔐 Безопасность</span>
        </h2>
        <div className="max-w-md">
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
            Сменить пароль администратора
          </label>
          <input
            type="password"
            placeholder="Новый пароль..."
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 transition"
            value={settings["admin_password"] || ""}
            onChange={(e) => setSettings(p => ({ ...p, admin_password: e.target.value }))}
            onBlur={(e) => saveSetting("admin_password", e.target.value)}
          />
          <p className="mt-3 text-xs text-slate-400">
            Этот пароль используется для доступа к данной странице настроек.
          </p>
        </div>
      </section>
    </div>
  );
}
