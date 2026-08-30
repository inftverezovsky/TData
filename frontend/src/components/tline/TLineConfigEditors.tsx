"use client";

import { FormEvent, useEffect, useState } from "react";

import type { TLineChampionship, TLineGlobalHeader, TLineSport } from "./types";

export function SportConfigEditor({
  sport,
  disabled,
  onSave,
}: {
  sport: TLineSport;
  disabled: boolean;
  onSave: (payload: Record<string, unknown>) => void;
}) {
  const [values, setValues] = useState(() => sportValues(sport));
  useEffect(() => setValues(sportValues(sport)), [sport]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({
      adminSportId: values.adminSportId.trim() || null,
      autoPeriodFromOffsetMinutes: numberOrNull(values.from),
      autoPeriodToOffsetMinutes: numberOrNull(values.to),
      candidateMatchWindowMinutes: numberOrNull(values.window),
      defaultAllowedTimeDriftMinutes: numberOrNull(values.tolerance),
      active: values.active,
      autoEnabled: values.autoEnabled,
    });
  };
  return (
    <details className="border-t border-slate-100 px-4 py-3">
      <summary className="cursor-pointer text-xs font-black text-blue-700">Параметры проверки</summary>
      <form onSubmit={submit} className="mt-3 grid gap-3 lg:grid-cols-5">
        <EditorInput label="Admin Sport ID" value={values.adminSportId} onChange={(value) => setValues({ ...values, adminSportId: value })} />
        <EditorInput label="Начало, мин." type="number" value={values.from} onChange={(value) => setValues({ ...values, from: value })} />
        <EditorInput label="Конец, мин." type="number" value={values.to} onChange={(value) => setValues({ ...values, to: value })} />
        <EditorInput label="Окно кандидатов" type="number" min="1" value={values.window} onChange={(value) => setValues({ ...values, window: value })} />
        <EditorInput label="Допуск 0–5 мин." type="number" min="0" max="5" value={values.tolerance} onChange={(value) => setValues({ ...values, tolerance: value })} />
        <Toggle label="Активен" checked={values.active} onChange={(active) => setValues({ ...values, active })} />
        <Toggle label="Участвует в расписании" checked={values.autoEnabled} onChange={(autoEnabled) => setValues({ ...values, autoEnabled })} />
        <button disabled={disabled} className="h-10 rounded-xl bg-slate-950 px-4 text-sm font-black text-white disabled:opacity-50">Сохранить спорт</button>
      </form>
    </details>
  );
}

export function ChampionshipConfigEditor({
  championship,
  globalHeaders,
  disabled,
  onSave,
}: {
  championship: TLineChampionship;
  globalHeaders: TLineGlobalHeader[];
  disabled: boolean;
  onSave: (payload: Record<string, unknown>) => void;
}) {
  const [values, setValues] = useState(() => championshipValues(championship));
  useEffect(() => setValues(championshipValues(championship)), [championship]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({
      globalHeaderId: values.globalHeaderId || null,
      adminChampionshipId: values.adminId.trim() || null,
      adminChampionshipName: values.adminName.trim() || null,
      allowedTimeDriftMinutes: numberOrNull(values.tolerance),
      candidateMatchWindowMinutes: numberOrNull(values.window),
      active: values.active,
      autoEnabled: values.autoEnabled,
    });
  };
  return (
    <details className="border-t border-slate-100 px-4 py-3">
      <summary className="cursor-pointer text-xs font-black text-blue-700">Admin и правила чемпионата</summary>
      <form onSubmit={submit} className="mt-3 grid gap-3 lg:grid-cols-4">
        <label><span className="mb-1 block text-xs font-black text-slate-600">Global Header / Shapka</span><select value={values.globalHeaderId} onChange={(event) => setValues({ ...values, globalHeaderId: event.target.value })} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"><option value="">Не назначена</option>{globalHeaders.filter((header) => header.sportId === championship.sportId).map((header) => <option key={header.id} value={header.id}>{header.name || `Shapka #${header.adminShapkaId}`}</option>)}</select></label>
        <EditorInput label="Admin Championship ID" value={values.adminId} onChange={(value) => setValues({ ...values, adminId: value })} />
        <EditorInput label="Название в Admin" value={values.adminName} onChange={(value) => setValues({ ...values, adminName: value })} />
        <EditorInput label="Допуск 0–5 мин." type="number" min="0" max="5" value={values.tolerance} onChange={(value) => setValues({ ...values, tolerance: value })} />
        <EditorInput label="Окно кандидатов" type="number" min="1" value={values.window} onChange={(value) => setValues({ ...values, window: value })} />
        <Toggle label="Активен" checked={values.active} onChange={(active) => setValues({ ...values, active })} />
        <Toggle label="Участвует в расписании" checked={values.autoEnabled} onChange={(autoEnabled) => setValues({ ...values, autoEnabled })} />
        <button disabled={disabled} className="h-10 rounded-xl bg-slate-950 px-4 text-sm font-black text-white disabled:opacity-50">Сохранить чемпионат</button>
      </form>
    </details>
  );
}

function EditorInput({ label, value, onChange, type = "text", min, max }: { label: string; value: string; onChange: (value: string) => void; type?: string; min?: string; max?: string }) {
  return <label><span className="mb-1 block text-xs font-black text-slate-600">{label}</span><input type={type} min={min} max={max} value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm" /></label>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="inline-flex h-10 items-center gap-2 text-sm font-bold"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{label}</label>;
}

function sportValues(sport: TLineSport) {
  return {
    adminSportId: sport.adminSportId ?? "",
    from: valueString(sport.autoPeriodFromOffsetMinutes),
    to: valueString(sport.autoPeriodToOffsetMinutes),
    window: valueString(sport.candidateMatchWindowMinutes),
    tolerance: valueString(sport.defaultAllowedTimeDriftMinutes),
    active: sport.active,
    autoEnabled: sport.autoEnabled,
  };
}

function championshipValues(championship: TLineChampionship) {
  return {
    globalHeaderId: championship.globalHeaderId ?? "",
    adminId: championship.adminChampionshipId ?? "",
    adminName: championship.adminChampionshipName ?? "",
    tolerance: valueString(championship.allowedTimeDriftMinutes),
    window: valueString(championship.candidateMatchWindowMinutes),
    active: championship.active,
    autoEnabled: championship.autoEnabled,
  };
}

function numberOrNull(value: string) {
  return value.trim() === "" ? null : Number(value);
}

function valueString(value: number | null | undefined) {
  return value == null ? "" : String(value);
}
