'use client';

import { useEffect, useMemo, useState } from 'react';
import MatchList from "@/components/matches/MatchList";
import AdminUploadPanel from "@/components/admin/AdminUploadPanel";
import ExportPanel from "@/components/admin/ExportPanel";
import { ClientErrorBoundary } from "@/components/ui/ClientErrorBoundary";
import useSWR from 'swr';
import { fetcher } from '@/lib/utils/fetcher';
import {
  ADMIN_MAPPING_UPDATED_EVENT,
  TEAM_MAPPINGS_UPDATED_EVENT,
  TOURNAMENT_DATA_UPDATED_EVENT,
} from "@/lib/utils/clientEvents";
import { CalendarDays } from "lucide-react";

interface Props {
  tournament: any;
  mappingMap: any;
  disciplineSlug: string;
  adminSettings: {
    apiUrl: string;
    adminSportId: string;
    adminMax: string;
    defaultShapkaId: string;
    timezone: string;
    dateFormat: string;
    requestMode: string;
  };
}

export default function TournamentAdminView({ tournament: initialTournament, mappingMap, disciplineSlug, adminSettings }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<"schedule" | "upload">("schedule");
  const selectedMatchIds = useMemo(() => Array.from(selectedIds), [selectedIds]);

  const { data: tournament, error: refreshError, mutate } = useSWR(
    `/api/${disciplineSlug}/tournament/${initialTournament.id}/data`,
    fetcher,
    {
      fallbackData: initialTournament,
      refreshInterval: 0,
      revalidateOnFocus: false,
      revalidateOnReconnect: false
    }
  );

  const normalizedMatches = useMemo(
    () => tournament.matches?.map((m: any) => ({
      ...m,
      lpNumericalId: m.lpNumericalId ? m.lpNumericalId.toString() : null
    })) || [],
    [tournament.matches]
  );

  useEffect(() => {
    mutate(initialTournament, { revalidate: true });
  }, [initialTournament, mutate]);

  useEffect(() => {
    const currentTab = new URL(window.location.href).searchParams.get("tab");
    setActiveTab(currentTab === "upload" ? "upload" : "schedule");
  }, []);

  useEffect(() => {
    const handleRefresh = (event: Event) => {
      const detail = (event as CustomEvent<{ tournamentId?: string; disciplineSlug?: string }>).detail;
      if (detail?.disciplineSlug && detail.disciplineSlug !== disciplineSlug) return;
      if (detail?.tournamentId && detail.tournamentId !== initialTournament.id) return;

      mutate();
      if (event.type === TOURNAMENT_DATA_UPDATED_EVENT) {
        setSelectedIds(new Set());
      }
    };

    window.addEventListener(TOURNAMENT_DATA_UPDATED_EVENT, handleRefresh);
    window.addEventListener(TEAM_MAPPINGS_UPDATED_EVENT, handleRefresh);
    window.addEventListener(ADMIN_MAPPING_UPDATED_EVENT, handleRefresh);

    return () => {
      window.removeEventListener(TOURNAMENT_DATA_UPDATED_EVENT, handleRefresh);
      window.removeEventListener(TEAM_MAPPINGS_UPDATED_EVENT, handleRefresh);
      window.removeEventListener(ADMIN_MAPPING_UPDATED_EVENT, handleRefresh);
    };
  }, [disciplineSlug, initialTournament.id, mutate]);

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px] animate-in">
      <div className="space-y-8">
        <section className="premium-card p-6">
          <div className="mb-6 flex items-center justify-between border-b border-slate-100 pb-6">
            <div className="flex items-center gap-3">
              <CalendarDays className="w-5 h-5 text-indigo-600" />
              <h2 className="text-xl font-bold text-slate-900">Расписание</h2>
            </div>
            <div className="rounded-full bg-slate-50 border border-slate-100 px-3 py-1 text-[10px] font-bold text-slate-400">
              Матчей: {tournament.matches?.length || 0}
            </div>
          </div>
          {refreshError ? (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800">
              Не удалось обновить расписание из API. Показаны последние данные страницы.
            </div>
          ) : null}
          <ClientErrorBoundary title="Расписание временно недоступно">
            <MatchList
              matches={normalizedMatches}
              mappings={mappingMap}
              disciplineSlug={disciplineSlug}
              selectedIds={selectedIds}
              setSelectedIds={setSelectedIds}
              mutate={mutate}
            />
          </ClientErrorBoundary>
        </section>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-1 border-b border-slate-200">
          <button
            type="button"
            onClick={() => setActiveTab("schedule")}
            className={`relative px-6 py-4 text-xs font-black uppercase tracking-[0.2em] transition-all duration-200 ${
              activeTab === "schedule" ? "text-indigo-600" : "text-slate-400 hover:text-slate-600"
            }`}
          >
            Расписание
            {activeTab === "schedule" && <div className="absolute inset-x-0 bottom-0 h-1 rounded-t-full bg-indigo-600" />}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("upload")}
            className={`relative px-6 py-4 text-xs font-black uppercase tracking-[0.2em] transition-all duration-200 ${
              activeTab === "upload" ? "text-indigo-600" : "text-slate-400 hover:text-slate-600"
            }`}
          >
            Загрузка
            {activeTab === "upload" && <div className="absolute inset-x-0 bottom-0 h-1 rounded-t-full bg-indigo-600" />}
          </button>
        </div>

        <div className="space-y-8">
          <ClientErrorBoundary title="Панель заливки временно недоступна">
            <AdminUploadPanel
              tournamentId={tournament.id}
              disciplineSlug={disciplineSlug}
              tournamentName={tournament.name}
              initialSettings={adminSettings}
              selectedMatchIds={selectedMatchIds}
            />
          </ClientErrorBoundary>

          <ClientErrorBoundary title="Экспорт временно недоступен">
            <ExportPanel
              tournamentId={tournament.id}
              disciplineSlug={disciplineSlug}
              selectedMatchIds={selectedMatchIds}
            />
          </ClientErrorBoundary>
        </div>
      </div>
    </div>
  );
}
