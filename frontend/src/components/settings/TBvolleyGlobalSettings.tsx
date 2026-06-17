"use client";

import { useEffect, useState } from "react";
import { BEACH_VOLLEYBALL_ADMIN_SPORT_ID } from "@backend/sources/tbvolley/config";

const DEFAULT_SETTINGS = {
  tbvolley_volleyballworld_api: "https://en.volleyballworld.com/api/v1/globalschedule",
  tbvolley_user_agent: "TData TBvolley/1.0 (+https://en.volleyballworld.com/global-schedule)",
  tbvolley_default_days: "14",
  tbvolley_beachvolleyru_calendar_url: "https://beach.volley.ru/calendar/",
  tbvolley_beachvolleyru_user_agent: "TData TBvolley/1.0 (+https://beach.volley.ru/calendar/)",
  tbvolley_beachvolleyru_window_months: "1",
  tbvolley_germanbeachtour_calendar_url: "https://beach.volleyball-verband.de/public/tur.php",
  tbvolley_germanbeachtour_user_agent: "TData TBvolley/1.0 (+https://beach.volleyball-verband.de/public/tur.php)",
  tbvolley_germanbeachtour_window_months: "1",
  tbvolley_twelvendr_calendar_url: "https://fivb.12ndr.at/scripts/calendar.php",
  tbvolley_twelvendr_tournament_url: "https://fivb.12ndr.at/scripts/tournament.php",
  tbvolley_twelvendr_user_agent: "TData TBvolley/1.0 (+https://fivb.12ndr.at)",
  tbvolley_cbv_api_url: "https://evolleyball.cbv.com.br/eVolleyball/api",
  tbvolley_cbv_user_agent: "TData TBvolley/1.0 (+https://evolleyball.cbv.com.br/#!/tabelas)",
  tbvolley_federvolley_assoluto_url: "https://beachvolley.federvolley.it/index.php/campionato-assoluto/tornei/precedenti",
  tbvolley_federvolley_serie_url: "https://beachvolley.federvolley.it/index.php/serie-beach/tornei/precedenti",
  tbvolley_federvolley_matchshare_url: "https://srv.matchshare.it/bvl_test/rest_api/matches/json_for_bracket",
  tbvolley_federvolley_user_agent: "TData TBvolley/1.0 (+https://beachvolley.federvolley.it)",
  tbvolley_admin_api_url: "",
  tbvolley_sport_id: BEACH_VOLLEYBALL_ADMIN_SPORT_ID,
};

type TBvolleySettings = typeof DEFAULT_SETTINGS;
const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as Array<keyof TBvolleySettings>;

