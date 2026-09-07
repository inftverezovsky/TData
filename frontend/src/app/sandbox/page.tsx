"use client";

import { useState } from "react";
import { Code2, Languages } from "lucide-react";
import AutoMappingTranslationsSandbox from "@/components/settings/AutoMappingTranslationsSandbox";
import ParserSandbox from "@/components/settings/ParserSandbox";
import { ClientErrorBoundary } from "@/components/ui/ClientErrorBoundary";

const SANDBOX_TABS = [
  { key: "parser", label: "Парсинг", icon: Code2 },
  { key: "translations", label: "Переводы", icon: Languages },
] as const;

export default function SandboxPage() {
  const [activeTab, setActiveTab] = useState<(typeof SANDBOX_TABS)[number]["key"]>("parser");

  return (
    <div className="space-y-8">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-sky-600">
          TData Sandbox
        </p>
        <h1 className="mt-4 text-5xl font-black tracking-normal text-slate-950">
          Песочница <span className="text-slate-400">TData.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-xl font-bold leading-relaxed text-slate-700">
          Быстрая проверка парсеров и автомапинга без записи в базу.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {SANDBOX_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black transition ${
                active
                  ? "bg-sky-600 text-white shadow-md shadow-sky-600/15"
                  : "bg-white text-slate-500 ring-1 ring-slate-200 hover:text-slate-950"
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "parser" && (
        <ClientErrorBoundary title="Песочница парсинга недоступна">
          <ParserSandbox />
        </ClientErrorBoundary>
      )}

      {activeTab === "translations" && (
        <ClientErrorBoundary title="Песочница переводов недоступна">
          <AutoMappingTranslationsSandbox />
        </ClientErrorBoundary>
      )}
    </div>
  );
}
