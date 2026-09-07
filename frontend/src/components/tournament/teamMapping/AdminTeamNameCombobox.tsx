"use client";

import { readJsonResponse } from "@/services/responseSchema";
import { decodeTeamSuggestions } from "./response";
import { useEffect, useId, useState } from "react";
import type { AdminTeamSuggestion } from "./types";
import { formatSuggestionAlternateName, formatSuggestionMatchType, nextSuggestionIndex } from "./model";

export function AdminTeamNameCombobox({
  value,
  label,
  disciplineSlug,
  disabled,
  onChange,
  onSelect,
}: {
  value: string;
  label: string;
  disciplineSlug: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onSelect: (suggestion: AdminTeamSuggestion) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<AdminTeamSuggestion[]>([]);
  const [adminTeamsCount, setAdminTeamsCount] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const listId = useId();
  const canSearch = value.trim().length >= 2;

  useEffect(() => {
    setActiveIndex(-1);
    if (disabled || !open || !canSearch) {
      setItems([]);
      setLoading(false);
      setAdminTeamsCount(null);
      setError("");
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          disciplineSlug,
          q: value,
          limit: "8",
        });
        const response = await fetch(`/api/admin-teams/suggest?${params.toString()}`, {
          credentials: "same-origin",
          signal: controller.signal,
        });
        const data = await readJsonResponse(response, decodeTeamSuggestions, "Не удалось загрузить подсказки");
        if (controller.signal.aborted) return;
        setItems(data.items);
        setAdminTeamsCount(data.adminTeamsCount);
      } catch (fetchError) {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") return;
        setItems([]);
        setError(fetchError instanceof Error ? fetchError.message : "Не удалось загрузить подсказки");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 150);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [canSearch, disabled, disciplineSlug, open, value]);

  return (
    <div className="relative min-w-[256px] flex-1 xl:min-w-[336px]">
      <input
        type="text"
        aria-label={label}
        value={value}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(event) => {
          setOpen(true);
          setActiveIndex(-1);
          onChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((current) => nextSuggestionIndex(current, event.key === "ArrowDown" ? 1 : -1, items.length));
          } else if (event.key === "Enter" && open && items[activeIndex]) {
            event.preventDefault();
            onSelect(items[activeIndex]);
            setOpen(false);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="Начните вводить название..."
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && items[activeIndex] ? `${listId}-${activeIndex}` : undefined}
        className={`h-9 min-w-0 w-full rounded-lg border px-3 text-sm font-medium transition-all outline-none ${
          disabled
            ? "bg-slate-50 border-slate-100 text-slate-400 cursor-not-allowed"
            : "bg-white border-slate-200 text-slate-900 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-500/10"
        }`}
      />
      {open && !disabled && (canSearch || loading || error) && (
        <div
          id={listId}
          role="listbox"
          className="absolute left-0 top-full z-50 mt-1 w-[max(100%,28rem)] max-w-[min(42rem,calc(100vw-3rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10"
        >
          {loading ? (
            <div className="px-3 py-2 text-xs font-bold text-slate-400">Ищу в справочнике...</div>
          ) : error ? (
            <div className="px-3 py-2 text-xs font-bold text-rose-600">{error}</div>
          ) : adminTeamsCount === 0 ? (
            <div className="px-3 py-2 text-xs font-bold text-amber-700">Справочник команд для этой дисциплины не загружен.</div>
          ) : items.length === 0 ? (
            <div className="px-3 py-2 text-xs font-bold text-slate-400">Подходящих команд не найдено.</div>
          ) : (
            <div className="max-h-64 overflow-auto py-1">
              {items.map((item, index) => (
                <button
                  key={`${item.platformId}-${item.platformName}`}
                  type="button"
                  role="option"
                  id={`${listId}-${index}`}
                  tabIndex={-1}
                  aria-selected={activeIndex === index}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onSelect(item);
                    setOpen(false);
                  }}
                  className={`flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left text-xs transition hover:bg-indigo-50 ${activeIndex === index ? "bg-indigo-50" : ""}`}
                >
                  <span className="min-w-0">
                    <span className="block whitespace-normal break-words font-black leading-snug text-slate-900">
                      {item.matchedName || item.platformName}
                    </span>
                    {formatSuggestionAlternateName(item) && (
                      <span className="mt-1 block whitespace-normal break-words text-[11px] font-bold leading-snug text-slate-500">
                        {formatSuggestionAlternateName(item)}
                      </span>
                    )}
                    <span className="mt-0.5 block text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      ID платформы {item.platformId}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-slate-500">
                    {formatSuggestionMatchType(item.matchType)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