export default function TBvolleyGlobalSettings() {
  const [isSourceOpen, setIsSourceOpen] = useState(false);
  const [isBeachVolleyRuOpen, setIsBeachVolleyRuOpen] = useState(false);
  const [isGermanBeachTourOpen, setIsGermanBeachTourOpen] = useState(false);
  const [isTwelveNdrOpen, setIsTwelveNdrOpen] = useState(false);
  const [isCBVOpen, setIsCBVOpen] = useState(false);
  const [isFedervolleyOpen, setIsFedervolleyOpen] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings/global")
      .then((res) => res.json())
      .then((data) => {
        if (Object.keys(data).length > 0) {
          setSettings((prev) => normalizeSettings({ ...prev, ...data }));
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch("/api/settings/global", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizeSettings(settings)),
      });
      setIsEditing(false);
    } catch {
      alert("Ошибка при сохранении");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="h-20 animate-pulse rounded-3xl bg-slate-100" />;

  return (
    <div className="space-y-8">
      <section className="premium-card overflow-hidden transition-all duration-500">
        <div
          className="flex cursor-pointer items-center justify-between p-8 transition-colors hover:bg-slate-50/50"
          onClick={() => !isEditing && setIsSourceOpen(!isSourceOpen)}
        >
          <div className="flex items-center gap-4">
            <div className={`flex h-10 w-10 items-center justify-center rounded-2xl transition-all ${isSourceOpen ? "bg-indigo-600 text-white shadow-lg shadow-indigo-200" : "bg-slate-100 text-slate-400"}`}>
              <svg className={`h-6 w-6 transition-transform duration-500 ${isSourceOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            <div>
              <h2 className="text-2xl font-black tracking-tight text-slate-900">TBvolley: Volleyball World</h2>
              <p className="mt-0.5 text-xs font-bold text-slate-500">Источник расписания пляжного волейбола и базовые параметры парсинга</p>
            </div>
          </div>

          <EditActions isEditing={isEditing} saving={saving} onEdit={() => { setIsEditing(true); setIsSourceOpen(true); }} onCancel={() => setIsEditing(false)} onSave={handleSave} />
        </div>

        <div className={`overflow-hidden transition-all duration-500 ease-in-out ${isSourceOpen ? "max-h-[1200px] opacity-100" : "max-h-0 opacity-0"}`}>
          <div className="space-y-6 p-8 pt-0">
            <div className="mb-8 h-px bg-slate-100" />

            <dl className="grid gap-6">
              <SettingsRow
                label="Volleyball World API"
                name="tbvolley_volleyballworld_api"
                value={settings.tbvolley_volleyballworld_api}
                isEditing={isEditing}
                onChange={(val) => setSettings({ ...settings, tbvolley_volleyballworld_api: val })}
              />
              <SettingsRow
                label="User-Agent"
                name="tbvolley_user_agent"
                value={settings.tbvolley_user_agent}
                isEditing={isEditing}
                onChange={(val) => setSettings({ ...settings, tbvolley_user_agent: val })}
              />
              <SettingsRow
                label="Default Days"
                name="tbvolley_default_days"
                value={settings.tbvolley_default_days}
                isEditing={isEditing}
                onChange={(val) => setSettings({ ...settings, tbvolley_default_days: val.replace(/[^\d]/g, "") })}
              />
            </dl>
          </div>
        </div>
      </section>

      <section className="premium-card overflow-hidden transition-all duration-500">
        <div
          className="flex cursor-pointer items-center justify-between p-8 transition-colors hover:bg-slate-50/50"
          onClick={() => !isEditing && setIsBeachVolleyRuOpen(!isBeachVolleyRuOpen)}
        >
          <div className="flex items-center gap-4">
            <div className={`flex h-10 w-10 items-center justify-center rounded-2xl transition-all ${isBeachVolleyRuOpen ? "bg-indigo-600 text-white shadow-lg shadow-indigo-200" : "bg-slate-100 text-slate-400"}`}>
              <svg className={`h-6 w-6 transition-transform duration-500 ${isBeachVolleyRuOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            <div>
              <h2 className="text-2xl font-black tracking-tight text-slate-900">TBvolley: beach.volley.ru</h2>
              <p className="mt-0.5 text-xs font-bold text-slate-500">Источник календаря Кубка и Чемпионата России по пляжному волейболу</p>
            </div>
          </div>

          <EditActions isEditing={isEditing} saving={saving} onEdit={() => { setIsEditing(true); setIsBeachVolleyRuOpen(true); }} onCancel={() => setIsEditing(false)} onSave={handleSave} />
        </div>

        <div className={`overflow-hidden transition-all duration-500 ease-in-out ${isBeachVolleyRuOpen ? "max-h-[1200px] opacity-100" : "max-h-0 opacity-0"}`}>
          <div className="space-y-6 p-8 pt-0">
            <div className="mb-8 h-px bg-slate-100" />

            <dl className="grid gap-6">
              <SettingsRow
                label="beach.volley.ru Calendar"
                name="tbvolley_beachvolleyru_calendar_url"
                value={settings.tbvolley_beachvolleyru_calendar_url}
                isEditing={isEditing}
                onChange={(val) => setSettings({ ...settings, tbvolley_beachvolleyru_calendar_url: val })}
              />
              <SettingsRow
                label="User-Agent"
                name="tbvolley_beachvolleyru_user_agent"
                value={settings.tbvolley_beachvolleyru_user_agent}
                isEditing={isEditing}
                onChange={(val) => setSettings({ ...settings, tbvolley_beachvolleyru_user_agent: val })}
              />
              <SettingsRow
                label="Upcoming Window (months)"
                name="tbvolley_beachvolleyru_window_months"
                value={settings.tbvolley_beachvolleyru_window_months}
                isEditing={isEditing}
                onChange={(val) => setSettings({ ...settings, tbvolley_beachvolleyru_window_months: val.replace(/[^\d]/g, "") })}
              />
            </dl>
          </div>
        </div>
      </section>

      <section className="premium-card overflow-hidden transition-all duration-500">
        <div
          className="flex cursor-pointer items-center justify-between p-8 transition-colors hover:bg-slate-50/50"
          onClick={() => !isEditing && setIsGermanBeachTourOpen(!isGermanBeachTourOpen)}
        >
          <div className="flex items-center gap-4">
            <div className={`flex h-10 w-10 items-center justify-center rounded-2xl transition-all ${isGermanBeachTourOpen ? "bg-indigo-600 text-white shadow-lg shadow-indigo-200" : "bg-slate-100 text-slate-400"}`}>
              <svg className={`h-6 w-6 transition-transform duration-500 ${isGermanBeachTourOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            <div>
              <h2 className="text-2xl font-black tracking-tight text-slate-900">TBvolley: German Beach Tour</h2>
              <p className="mt-0.5 text-xs font-bold text-slate-500">Источник календаря German Beach Tour по пляжному волейболу</p>
            </div>
          </div>

          <EditActions isEditing={isEditing} saving={saving} onEdit={() => { setIsEditing(true); setIsGermanBeachTourOpen(true); }} onCancel={() => setIsEditing(false)} onSave={handleSave} />
        </div>

        <div className={`overflow-hidden transition-all duration-500 ease-in-out ${isGermanBeachTourOpen ? "max-h-[1200px] opacity-100" : "max-h-0 opacity-0"}`}>
          <div className="space-y-6 p-8 pt-0">
            <div className="mb-8 h-px bg-slate-100" />

            <dl className="grid gap-6">
              <SettingsRow
                label="German Beach Tour Calendar"
                name="tbvolley_germanbeachtour_calendar_url"
                value={settings.tbvolley_germanbeachtour_calendar_url}
                isEditing={isEditing}
                onChange={(val) => setSettings({ ...settings, tbvolley_germanbeachtour_calendar_url: val })}
              />
              <SettingsRow
                label="User-Agent"
                name="tbvolley_germanbeachtour_user_agent"
                value={settings.tbvolley_germanbeachtour_user_agent}
                isEditing={isEditing}
                onChange={(val) => setSettings({ ...settings, tbvolley_germanbeachtour_user_agent: val })}
              />
              <SettingsRow
                label="Upcoming Window (months)"
                name="tbvolley_germanbeachtour_window_months"
                value={settings.tbvolley_germanbeachtour_window_months}
                isEditing={isEditing}
                onChange={(val) => setSettings({ ...settings, tbvolley_germanbeachtour_window_months: val.replace(/[^\d]/g, "") })}
              />
            </dl>
          </div>
        </div>
      </section>

      <section className="premium-card overflow-hidden transition-all duration-500">
        <div
          className="flex cursor-pointer items-center justify-between p-8 transition-colors hover:bg-slate-50/50"
          onClick={() => !isEditing && setIsTwelveNdrOpen(!isTwelveNdrOpen)}
        >
          <div className="flex items-center gap-4">
            <div className={`flex h-10 w-10 items-center justify-center rounded-2xl transition-all ${isTwelveNdrOpen ? "bg-indigo-600 text-white shadow-lg shadow-indigo-200" : "bg-slate-100 text-slate-400"}`}>
              <svg className={`h-6 w-6 transition-transform duration-500 ${isTwelveNdrOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            <div>
              <h2 className="text-2xl font-black tracking-tight text-slate-900">TBvolley: 12ndr CSVP / ÖVV</h2>
              <p className="mt-0.5 text-xs font-bold text-slate-500">Календарь CSVP International и Austrian Beach Tour на общей платформе 12ndr</p>
            </div>
          </div>

          <EditActions isEditing={isEditing} saving={saving} onEdit={() => { setIsEditing(true); setIsTwelveNdrOpen(true); }} onCancel={() => setIsEditing(false)} onSave={handleSave} />
        </div>

        <div className={`overflow-hidden transition-all duration-500 ease-in-out ${isTwelveNdrOpen ? "max-h-[1200px] opacity-100" : "max-h-0 opacity-0"}`}>
          <div className="space-y-6 p-8 pt-0">
            <div className="mb-8 h-px bg-slate-100" />

            <dl className="grid gap-6">
              <SettingsRow
                label="12ndr Calendar API"
                name="tbvolley_twelvendr_calendar_url"
                value={settings.tbvolley_twelvendr_calendar_url}
                isEditing={isEditing}
                onChange={(val) => setSettings({ ...settings, tbvolley_twelvendr_calendar_url: val })}
              />
              <SettingsRow
                label="12ndr Tournament API"
                name="tbvolley_twelvendr_tournament_url"
                value={settings.tbvolley_twelvendr_tournament_url}
                isEditing={isEditing}
                onChange={(val) => setSettings({ ...settings, tbvolley_twelvendr_tournament_url: val })}
              />
              <SettingsRow
                label="User-Agent"
                name="tbvolley_twelvendr_user_agent"
                value={settings.tbvolley_twelvendr_user_agent}
                isEditing={isEditing}
                onChange={(val) => setSettings({ ...settings, tbvolley_twelvendr_user_agent: val })}
              />
            </dl>
          </div>
        </div>
      </section>

      <section className="premium-card overflow-hidden transition-all duration-500">
        <div
          className="flex cursor-pointer items-center justify-between p-8 transition-colors hover:bg-slate-50/50"
          onClick={() => !isEditing && setIsCBVOpen(!isCBVOpen)}
        >
          <div className="flex items-center gap-4">
            <div className={`flex h-10 w-10 items-center justify-center rounded-2xl transition-all ${isCBVOpen ? "bg-indigo-600 text-white shadow-lg shadow-indigo-200" : "bg-slate-100 text-slate-400"}`}>
              <svg className={`h-6 w-6 transition-transform duration-500 ${isCBVOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            <div>
              <h2 className="text-2xl font-black tracking-tight text-slate-900">TBvolley: CBV Brasil</h2>
              <p className="mt-0.5 text-xs font-bold text-slate-500">JSON API eVolleyball CBV для взрослой серии CBVP ADULTO</p>
            </div>
          </div>

          <EditActions isEditing={isEditing} saving={saving} onEdit={() => { setIsEditing(true); setIsCBVOpen(true); }} onCancel={() => setIsEditing(false)} onSave={handleSave} />
        </div>

        <div className={`overflow-hidden transition-all duration-500 ease-in-out ${isCBVOpen ? "max-h-[1200px] opacity-100" : "max-h-0 opacity-0"}`}>
          <div className="space-y-6 p-8 pt-0">
            <div className="mb-8 h-px bg-slate-100" />

            <dl className="grid gap-6">
              <SettingsRow
                label="CBV API Base"
                name="tbvolley_cbv_api_url"
                value={settings.tbvolley_cbv_api_url}
                isEditing={isEditing}
                onChange={(val) => setSettings({ ...settings, tbvolley_cbv_api_url: val })}
              />
              <SettingsRow
                label="User-Agent"
                name="tbvolley_cbv_user_agent"
                value={settings.tbvolley_cbv_user_agent}
                isEditing={isEditing}
                onChange={(val) => setSettings({ ...settings, tbvolley_cbv_user_agent: val })}
              />
            </dl>
          </div>
        </div>
      </section>

      <section className="premium-card overflow-hidden transition-all duration-500">
        <div
          className="flex cursor-pointer items-center justify-between p-8 transition-colors hover:bg-slate-50/50"
          onClick={() => !isEditing && setIsFedervolleyOpen(!isFedervolleyOpen)}
        >
          <div className="flex items-center gap-4">
            <div className={`flex h-10 w-10 items-center justify-center rounded-2xl transition-all ${isFedervolleyOpen ? "bg-indigo-600 text-white shadow-lg shadow-indigo-200" : "bg-slate-100 text-slate-400"}`}>
              <svg className={`h-6 w-6 transition-transform duration-500 ${isFedervolleyOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            <div>
              <h2 className="text-2xl font-black tracking-tight text-slate-900">TBvolley: Federvolley Italy</h2>
              <p className="mt-0.5 text-xs font-bold text-slate-500">Drupal-листинги Assoluto/Serie Beach и Matchshare bracket endpoint</p>
            </div>
          </div>

          <EditActions isEditing={isEditing} saving={saving} onEdit={() => { setIsEditing(true); setIsFedervolleyOpen(true); }} onCancel={() => setIsEditing(false)} onSave={handleSave} />
        </div>

        <div className={`overflow-hidden transition-all duration-500 ease-in-out ${isFedervolleyOpen ? "max-h-[1400px] opacity-100" : "max-h-0 opacity-0"}`}>
          <div className="space-y-6 p-8 pt-0">
            <div className="mb-8 h-px bg-slate-100" />

            <dl className="grid gap-6">
              <SettingsRow
                label="Assoluto Listing"
                name="tbvolley_federvolley_assoluto_url"
                value={settings.tbvolley_federvolley_assoluto_url}
                isEditing={isEditing}
                onChange={(val) => setSettings({ ...settings, tbvolley_federvolley_assoluto_url: val })}
              />
              <SettingsRow
                label="Serie Beach Listing"
                name="tbvolley_federvolley_serie_url"
                value={settings.tbvolley_federvolley_serie_url}
                isEditing={isEditing}
                onChange={(val) => setSettings({ ...settings, tbvolley_federvolley_serie_url: val })}
              />
              <SettingsRow
                label="Matchshare API"
                name="tbvolley_federvolley_matchshare_url"
                value={settings.tbvolley_federvolley_matchshare_url}
                isEditing={isEditing}
                onChange={(val) => setSettings({ ...settings, tbvolley_federvolley_matchshare_url: val })}
              />
              <SettingsRow
                label="User-Agent"
                name="tbvolley_federvolley_user_agent"
                value={settings.tbvolley_federvolley_user_agent}
                isEditing={isEditing}
                onChange={(val) => setSettings({ ...settings, tbvolley_federvolley_user_agent: val })}
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
            <div className={`flex h-10 w-10 items-center justify-center rounded-2xl transition-all ${isUploadOpen ? "bg-indigo-600 text-white shadow-lg shadow-indigo-200" : "bg-slate-100 text-slate-400"}`}>
              <svg className={`h-6 w-6 transition-transform duration-500 ${isUploadOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            <div>
              <h2 className="text-2xl font-black tracking-tight text-slate-900">TBvolley: Заливка</h2>
              <p className="mt-0.5 text-xs font-bold text-slate-500">Admin API и единый Sport ID пляжного волейбола; команды маппятся отдельно по муж/жен</p>
            </div>
          </div>

          <EditActions isEditing={isEditing} saving={saving} onEdit={() => { setIsEditing(true); setIsUploadOpen(true); }} onCancel={() => setIsEditing(false)} onSave={handleSave} />
        </div>

        <div className={`overflow-hidden transition-all duration-500 ease-in-out ${isUploadOpen ? "max-h-[1200px] opacity-100" : "max-h-0 opacity-0"}`}>
          <div className="space-y-6 p-8 pt-0">
            <div className="mb-8 h-px bg-slate-100" />

            <dl className="grid gap-6">
              <SettingsRow
                label="TBvolley Admin API URL"
                name="tbvolley_admin_api_url"
                value={settings.tbvolley_admin_api_url}
                isEditing={isEditing}
                onChange={(val) => setSettings({ ...settings, tbvolley_admin_api_url: val })}
              />
              <SettingsRow
                label="Beach Volleyball Sport ID"
                name="tbvolley_sport_id"
                value={settings.tbvolley_sport_id}
                isEditing={isEditing}
                onChange={(val) => setSettings({ ...settings, tbvolley_sport_id: val.replace(/[^\d]/g, "") })}
              />
            </dl>
          </div>
        </div>
      </section>
    </div>
  );
}

function normalizeSettings(data: Partial<Record<string, string>>): TBvolleySettings {
  const normalized = SETTING_KEYS.reduce((acc, key) => {
    acc[key] = data[key] ?? DEFAULT_SETTINGS[key];
    return acc;
  }, {} as TBvolleySettings);
  normalized.tbvolley_sport_id = normalized.tbvolley_sport_id
    || BEACH_VOLLEYBALL_ADMIN_SPORT_ID;
  return normalized;
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
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-950 transition-all focus:border-indigo-600 focus:outline-none focus:ring-4 focus:ring-indigo-600/5"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            name={name}
          />
        ) : (
          <span className="block w-fit break-all rounded-xl border border-slate-100 bg-slate-50 px-4 py-2 font-mono text-sm font-bold text-slate-900">
            {type === "password" ? "********" : value}
          </span>
        )}
      </dd>
    </div>
  );
}
