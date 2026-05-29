"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Mars, Venus } from "lucide-react";
import { dispatchTournamentDataUpdated } from "@/lib/utils/clientEvents";
import type { BeachVolleyballGender } from "@/lib/sources/tbvolley/config";

const genderOptions: Array<{ value: BeachVolleyballGender; label: string }> = [
  { value: "men", label: "Мужчины" },
  { value: "women", label: "Женщины" },
];

export default function TBvolleyGenderSwitcher({
  currentGender,
  currentTournamentId,
  disciplineSlug,
  targetBasePath = "/tbvolley/tournament",
}: {
  currentGender: BeachVolleyballGender;
  currentTournamentId: string;
  disciplineSlug: string;
  targetBasePath?: string;
}) {
  const router = useRouter();
  const [loadingGender, setLoadingGender] = useState<BeachVolleyballGender | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function switchGender(nextGender: BeachVolleyballGender) {
    if (nextGender === currentGender || loadingGender) return;

    setLoadingGender(nextGender);
    setError(null);

    try {
      const response = await fetch(`/api/${disciplineSlug}/tournament/${currentTournamentId}/tbvolley-gender-switch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gender: nextGender,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        tournament?: { id: string };
        error?: string;
        userMessage?: string | null;
      };

      if (!response.ok || !data.tournament?.id) {
        throw new Error(data.userMessage || data.error || "Не удалось переключить сетку турнира.");
      }

      const baseUrl = targetBasePath.replace(/\/$/, "");
      router.push(`${baseUrl}/${data.tournament.id}`);
      router.refresh();
      dispatchTournamentDataUpdated({ tournamentId: data.tournament.id, disciplineSlug });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось переключить сетку турнира.");
    } finally {
      setLoadingGender(null);
    }
  }

  return (
    <section className="rounded-3xl bg-white px-6 py-5 shadow-soft ring-1 ring-slate-200">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Сетка турнира</p>
          <p className="mt-1 text-sm font-bold text-slate-600">
            Сейчас открыта: <span className="text-slate-950">{currentGender === "women" ? "Женщины" : "Мужчины"}</span>
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-1">
          {genderOptions.map((option) => {
            const active = option.value === currentGender;
            const loading = loadingGender === option.value;
            const Icon = option.value === "women" ? Venus : Mars;

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => switchGender(option.value)}
                disabled={active || Boolean(loadingGender)}
                aria-pressed={active}
                className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-xs font-black uppercase tracking-widest transition-all ${
                  active
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "bg-white text-slate-600 ring-1 ring-slate-200 hover:text-emerald-700 hover:ring-emerald-200 disabled:opacity-60"
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
