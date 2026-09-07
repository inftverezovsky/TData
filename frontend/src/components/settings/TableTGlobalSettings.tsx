"use client";

import { useState } from "react";
import { useGlobalSettings } from "@/hooks/useGlobalSettings";
import { SettingsRequestError } from "./SettingsRequestError";

const DEFAULT_SETTINGS = {
  tablet_wtt_default_days: "14",
  tablet_wtt_window_days: "60",
  tablet_admin_api_url: "",
  tablet_sport_id: "",
};

type TableTSettings = typeof DEFAULT_SETTINGS;
const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as Array<keyof TableTSettings>;

export default function TableTGlobalSettings() {
  const [isSourceOpen, setIsSourceOpen] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const { settings, setSettings, loading, loaded, saving, error, retryLoad, save } = useGlobalSettings(
    DEFAULT_SETTINGS,
    normalizeSettings,
  );

  const handleSave = async () => {
    // Выходим из редактирования только после подтверждения сервера; при ошибке введённые значения остаются на месте.
    if (await save()) setIsEditing(false);
  };

  if (loading) return <div className="h-20 animate-pulse rounded-3xl bg-slate-100" />;

  if (!loaded) return <SettingsRequestError message={error || "Не удалось загрузить настройки."} onRetry={retryLoad} />;

  return (
    <div className="space-y-8">
      {error && <SettingsRequestError message={error} />}
      <section className="premium-card overflow-hidden transition-all duration-500">
        <div
          className="flex cursor-pointer items-center justify-between p-8 transition-colors hover:bg-slate-50/50"
          onClick={() => !isEditing && setIsSourceOpen(!isSourceOpen)}
        >
          <div className="flex items-center gap-4">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-2xl transition-all ${isSourceOpen ? "bg-cyan-600 text-white shadow-lg shadow-cyan-200" : "bg-slate-100 text-slate-400"}`}
            >
              <svg
                className={`h-6 w-6 transition-transform duration-500 ${isSourceOpen ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            <div>
              <h2 className="text-2xl font-black tracking-tight text-slate-900">TableT: WTT</h2>
              <p className="mt-0.5 text-xs font-bold text-slate-500">
                Источник событий World Table Tennis и окно поиска турниров
              </p>
            </div>
          </div>

          <EditActions
            isEditing={isEditing}
            saving={saving}
            onEdit={() => {
              setIsEditing(true);
              setIsSourceOpen(true);
            }}
            onCancel={() => setIsEditing(false)}
            onSave={handleSave}
          />
        </div>

        <div
          className={`overflow-hidden transition-all duration-500 ease-in-out ${isSourceOpen ? "max-h-[1200px] opacity-100" : "max-h-0 opacity-0"}`}
        >
          <div className="space-y-6 p-8 pt-0">
            <div className="mb-8 h-px bg-slate-100" />

            <dl className="grid gap-6">
              <SettingsRow
                label="Default Days"
                name="tablet_wtt_default_days"
                value={settings.tablet_wtt_default_days}
                isEditing={isEditing}
                onChange={(val) => setSettings({ ...settings, tablet_wtt_default_days: val.replace(/[^\d]/g, "") })}
              />
              <SettingsRow
                label="Import Window Days"
                name="tablet_wtt_window_days"
                value={settings.tablet_wtt_window_days}
                isEditing={isEditing}
                onChange={(val) => setSettings({ ...settings, tablet_wtt_window_days: val.replace(/[^\d]/g, "") })}
              />
            </dl>
          </div>
        </div>
      </section>

      <section className="premium-card overflow-hidden transition-all duration-500">
        <div
          className="flex cursor-pointer items-center justify-between p-8 transition-colors hover:bg-slate-50/50"
          onClick={() => !isEditing && setIsUploadOpen(!isUploadOpen)}
        >
          <div className="flex items-center gap-4">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-2xl transition-all ${isUploadOpen ? "bg-cyan-600 text-white shadow-lg shadow-cyan-200" : "bg-slate-100 text-slate-400"}`}
            >
              <svg
                className={`h-6 w-6 transition-transform duration-500 ${isUploadOpen ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            <div>
              <h2 className="text-2xl font-black tracking-tight text-slate-900">TableT: Заливка</h2>
              <p className="mt-0.5 text-xs font-bold text-slate-500">
                Отдельные Admin API и Sport ID для настольного тенниса
              </p>
            </div>
          </div>

          <EditActions
            isEditing={isEditing}
            saving={saving}
            onEdit={() => {
              setIsEditing(true);
              setIsUploadOpen(true);
            }}
            onCancel={() => setIsEditing(false)}
            onSave={handleSave}
          />
        </div>

        <div
          className={`overflow-hidden transition-all duration-500 ease-in-out ${isUploadOpen ? "max-h-[1200px] opacity-100" : "max-h-0 opacity-0"}`}
        >
          <div className="space-y-6 p-8 pt-0">
            <div className="mb-8 h-px bg-slate-100" />

            <dl className="grid gap-6">
              <SettingsRow
                label="TableT Admin API URL"
                name="tablet_admin_api_url"
                value={settings.tablet_admin_api_url}
                isEditing={isEditing}
                onChange={(val) => setSettings({ ...settings, tablet_admin_api_url: val })}
              />
              <SettingsRow
                label="TableT Sport ID"
                name="tablet_sport_id"
                value={settings.tablet_sport_id}
                isEditing={isEditing}
                onChange={(val) => setSettings({ ...settings, tablet_sport_id: val.replace(/[^\d]/g, "") })}
              />
            </dl>
          </div>
        </div>
      </section>
    </div>
  );
}

function normalizeSettings(data: Partial<Record<string, string>>): TableTSettings {
  return SETTING_KEYS.reduce((acc, key) => {
    acc[key] = data[key] ?? DEFAULT_SETTINGS[key];
    return acc;
  }, {} as TableTSettings);
}

function EditActions({
  isEditing,
  saving,
  onEdit,
  onCancel,
  onSave,
}: {
  isEditing: boolean;
  saving: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  if (isEditing) {
    return (
      <div className="flex items-center gap-3">
        <button
          onClick={(event) => {
            event.stopPropagation();
            onCancel();
          }}
          className="px-6 py-2 text-xs font-black uppercase tracking-widest text-slate-400 transition-colors hover:text-slate-600"
        >
          Отмена
        </button>
        <button
          onClick={(event) => {
            event.stopPropagation();
            onSave();
          }}
          disabled={saving}
          className="btn-primary px-8 py-2 text-xs"
        >
          {saving ? "..." : "Сохранить"}
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={(event) => {
        event.stopPropagation();
        onEdit();
      }}
      className="btn-secondary px-8 py-2 text-xs"
    >
      Изменить
    </button>
  );
}

function SettingsRow({
  label,
  name,
  value,
  isEditing,
  type = "text",
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  isEditing: boolean;
  type?: string;
  onChange: (val: string) => void;
}) {
  return (
    <div className="grid items-center gap-3 border-b border-slate-50 pb-6 last:border-0 sm:grid-cols-[220px_minmax(0,1fr)]">
      <dt className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</dt>
      <dd>
        {isEditing ? (
          <input
            type={type}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-950 transition-all focus:border-cyan-600 focus:outline-none focus:ring-4 focus:ring-cyan-600/5"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            name={name}
          />
        ) : (
          <span className="block w-fit break-all rounded-xl border border-slate-100 bg-slate-50 px-4 py-2 font-mono text-sm font-bold text-slate-900">
            {type === "password" ? "********" : value || "не задано"}
          </span>
        )}
      </dd>
    </div>
  );
}
