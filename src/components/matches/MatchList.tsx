"use client";

import { useCallback, useMemo, useEffect, useState } from "react";
import { applyDisciplineScheduleLead } from "@/lib/matches/scheduleOffset";
import {
  buildScheduleCourtGroups,
  buildScheduleFormatGroups,
  expandScheduleAnnouncementsForDiscipline,
  getScheduleMatchCourtLabel,
  getScheduleMatchBestOfLabel,
  isDisplayableScheduleMatch,
  isScheduleMatchInUpcomingWindow,
  isSchedulePlaceholderMatch,
  isUploadableScheduleEntry,
  type ScheduleAnnouncementEntry,
} from "@/lib/matches/scheduleView";
import { resolveDisplayMatchDate, resolveExactMatchDate } from "@/lib/matches/time";
import { normalizeTeamName } from "@/lib/teams/teams";
import { getTeamAliasKey } from "@/lib/teams/canonicalize";
import type { TournamentSource } from "@/lib/utils/tournamentSource";
import { isBeachVolleyballTournamentSource } from "@/lib/utils/tournamentSource";
import { isBeachVolleyballScopeSlug } from "@/lib/tbvolley/config";
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
  court?: string | null;
  status: string | null;
  syncedAt: Date | string | null;
  rawText: string | null;
  hasPlaceholderTeams?: boolean | null;
  sourceConfidence?: number | null;
  sourceBreakdown?: unknown;
};

type DisplayMatch = ScheduleAnnouncementEntry<Match>;
type MappingInfo = { alias: string | null; platformId: string | null; logoUrl?: string | null; countryCode?: string | null };
type ScheduleEntryVariant = "matches" | "announcements";
type ScheduleMode = "all" | ScheduleEntryVariant;
type DisplayScheduleEntry = DisplayMatch & { scheduleEntryVariant: ScheduleEntryVariant };

const moscowDateFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const moscowDateOnlyFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function getMatchDateObj(match: DisplayMatch): Date | null {
  return resolveExactMatchDate(match);
}

function getMatchTimestamp(match: DisplayMatch): number | null {
  const d = getMatchDateObj(match);
  return d ? d.getTime() : null;
}

function isMatchPlaceholder(match: DisplayMatch) {
  return isSchedulePlaceholderMatch(match);
}

function getMatchStatusDotClass(match: DisplayMatch) {
  if (match.syncedAt) return "bg-emerald-500";
  if (isMatchPlaceholder(match)) return "bg-amber-400";
  if (match.platformId) return "bg-emerald-500";
  return "bg-rose-500 animate-pulse";
}

