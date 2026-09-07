"use client";

import type { FormEventHandler } from "react";
import { Loader2, RefreshCw, Search } from "lucide-react";

type SearchField = { label: string; value: string; onChange: (value: string) => void } & (
  | { type: "date" }
  | { type: "select"; options: ReadonlyArray<{ value: string; label: string }> }
);
type Props = {
  query: { label: string; placeholder: string; value: string; onChange: (value: string) => void };
  fields: readonly SearchField[];
  loading: boolean;
  onSubmit: FormEventHandler<HTMLFormElement>;
};

/** Общая форма задаёт доступные поля; параметры URL и момент загрузки остаются в контроллере конкретного источника. */
export function TournamentSearchForm({ query, fields, loading, onSubmit }: Props) {
  return (
    <form onSubmit={onSubmit} className={`grid gap-3 lg:items-end ${fields.length === 1 ? "lg:grid-cols-[minmax(220px,1fr)_120px_52px]" : "lg:grid-cols-[minmax(220px,1fr)_164px_140px_52px]"}`}>
      <label className="min-w-0 space-y-1.5">
        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{query.label}</span>
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
          <input value={query.value} onChange={(event) => query.onChange(event.target.value)} placeholder={query.placeholder} className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm font-bold text-slate-950 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100 placeholder:text-slate-300" />
        </div>
      </label>
      {fields.map((field) => (
        <label key={field.label} className="space-y-1.5">
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{field.label}</span>
          {field.type === "date" ? (
            <input type="date" value={field.value} onChange={(event) => field.onChange(event.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100" />
          ) : (
            <select value={field.value} onChange={(event) => field.onChange(event.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100">
              {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          )}
        </label>
      ))}
      <button type="submit" disabled={loading} aria-label="Найти" title="Найти" className="flex h-10 w-full items-center justify-center rounded-xl bg-slate-950 text-white transition hover:bg-emerald-600 active:scale-[0.96] disabled:opacity-50">
        {loading ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <RefreshCw aria-hidden="true" className="h-4 w-4" />}
      </button>
    </form>
  );
}
