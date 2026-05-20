'use client';

import { useEffect, useMemo, useState } from 'react';
import MatchList from "@/components/matches/MatchList";
import AdminUploadPanel from "@/components/admin/AdminUploadPanel";
import ExportPanel from "@/components/admin/ExportPanel";
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
}

export default function TournamentAdminView({ tournament: initialTournament, mappingMap, disciplineSlug }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedMatchIds = useMemo(() => Array.from(selectedIds), [selectedIds]);

  // SWR for caching (SAFE: Only hits local DB, not Liquipedia)
  const { data: tournament, mutate } = useSWR(
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
        {/* Matches section */}
        <section className="premium-card p-6">
          <div className="mb-6 flex items-center justify-between border-b border-slate-100 pb-6">
            <div className="flex items-center gap-3">
              <CalendarDays className="w-5 h-5 text-indigo-600" />
              <h2 className="text-xl font-bold text-slate-900">Расписание</h2>
            </div>
            <div className="rounded-full bg-slate-50 border border-slate-100 px-3 py-1 text-[10px] font-bold text-slate-400">
              {tournament.matches?.length || 0} Matches
            </div>
          </div>
          <MatchList 
            matches={normalizedMatches} 
            mappings={mappingMap} 
            disciplineSlug={disciplineSlug} 
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            mutate={mutate}
          />
        </section>
      </div>

      <div className="space-y-8">
        <div>
          <AdminUploadPanel 
            tournamentId={tournament.id} 
            disciplineSlug={disciplineSlug} 
            tournamentName={tournament.name} 
            selectedMatchIds={selectedMatchIds}
          />
        </div>

        <div>
          <ExportPanel 
            tournamentId={tournament.id} 
            disciplineSlug={disciplineSlug} 
            selectedMatchIds={selectedMatchIds}
          />
        </div>
      </div>
    </div>
  );
}
