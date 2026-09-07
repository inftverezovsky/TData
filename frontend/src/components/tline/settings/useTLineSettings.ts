"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import {
  loadSports,
  loadChampionships,
  loadGlobalHeaders,
  loadSchedule,
  loadAdminStatus,
  loadMappings,
  EMPTY_SPORTS,
  EMPTY_CHAMPIONSHIPS,
  EMPTY_GLOBAL_HEADERS,
} from "./settingsData";

/** Загружает независимые справочники и хранит состояние одной операции; ошибки чтения доступны для повтора. */
export function useTLineSettings() {
  const sportsQuery = useSWR("/api/tline/sports", loadSports, { revalidateOnFocus: false });
  const championshipsQuery = useSWR("/api/tline/championships", loadChampionships, { revalidateOnFocus: false });
  const globalHeadersQuery = useSWR("/api/tline/global-headers", loadGlobalHeaders, { revalidateOnFocus: false });
  const scheduleQuery = useSWR("/api/tline/schedule", loadSchedule, { revalidateOnFocus: false });
  const adminQuery = useSWR("/api/tline/admin-connection/status", loadAdminStatus, { revalidateOnFocus: false });
  const [selectedChampionshipId, setSelectedChampionshipId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sports = sportsQuery.data ?? EMPTY_SPORTS;
  const championships = championshipsQuery.data ?? EMPTY_CHAMPIONSHIPS;
  const globalHeaders = globalHeadersQuery.data ?? EMPTY_GLOBAL_HEADERS;

  useEffect(() => {
    if (!selectedChampionshipId && championships.length > 0) setSelectedChampionshipId(championships[0].id);
  }, [championships, selectedChampionshipId]);

  const mappingsKey = selectedChampionshipId
    ? `/api/tline/championships/${encodeURIComponent(selectedChampionshipId)}/team-mappings`
    : null;
  const mappingsQuery = useSWR(mappingsKey, loadMappings, { revalidateOnFocus: false });

  const runAction = async (key: string, action: () => Promise<string | void>) => {
    setBusy(key);
    setMessage(null);
    setError(null);
    try {
      const confirmation = await action();
      if (!confirmation) return false;
      setMessage(confirmation);
      return true;
    } catch (cause) {
      setError(messageOf(cause));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const queries = [sportsQuery, championshipsQuery, globalHeadersQuery, scheduleQuery, adminQuery, mappingsQuery];
  const loadError = queries.find((query) => query.error)?.error;
  const retryLoads = () => Promise.allSettled(queries.map((query) => query.mutate()));
  return {
    sportsQuery,
    championshipsQuery,
    globalHeadersQuery,
    scheduleQuery,
    adminQuery,
    mappingsQuery,
    selectedChampionshipId,
    setSelectedChampionshipId,
    busy,
    message,
    error,
    sports,
    championships,
    globalHeaders,
    runAction,
    loadError: loadError ? messageOf(loadError) : null,
    retryLoads,
  };
}

function messageOf(value: unknown) {
  return value instanceof Error ? value.message : "Неизвестная ошибка";
}
