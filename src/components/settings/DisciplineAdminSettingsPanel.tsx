'use client';

import { useState, useEffect } from 'react';

interface Settings {
  apiUrl: string;
  adminSportId: string;
  adminMax: string;
  defaultShapkaId: string;
  timezone: string;
  dateFormat: string;
  requestMode: string;
  sslVerify: boolean;
}

export default function DisciplineAdminSettingsPanel({ disciplineSlug }: { disciplineSlug: string }) {
  const [settings, setSettings] = useState<Settings>({
    apiUrl: '',
    adminSportId: '',
    adminMax: '5000',
    defaultShapkaId: '',
    timezone: 'Europe/Moscow',
    dateFormat: 'DD.MM.YYYY HH:mm:ss',
    requestMode: 'legacy_raw',
    sslVerify: true,
  });
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetch(`/api/admin-settings/${disciplineSlug}`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.error) {
          setSettings({
            apiUrl: data.apiUrl || '',
            adminSportId: data.adminSportId || '',
            adminMax: data.adminMax || '5000',
            defaultShapkaId: data.defaultShapkaId || '',
            timezone: data.timezone || 'Europe/Moscow',
            dateFormat: data.dateFormat || 'DD.MM.YYYY HH:mm:ss',
            requestMode: data.requestMode || 'legacy_raw',
            sslVerify: data.sslVerify ?? true,
          });
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [disciplineSlug]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      // Force defaults as requested (hidden from UI)
      const payload = {
        ...settings,
        adminMax: '5000',
        timezone: 'Europe/Moscow',
        dateFormat: 'DD.MM.YYYY HH:mm:ss',
        requestMode: 'legacy_raw',
        sslVerify: true,
      };

      const res = await fetch(`/api/admin-settings/${disciplineSlug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setMessage({ type: 'success', text: 'Настройки сохранены' });
        setIsEditing(false);
        // Sync local state with forced defaults
        setSettings(payload);
      } else {
        const data = await res.json();
        setMessage({ type: 'error', text: data.error || 'Ошибка при сохранении' });
      }
    } catch (e) {
      setMessage({ type: 'error', text: 'Сетевая ошибка' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-4 text-slate-400 font-bold animate-pulse">Загрузка настроек...</div>;

  return (
    <section className="premium-card p-8">
      <div className="mb-8 border-b border-slate-100 pb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black text-slate-900">Настройки админ-заливки {disciplineSlug.toUpperCase()}</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">Глобальные параметры для отправки данных в API.</p>
        </div>
        {!isEditing && (
          <button
            onClick={() => setIsEditing(true)}
            className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-600 hover:bg-slate-200 transition-colors"
          >
            Изменить
          </button>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">API URL</label>
          <input
            type="text"
            className={`w-full rounded-xl border px-4 py-3 text-sm font-bold transition-colors ${
              isEditing 
                ? 'border-indigo-500 bg-white text-slate-900 focus:outline-none' 
                : 'border-slate-100 bg-slate-50 text-slate-400 cursor-not-allowed'
            }`}
            placeholder="https://example.com/api"
            value={settings.apiUrl}
            onChange={(e) => setSettings({ ...settings, apiUrl: e.target.value })}
            disabled={!isEditing}
          />
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Admin Sport ID</label>
          <input
            type="text"
            className={`w-full rounded-xl border px-4 py-3 text-sm font-bold transition-colors ${
              isEditing 
                ? 'border-indigo-500 bg-white text-slate-900 focus:outline-none' 
                : 'border-slate-100 bg-slate-50 text-slate-400 cursor-not-allowed'
            }`}
            placeholder="Например: 73"
            value={settings.adminSportId}
            onChange={(e) => setSettings({ ...settings, adminSportId: e.target.value })}
            disabled={!isEditing}
          />
        </div>
      </div>

      {isEditing && (
        <div className="mt-8 flex items-center justify-between border-t border-slate-100 pt-8">
          <div>
            {message && (
              <p className={`text-sm font-bold ${message.type === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>
                {message.text}
              </p>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => {
                setIsEditing(false);
                setMessage(null);
              }}
              className="rounded-xl px-6 py-3 text-sm font-bold text-slate-500 hover:bg-slate-100 transition-colors"
            >
              Отмена
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary"
            >
              {saving ? 'Сохранение...' : 'Сохранить настройки'}
            </button>
          </div>
        </div>
      )}

      {message && !isEditing && (
        <div className="mt-6">
          <p className={`text-sm font-bold ${message.type === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>
            {message.text}
          </p>
        </div>
      )}
    </section>
  );
}
