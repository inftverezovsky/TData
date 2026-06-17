"use client";

import { useState } from "react";
import { SettingsPasswordGate } from "@/components/settings/SettingsPasswordGate";
import LiquipediaGlobalSettings from "@/components/settings/LiquipediaGlobalSettings";
import TBvolleyGlobalSettings from "@/components/settings/TBvolleyGlobalSettings";
import TableTGlobalSettings from "@/components/settings/TableTGlobalSettings";
import { AdminTeamImporter } from "@/components/admin/AdminTeamImporter";
import SystemHealthDashboard from "@/components/settings/SystemHealthDashboard";
import ParserSandbox from "@/components/settings/ParserSandbox";
import ProxyManager from "@/components/settings/ProxyManager";
import { ClientErrorBoundary } from "@/components/ui/ClientErrorBoundary";
import { Sliders, Database, Network, Terminal, Activity, ChevronDown } from "lucide-react";

export default function SettingsPage() {
  const [openPanels, setOpenPanels] = useState<Record<string, boolean>>({
    global: false,
    tbvolley: false,
    tablet: false,
    importer: false,
    proxy: false,
    sandbox: false,
    health: false,
  });

  const togglePanel = (panel: string) => {
    setOpenPanels((prev) => ({ ...prev, [panel]: !prev[panel] }));
  };

  return (
    <SettingsPasswordGate>
      <div className="space-y-10">
        {/* Page Header */}
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-indigo-600">Engine Configuration</p>
          <h1 className="mt-4 text-5xl font-black tracking-tighter text-slate-950">
            Настройки <span className="text-slate-400">TData.</span>
          </h1>
          <p className="mt-6 text-xl font-bold leading-relaxed text-slate-700 max-w-2xl">
            Центральный пульт управления API-коннекторами, прокси-серверами, базами данных и отладкой парсинга.
          </p>
        </div>

        {/* Accordion Panels Container */}
        <div className="space-y-4">
          
          {/* 1. TData */}
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-soft transition-all duration-300">
            <button
              onClick={() => togglePanel("global")}
              className="flex w-full items-center justify-between p-6 text-left hover:bg-slate-50/50 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className={`flex h-12 w-12 items-center justify-center rounded-2xl transition-all ${openPanels.global ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/10" : "bg-slate-100 text-slate-400"}`}>
                  <Sliders className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-950 tracking-tight">TData</h2>
                  <p className="mt-0.5 text-xs font-bold text-slate-500">Liquipedia endpoints, сетевые лимиты и Admin API для cyber-направления</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-indigo-50 border border-indigo-100 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-indigo-600">
                  API
                </span>
                <ChevronDown className={`h-5 w-5 text-slate-400 transition-transform duration-300 ${openPanels.global ? "rotate-180 text-indigo-600" : ""}`} />
              </div>
            </button>
            <div className={`transition-all duration-300 ease-in-out ${openPanels.global ? "max-h-[2500px] border-t border-slate-100 opacity-100" : "max-h-0 opacity-0 overflow-hidden"}`}>
              {openPanels.global && (
                <div className="p-6 bg-white">
                  <ClientErrorBoundary title="Параметры API недоступны">
                    <LiquipediaGlobalSettings />
                  </ClientErrorBoundary>
                </div>
              )}
            </div>
          </div>

          {/* 2. TBvolley */}
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-soft transition-all duration-300">
            <button
              onClick={() => togglePanel("tbvolley")}
              className="flex w-full items-center justify-between p-6 text-left hover:bg-slate-50/50 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className={`flex h-12 w-12 items-center justify-center rounded-2xl transition-all ${openPanels.tbvolley ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/10" : "bg-slate-100 text-slate-400"}`}>
                  <Sliders className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-950 tracking-tight">TBvolley</h2>
                  <p className="mt-0.5 text-xs font-bold text-slate-500">Volleyball World, beach.volley.ru, German Beach Tour, 12ndr, CBV, Federvolley и Admin API пляжного волейбола</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-indigo-50 border border-indigo-100 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-indigo-600">
                  API
                </span>
                <ChevronDown className={`h-5 w-5 text-slate-400 transition-transform duration-300 ${openPanels.tbvolley ? "rotate-180 text-indigo-600" : ""}`} />
              </div>
            </button>
            <div className={`transition-all duration-300 ease-in-out ${openPanels.tbvolley ? "max-h-[7600px] border-t border-slate-100 opacity-100" : "max-h-0 opacity-0 overflow-hidden"}`}>
              {openPanels.tbvolley && (
                <div className="p-6 bg-white">
                  <ClientErrorBoundary title="Параметры TBvolley недоступны">
                    <TBvolleyGlobalSettings />
                  </ClientErrorBoundary>
                </div>
              )}
            </div>
          </div>

          {/* 3. TableT */}
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-soft transition-all duration-300">
            <button
              onClick={() => togglePanel("tablet")}
              className="flex w-full items-center justify-between p-6 text-left hover:bg-slate-50/50 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className={`flex h-12 w-12 items-center justify-center rounded-2xl transition-all ${openPanels.tablet ? "bg-cyan-600 text-white shadow-md shadow-cyan-600/10" : "bg-slate-100 text-slate-400"}`}>
                  <Sliders className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-950 tracking-tight">TableT</h2>
                  <p className="mt-0.5 text-xs font-bold text-slate-500">WTT events, локальное время турниров и отдельная заливка настольного тенниса</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-cyan-50 border border-cyan-100 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-cyan-600">
                  API
                </span>
                <ChevronDown className={`h-5 w-5 text-slate-400 transition-transform duration-300 ${openPanels.tablet ? "rotate-180 text-cyan-600" : ""}`} />
              </div>
            </button>
            <div className={`transition-all duration-300 ease-in-out ${openPanels.tablet ? "max-h-[2600px] border-t border-slate-100 opacity-100" : "max-h-0 opacity-0 overflow-hidden"}`}>
              {openPanels.tablet && (
                <div className="p-6 bg-white">
                  <ClientErrorBoundary title="Параметры TableT недоступны">
                    <TableTGlobalSettings />
                  </ClientErrorBoundary>
                </div>
              )}
            </div>
          </div>

          {/* 4. Импортер Команд в Базу */}
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-soft transition-all duration-300">
            <button
              onClick={() => togglePanel("importer")}
              className="flex w-full items-center justify-between p-6 text-left hover:bg-slate-50/50 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className={`flex h-12 w-12 items-center justify-center rounded-2xl transition-all ${openPanels.importer ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/10" : "bg-slate-100 text-slate-400"}`}>
                  <Database className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-950 tracking-tight">Импортер Команд (Admin)</h2>
                  <p className="mt-0.5 text-xs font-bold text-slate-500">Синхронизация и загрузка ID команд во внутреннюю базу</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-amber-50 border border-amber-100 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-amber-600">
                  Импорт
                </span>
                <ChevronDown className={`h-5 w-5 text-slate-400 transition-transform duration-300 ${openPanels.importer ? "rotate-180 text-indigo-600" : ""}`} />
              </div>
            </button>
            <div className={`transition-all duration-300 ease-in-out ${openPanels.importer ? "max-h-[1500px] border-t border-slate-100 opacity-100" : "max-h-0 opacity-0 overflow-hidden"}`}>
              {openPanels.importer && (
                <div className="p-6 bg-white">
                  <ClientErrorBoundary title="Импорт команд недоступен">
                    <AdminTeamImporter />
                  </ClientErrorBoundary>
                </div>
              )}
            </div>
          </div>

          {/* 5. Менеджер Прокси-Пула */}
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-soft transition-all duration-300">
            <button
              onClick={() => togglePanel("proxy")}
              className="flex w-full items-center justify-between p-6 text-left hover:bg-slate-50/50 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className={`flex h-12 w-12 items-center justify-center rounded-2xl transition-all ${openPanels.proxy ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/10" : "bg-slate-100 text-slate-400"}`}>
                  <Network className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-950 tracking-tight">Менеджер Прокси-Пула</h2>
                  <p className="mt-0.5 text-xs font-bold text-slate-500">Добавление, проверка пингов и статистика блокировок нод</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-emerald-50 border border-emerald-100 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-emerald-600">
                  Пул Прокси
                </span>
                <ChevronDown className={`h-5 w-5 text-slate-400 transition-transform duration-300 ${openPanels.proxy ? "rotate-180 text-indigo-600" : ""}`} />
              </div>
            </button>
            <div className={`transition-all duration-300 ease-in-out ${openPanels.proxy ? "max-h-[2000px] border-t border-slate-100 opacity-100" : "max-h-0 opacity-0 overflow-hidden"}`}>
              {openPanels.proxy && (
                <div className="p-6 bg-white">
                  <ClientErrorBoundary title="Менеджер прокси недоступен">
                    <ProxyManager />
                  </ClientErrorBoundary>
                </div>
              )}
            </div>
          </div>

          {/* 6. Песочница Парсинга Wikitext */}
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-soft transition-all duration-300">
            <button
              onClick={() => togglePanel("sandbox")}
              className="flex w-full items-center justify-between p-6 text-left hover:bg-slate-50/50 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className={`flex h-12 w-12 items-center justify-center rounded-2xl transition-all ${openPanels.sandbox ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/10" : "bg-slate-100 text-slate-400"}`}>
                  <Terminal className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-950 tracking-tight">Песочница Wikitext</h2>
                  <p className="mt-0.5 text-xs font-bold text-slate-500">Ручная отладка правил нормализации до сохранения в БД</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-sky-50 border border-sky-100 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-sky-600">
                  Песочница
                </span>
                <ChevronDown className={`h-5 w-5 text-slate-400 transition-transform duration-300 ${openPanels.sandbox ? "rotate-180 text-indigo-600" : ""}`} />
              </div>
            </button>
            <div className={`transition-all duration-300 ease-in-out ${openPanels.sandbox ? "max-h-[2000px] border-t border-slate-100 opacity-100" : "max-h-0 opacity-0 overflow-hidden"}`}>
              {openPanels.sandbox && (
                <div className="p-6 bg-white">
                  <ClientErrorBoundary title="Песочница парсинга недоступна">
                    <ParserSandbox />
                  </ClientErrorBoundary>
                </div>
              )}
            </div>
          </div>

          {/* 7. Панель Диагностики и Телеметрии */}
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-soft transition-all duration-300">
            <button
              onClick={() => togglePanel("health")}
              className="flex w-full items-center justify-between p-6 text-left hover:bg-slate-50/50 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className={`flex h-12 w-12 items-center justify-center rounded-2xl transition-all ${openPanels.health ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/10" : "bg-slate-100 text-slate-400"}`}>
                  <Activity className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-950 tracking-tight">Мониторинг Системы</h2>
                  <p className="mt-0.5 text-xs font-bold text-slate-500">Задержка БД, активность парсинга и логи блокировок</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-rose-50 border border-rose-100 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-rose-600">
                  Телеметрия
                </span>
                <ChevronDown className={`h-5 w-5 text-slate-400 transition-transform duration-300 ${openPanels.health ? "rotate-180 text-indigo-600" : ""}`} />
              </div>
            </button>
            <div className={`transition-all duration-300 ease-in-out ${openPanels.health ? "max-h-[2000px] border-t border-slate-100 opacity-100" : "max-h-0 opacity-0 overflow-hidden"}`}>
              {openPanels.health && (
                <div className="p-6 bg-white">
                  <ClientErrorBoundary title="Мониторинг системы недоступен">
                    <SystemHealthDashboard />
                  </ClientErrorBoundary>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </SettingsPasswordGate>
  );
}
