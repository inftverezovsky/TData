"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Mars, Venus, UsersRound } from "lucide-react";
import { dispatchTournamentDataUpdated } from "@/lib/utils/clientEvents";
import type { TableTennisCategoryScope } from "@/lib/sources/tablet/config";

const categoryOptions: Array<{ value: TableTennisCategoryScope; label: string; icon: typeof Mars }> = [
  { value: "men", label: "Мужчины", icon: Mars },
  { value: "women", label: "Женщины", icon: Venus },
  { value: "men-doubles", label: "Муж. пары", icon: UsersRound },
  { value: "women-doubles", label: "Жен. пары", icon: UsersRound },
  { value: "mixed", label: "Микст", icon: UsersRound },
];

export default function WttCategorySwitcher({
  currentCategory,
  currentTournamentId,
  disciplineSlug,
  targetBasePath = "/tablet/tournament",
}: {
  currentCategory: TableTennisCategoryScope;
  currentTournamentId: string;
  disciplineSlug: string;
  targetBasePath?: string;
}) {
  const router = useRouter();
  const [loadingCategory, setLoadingCategory] = useState<TableTennisCategoryScope | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function switchCategory(nextCategory: TableTennisCategoryScope) {
    if (nextCategory === currentCategory || loadingCategory) return;

    setLoadingCategory(nextCategory);
    setError(null);

    try {
      const response = await fetch(`/api/${disciplineSlug}/tournament/${currentTournamentId}/wtt-category-switch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryScope: nextCategory }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        tournament?: { id: string };
        error?: string;
      };

      if (!response.ok || !data.tournament?.id) {
        throw new Error(data.error || "Не удалось переключить сетку WTT.");
      }

      const baseUrl = targetBasePath.replace(/\/$/, "");
      router.push(`${baseUrl}/${data.tournament.id}`);
      router.refresh();
      dispatchTournamentDataUpdated({ tournamentId: data.tournament.id, disciplineSlug });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось переключить сетку WTT.");
    } finally {
      setLoadingCategory(null);
    }
  }

  const currentLabel = categoryOptions.find((option) => option.value === currentCategory)?.label || currentCategory;

  return (
    <section className="rounded-3xl bg-white px-6 py-5 shadow-soft ring-1 ring-slate-200">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Сетка WTT</p>
          <p className="mt-1 text-sm font-bold text-slate-600">
            Сейчас открыта: <span className="text-slate-950">{currentLabel}</span>
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-1 sm:grid-cols-3 xl:grid-cols-5">
          {categoryOptions.map((option) => {
            const active = option.value === currentCategory;
            const loading = loadingCategory === option.value;
            const Icon = option.icon;

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => switchCategory(option.value)}
                disabled={active || Boolean(loadingCategory)}
                aria-pressed={active}
                className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-[10px] font-black uppercase tracking-widest transition-all ${
                  active
                    ? "bg-cyan-600 text-white shadow-sm"
                    : "bg-white text-slate-600 ring-1 ring-slate-200 hover:text-cyan-700 hover:ring-cyan-200 disabled:opacity-60"
                }`}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">
          {error}
        </div>
      ) : null}
    </section>
  );
}
