"use client";

import { useEffect, useState } from "react";
import type { TLineSport, TLineGlobalHeader } from "../types";
import { TextField } from "./SettingsUi";

/** Формы каталога: собрать поля → дождаться сохранения → закрыть редактор только при успехе. */
export function SportForm({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (payload: { name: string; slug: string }) => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() && slug.trim()) onSubmit({ name: name.trim(), slug: slug.trim().toLowerCase() });
      }}
      className="grid gap-3 md:grid-cols-[1fr_1fr_auto]"
    >
      <TextField label="Название" value={name} onChange={setName} placeholder="Волейбол" required />
      <TextField label="Slug" value={slug} onChange={setSlug} placeholder="volleyball" required />
      <button
        disabled={disabled}
        className="mt-5 h-10 rounded-xl bg-slate-950 px-4 text-sm font-black text-white disabled:opacity-50"
      >
        Добавить
      </button>
    </form>
  );
}

export function GlobalHeaderForm({
  sports,
  disabled,
  onSubmit,
}: {
  sports: TLineSport[];
  disabled: boolean;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const [sportId, setSportId] = useState("");
  const [adminShapkaId, setAdminShapkaId] = useState("");
  const [name, setName] = useState("");
  useEffect(() => {
    if (!sportId && sports.length > 0) setSportId(sports[0].id);
  }, [sportId, sports]);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ sportId, adminShapkaId: adminShapkaId.trim(), name: name.trim() || null });
      }}
      className="grid gap-3 lg:grid-cols-[200px_220px_1fr_auto]"
    >
      <label>
        <span className="mb-1 block text-xs font-black text-slate-600">Вид спорта</span>
        <select
          value={sportId}
          onChange={(event) => setSportId(event.target.value)}
          required
          className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
        >
          {sports.map((sport) => (
            <option key={sport.id} value={sport.id}>
              {sport.name}
            </option>
          ))}
        </select>
      </label>
      <TextField
        label="Admin Shapka ID"
        value={adminShapkaId}
        onChange={setAdminShapkaId}
        placeholder="833524"
        required
      />
      <TextField label="Название Shapka" value={name} onChange={setName} placeholder="Волейбол России" />
      <button
        disabled={disabled}
        className="mt-5 h-10 rounded-xl bg-slate-950 px-4 text-sm font-black text-white disabled:opacity-50"
      >
        Добавить
      </button>
    </form>
  );
}

export function GlobalHeaderRow({
  header,
  disabled,
  onSave,
  onDisable,
}: {
  header: TLineGlobalHeader;
  disabled: boolean;
  onSave: (payload: Record<string, unknown>) => Promise<boolean>;
  onDisable: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(header.name ?? "");
  const [adminShapkaId, setAdminShapkaId] = useState(header.adminShapkaId);
  useEffect(() => {
    if (editing) return;
    setName(header.name ?? "");
    setAdminShapkaId(header.adminShapkaId);
  }, [header, editing]);
  if (editing)
    return (
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (await onSave({ name: name.trim() || null, adminShapkaId: adminShapkaId.trim() })) setEditing(false);
        }}
        className="grid gap-3 px-4 py-3 lg:grid-cols-[220px_1fr_auto_auto]"
      >
        <TextField
          label="Admin Shapka ID"
          value={adminShapkaId}
          onChange={setAdminShapkaId}
          placeholder="833524"
          required
        />
        <TextField label="Название" value={name} onChange={setName} placeholder="Волейбол России" />
        <button disabled={disabled} className="mt-5 h-10 rounded-lg bg-blue-600 px-3 text-xs font-black text-white">
          Сохранить
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="mt-5 h-10 rounded-lg border border-slate-200 px-3 text-xs font-black"
        >
          Отмена
        </button>
      </form>
    );
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div>
        <p className="font-black text-slate-900">{header.name || `Shapka #${header.adminShapkaId}`}</p>
        <p className="text-xs text-slate-500">
          {header.sportName} · ID {header.adminShapkaId} · команд {header.teamCount} · чемпионатов{" "}
          {header.championships.length}
        </p>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setEditing(true)}
          className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-black text-blue-700"
        >
          Редактировать
        </button>
        {header.active && (
          <button
            type="button"
            disabled={disabled}
            onClick={onDisable}
            className="rounded-lg border border-red-200 px-3 py-2 text-xs font-black text-red-700"
          >
            Отключить
          </button>
        )}
      </div>
    </div>
  );
}

export function ChampionshipForm({
  sports,
  globalHeaders,
  disabled,
  onSubmit,
}: {
  sports: TLineSport[];
  globalHeaders: TLineGlobalHeader[];
  disabled: boolean;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState("");
  const [sportId, setSportId] = useState("");
  const [globalHeaderId, setGlobalHeaderId] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [tolerance, setTolerance] = useState("");
  useEffect(() => {
    if (!sportId && sports.length > 0) setSportId(sports[0].id);
  }, [sportId, sports]);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          name: name.trim(),
          sportId,
          globalHeaderId: globalHeaderId || null,
          sourceUrl: sourceUrl.trim(),
          allowedTimeDriftMinutes: tolerance ? Number(tolerance) : null,
        });
      }}
      className="grid gap-3 lg:grid-cols-[1fr_180px_220px_1.5fr_160px_auto]"
    >
      <TextField label="Название" value={name} onChange={setName} placeholder="Высшая лига А. Женщины" required />
      <label>
        <span className="mb-1 block text-xs font-black text-slate-600">Вид спорта</span>
        <select
          value={sportId}
          onChange={(event) => setSportId(event.target.value)}
          required
          className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
        >
          <option value="">Выберите</option>
          {sports.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="mb-1 block text-xs font-black text-slate-600">Global Header / Shapka</span>
        <select
          value={globalHeaderId}
          onChange={(event) => setGlobalHeaderId(event.target.value)}
          className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
        >
          <option value="">Настроить позже</option>
          {globalHeaders
            .filter((header) => header.sportId === sportId && header.active)
            .map((header) => (
              <option key={header.id} value={header.id}>
                {header.name || `Shapka #${header.adminShapkaId}`}
              </option>
            ))}
        </select>
      </label>
      <TextField
        label="Официальный URL"
        type="url"
        value={sourceUrl}
        onChange={setSourceUrl}
        placeholder="https://volley.ru/calendar/..."
        required
      />
      <TextField
        label="Допуск, минуты"
        type="number"
        value={tolerance}
        onChange={setTolerance}
        placeholder="5"
        required
      />
      <button
        disabled={disabled}
        className="mt-5 h-10 rounded-xl bg-slate-950 px-4 text-sm font-black text-white disabled:opacity-50"
      >
        Добавить
      </button>
    </form>
  );
}
