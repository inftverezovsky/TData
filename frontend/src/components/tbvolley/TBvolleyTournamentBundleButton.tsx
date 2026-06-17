"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { detectTournamentSource, type TournamentSource } from "@backend/utils/tournamentSource";
import { dispatchTournamentDataUpdated } from "@backend/utils/clientEvents";
import { getTournamentImportUserMessage } from "@backend/imports/userFacingErrors";

type BundleItem = {
  title: string;
  pageUrl: string;
  source: Extract<TournamentSource, "volleyballworld" | "beachvolleyru" | "germanbeachtour" | "twelvendrcsvp" | "twelvendroevv" | "cbv" | "federvolley">;
  extraPayload?: Record<string, unknown>;
};

const IMPORT_CLIENT_TIMEOUT_MS = 180000;

export default function TBvolleyTournamentBundleButton({
  items,
  disciplineSlug,
  targetBasePath = "/tbvolley/tournament",
}: {
  items: BundleItem[];
  disciplineSlug: string;
  targetBasePath?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadBundle() {
    if (loading || items.length === 0) return;

    setLoading(true);
    setError(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), IMPORT_CLIENT_TIMEOUT_MS);

    try {
      const importedIds: string[] = [];

      for (const item of items) {
        const itemSource = item.source ?? detectTournamentSource(item.pageUrl);
        const response = await fetch(`/api/${disciplineSlug}/import-tournament`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: item.title,
            pageUrl: item.pageUrl,
            source: itemSource,
            force: true,
            ...(item.extraPayload || {}),
          }),
          signal: controller.signal,
        });

        const data = (await response.json().catch(() => ({}))) as {
          tournament?: { id: string };
          error?: string;
          userMessage?: string | null;
          errorClass?: string | null;
        };

        if (!response.ok || !data.tournament?.id) {
          throw new Error(getTournamentImportUserMessage(
            itemSource,
            data.errorClass,
            data.userMessage ?? data.error ?? "Не удалось загрузить турнир",
          ));
        }

        importedIds.push(data.tournament.id);
      }

      const tournamentId = importedIds[0];
      if (!tournamentId) throw new Error("Не удалось загрузить турнир");

      const baseUrl = targetBasePath.replace(/\/$/, "");
      router.push(`${baseUrl}/${tournamentId}`);
      router.refresh();
      dispatchTournamentDataUpdated({ tournamentId, disciplineSlug });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setError("Импорт длится больше 3 минут. Попробуйте повторить обновление.");
      } else {
        setError(err instanceof Error
          ? err.message
          : getTournamentImportUserMessage(null, null, "Неизвестная ошибка"));
      }
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  }

  return (
    <div className="min-w-0 space-y-2">
      <button
        type="button"
        onClick={loadBundle}
        disabled={loading || items.length === 0}
        className="flex min-h-11 w-full min-w-0 items-center justify-center rounded-xl border border-slate-200/50 bg-slate-500/5 px-4 py-2.5 text-center text-sm font-medium text-slate-600 backdrop-blur-sm transition-all hover:bg-slate-500/10 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-5"
      >
        {loading ? "Загружаю сетки..." : "Загрузить данные"}
      </button>
      {error ? <p className="max-w-56 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
