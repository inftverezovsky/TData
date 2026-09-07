"use client";

import { type FormEvent, useEffect, useState } from "react";
import type { TLineChampionship, TLineGlobalHeader, TLineSchedule } from "../types";
import { emptySchedule } from "./settingsData";
import { TextField, formatMoscow } from "./SettingsUi";

/** Импорт справочника и расписание имеют отдельные формы и не управляют запросами каталога. */
export function AdminTeamImportForm({
  championships,
  globalHeaders,
  disabled,
  onSubmit,
}: {
  championships: TLineChampionship[];
  globalHeaders: TLineGlobalHeader[];
  disabled: boolean;
  onSubmit: (championshipId: string, body: FormData) => void;
}) {
  const [championshipId, setChampionshipId] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => {
    if (!championshipId && championships.length > 0) setChampionshipId(championships[0].id);
  }, [championshipId, championships]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body = new FormData();
    if (url.trim()) body.set("url", url.trim());
    if (file) body.set("file", file);
    onSubmit(championshipId, body);
  };
  const selectedChampionship = championships.find((item) => item.id === championshipId);
  const sharedHeader = globalHeaders.find((header) => header.id === selectedChampionship?.globalHeaderId);
  return (
    <form onSubmit={submit} className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_auto]">
      <label>
        <span className="mb-1 block text-xs font-black text-slate-600">Чемпионат</span>
        <select
          value={championshipId}
          onChange={(event) => setChampionshipId(event.target.value)}
          className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
        >
          <option value="">Выберите чемпионат</option>
          {championships.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <TextField
        label="Google Sheets URL"
        type="url"
        value={url}
        onChange={setUrl}
        placeholder="https://docs.google.com/spreadsheets/..."
      />
      <label>
        <span className="mb-1 block text-xs font-black text-slate-600">XLSX-файл</span>
        <input
          type="file"
          accept=".xlsx"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          className="block h-10 w-full rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:font-bold"
        />
      </label>
      <button
        disabled={disabled || (!url.trim() && !file)}
        className="mt-5 h-10 rounded-xl bg-blue-600 px-4 text-sm font-black text-white disabled:opacity-50"
      >
        Импортировать
      </button>
      <p className="lg:col-span-4 text-xs text-slate-500">
        Справочник будет доступен всем чемпионатам выбранной Shapka:{" "}
        {sharedHeader?.championships.map((item) => item.name).join(", ") || "назначьте Shapka в настройках чемпионата"}.
      </p>
    </form>
  );
}

export function ScheduleForm({
  value,
  disabled,
  onSubmit,
}: {
  value: TLineSchedule;
  disabled: boolean;
  onSubmit: (payload: TLineSchedule) => void;
}) {
  const [enabled, setEnabled] = useState(value.enabled);
  useEffect(() => setEnabled(value.enabled), [value.enabled]);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled) return;
        onSubmit({ ...value, enabled, slots: value.slots.length > 0 ? value.slots : emptySchedule.slots });
      }}
      className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 p-4"
    >
      <div>
        <p className="font-black text-slate-900">08:00 · 12:00 · 16:00 · 22:00 МСК</p>
        <p className="mt-1 text-xs text-slate-500">
          Следующий запуск: {value.nextRunAt ? formatMoscow(value.nextRunAt) : "не запланирован"}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <label className="inline-flex items-center gap-2 text-sm font-bold">
          <input
            type="checkbox"
            checked={enabled}
            disabled={disabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          Включена
        </label>
        <button
          disabled={disabled}
          className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white disabled:opacity-50"
        >
          Сохранить
        </button>
      </div>
    </form>
  );
}
