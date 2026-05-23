"use client";

import { useMemo, useEffect } from "react";
import { getBestOfLabel } from "@/lib/matches/format";
import { applyDisciplineScheduleLead } from "@/lib/matches/scheduleOffset";
import { isPlaceholderTeam, normalizeTeamName } from "@/lib/teams/teams";
import { getTeamAliasKey } from "@/lib/teams/canonicalize";
import { Clock, LayoutGrid, CheckCircle2, TimerReset } from "lucide-react";

type Match = {
  id: string;
  matchId: string;
  lpNumericalId: string | number | null;
  platformId: string | null;
  matchDate: Date | string | null;
  matchDateTime: string | null;
  teamAName: string | null;
  teamBName: string | null;
  scoreA: number | null;
  scoreB: number | null;
  stage: string | null;
  round: string | null;
  format?: string | null;
  status: string | null;
  syncedAt: Date | string | null;
  rawText: string | null;
  hasPlaceholderTeams?: boolean | null;
  sourceConfidence?: number | null;
  sourceBreakdown?: unknown;
};

type MappingInfo = { alias: string | null; platformId: string | null; logoUrl?: string | null };

const moscowDateFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function getMatchDateObj(match: Match): Date | null {
  let d: Date | null = null;
  if (match.matchDate) {
    d = typeof match.matchDate === "string" ? new Date(match.matchDate) : match.matchDate;
    if (isNaN(d.getTime())) d = null;
  }
  if (!d && match.matchDateTime) {
    const cleaned = match.matchDateTime.replace(/\s*-\s*/, " ").replace(/\s+[A-Z]{2,5}$/, "");
    // Treat as MSK: create UTC date then subtract 3h
    const parsed = new Date(cleaned + "Z");
    if (!isNaN(parsed.getTime())) {
      d = parsed;
    }
  }
  return d;
}

function getMatchTimestamp(match: Match): number | null {
  const d = getMatchDateObj(match);
  return d ? d.getTime() : null;
}

function isMatchPlaceholder(match: Match) {
  return Boolean(
    match.hasPlaceholderTeams ||
    isPlaceholderTeam(match.teamAName) ||
    isPlaceholderTeam(match.teamBName)
  );
}

function hasExactVisibleTime(match: Match) {
  return /\b\d{1,2}:\d{2}\b/.test(match.matchDateTime || "");
}

function isGeneratedScheduleMatrixRow(match: Match) {
  if (isMatchPlaceholder(match)) return false;
  if (getMatchDateObj(match)) return false;
  if (hasExactVisibleTime(match)) return false;

  const rawText = String(match.rawText || "").toLowerCase();
  const format = String(match.format || "").toLowerCase().trim();
  return format === "round robin" || rawText.includes("crosstable");
}

