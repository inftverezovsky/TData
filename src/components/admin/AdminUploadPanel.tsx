'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { buildAdminServiceUrl } from '@/lib/adminUpload/adminServiceUrl';
import { appendShapkaOverridesSearchParam } from '@/lib/adminUpload/shapkaOverrides';
import { toPhpString } from '@/lib/adminUpload/utils';
import { dispatchAdminMappingUpdated, dispatchTournamentDataUpdated } from '@/lib/utils/clientEvents';

interface AdminMapping {
  adminShapkaId: string;
  adminShapkaName: string;
}

interface Settings {
  apiUrl: string;
  adminSportId: string;
  adminMax: string;
  defaultShapkaId: string;
  timezone: string;
  dateFormat: string;
  requestMode: string;
}

interface PreviewData {
  phpArray: any;
  serialized: string;
  postBody: string;
  readyMatchesCount: number;
  skippedMatches: any[];
  warnings: string[];
}

function buildSelectedIdsQuery(selectedMatchIds: string[]) {
  return selectedMatchIds.map((id) => encodeURIComponent(id)).join(',');
}

function getFriendlyErrorMessage(error: unknown, fallback: string) {
  return typeof error === 'string' && error.trim() ? error : fallback;
}

export default function AdminUploadPanel({ 
  tournamentId, 
  disciplineSlug,
  tournamentName,
  initialSettings,
  selectedMatchIds = [],
  shapkaIdBySelectionId = {},
}: { 
  tournamentId: string; 
  disciplineSlug: string;
  tournamentName: string;
  initialSettings: Settings;
  selectedMatchIds?: string[];
  shapkaIdBySelectionId?: Record<string, string>;
}) {
  const router = useRouter();
  const [mapping, setMapping] = useState<AdminMapping>({ adminShapkaId: '', adminShapkaName: '' });
  const settings = initialSettings;
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [lastSavedId, setLastSavedId] = useState<string | null>(null);
  const [result, setResult] = useState<{ type: 'success' | 'error' | 'info'; text: string; raw?: string } | null>(null);
  const selectedMatchKey = `${selectedMatchIds.join('\u0001')}\u0002${JSON.stringify(shapkaIdBySelectionId)}`;
  const selectedCount = selectedMatchIds.length;
  const normalizedShapkaId = mapping.adminShapkaId.trim();
  const savedShapkaId = (lastSavedId || '').trim();
  const hasUnsavedShapkaId = normalizedShapkaId !== '' && normalizedShapkaId !== savedShapkaId;
  const effectiveShapkaId = savedShapkaId || settings?.defaultShapkaId;
  const allSelectedHaveGroupShapka =
    selectedCount > 0 && selectedMatchIds.every((id) => Boolean(shapkaIdBySelectionId[id]));
  const readyCount = preview?.readyMatchesCount ?? selectedCount;
  const uploadPayloadDisabledReason = hasUnsavedShapkaId && !allSelectedHaveGroupShapka
    ? "Сначала сохраните ID шапки"
    : !effectiveShapkaId && !allSelectedHaveGroupShapka
      ? "Укажите ID шапки"
      : !settings?.adminSportId
        ? "Не настроен Sport ID"
        : preview?.readyMatchesCount === 0
          ? "Нет готовых матчей"
          : selectedCount === 0
            ? "Выберите матчи"
            : null;
  const sendDisabledReason = !settings?.apiUrl
    ? "Не настроен API URL"
    : uploadPayloadDisabledReason;
  const serviceDisabledReason = uploadPayloadDisabledReason;

  const loadAdminData = useCallback(async () => {
    const mappingRes = await fetch(`/api/${disciplineSlug}/tournament/${tournamentId}/admin-mapping`, {
      cache: 'no-store',
      credentials: 'same-origin',
    });

    const mappingData = await mappingRes.json().catch(() => null);

    if (!mappingRes.ok) {
      setResult({
        type: 'error',
        text: getFriendlyErrorMessage(
          mappingData?.error,
          'Ошибка загрузки данных админки'
        ),
      });
      return;
    }

    setMapping({
      adminShapkaId: mappingData.adminShapkaId || '',
      adminShapkaName: mappingData.adminShapkaName || '',
    });
    setLastSavedId(mappingData.adminShapkaId || '');
  }, [disciplineSlug, tournamentId]);

  const handlePreview = useCallback(async () => {
    if (uploadPayloadDisabledReason) {
      setResult({ type: 'error', text: uploadPayloadDisabledReason });
      return;
    }

    setActionLoading(true);
    setResult(null);
    try {
      const res = await fetch(`/api/${disciplineSlug}/tournament/${tournamentId}/admin-fixt-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ disciplineSlug, selectedMatchIds, shapkaIdBySelectionId }),
      });
      const data = await res.json();
      if (data.ok) {
        setPreview(data);
      } else {
        setResult({ type: 'error', text: data.error || 'Ошибка превью' });
      }
    } catch (e) {
      setResult({ type: 'error', text: 'Ошибка превью' });
    } finally {
      setActionLoading(false);
    }
  }, [disciplineSlug, tournamentId, selectedMatchIds, shapkaIdBySelectionId, uploadPayloadDisabledReason]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        await loadAdminData();
      } catch (e) {
        console.error('Failed to fetch admin data', e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();

  }, [loadAdminData]);

  useEffect(() => {
    const handleTrigger = () => handlePreview();
    window.addEventListener('trigger-admin-preview', handleTrigger);
    return () => window.removeEventListener('trigger-admin-preview', handleTrigger);
  }, [handlePreview]);

  useEffect(() => {
    setPreview(null);
  }, [selectedMatchKey]);

  const handleSaveMapping = useCallback(async () => {
    setActionLoading(true);
    setResult(null);
    try {
      const res = await fetch(`/api/${disciplineSlug}/tournament/${tournamentId}/admin-mapping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          ...mapping,
          disciplineSlug,
          sourceTournamentName: tournamentName
        }),
      });
      if (res.ok) {
        setLastSavedId(mapping.adminShapkaId);
        setIsEditing(false);
        setPreview(null);
        setResult({ type: 'success', text: 'ID шапки сохранён.' });
        dispatchAdminMappingUpdated({ tournamentId, disciplineSlug });
        router.refresh();
      } else {
        const data = await res.json().catch(() => null);
        setResult({ type: 'error', text: data?.error || 'Ошибка сохранения ID' });
      }
    } catch (e) {
      setResult({ type: 'error', text: 'Ошибка сохранения ID' });
    } finally {
      setActionLoading(false);
    }
  }, [disciplineSlug, router, tournamentId, mapping, tournamentName]);

  async function handleSend(confirmed = false) {
    if (!confirmed && !confirm('Залить данные в API?')) return;
    setActionLoading(true);
    setResult(null);
    try {
      const res = await fetch(`/api/${disciplineSlug}/tournament/${tournamentId}/admin-fixt-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ disciplineSlug, selectedMatchIds, shapkaIdBySelectionId }),
      });
      const data = await res.json();
      if (data.ok) {
        setResult({ 
          type: 'success', 
          text: `Данные успешно залиты в платформу. Статус: ${data.status}. Отмечено матчей: ${data.markedMatchesCount ?? readyCount}`,
          raw: data.rawResponse 
        });
        setPreview(null);
        // Dispatch custom event to refresh MatchList history
        window.dispatchEvent(new CustomEvent('admin-upload-success'));
        dispatchTournamentDataUpdated({ tournamentId, disciplineSlug });
        router.refresh();
      } else {
        const warningText = data.warnings && data.warnings.length > 0 
          ? `\n\nВнимание:\n${data.warnings.join('\n')}` 
          : '';
        setResult({ 
          type: 'error', 
          text: (data.error || 'Ошибка при заливке') + warningText,
          raw: data.rawResponse 
        });
      }
    } catch (e) {
      setResult({ type: 'error', text: 'Сетевая ошибка при отправке' });
    } finally {
      setActionLoading(false);
    }
  }

  const getJsonUrl = () => {
    const baseUrl = `/${disciplineSlug}/tournament/${tournamentId}/json`;
    const params = new URLSearchParams();
    if (selectedMatchIds.length > 0) params.set("ids", selectedMatchIds.join(','));
    appendShapkaOverridesSearchParam(params, shapkaIdBySelectionId);
    const query = params.toString();
    return query ? `${baseUrl}?${query}` : baseUrl;
  };

  async function markSelectedMatchesUploaded() {
    const res = await fetch(`/api/${disciplineSlug}/tournament/${tournamentId}/admin-fixt-mark-uploaded`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ selectedMatchIds, shapkaIdBySelectionId, confirmed: true }),
    });
    const data = await res.json();
    if (!data.ok) {
      throw new Error(data.error || 'Не удалось отметить матчи как залитые');
    }
    window.dispatchEvent(new CustomEvent('admin-upload-success'));
    dispatchTournamentDataUpdated({ tournamentId, disciplineSlug });
    router.refresh();
    setPreview(null);
    return data.markedMatchesCount as number;
  }

  const handleServiceUpload = async () => {
    if (serviceDisabledReason) {
      setResult({ type: 'error', text: serviceDisabledReason });
      return;
    }

    setActionLoading(true);
    setResult(null);

    const baseUrl = `/${disciplineSlug}/tournament/${tournamentId}/json`;
    const params = new URLSearchParams();
    if (selectedMatchIds.length > 0) params.set("ids", selectedMatchIds.join(','));
    appendShapkaOverridesSearchParam(params, shapkaIdBySelectionId);
    const query = params.toString();
    const absoluteJsonUrl = `${window.location.origin}${baseUrl}${query ? `?${query}` : ''}`;

    const fallbackCopyText = (text: string) => {
      try {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.top = "0";
        textArea.style.left = "0";
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        return successful;
      } catch (err) {
        console.error('Fallback copy failed: ', err);
        return false;
      }
    };

    let copied = false;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(absoluteJsonUrl)
          .then(() => {
            setResult({
              type: 'success',
              text: 'Ссылка на JSON успешно скопирована в буфер обмена! Открываю сервис...'
            });
          })
          .catch((err) => {
            console.error('Failed to copy via navigator.clipboard: ', err);
            copied = fallbackCopyText(absoluteJsonUrl);
            if (copied) {
              setResult({
                type: 'success',
                text: 'Ссылка на JSON успешно скопирована в буфер обмена! Открываю сервис...'
              });
            } else {
              setResult({
                type: 'info',
                text: 'Ссылка сформирована, но не удалось скопировать ее в буфер обмена. Открываю сервис...'
              });
            }
          });
      } else {
        copied = fallbackCopyText(absoluteJsonUrl);
        if (copied) {
          setResult({
            type: 'success',
            text: 'Ссылка на JSON успешно скопирована в буфер обмена! Открываю сервис...'
          });
        } else {
          setResult({
            type: 'info',
            text: 'Ссылка сформирована, но не удалось скопировать ее в буфер обмена. Открываю сервис...'
          });
        }
      }
    } catch (err) {
      console.error('Copying failed: ', err);
      fallbackCopyText(absoluteJsonUrl);
    }

    let openedWindow: Window | null = null;
    try {
      const targetUrl = buildAdminServiceUrl(absoluteJsonUrl, process.env.NEXT_PUBLIC_ADMIN_SERVICE_URL);
      if (!targetUrl) {
        throw new Error('URL сервиса админки не настроен.');
      }
      openedWindow = window.open('', '_blank');
      if (!openedWindow) {
        throw new Error('Не удалось автоматически открыть окно. Разрешите всплывающие окна для этого сайта.');
      }
      openedWindow.opener = null;

      const markedCount = await markSelectedMatchesUploaded();
      openedWindow.location.href = targetUrl;
      setResult({
        type: 'success',
        text: `Сервис открыт, ссылка на JSON подготовлена. Отмечено матчей: ${markedCount}.`
      });
    } catch (openErr) {
      console.error('Service upload failed: ', openErr);
      if (openedWindow && !openedWindow.closed) openedWindow.close();
      setResult({
        type: 'error',
        text: openErr instanceof Error ? openErr.message : 'Не удалось открыть сервис или отметить матчи.'
      });
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) return <div className="p-4 text-slate-400 font-normal animate-pulse">Загрузка данных админки...</div>;

  const isSaved = mapping.adminShapkaId !== '' && mapping.adminShapkaId === lastSavedId;

  return (
    <div className="space-y-6">
      <section className="premium-card bg-white border-slate-200 shadow-sm">
        <div className="mb-6 border-b border-slate-100 pb-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-xl font-bold text-slate-900 tracking-tight">Заливка в админ</h3>
              <p className="mt-1 text-sm font-normal text-slate-500">Проверьте ID шапки и отправьте выбранные матчи.</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-right">
              <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Выбрано</div>
              <div className="text-lg font-black text-slate-950">{selectedCount}</div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {/* Shapka ID Input */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-400">ID Шапки Турнира</label>
              {(isSaved && !isEditing) && (
                <button 
                  onClick={() => setIsEditing(true)}
                  className="text-[10px] font-medium text-slate-600 hover:text-slate-700 uppercase tracking-widest flex items-center gap-1"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                  Изменить
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2 items-stretch">
              <input
                type="text"
                disabled={isSaved && !isEditing}
                className={`flex-1 min-w-[120px] min-h-[52px] rounded-xl border px-4 py-3 text-sm font-normal transition-all ${
                  isSaved && !isEditing 
                    ? 'bg-slate-50 border-slate-100 text-slate-400 cursor-not-allowed' 
                    : 'bg-white border-slate-200 text-slate-950 focus:outline-none focus:ring-4 focus:ring-slate-800/5 focus:border-slate-800'
                }`}
                placeholder={settings?.defaultShapkaId ? `ID: ${settings.defaultShapkaId}` : "Введите ID..."}
                value={mapping.adminShapkaId}
                onChange={(e) => setMapping({ ...mapping, adminShapkaId: e.target.value })}
              />
              {(!isSaved || isEditing) && (
                <button
                  onClick={handleSaveMapping}
                  disabled={actionLoading}
                  className={`flex-none min-h-[52px] px-6 rounded-xl font-medium text-[9px] uppercase tracking-widest transition-all duration-300 disabled:opacity-50 bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200`}
                >
                  СОХРАНИТЬ ID
                </button>
              )}
              {(isSaved && !isEditing) && (
                <div className="flex-none min-h-[52px] px-6 rounded-xl font-medium text-[9px] uppercase tracking-widest bg-emerald-500/5 backdrop-blur-sm text-emerald-600 border border-emerald-500/20 flex items-center justify-center gap-1.5">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  ГОТОВО
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={handlePreview}
              disabled={actionLoading || Boolean(uploadPayloadDisabledReason)}
              title={uploadPayloadDisabledReason ?? `Будет проверено матчей: ${selectedCount}`}
              className="min-h-[46px] rounded-lg border border-slate-200 bg-white px-4 text-xs font-black uppercase tracking-widest text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              {actionLoading ? "Проверяю..." : `Проверить ${selectedCount || ""}`}
            </button>
            <button
              onClick={() => handleSend()}
              disabled={actionLoading || Boolean(sendDisabledReason)}
              title={sendDisabledReason ?? `Будет отправлено матчей: ${readyCount}`}
              className="min-h-[54px] rounded-lg bg-slate-950 px-4 text-sm font-black uppercase tracking-widest text-white transition-colors hover:bg-indigo-600 disabled:bg-slate-100 disabled:text-slate-400"
            >
              {actionLoading ? "Отправка..." : `Залить ${readyCount || ""}`}
            </button>
            <button
              type="button"
              onClick={handleServiceUpload}
              disabled={actionLoading || Boolean(serviceDisabledReason)}
              title={serviceDisabledReason ?? `Будет отмечено матчей: ${readyCount}`}
              className="min-h-[54px] rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 px-4 text-sm font-black uppercase tracking-widest text-white transition-all duration-300 flex items-center justify-center shadow-lg hover:shadow-indigo-500/20 active:scale-[0.98] text-center cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Залить через сервис
            </button>
            {(sendDisabledReason || serviceDisabledReason) && (
              <p className="text-xs font-medium text-slate-500">
                {sendDisabledReason || serviceDisabledReason}
              </p>
            )}
          </div>
        </div>

        {result && (
          <div className={`mt-8 p-6 rounded-2xl animate-in slide-in-from-top-2 border ${
            result.type === 'success' ? 'bg-emerald-50/50 text-emerald-900 border-emerald-100' : 
            result.type === 'error' ? 'bg-rose-50/50 text-rose-900 border-rose-100' : 'bg-blue-50/50 text-blue-900 border-blue-100'
          }`}>
            <div className="flex items-center gap-3">
               <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${
                 result.type === 'success' ? 'bg-emerald-100 text-emerald-600' : 
                 result.type === 'error' ? 'bg-rose-100 text-rose-600' : 'bg-blue-100 text-blue-600'
               }`}>
                 <span className="text-lg font-black">{result.type === 'success' ? '✓' : '!'}</span>
               </div>
               <p className="text-sm font-bold tracking-tight whitespace-pre-line">{result.text}</p>
            </div>
            
            {result.raw && (
              <details className="mt-4 group">
                <summary className="cursor-pointer text-[10px] font-bold text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors list-none flex items-center gap-2">
                  <svg className="h-3 w-3 group-open:rotate-90 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
                  </svg>
                  Технические подробности
                </summary>
                <div className="mt-3">
                  <pre className="p-4 bg-white border border-slate-100 rounded-xl overflow-auto max-h-40 text-[9px] font-mono leading-relaxed text-slate-400">
                    {result.raw}
                  </pre>
                </div>
              </details>
            )}
          </div>
        )}

        {preview && (
          <div className="mt-8 space-y-6 animate-in slide-in-from-top-4 duration-300 border-t border-slate-100 pt-8">
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-emerald-50/50 border border-emerald-100 p-4 rounded-2xl text-center">
                <div className="text-[9px] text-emerald-600 font-medium uppercase tracking-widest mb-1">Готово</div>
                <div className="text-2xl font-medium text-emerald-700">{preview.readyMatchesCount}</div>
              </div>
              <div className="bg-amber-50/50 border border-amber-100 p-4 rounded-2xl text-center">
                <div className="text-[9px] text-amber-600 font-medium uppercase tracking-widest mb-1">Пропущено</div>
                <div className="text-2xl font-medium text-amber-700">{preview.skippedMatches.length}</div>
              </div>
              <div className="bg-rose-50/50 border border-rose-100 p-4 rounded-2xl text-center">
                <div className="text-[9px] text-rose-600 font-medium uppercase tracking-widest mb-1">Предупреждения</div>
                <div className="text-2xl font-medium text-rose-700">{preview.warnings.length}</div>
              </div>
            </div>

            {preview.warnings.length > 0 && (
              <div className="space-y-2">
                {preview.warnings.map((w, i) => (
                  <div key={i} className="text-[10px] font-normal text-rose-600 bg-rose-50/50 px-3 py-2 rounded-lg border border-rose-100">⚠️ {w}</div>
                ))}
              </div>
            )}

            {preview.skippedMatches.length > 0 && (
              <details className="group">
                <summary className="cursor-pointer text-[10px] font-medium text-slate-400 uppercase tracking-widest hover:text-slate-900 transition-colors list-none flex items-center gap-2">
                  <svg className="h-4 w-4 group-open:rotate-90 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" /></svg>
                  Подробности по пропущенным матчам ({preview.skippedMatches.length})
                </summary>
                <div className="mt-4 space-y-2 max-h-48 overflow-auto custom-scrollbar pr-2">
                  {preview.skippedMatches.map((m, i) => (
                    <div key={i} className="text-[10px] font-normal text-slate-500 bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <div className="text-slate-950 mb-1">{m.teams}</div>
                      <div className="text-rose-500">{m.reason}</div>
                    </div>
                  ))}
                </div>
              </details>
            )}

            <details className="group pt-4">
              <summary className="cursor-pointer flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors list-none">
                <svg className="h-4 w-4 group-open:rotate-90 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
                </svg>
                Технические подробности (Превью)
              </summary>
              
              <div className="space-y-4 mt-6 animate-in fade-in slide-in-from-top-2">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400">PHP-массив</label>
                    <button onClick={() => navigator.clipboard.writeText(toPhpString(preview.phpArray))} className="text-[9px] font-bold text-slate-600 hover:underline">Копировать PHP</button>
                  </div>
                  <pre className="p-4 bg-slate-900 text-slate-200/50 text-[10px] rounded-2xl overflow-auto max-h-80 font-mono leading-relaxed scrollbar-hide">
                    {toPhpString(preview.phpArray)}
                  </pre>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Serialized</label>
                      <button onClick={() => navigator.clipboard.writeText(preview.serialized)} className="text-[9px] font-bold text-slate-600 hover:underline">Copy</button>
                    </div>
                    <div className="p-3 bg-slate-50 border border-slate-200 text-slate-500 text-[9px] rounded-xl font-mono break-all max-h-24 overflow-auto scrollbar-hide">
                      {preview.serialized}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Post Body</label>
                      <button onClick={() => navigator.clipboard.writeText(preview.postBody)} className="text-[9px] font-bold text-slate-600 hover:underline">Copy</button>
                    </div>
                    <div className="p-3 bg-slate-50 border border-slate-200 text-slate-500 text-[9px] rounded-xl font-mono break-all max-h-24 overflow-auto scrollbar-hide">
                      {preview.postBody}
                    </div>
                  </div>
                </div>
              </div>
            </details>
          </div>
        )}
      </section>
    </div>
  );
}