export default function MatchList({
  matches,
  mappings,
  disciplineSlug,
  source,
  selectedIds,
  setSelectedIds,
  mutate
}: {
  matches: Match[];
  mappings: Record<string, MappingInfo>;
  disciplineSlug: string;
  source: TournamentSource;
  selectedIds: Set<string>;
  setSelectedIds: (ids: Set<string>) => void;
  mutate?: () => void;
}) {
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("all");
  const [groupByPrimary, setGroupByPrimary] = useState(false);
  const [hideUploaded, setHideUploaded] = useState(false);
  const [draftAdminHeaderId, setDraftAdminHeaderId] = useState("");
  const [draftCourtByGroup, setDraftCourtByGroup] = useState<Record<string, string>>({});
  const [draftFormatByGroup, setDraftFormatByGroup] = useState<Record<string, string>>({});
  const usesCourtGrouping = isBeachVolleyballScopeSlug(disciplineSlug) || isBeachVolleyballTournamentSource(source);
  const showCourtAdminDraftFields = usesCourtGrouping && groupByPrimary;
  const showFormatAdminDraftFields = !usesCourtGrouping && groupByPrimary;
  const showAdminDraftFields = showCourtAdminDraftFields || showFormatAdminDraftFields;

  useEffect(() => {
    const handleSuccess = () => {
      if (mutate) mutate();
      setSelectedIds(new Set());
    };
    window.addEventListener('admin-upload-success', handleSuccess);
    return () => window.removeEventListener('admin-upload-success', handleSuccess);
  }, [mutate, setSelectedIds]);

  const baseMatches = useMemo<DisplayMatch[]>(() => {
    return [...matches]
      .filter(isDisplayableScheduleMatch)
      .filter((match) => isScheduleMatchInUpcomingWindow(match))
      .sort((a, b) => {
        const tsA = getMatchTimestamp(a) || Infinity;
        const tsB = getMatchTimestamp(b) || Infinity;
        if (tsA !== tsB) return tsA - tsB;
        return a.id.localeCompare(b.id);
      });
  }, [matches]);

  const baseAnnouncements = useMemo<DisplayMatch[]>(() => {
    return expandScheduleAnnouncementsForDiscipline(
      matches.filter((match) => isScheduleMatchInUpcomingWindow(match)),
      disciplineSlug,
      source,
    )
      .sort((a, b) => {
        const tsA = getMatchTimestamp(a) || Infinity;
        const tsB = getMatchTimestamp(b) || Infinity;
        if (tsA !== tsB) return tsA - tsB;
        return a.id.localeCompare(b.id);
      });
  }, [disciplineSlug, matches, source]);

  const getSelectionId = useCallback((match: DisplayMatch) => {
    return match.selectionId || match.matchId || "unknown";
  }, []);

  const displayMatches = useMemo<DisplayScheduleEntry[]>(() => {
    const visibleMatches = hideUploaded
      ? baseMatches.filter((match) => !match.syncedAt)
      : baseMatches;
    const matchEntries = visibleMatches.map((match) => ({
      ...match,
      scheduleEntryVariant: "matches" as const,
    }));
    const announcementEntries = baseAnnouncements.map((match) => ({
      ...match,
      scheduleEntryVariant: "announcements" as const,
    }));

    if (scheduleMode === "matches") return matchEntries;
    if (scheduleMode === "announcements") return announcementEntries;

    return [...matchEntries, ...announcementEntries].sort((a, b) => {
      const tsA = getMatchTimestamp(a) || Infinity;
      const tsB = getMatchTimestamp(b) || Infinity;
      if (tsA !== tsB) return tsA - tsB;
      if (a.scheduleEntryVariant !== b.scheduleEntryVariant) {
        return a.scheduleEntryVariant === "matches" ? -1 : 1;
      }
      return getSelectionId(a).localeCompare(getSelectionId(b));
    });
  }, [baseAnnouncements, baseMatches, getSelectionId, hideUploaded, scheduleMode]);

  const isDisplayEntrySelectable = useCallback((match: DisplayMatch) => {
    return isUploadableScheduleEntry(match, { disciplineSlug, source });
  }, [disciplineSlug, source]);

  const selectableMatches = useMemo(
    () => displayMatches.filter((match) => !match.syncedAt && isDisplayEntrySelectable(match)),
    [displayMatches, isDisplayEntrySelectable]
  );
  const allSelected = selectableMatches.length > 0 && selectableMatches.every(m => selectedIds.has(getSelectionId(m)));
  const groupedMatches = useMemo(() => {
    if (usesCourtGrouping) {
      return buildScheduleCourtGroups(displayMatches).map((group) => ({ label: group.court, matches: group.matches }));
    }

    return buildScheduleFormatGroups(displayMatches).map((group) => ({ label: group.format, matches: group.matches }));
  }, [displayMatches, usesCourtGrouping]);
  const showsMatches = scheduleMode !== "announcements";
  const showsAnnouncements = scheduleMode !== "matches";
  const activeBaseCount =
    (showsMatches ? baseMatches.length : 0) +
    (showsAnnouncements ? baseAnnouncements.length : 0);

  useEffect(() => {
    const visibleSelectableIds = new Set(selectableMatches.map((match) => getSelectionId(match)));
    const nextSelectedIds = new Set(Array.from(selectedIds).filter((id) => visibleSelectableIds.has(id)));
    if (nextSelectedIds.size !== selectedIds.size) {
      setSelectedIds(nextSelectedIds);
    }
  }, [getSelectionId, selectableMatches, selectedIds, setSelectedIds]);

  function toggleAll() {
    const newIds = new Set(selectedIds);
    if (allSelected) {
      selectableMatches.forEach(m => newIds.delete(getSelectionId(m)));
    } else {
      selectableMatches.forEach(m => newIds.add(getSelectionId(m)));
    }
    setSelectedIds(newIds);
  }

  function toggleHideUploaded(checked: boolean) {
    if (!showsMatches) return;

    setHideUploaded(checked);

    if (!checked) return;

    const uploadedIds = new Set(
      matches
        .filter((match) => match.syncedAt)
        .map((match) => getSelectionId(match))
    );
    if (uploadedIds.size === 0) return;

    const newIds = new Set(selectedIds);
    let changed = false;
    for (const id of uploadedIds) {
      if (newIds.delete(id)) changed = true;
    }
    if (changed) setSelectedIds(newIds);
  }

  function toggleScheduleFilter(filter: ScheduleEntryVariant) {
    if (scheduleMode === "all") {
      setScheduleMode(filter === "matches" ? "announcements" : "matches");
      return;
    }

    setScheduleMode(scheduleMode === filter ? (filter === "matches" ? "announcements" : "matches") : "all");
  }

  function isGroupSelected(groupMatches: DisplayMatch[]) {
    const selectableGroupMatches = groupMatches.filter((match) => !match.syncedAt && isDisplayEntrySelectable(match));
    return selectableGroupMatches.length > 0 && selectableGroupMatches.every(match => selectedIds.has(getSelectionId(match)));
  }

  function toggleGroup(groupMatches: DisplayMatch[]) {
    const selectableGroupMatches = groupMatches.filter((match) => !match.syncedAt && isDisplayEntrySelectable(match));
    if (selectableGroupMatches.length === 0) return;

    const newIds = new Set(selectedIds);
    const shouldDeselect = isGroupSelected(selectableGroupMatches);

    for (const match of selectableGroupMatches) {
      const id = getSelectionId(match);
      if (shouldDeselect) newIds.delete(id);
      else newIds.add(id);
    }

    setSelectedIds(newIds);
  }

  function toggleOne(id: string) {
    const newIds = new Set(selectedIds);
    if (newIds.has(id)) newIds.delete(id);
    else newIds.add(id);
    setSelectedIds(newIds);
  }

  function formatNeutralDate(match: DisplayMatch): string {
    const d = getMatchDateObj(match);
    if (d) return moscowDateFormatter.format(applyDisciplineScheduleLead(d, disciplineSlug)).replace(",", "");

    const rawDate = match.matchDateTime?.trim();
    if (rawDate) return rawDate;

    const displayDate = resolveDisplayMatchDate(match);
    return displayDate ? moscowDateOnlyFormatter.format(displayDate) : "—";
  }

  function formatAnnouncementDate(match: DisplayMatch) {
    if (getMatchDateObj(match)) return formatNeutralDate(match);
    return match.matchDateTime?.trim() || "без точного времени";
  }

  function MatchCard({ match, variant }: { match: DisplayMatch; variant: ScheduleEntryVariant }) {
    const isPlaceholder = isMatchPlaceholder(match);
    const isUploaded = Boolean(match.syncedAt);
    const isAnnouncement = variant === "announcements";
    const isSingleAnnouncement = Boolean(match.isSingleTeamAnnouncement);
    const selectionId = getSelectionId(match);
    const isSelected = selectedIds.has(selectionId);
    const isSelectable = !isUploaded && isDisplayEntrySelectable(match);
    const bestOfLabel = getScheduleMatchBestOfLabel(match);
    const courtLabel = getScheduleMatchCourtLabel(match);

    return (
      <div
        key={match.matchId || match.id}
        onClick={() => {
          if (isSelectable) toggleOne(selectionId);
        }}
        className={`group relative flex flex-col overflow-hidden rounded-lg border bg-white px-4 py-1 transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.99] will-change-transform ${
          isUploaded
            ? "border-emerald-200 bg-emerald-50/10 cursor-default hover:border-emerald-300"
            : isSelected && isSelectable
            ? "cursor-pointer border-indigo-600 ring-1 ring-indigo-600/10 shadow-sm shadow-indigo-600/5"
            : isAnnouncement
            ? isSelectable
              ? "cursor-pointer border-sky-200 bg-sky-50/20 hover:border-indigo-300 hover:bg-sky-50/40 hover:shadow-sm"
              : "cursor-default border-sky-200 bg-sky-50/20 hover:border-sky-300"
            : isPlaceholder
              ? "cursor-pointer border-amber-200 bg-amber-50/20 hover:border-amber-300 hover:bg-amber-50/30"
              : "cursor-pointer border-slate-200 hover:border-indigo-300 hover:bg-slate-50/40 hover:shadow-sm"
        }`}
      >
        {isSelected && isSelectable && <div className="absolute inset-0 shimmer pointer-events-none" />}

        <div className="mb-0 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className={`h-1.5 w-1.5 rounded-full ${isAnnouncement ? "bg-sky-400" : getMatchStatusDotClass(match)}`} />
            {match.platformId && (
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">
                ID: <span className="text-slate-900">{match.platformId}</span>
              </span>
            )}
            {isPlaceholder && (
              <span
                className="inline-flex h-5 w-7 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-amber-700"
                title="Ожидает команд"
                aria-label="Ожидает команд"
              >
                <TimerReset className="h-3.5 w-3.5" />
              </span>
            )}
            <span className="inline-flex w-fit items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-0 text-[8px] font-black uppercase tracking-widest text-slate-700">
              {usesCourtGrouping ? courtLabel : bestOfLabel}
            </span>
            {isAnnouncement && (
              <span className="inline-flex w-fit items-center rounded-md border border-sky-200 bg-sky-50 px-2 py-0 text-[8px] font-black uppercase tracking-widest text-sky-700">
                Анонс
              </span>
            )}
            {match.syncedAt && (
              <span className="inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-widest text-emerald-600">
                <CheckCircle2 className="w-2.5 h-2.5" /> ОПУБЛИКОВАН
              </span>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            <span suppressHydrationWarning className="text-[10px] font-bold text-slate-900 tabular-nums">
              {isAnnouncement ? formatAnnouncementDate(match) : formatNeutralDate(match)}
            </span>
            {isSelectable && (
              <div className={`h-3.5 w-3.5 rounded-md border transition-all flex items-center justify-center ${
                isSelected ? "bg-indigo-600 border-indigo-600" : "bg-white border-slate-200"
              }`}>
                {isSelected && <CheckCircle2 className="h-3 w-3 text-white" />}
              </div>
            )}
          </div>
        </div>

        {isSingleAnnouncement ? (
          <div className="flex min-h-9 items-center justify-center py-1">
            {match.isStageAnnouncement ? (
              <StageSlotDisplay label={match.singleAnnouncementTeamName || match.round || match.stage || "Group Stage"} />
            ) : (
              <TeamDisplay name={match.singleAnnouncementTeamName || match.teamAName} side="center" />
            )}
          </div>
        ) : (
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
        )}
      </div>
    );
  }

  function TeamDisplay({ name, side }: { name: string | null; side: "left" | "right" | "center" }) {
    const isGenericTbd = !name || name.toLowerCase() === "tbd";
    const isNumberedTbd = name ? /^tbd\d+$/i.test(name) : false;
    const effectiveName = (isGenericTbd || isNumberedTbd) ? (name || "TBD") : name;
    const m = mappings[effectiveName]
      || mappings[effectiveName.toLowerCase()]
      || mappings[normalizeTeamName(effectiveName)]
      || mappings[getTeamAliasKey(effectiveName)];
    const pid = m?.platformId || "";
    const countryCode = m?.countryCode || "";
    return (
      <div className={`flex flex-col min-w-0 ${side === "center" ? "items-center text-center" : side === "left" ? "text-left sm:text-right" : "text-left"}`}>
        <span className="truncate text-[13px] font-bold leading-tight text-slate-900 transition-colors group-hover:text-indigo-600 sm:text-[15px]">
          {effectiveName}
        </span>
        <div className={`flex items-center gap-1 mt-0.5 ${side === "center" ? "justify-center" : side === "left" ? "justify-start sm:justify-end" : "justify-start"}`}>
          {countryCode ? (
            <span className="text-[7px] font-black px-1 py-0 rounded-full border border-slate-200 bg-slate-50 text-slate-500">
              {countryCode}
            </span>
          ) : null}
          <span className={`text-[7px] font-black px-1 py-0 rounded-full border ${pid ? "bg-emerald-50 border-emerald-100 text-emerald-700" : "bg-rose-50 border-rose-100 text-rose-600"}`}>
            {pid || "НЕТ ID"}
          </span>
        </div>
      </div>
    );
  }

  function StageSlotDisplay({ label }: { label: string }) {
    const m = mappings[label]
      || mappings[label.toLowerCase()]
      || mappings[normalizeTeamName(label)]
      || mappings[getTeamAliasKey(label)];
    const pid = m?.platformId || "";
    return (
      <div className="flex min-w-0 flex-col items-center text-center">
        <span className="truncate text-[13px] font-bold leading-tight text-slate-900 transition-colors group-hover:text-indigo-600 sm:text-[15px]">
          {label}
        </span>
        <div className="mt-0.5 flex items-center justify-center gap-1">
          <span className="text-[7px] font-black uppercase tracking-widest text-sky-500">
            стадия турнира
          </span>
          <span className={`text-[7px] font-black px-1 py-0 rounded-full border ${pid ? "bg-emerald-50 border-emerald-100 text-emerald-700" : "bg-rose-50 border-rose-100 text-rose-600"}`}>
            {pid || "НЕТ ID"}
          </span>
        </div>
      </div>
    );
  }

  function getEmptyStateText() {
    if (scheduleMode === "announcements") return "Анонсов нет.";
    if (hideUploaded && showsMatches && baseMatches.length > 0 && (scheduleMode === "matches" || baseAnnouncements.length === 0)) {
      return "Все залитые матчи скрыты.";
    }
    if (scheduleMode === "matches") return "Нет предстоящих матчей.";
    return "Нет предстоящих матчей и анонсов.";
  }

  function formatGroupCountLabel(groupMatches: DisplayScheduleEntry[]) {
    if (scheduleMode !== "all") {
      return `${scheduleMode === "announcements" ? "Анонсов" : "Матчей"}: ${groupMatches.length}`;
    }

    const matchesCount = groupMatches.filter((match) => match.scheduleEntryVariant === "matches").length;
    const announcementsCount = groupMatches.length - matchesCount;
    return `Матчей: ${matchesCount} / Анонсов: ${announcementsCount}`;
  }

  return (
    <div className="mt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={showsMatches}
            onClick={() => toggleScheduleFilter("matches")}
            className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors ${
              showsMatches
                ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                : "border-slate-200 bg-white text-slate-500 hover:border-indigo-200 hover:text-indigo-600"
            }`}
          >
            <LayoutGrid className="w-3 h-3" />
            Предстоящие матчи
            <span className="rounded-full bg-white/70 px-1.5 py-0 text-[8px] text-slate-500">{baseMatches.length}</span>
          </button>
          <button
            type="button"
            aria-pressed={showsAnnouncements}
            onClick={() => toggleScheduleFilter("announcements")}
            className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors ${
              showsAnnouncements
                ? "border-sky-200 bg-sky-50 text-sky-700"
                : "border-slate-200 bg-white text-slate-500 hover:border-sky-200 hover:text-sky-600"
            }`}
          >
            <Clock className="w-3 h-3" />
            Анонсы
            <span className="rounded-full bg-white/70 px-1.5 py-0 text-[8px] text-slate-500">{baseAnnouncements.length}</span>
          </button>
        </div>

        {activeBaseCount > 0 && (
          <div className="flex flex-wrap items-center justify-end gap-3">
            <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 transition-colors hover:border-indigo-200 hover:text-indigo-600">
              <span className={`h-4 w-4 rounded border transition-all flex items-center justify-center ${
                groupByPrimary ? "bg-indigo-600 border-indigo-600" : "bg-white border-slate-200"
              }`}>
                {groupByPrimary && <CheckCircle2 className="h-3 w-3 text-white" />}
              </span>
              <input
                type="checkbox"
                checked={groupByPrimary}
                onChange={(event) => setGroupByPrimary(event.target.checked)}
                className="sr-only"
              />
              {usesCourtGrouping ? "Группировка по кортам" : "Группировка по формату"}
            </label>
            {(showsMatches || selectableMatches.length > 0) && (
              <>
                {showsMatches && (
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 transition-colors hover:border-emerald-200 hover:text-emerald-600">
                    <span className={`h-4 w-4 rounded border transition-all flex items-center justify-center ${
                      hideUploaded ? "bg-emerald-500 border-emerald-500" : "bg-white border-slate-200"
                    }`}>
                      {hideUploaded && <CheckCircle2 className="h-3 w-3 text-white" />}
                    </span>
                    <input
                      type="checkbox"
                      checked={hideUploaded}
                      onChange={(event) => toggleHideUploaded(event.target.checked)}
                      className="sr-only"
                    />
                    Скрыть залитые
                  </label>
                )}
                {selectableMatches.length > 0 && (
                  <button
                    onClick={toggleAll}
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
                {showAdminDraftFields && (
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={draftAdminHeaderId}
                    onChange={(event) => setDraftAdminHeaderId(event.target.value.replace(/\D/g, ""))}
                    aria-label="ID шапки турнира для админки"
                    placeholder="ID шапки"
                    className="h-8 w-28 rounded-lg border border-slate-200 bg-white px-2.5 text-[10px] font-bold text-slate-700 outline-none transition-colors placeholder:text-slate-300 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                  />
                )}
              </>
            )}
          </div>
        )}
      </div>

      {displayMatches.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-slate-200 bg-white/70 p-12 text-center">
            <Clock className="w-12 h-12 text-slate-200 mx-auto mb-4" />
            <p className="text-sm font-medium text-slate-400">
              {getEmptyStateText()}
            </p>
            {showsMatches && hideUploaded && baseMatches.length > 0 && (
              <button
                type="button"
                onClick={() => setHideUploaded(false)}
                className="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 transition-colors hover:border-emerald-200 hover:text-emerald-600"
              >
                Показать залитые
              </button>
            )}
          </div>
        ) : groupByPrimary ? (
          <div className="grid gap-5">
            {groupedMatches.map((group) => {
              const groupSelected = isGroupSelected(group.matches);
              const groupSelectableCount = group.matches.filter(
                (match) => !match.syncedAt && isDisplayEntrySelectable(match)
              ).length;

              return (
                <section key={group.label} className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-3 px-1">
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-slate-800">
                      {group.label}
                    </div>
                    {showCourtAdminDraftFields && (
                      <input
                        type="text"
                        value={draftCourtByGroup[group.label] ?? ""}
                        onChange={(event) => {
                          const value = event.target.value;
                          setDraftCourtByGroup((current) => ({
                            ...current,
                            [group.label]: value,
                          }));
                        }}
                        aria-label={`Фактический корт для ${group.label}`}
                        placeholder="Факт. корт"
                        className="h-7 w-28 rounded-md border border-slate-200 bg-white px-2 text-[10px] font-bold text-slate-700 outline-none transition-colors placeholder:text-slate-300 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                      />
                    )}
                    {showFormatAdminDraftFields && (
                      <input
                        type="text"
                        value={draftFormatByGroup[group.label] ?? ""}
                        onChange={(event) => {
                          const value = event.target.value;
                          setDraftFormatByGroup((current) => ({
                            ...current,
                            [group.label]: value,
                          }));
                        }}
                        aria-label={`Фактический формат для ${group.label}`}
                        placeholder="Факт. формат"
                        className="h-7 w-32 rounded-md border border-slate-200 bg-white px-2 text-[10px] font-bold text-slate-700 outline-none transition-colors placeholder:text-slate-300 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                      />
                    )}
                    <div className="h-px min-w-8 flex-1 bg-slate-100" />
                    {groupSelectableCount > 0 && (
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.matches)}
                        disabled={groupSelectableCount === 0}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-slate-500 transition-colors hover:border-indigo-200 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <span className={`flex h-3.5 w-3.5 items-center justify-center rounded border transition-all ${
                          groupSelected ? "border-indigo-600 bg-indigo-600" : "border-slate-200 bg-white"
                        }`}>
                          {groupSelected && <CheckCircle2 className="h-2.5 w-2.5 text-white" />}
                        </span>
                        Выбрать все
                      </button>
                    )}
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      {formatGroupCountLabel(group.matches)}
                    </div>
                  </div>
                <div className="grid gap-2">
                  {group.matches.map((match) => (
                    <MatchCard
                      key={`${match.scheduleEntryVariant}:${getSelectionId(match)}`}
                      match={match}
                      variant={match.scheduleEntryVariant}
                    />
                  ))}
                </div>
              </section>
              );
            })}
          </div>
        ) : (
          <div className="grid gap-2">
            {displayMatches.map((match) => (
              <MatchCard
                key={`${match.scheduleEntryVariant}:${getSelectionId(match)}`}
                match={match}
                variant={match.scheduleEntryVariant}
              />
            ))}
          </div>
        )}
    </div>
  );
}

