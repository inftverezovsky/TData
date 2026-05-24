"use client";

import { use, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import SearchTournament from "@/components/liquipedia/SearchTournament";
import SearchHltv from "@/components/hltv/SearchHltv";
import SearchVlr from "@/components/vlr/SearchVlr";
import SearchDltv from "@/components/dltv/SearchDltv";
import SearchFandom from "@/components/fandom/SearchFandom";
import UpcomingTournamentsWidget from "@/components/liquipedia/UpcomingTournamentsWidget";
import HltvTournamentsWidget from "@/components/hltv/HltvTournamentsWidget";
import VlrTournamentsWidget from "@/components/vlr/VlrTournamentsWidget";
import DltvTournamentsWidget from "@/components/dltv/DltvTournamentsWidget";
import FandomTournamentsWidget from "@/components/fandom/FandomTournamentsWidget";
import { ClientErrorBoundary } from "@/components/ui/ClientErrorBoundary";

export default function DynamicDisciplinePage({
  params,
}: {
  params: Promise<{ disciplineSlug: string }>;
}) {
  const { disciplineSlug } = use(params);
  const slug = disciplineSlug.trim().toLowerCase();
  const searchParams = useSearchParams();

  const [activeTab, setActiveTab] = useState<"liquipedia" | "hltv" | "vlr" | "dltv" | "fandom">(
    slug === "counterstrike" && searchParams.get("tab") === "hltv"
      ? "hltv"
      : slug === "valorant" && searchParams.get("tab") === "vlr"
        ? "vlr"
        : slug === "dota2" && searchParams.get("tab") === "dltv"
          ? "dltv"
          : slug === "leagueoflegends" && searchParams.get("tab") === "fandom"
            ? "fandom"
            : "liquipedia"
  );

  useEffect(() => {
    if (slug === "counterstrike" && searchParams.get("tab") === "hltv") {
      setActiveTab("hltv");
    } else if (slug === "valorant" && searchParams.get("tab") === "vlr") {
      setActiveTab("vlr");
    } else if (slug === "dota2" && searchParams.get("tab") === "dltv") {
      setActiveTab("dltv");
    } else if (slug === "leagueoflegends" && searchParams.get("tab") === "fandom") {
      setActiveTab("fandom");
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

  if (slug === "valorant") {
    return (
      <div className="animate-in">
        <div className="mb-8 flex items-center gap-1 border-b border-slate-200">
          <button
            onClick={() => setActiveTab("liquipedia")}
            className={`relative px-8 py-5 text-xs font-black uppercase tracking-[0.2em] transition-all duration-200 active:scale-[0.96] will-change-transform ${
              activeTab === "liquipedia"
                ? "text-rose-600"
                : "text-slate-400 hover:bg-white/50 hover:text-slate-600"
            }`}
          >
            Liquipedia
            {activeTab === "liquipedia" && (
              <div className="absolute inset-x-0 bottom-0 h-1 rounded-t-full bg-rose-600 shadow-[0_-4px_12px_rgba(225,29,72,0.25)] animate-slide-in" />
            )}
          </button>
          <button
            onClick={() => setActiveTab("vlr")}
            className={`relative px-8 py-5 text-xs font-black uppercase tracking-[0.2em] transition-all duration-200 active:scale-[0.96] will-change-transform ${
              activeTab === "vlr"
                ? "text-rose-600"
                : "text-slate-400 hover:bg-white/50 hover:text-slate-600"
            }`}
          >
            VLR
            {activeTab === "vlr" && (
              <div className="absolute inset-x-0 bottom-0 h-1 rounded-t-full bg-rose-600 shadow-[0_-4px_12px_rgba(225,29,72,0.25)] animate-slide-in" />
            )}
          </button>
        </div>

        <div className="grid items-start gap-8 lg:grid-cols-[1fr_340px]">
          <div className="min-w-0">
            {activeTab === "liquipedia" ? (
              <div className="animate-in fade-in slide-in-from-left-4 duration-500">
                <ClientErrorBoundary title="Поиск Liquipedia недоступен">
                  <SearchTournament disciplineSlug="valorant" hideSidebar={true} />
                </ClientErrorBoundary>
              </div>
            ) : (
              <div className="animate-in fade-in slide-in-from-right-4 duration-500">
                <ClientErrorBoundary title="Поиск VLR недоступен">
                  <SearchVlr disciplineSlug="valorant" />
                </ClientErrorBoundary>
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-6">
            {activeTab === "liquipedia" ? (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <ClientErrorBoundary title="Виджет турниров недоступен">
                  <UpcomingTournamentsWidget disciplineSlug="valorant" />
                </ClientErrorBoundary>
              </div>
            ) : (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <ClientErrorBoundary title="Виджет VLR недоступен">
                  <VlrTournamentsWidget disciplineSlug="valorant" />
                </ClientErrorBoundary>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (slug === "dota2") {
    return (
      <div className="animate-in">
        <div className="mb-8 flex items-center gap-1 border-b border-slate-200">
          <button
            onClick={() => setActiveTab("liquipedia")}
            className={`relative px-8 py-5 text-xs font-black uppercase tracking-[0.2em] transition-all duration-200 active:scale-[0.96] will-change-transform ${
              activeTab === "liquipedia"
                ? "text-red-600"
                : "text-slate-400 hover:bg-white/50 hover:text-slate-600"
            }`}
          >
            Liquipedia
            {activeTab === "liquipedia" && (
              <div className="absolute inset-x-0 bottom-0 h-1 rounded-t-full bg-red-600 shadow-[0_-4px_12px_rgba(220,38,38,0.25)] animate-slide-in" />
            )}
          </button>
          <button
            onClick={() => setActiveTab("dltv")}
            className={`relative px-8 py-5 text-xs font-black uppercase tracking-[0.2em] transition-all duration-200 active:scale-[0.96] will-change-transform ${
              activeTab === "dltv"
                ? "text-red-600"
                : "text-slate-400 hover:bg-white/50 hover:text-slate-600"
            }`}
          >
            DLTV
            {activeTab === "dltv" && (
              <div className="absolute inset-x-0 bottom-0 h-1 rounded-t-full bg-red-600 shadow-[0_-4px_12px_rgba(220,38,38,0.25)] animate-slide-in" />
            )}
          </button>
        </div>

        <div className="grid items-start gap-8 lg:grid-cols-[1fr_340px]">
          <div className="min-w-0">
            {activeTab === "liquipedia" ? (
              <div className="animate-in fade-in slide-in-from-left-4 duration-500">
                <ClientErrorBoundary title="Поиск Liquipedia недоступен">
                  <SearchTournament disciplineSlug="dota2" hideSidebar={true} />
                </ClientErrorBoundary>
              </div>
            ) : (
              <div className="animate-in fade-in slide-in-from-right-4 duration-500">
                <ClientErrorBoundary title="Поиск DLTV недоступен">
                  <SearchDltv disciplineSlug="dota2" />
                </ClientErrorBoundary>
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-6">
            {activeTab === "liquipedia" ? (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <ClientErrorBoundary title="Виджет турниров недоступен">
                  <UpcomingTournamentsWidget disciplineSlug="dota2" />
                </ClientErrorBoundary>
              </div>
            ) : (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <ClientErrorBoundary title="Виджет DLTV недоступен">
                  <DltvTournamentsWidget disciplineSlug="dota2" />
                </ClientErrorBoundary>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (slug === "leagueoflegends") {
    return (
      <div className="animate-in">
        <div className="mb-8 flex items-center gap-1 border-b border-slate-200">
          <button
            onClick={() => setActiveTab("liquipedia")}
            className={`relative px-8 py-5 text-xs font-black uppercase tracking-[0.2em] transition-all duration-200 active:scale-[0.96] will-change-transform ${
              activeTab === "liquipedia"
                ? "text-indigo-600"
                : "text-slate-400 hover:bg-white/50 hover:text-slate-600"
            }`}
          >
            Liquipedia
            {activeTab === "liquipedia" && (
              <div className="absolute inset-x-0 bottom-0 h-1 rounded-t-full bg-indigo-600 shadow-[0_-4px_12px_rgba(79,70,229,0.3)] animate-slide-in" />
            )}
          </button>
          <button
            onClick={() => setActiveTab("fandom")}
            className={`relative px-8 py-5 text-xs font-black uppercase tracking-[0.2em] transition-all duration-200 active:scale-[0.96] will-change-transform ${
              activeTab === "fandom"
                ? "text-sky-700"
                : "text-slate-400 hover:bg-white/50 hover:text-slate-600"
            }`}
          >
            Fandom
            {activeTab === "fandom" && (
              <div className="absolute inset-x-0 bottom-0 h-1 rounded-t-full bg-sky-600 shadow-[0_-4px_12px_rgba(2,132,199,0.25)] animate-slide-in" />
            )}
          </button>
        </div>

        <div className="grid items-start gap-8 lg:grid-cols-[1fr_340px]">
          <div className="min-w-0">
            {activeTab === "liquipedia" ? (
              <div className="animate-in fade-in slide-in-from-left-4 duration-500">
                <ClientErrorBoundary title="Поиск Liquipedia недоступен">
                  <SearchTournament disciplineSlug="leagueoflegends" hideSidebar={true} />
                </ClientErrorBoundary>
              </div>
            ) : (
              <div className="animate-in fade-in slide-in-from-right-4 duration-500">
                <ClientErrorBoundary title="Поиск Fandom недоступен">
                  <SearchFandom disciplineSlug="leagueoflegends" />
                </ClientErrorBoundary>
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-6">
            {activeTab === "liquipedia" ? (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <ClientErrorBoundary title="Виджет турниров недоступен">
                  <UpcomingTournamentsWidget disciplineSlug="leagueoflegends" />
                </ClientErrorBoundary>
              </div>
            ) : (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <ClientErrorBoundary title="Виджет Fandom недоступен">
                  <FandomTournamentsWidget disciplineSlug="leagueoflegends" />
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