export default function MatchList({
  matches,
  mappings,
  disciplineSlug,
  selectedIds,
  setSelectedIds,
  mutate
}: {
  matches: Match[];
  mappings: Record<string, MappingInfo>;
  disciplineSlug: string;
  selectedIds: Set<string>;
  setSelectedIds: (ids: Set<string>) => void;
  mutate?: () => void;
}) {
  useEffect(() => {
    const handleSuccess = () => {
      if (mutate) mutate();
      setSelectedIds(new Set());
    };
    window.addEventListener('admin-upload-success', handleSuccess);
    return () => window.removeEventListener('admin-upload-success', handleSuccess);
  }, [mutate, setSelectedIds]);

  const displayMatches = useMemo(() => {
    return [...matches]
      .filter(m => {
        // Liquipedia crosstable rows are schedule matrix hints, not exact
        // upload-ready matches. TBD slots are preserved separately.
        if (isGeneratedScheduleMatrixRow(m)) return false;

        // 1. Скрываем матчи с результатами
        if (m.scoreA !== null || m.scoreB !== null) return false;

        return true;
      })
      .sort((a, b) => {
        const tsA = getMatchTimestamp(a) || Infinity;
        const tsB = getMatchTimestamp(b) || Infinity;
        if (tsA !== tsB) return tsA - tsB;
        return a.id.localeCompare(b.id);
      });
  }, [matches]);

  const selectableMatches = displayMatches;
  const allSelected = selectableMatches.length > 0 && selectableMatches.every(m => selectedIds.has(m.matchId || "unknown"));

  function toggleAll() {
    const newIds = new Set(selectedIds);
    if (allSelected) {
      selectableMatches.forEach(m => newIds.delete(m.matchId || "unknown"));
    } else {
      selectableMatches.forEach(m => newIds.add(m.matchId || "unknown"));
    }
    setSelectedIds(newIds);
  }

  function toggleOne(id: string) {
    const newIds = new Set(selectedIds);
    if (newIds.has(id)) newIds.delete(id);
    else newIds.add(id);
    setSelectedIds(newIds);
  }

  function formatNeutralDate(match: Match): string {
    const d = getMatchDateObj(match);
    if (!d) return "—";
    return moscowDateFormatter.format(applyDisciplineScheduleLead(d, disciplineSlug)).replace(",", "");
  }

  function TeamDisplay({ name, side }: { name: string | null; side: "left" | "right" }) {
    const isGenericTbd = !name || name.toLowerCase() === "tbd";
    const isNumberedTbd = name ? /^tbd\d+$/i.test(name) : false;
    const effectiveName = (isGenericTbd || isNumberedTbd) ? (name || "TBD") : name;
    const m = mappings[effectiveName]
      || mappings[effectiveName.toLowerCase()]
      || mappings[normalizeTeamName(effectiveName)]
      || mappings[getTeamAliasKey(effectiveName)];
    const pid = m?.platformId || "";
    return (
      <div className={`flex flex-col min-w-0 ${side === "left" ? "text-left sm:text-right" : "text-left"}`}>
        <span className="truncate text-[13px] font-bold leading-tight text-slate-900 transition-colors group-hover:text-indigo-600 sm:text-[15px]">
          {effectiveName}
        </span>
        <div className={`flex items-center gap-1 mt-0.5 ${side === "left" ? "justify-start sm:justify-end" : "justify-start"}`}>
          <span className={`text-[7px] font-black px-1 py-0 rounded-full border ${pid ? "bg-emerald-50 border-emerald-100 text-emerald-700" : "bg-rose-50 border-rose-100 text-rose-600"}`}>
            {pid || "НЕТ ID"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-900 border border-slate-200">
            <LayoutGrid className="w-3 h-3" />
            Предстоящие матчи
          </div>
        </div>

        {displayMatches.length > 0 && (
          <button 
            onClick={toggleAll}
            disabled={selectableMatches.length === 0}
            className="flex items-center gap-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-indigo-600 transition-colors"
          >
            <div className={`h-4 w-4 rounded border transition-all flex items-center justify-center ${
              allSelected ? "bg-indigo-600 border-indigo-600" : "bg-white border-slate-200"
            }`}>
              {allSelected && <CheckCircle2 className="h-3 w-3 text-white" />}
            </div>
            Выбрать все
          </button>
        )}
      </div>

      {displayMatches.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-slate-200 bg-white/70 p-12 text-center">
            <Clock className="w-12 h-12 text-slate-200 mx-auto mb-4" />
            <p className="text-sm font-medium text-slate-400">Нет предстоящих матчей.</p>
          </div>
        ) : (
          <div className="grid gap-2">
            {displayMatches.map((match) => {
              const isPlaceholder = isMatchPlaceholder(match);
              const isSelected = selectedIds.has(match.matchId || "unknown");
              const bestOfLabel = getBestOfLabel(match.format) || getBestOfLabel(match.rawText) || "Карт?";
              
              return (
                <div
                  key={match.matchId || match.id}
                  onClick={() => toggleOne(match.matchId || "unknown")}
                  className={`group relative flex flex-col overflow-hidden rounded-lg border bg-white px-4 py-1 transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.99] will-change-transform cursor-pointer ${
                    isSelected 
                      ? "border-indigo-600 ring-1 ring-indigo-600/10 shadow-sm shadow-indigo-600/5" 
                      : isPlaceholder 
                        ? "border-amber-200 bg-amber-50/20 hover:border-amber-300 hover:bg-amber-50/30" 
                        : "border-slate-200 hover:border-indigo-300 hover:bg-slate-50/40 hover:shadow-sm"
                  }`}
                >
                  {/* Shimmer overlay for selected state */}
                  {isSelected && <div className="absolute inset-0 shimmer pointer-events-none" />}
                  
                  <div className="mb-0 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className={`h-1.5 w-1.5 rounded-full ${isPlaceholder ? "bg-amber-400" : match.platformId ? "bg-emerald-500" : "bg-rose-500 animate-pulse"}`} />
                      {match.platformId && (
                        <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">
                          ID: <span className="text-slate-900">{match.platformId}</span>
                        </span>
                      )}
                      {isPlaceholder && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0 text-[8px] font-black uppercase tracking-widest text-amber-700">
                          <TimerReset className="h-2.5 w-2.5" />
                          ОЖИДАЕТ КОМАНД
                        </span>
                      )}
                      <span className="inline-flex w-fit items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-0 text-[8px] font-black uppercase tracking-widest text-slate-700">
                        {bestOfLabel}
                      </span>
                      {match.syncedAt && (
                        <span className="inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-widest text-emerald-600">
                          <CheckCircle2 className="w-2.5 h-2.5" /> ОПУБЛИКОВАН
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-3 sm:justify-end">
                      <span suppressHydrationWarning className="text-[10px] font-bold text-slate-900 tabular-nums">
                        {formatNeutralDate(match)}
                      </span>
                      <div className={`h-3.5 w-3.5 rounded-md border transition-all flex items-center justify-center ${
                        isSelected ? "bg-indigo-600 border-indigo-600" : "bg-white border-slate-200"
                      }`}>
                        {isSelected && <CheckCircle2 className="h-3 w-3 text-white" />}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center sm:gap-4">
                    <div className="min-w-0">
                      <TeamDisplay name={match.teamAName} side="left" />
                    </div>
                    
                    <div className="flex shrink-0 flex-row items-center gap-2 sm:flex-col sm:gap-0.5">
                      <div className="rounded-full bg-slate-50 border border-slate-100 px-2 py-0 text-[7px] font-bold text-slate-300 uppercase tracking-[0.18em]">против</div>
                      {(match.scoreA != null || match.scoreB != null) && (
                        <div className="text-xl font-bold tabular-nums gradient-text">
                          {match.scoreA ?? "0"} <span className="text-slate-200">:</span> {match.scoreB ?? "0"}
                        </div>
                      )}
                    </div>

                    <div className="min-w-0">
                      <TeamDisplay name={match.teamBName} side="right" />
                    </div>
                  </div>

                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}

