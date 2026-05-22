"use client";

import { use, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import SearchTournament from "@/components/liquipedia/SearchTournament";
import SearchHltv from "@/components/hltv/SearchHltv";
import UpcomingTournamentsWidget from "@/components/liquipedia/UpcomingTournamentsWidget";
import HltvTournamentsWidget from "@/components/hltv/HltvTournamentsWidget";
import { ClientErrorBoundary } from "@/components/ui/ClientErrorBoundary";

export default function DynamicDisciplinePage({
  params,
}: {
  params: Promise<{ disciplineSlug: string }>;
}) {
  const { disciplineSlug } = use(params);
  const slug = disciplineSlug.trim().toLowerCase();
  const searchParams = useSearchParams();

  const [activeTab, setActiveTab] = useState<"liquipedia" | "hltv">(
    slug === "counterstrike" && searchParams.get("tab") === "hltv" ? "hltv" : "liquipedia"
  );

  useEffect(() => {
    if (slug === "counterstrike" && searchParams.get("tab") === "hltv") {
      setActiveTab("hltv");
    }
  }, [searchParams, slug]);

  if (slug === "counterstrike") {
    return (
      <div className="animate-in">
        {/* Sub-navigation Tabs */}
        <div className="mb-8 flex items-center gap-1 border-b border-slate-200">
          <button
            onClick={() => setActiveTab("liquipedia")}
            className={`relative px-8 py-5 text-xs font-black uppercase tracking-[0.2em] transition-all duration-200 active:scale-[0.96] will-change-transform ${
              activeTab === "liquipedia" 
                ? "text-indigo-600" 
                : "text-slate-400 hover:text-slate-600 hover:bg-white/50"
            }`}
          >
            Liquipedia
            {activeTab === "liquipedia" && (
              <div className="absolute inset-x-0 bottom-0 h-1 rounded-t-full bg-indigo-600 shadow-[0_-4px_12px_rgba(79,70,229,0.3)] animate-slide-in" />
            )}
          </button>
          <button
            onClick={() => setActiveTab("hltv")}
            className={`relative px-8 py-5 text-xs font-black uppercase tracking-[0.2em] transition-all duration-200 active:scale-[0.96] will-change-transform ${
              activeTab === "hltv" 
                ? "text-indigo-600" 
                : "text-slate-400 hover:text-slate-600 hover:bg-white/50"
            }`}
          >
            HLTV
            {activeTab === "hltv" && (
              <div className="absolute inset-x-0 bottom-0 h-1 rounded-t-full bg-indigo-600 shadow-[0_-4px_12px_rgba(79,70,229,0.3)] animate-slide-in" />
            )}
          </button>
        </div>

        <div className="grid items-start gap-8 lg:grid-cols-[1fr_340px]">
          {/* Main Content Area */}
          <div className="min-w-0">
            {activeTab === "liquipedia" ? (
              <div className="animate-in fade-in slide-in-from-left-4 duration-500">
                <ClientErrorBoundary title="Поиск Liquipedia недоступен">
                  <SearchTournament disciplineSlug="counterstrike" hideSidebar={true} />
                </ClientErrorBoundary>
              </div>
            ) : (
              <div className="animate-in fade-in slide-in-from-right-4 duration-500">
                <ClientErrorBoundary title="Поиск HLTV недоступен">
                  <SearchHltv disciplineSlug="counterstrike" />
                </ClientErrorBoundary>
              </div>
            )}
          </div>
          
          {/* Sidebar Area */}
          <div className="min-w-0 space-y-6">
            {activeTab === "liquipedia" ? (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <ClientErrorBoundary title="Виджет турниров недоступен">
                  <UpcomingTournamentsWidget disciplineSlug="counterstrike" />
                </ClientErrorBoundary>
              </div>
            ) : (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <ClientErrorBoundary title="Виджет HLTV недоступен">
                  <HltvTournamentsWidget disciplineSlug="counterstrike" />
                </ClientErrorBoundary>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in">
      <div className="space-y-12">
        <ClientErrorBoundary title="Поиск Liquipedia недоступен">
          <SearchTournament disciplineSlug={slug} />
        </ClientErrorBoundary>
      </div>
    </div>
  );
}
