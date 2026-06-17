"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { detectTournamentSource, type TournamentSource } from "@backend/utils/tournamentSource";
import { dispatchTournamentDataUpdated } from "@backend/utils/clientEvents";
import { getTournamentImportUserMessage } from "@backend/imports/userFacingErrors";

const IMPORT_CLIENT_TIMEOUT_MS = 180000;

export default function LoadTournamentButton({
  pageId,
  title,
  pageUrl,
  disciplineSlug,
  initialTournamentId,
  force = false,
  source,
  targetTab,
  targetBasePath,
  extraPayload,
  size = "md"
}: {
  pageId?: number | null;
  title: string;
  pageUrl?: string | null;
  disciplineSlug: string;
  initialTournamentId?: string;
  force?: boolean;
  source?: TournamentSource;
  targetTab?: string;
  targetBasePath?: string;
  extraPayload?: Record<string, unknown>;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function buildTournamentUrl(tournamentId: string) {
    const baseUrl = targetBasePath
      ? `${targetBasePath.replace(/\/$/, "")}/${tournamentId}`
      : `/${disciplineSlug}/tournament/${tournamentId}`;
    return targetTab ? `${baseUrl}?tab=${encodeURIComponent(targetTab)}` : baseUrl;
  }

  async function loadTournament() {
    if (initialTournamentId && !force) {
      router.push(buildTournamentUrl(initialTournamentId));
      return;
    }
    
    setLoading(true);
    setError(null);

    const resolvedSource = source ?? detectTournamentSource(pageUrl);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), IMPORT_CLIENT_TIMEOUT_MS);

    try {
      const response = await fetch(`/api/${disciplineSlug}/import-tournament`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId, title, pageUrl, force, source: resolvedSource, ...(extraPayload || {}) }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const data = (await response.json().catch(() => ({}))) as {
        tournament?: { id: string };
        error?: string;
        userMessage?: string | null;
        errorClass?: string | null;
      };

      if (!response.ok || !data.tournament?.id) {
        throw new Error(getTournamentImportUserMessage(
          resolvedSource,
          data.errorClass,
          data.userMessage ?? data.error ?? "Не удалось загрузить турнир",
        ));
      }

      router.push(buildTournamentUrl(data.tournament.id));
      router.refresh();
      dispatchTournamentDataUpdated({ tournamentId: data.tournament.id, disciplineSlug });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setError(resolvedSource === "liquipedia"
          ? "Импорт длится больше 3 минут. Обычно это медленный прокси или слишком много подстраниц Liquipedia. Попробуйте другой прокси и повторите."
          : "Импорт длится больше 3 минут. Источник отвечает медленно, попробуйте повторить позже.");
      } else {
        setError(err instanceof Error
          ? err.message
          : getTournamentImportUserMessage(resolvedSource, null, "Неизвестная ошибка"));
      }
    } finally {
      setLoading(false);
      clearTimeout(timeoutId);
    }
  }


  return (
    <div className="min-w-0 space-y-2">
      <button
        type="button"
        onClick={loadTournament}
        disabled={loading}
        className={
          size === "sm"
            ? "flex min-h-8 w-full min-w-0 items-center justify-center rounded-lg border border-slate-200/30 bg-slate-500/5 px-3 py-1 text-center text-xs font-bold text-slate-600 backdrop-blur-sm transition-all hover:bg-slate-500/10 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            : "flex min-h-11 w-full min-w-0 items-center justify-center rounded-xl border border-slate-200/50 bg-slate-500/5 px-4 py-2.5 text-center text-sm font-medium text-slate-600 backdrop-blur-sm transition-all hover:bg-slate-500/10 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-5"
        }
      >
        {loading
          ? (force ? "Обновляю..." : "Загружаю...")
          : force ? "Обновить данные" : initialTournamentId ? "Открыть" : "Загрузить данные"}
      </button>
      {error ? <p className="max-w-56 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
