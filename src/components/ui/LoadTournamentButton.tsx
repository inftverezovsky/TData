"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { detectTournamentSource, type TournamentSource } from "@/lib/utils/tournamentSource";
import { dispatchTournamentDataUpdated } from "@/lib/utils/clientEvents";

const IMPORT_CLIENT_TIMEOUT_MS = 180000;

export default function LoadTournamentButton({
  pageId,
  title,
  pageUrl,
  disciplineSlug,
  initialTournamentId,
  force = false,
  source,
  size = "md"
}: {
  pageId?: number | null;
  title: string;
  pageUrl?: string | null;
  disciplineSlug: string;
  initialTournamentId?: string;
  force?: boolean;
  source?: TournamentSource;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adminAuthenticated, setAdminAuthenticated] = useState<boolean | null>(null);

  const needsAdmin = force || !initialTournamentId;

  useEffect(() => {
    if (!needsAdmin) return;
    fetch("/api/admin-auth/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => setAdminAuthenticated(Boolean(data.authenticated)))
      .catch(() => setAdminAuthenticated(false));
  }, [needsAdmin]);

  async function loadTournament() {
    if (initialTournamentId && !force) {
      router.push(`/${disciplineSlug}/tournament/${initialTournamentId}`);
      return;
    }

    if (adminAuthenticated === false) {
      setError("Импорт доступен после входа в админ-раздел.");
      return;
    }
    
    setLoading(true);
    setError(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), IMPORT_CLIENT_TIMEOUT_MS);

    try {
      const resolvedSource = source ?? detectTournamentSource(pageUrl);
      const response = await fetch(`/api/${disciplineSlug}/import-tournament`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId, title, pageUrl, force, source: resolvedSource }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const data = (await response.json()) as { tournament?: { id: string }; error?: string };

      if (!response.ok || !data.tournament?.id) {
        throw new Error(data.error ?? "Не удалось загрузить турнир");
      }

      router.push(`/${disciplineSlug}/tournament/${data.tournament.id}`);
      router.refresh();
      dispatchTournamentDataUpdated({ tournamentId: data.tournament.id, disciplineSlug });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setError("Импорт длится больше 3 минут. Обычно это медленный прокси или слишком много подстраниц Liquipedia. Попробуйте другой прокси и повторите.");
      } else {
        setError(err instanceof Error ? err.message : "Неизвестная ошибка");
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
        disabled={loading || adminAuthenticated === false}
        className={
          size === "sm"
            ? "flex min-h-8 w-full min-w-0 items-center justify-center rounded-lg border border-slate-200/30 bg-slate-500/5 px-3 py-1 text-center text-xs font-bold text-slate-600 backdrop-blur-sm transition-all hover:bg-slate-500/10 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            : "flex min-h-11 w-full min-w-0 items-center justify-center rounded-xl border border-slate-200/50 bg-slate-500/5 px-4 py-2.5 text-center text-sm font-medium text-slate-600 backdrop-blur-sm transition-all hover:bg-slate-500/10 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-5"
        }
      >
        {loading
          ? (force ? "Обновляю..." : "Загружаю...")
          : adminAuthenticated === false && needsAdmin
            ? "Войдите для импорта"
            : force ? "Обновить данные" : initialTournamentId ? "Открыть" : "Загрузить данные"}
      </button>
      {error ? <p className="max-w-56 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
