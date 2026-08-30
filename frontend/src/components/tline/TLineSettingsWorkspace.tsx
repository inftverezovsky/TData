"use client";

import { FormEvent, useEffect, useId, useState } from "react";
import useSWR from "swr";
import { CheckCircle2, Database, Link2, LoaderCircle, RefreshCw, Settings2, Upload } from "lucide-react";

import { jsonRequest, requestTLine } from "./api";
import { formatOfficialConnectionMessage } from "./viewModel";
import { ChampionshipConfigEditor, SportConfigEditor } from "./TLineConfigEditors";
import type { TLineChampionship, TLineGlobalHeader, TLineSchedule, TLineSport, TLineTeamMapping } from "./types";

export function TLineSettingsWorkspace() {
  const sportsQuery = useSWR("/api/tline/sports", loadSports, { revalidateOnFocus: false });
  const championshipsQuery = useSWR("/api/tline/championships", loadChampionships, { revalidateOnFocus: false });
  const globalHeadersQuery = useSWR("/api/tline/global-headers", loadGlobalHeaders, { revalidateOnFocus: false });
  const scheduleQuery = useSWR("/api/tline/schedule", loadSchedule, { revalidateOnFocus: false });
  const adminQuery = useSWR("/api/tline/admin-connection/status", loadAdminStatus, { revalidateOnFocus: false });
  const [selectedChampionshipId, setSelectedChampionshipId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sports = sportsQuery.data ?? EMPTY_SPORTS;
  const championships = championshipsQuery.data ?? EMPTY_CHAMPIONSHIPS;
  const globalHeaders = globalHeadersQuery.data ?? EMPTY_GLOBAL_HEADERS;

  useEffect(() => {
    if (!selectedChampionshipId && championships.length > 0) setSelectedChampionshipId(championships[0].id);
  }, [championships, selectedChampionshipId]);

  const mappingsKey = selectedChampionshipId
    ? `/api/tline/championships/${encodeURIComponent(selectedChampionshipId)}/team-mappings`
    : null;
  const mappingsQuery = useSWR(mappingsKey, loadMappings, { revalidateOnFocus: false });

  const runAction = async (key: string, action: () => Promise<string | void>) => {
    setBusy(key);
    setMessage(null);
    setError(null);
    try {
      setMessage((await action()) || "Изменения сохранены.");
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6 pb-10">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">TLine</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">Настройки TLine</h1>
        <p className="mt-2 text-sm text-slate-600">Источники, сопоставления и автопроверка. Все действия в Admin остаются read-only.</p>
      </div>

      {(message || error) && (
        <div role={error ? "alert" : "status"} className={`rounded-2xl border px-5 py-4 text-sm font-bold ${error ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
          {error ?? message}
        </div>
      )}

      <SettingsSection title="Виды спорта" description="Включайте только полностью настроенные спортивные контуры." icon={<Settings2 />}>
        <SportForm
          disabled={busy !== null}
          onSubmit={(payload) => runAction("sport:create", async () => {
            await requestTLine("/api/tline/sports", jsonRequest("POST", payload));
            await sportsQuery.mutate();
            return "Вид спорта добавлен.";
          })}
        />
        <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {sportsQuery.isLoading && <LoadingRow />}
          {!sportsQuery.isLoading && sports.length === 0 && <EmptyRow text="Виды спорта ещё не настроены." />}
          {sports.map((sport) => (
            <div key={sport.id}>
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div><p className="font-black text-slate-900">{sport.name}</p><p className="text-xs text-slate-500">{sport.slug}</p></div>
                <span className={`rounded-full px-3 py-1 text-xs font-black ${sport.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{sport.active ? "Активен" : "Отключён"}</span>
              </div>
              <SportConfigEditor sport={sport} disabled={busy !== null} onSave={(payload) => runAction(`sport:update:${sport.id}`, async () => {
                await requestTLine(`/api/tline/sports/${encodeURIComponent(sport.id)}`, jsonRequest("PATCH", payload));
                await sportsQuery.mutate();
                return "Параметры вида спорта сохранены.";
              })} />
            </div>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="Глобальные шапки" description="Общий справочник Admin-команд внутри одного вида спорта; каждая Shapka может обслуживать несколько чемпионатов." icon={<Database />}>
        <GlobalHeaderForm
          sports={sports}
          disabled={busy !== null || sports.length === 0}
          onSubmit={(payload) => runAction("global-header:create", async () => {
            await requestTLine("/api/tline/global-headers", jsonRequest("POST", payload));
            await globalHeadersQuery.mutate();
            return "Global Header / Shapka добавлена.";
          })}
        />
        <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {globalHeadersQuery.isLoading && <LoadingRow />}
          {!globalHeadersQuery.isLoading && globalHeaders.length === 0 && <EmptyRow text="Глобальные шапки ещё не настроены." />}
          {globalHeaders.map((header) => (
            <GlobalHeaderRow
              key={header.id}
              header={header}
              disabled={busy !== null}
              onSave={(payload) => runAction(`global-header:update:${header.id}`, async () => {
                await requestTLine(`/api/tline/global-headers/${encodeURIComponent(header.id)}`, jsonRequest("PATCH", payload));
                await globalHeadersQuery.mutate();
                await championshipsQuery.mutate();
                return "Параметры Shapka сохранены.";
              })}
              onDisable={() => runAction(`global-header:disable:${header.id}`, async () => {
                if (!window.confirm("Отключить Shapka? Плановые проверки связанных чемпионатов будут выключены.")) return;
                await requestTLine(`/api/tline/global-headers/${encodeURIComponent(header.id)}`, jsonRequest("DELETE"));
                await globalHeadersQuery.mutate();
                await championshipsQuery.mutate();
                return "Shapka безопасно отключена.";
              })}
            />
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="Чемпионаты" description="Официальный URL, sport scope и допустимое расхождение времени." icon={<Link2 />}>
        <ChampionshipForm
          sports={sports}
          globalHeaders={globalHeaders}
          disabled={busy !== null || sports.length === 0}
          onSubmit={(payload) => runAction("championship:create", async () => {
            await requestTLine("/api/tline/championships", jsonRequest("POST", payload));
            await championshipsQuery.mutate();
            return "Чемпионат добавлен.";
          })}
        />
        <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {championshipsQuery.isLoading && <LoadingRow />}
          {!championshipsQuery.isLoading && championships.length === 0 && <EmptyRow text="Чемпионаты ещё не добавлены." />}
          {championships.map((championship) => (
            <div key={championship.id}>
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0"><p className="font-black text-slate-900">{championship.name}</p><p className="max-w-3xl truncate text-xs text-slate-500">{championship.sourceUrl || "URL не задан"}</p></div>
                <button
                type="button"
                disabled={busy !== null}
                onClick={() => runAction(`championship:test:${championship.id}`, async () => {
                  const result = await requestTLine<{
                    teamCount?: number;
                    matchCount?: number;
                    eligibleMatchCount?: number;
                    excludedMatchCount?: number;
                    diagnostics?: { reasonCodes?: string[] };
                  }>(`/api/tline/championships/${encodeURIComponent(championship.id)}/test`, jsonRequest("POST"));
                  return formatOfficialConnectionMessage(result);
                })}
                className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-black text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                >Проверить источник</button>
              </div>
              <ChampionshipConfigEditor championship={championship} globalHeaders={globalHeaders} disabled={busy !== null} onSave={(payload) => runAction(`championship:update:${championship.id}`, async () => {
                await requestTLine(`/api/tline/championships/${encodeURIComponent(championship.id)}`, jsonRequest("PATCH", payload));
                await championshipsQuery.mutate();
                return "Параметры чемпионата сохранены.";
              })} />
            </div>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="Справочник команд Админа" description="Импорт существующего XLSX или публичной Google-таблицы без сохранения credentials." icon={<Upload />}>
        <AdminTeamImportForm
          championships={championships}
          globalHeaders={globalHeaders}
          disabled={busy !== null || championships.length === 0}
          onSubmit={(championshipId, formData) => runAction("admin-teams:import", async () => {
            const response = await fetch(`/api/tline/championships/${encodeURIComponent(championshipId)}/admin-teams/import`, { method: "POST", body: formData });
            const envelope = await response.json().catch(() => null) as { ok?: boolean; data?: { importedCount?: number; createdCount?: number; updatedCount?: number; membershipCount?: number }; error?: { message?: string } } | null;
            if (!response.ok || !envelope?.ok) throw new Error(envelope?.error?.message || `HTTP ${response.status}`);
            await globalHeadersQuery.mutate();
            return `Справочник обновлён. Добавлено: ${envelope.data?.createdCount ?? 0}, обновлено: ${envelope.data?.updatedCount ?? 0}, подключено к Shapka: ${envelope.data?.membershipCount ?? 0}.`;
          })}
        />
      </SettingsSection>

      <SettingsSection title="Маппинг команд" description="Маппинг всегда ограничен выбранным чемпионатом; неоднозначные варианты требуют подтверждения." icon={<Database />}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block flex-1"><span className="mb-1 block text-xs font-black text-slate-600">Чемпионат</span><select value={selectedChampionshipId} onChange={(event) => setSelectedChampionshipId(event.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold"><option value="">Выберите чемпионат</option>{championships.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <button
            type="button"
            disabled={!selectedChampionshipId || busy !== null}
            onClick={() => runAction("mapping:sync", async () => {
              const result = await requestTLine<{ synced?: number }>(`/api/tline/championships/${encodeURIComponent(selectedChampionshipId)}/sync-source-teams`, jsonRequest("POST"));
              await mappingsQuery.mutate();
              return `Синхронизация завершена. Команд: ${result.synced ?? 0}.`;
            })}
            className="h-10 rounded-xl border border-blue-200 px-4 text-sm font-black text-blue-700 hover:bg-blue-50 disabled:opacity-50"
          >
            Синхронизировать команды источника
          </button>
          <button
            type="button"
            disabled={!selectedChampionshipId || busy !== null}
            onClick={() => runAction("mapping:automap", async () => {
              await requestTLine(`/api/tline/championships/${encodeURIComponent(selectedChampionshipId)}/team-mappings/automap`, jsonRequest("POST"));
              await mappingsQuery.mutate();
              return "Автомаппинг завершён. Неоднозначные команды оставлены без привязки.";
            })}
            className="h-10 rounded-xl bg-blue-600 px-4 text-sm font-black text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Запустить автомаппинг
          </button>
        </div>
        <MappingTable
          championshipId={selectedChampionshipId}
          mappings={mappingsQuery.data ?? []}
          loading={mappingsQuery.isLoading}
          disabled={busy !== null}
          onSave={(mapping, platformId, adminName) => runAction(`mapping:save:${mapping.sourceTeamId}`, async () => {
            const path = mapping.id.startsWith("unmapped:")
              ? `/api/tline/championships/${encodeURIComponent(selectedChampionshipId)}/team-mappings`
              : `/api/tline/team-mappings/${encodeURIComponent(mapping.id)}`;
            await requestTLine(path, jsonRequest(mapping.id.startsWith("unmapped:") ? "POST" : "PATCH", {
              sourceTeamId: mapping.sourceTeamId,
              platformId,
              adminName,
              locked: true,
            }));
            await mappingsQuery.mutate();
            return "Ручной маппинг сохранён.";
          })}
          onAutomap={(mapping) => runAction(`mapping:row-automap:${mapping.sourceTeamId}`, async () => {
            await requestTLine(`/api/tline/championships/${encodeURIComponent(selectedChampionshipId)}/team-mappings/automap`, jsonRequest("POST", { sourceTeamId: mapping.sourceTeamId }));
            await mappingsQuery.mutate();
            return "Автомаппинг выполнен для доступных команд Shapka.";
          })}
          onClear={(mapping) => runAction(`mapping:clear:${mapping.sourceTeamId}`, async () => {
            if (mapping.id.startsWith("unmapped:")) return "Связь уже отсутствует.";
            if (!window.confirm(`Очистить маппинг команды «${mapping.sourceTeamName}» и заблокировать повторный автомаппинг?`)) return;
            await requestTLine(`/api/tline/team-mappings/${encodeURIComponent(mapping.id)}`, jsonRequest("DELETE"));
            await mappingsQuery.mutate();
            return "Маппинг очищен и заблокирован от автомаппинга.";
          })}
          onUnlock={(mapping) => runAction(`mapping:unlock:${mapping.sourceTeamId}`, async () => {
            await requestTLine(`/api/tline/team-mappings/${encodeURIComponent(mapping.id)}`, jsonRequest("PATCH", { locked: false }));
            await mappingsQuery.mutate();
            return "Ручная блокировка снята.";
          })}
        />
      </SettingsSection>

      <SettingsSection title="Автопроверка" description="Плановые слоты рассчитываются в Europe/Moscow и сохраняются в PostgreSQL." icon={<RefreshCw />}>
        <ScheduleForm
          value={scheduleQuery.data ?? emptySchedule}
          disabled={busy !== null || scheduleQuery.isLoading}
          onSubmit={(payload) => runAction("schedule:save", async () => {
            await requestTLine("/api/tline/schedule", jsonRequest("PATCH", payload));
            await scheduleQuery.mutate();
            return "Настройки автопроверки сохранены.";
          })}
        />
      </SettingsSection>

      <SettingsSection title="Подключение к Admin" description="Проверяется только read-only доступ; секреты никогда не отображаются." icon={<CheckCircle2 />}>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 p-4">
          <div><p className="font-black text-slate-900">{adminQuery.data?.configured ? "Адаптер настроен" : "Адаптер не настроен"}</p><p className="mt-1 text-xs text-slate-500">{adminQuery.data?.connected ? "Read-only соединение доступно" : "Соединение не подтверждено"}</p></div>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => runAction("admin:test", async () => {
              await requestTLine("/api/tline/admin-connection/test", jsonRequest("POST"));
              await adminQuery.mutate();
              return "Read-only подключение к Admin проверено.";
            })}
            className="rounded-xl border border-blue-200 px-4 py-2 text-sm font-black text-blue-700 hover:bg-blue-50 disabled:opacity-50"
          >
            Проверить подключение
          </button>
        </div>
      </SettingsSection>
    </div>
  );
}

function SettingsSection({ title, description, icon, children }: { title: string; description: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
      <div className="mb-5 flex items-start gap-3"><span className="mt-0.5 text-blue-600">{icon}</span><div><h2 className="text-xl font-black text-slate-950">{title}</h2><p className="mt-1 text-sm text-slate-600">{description}</p></div></div>
      {children}
    </section>
  );
}

function SportForm({ disabled, onSubmit }: { disabled: boolean; onSubmit: (payload: { name: string; slug: string }) => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  return (
    <form onSubmit={(event) => { event.preventDefault(); if (name.trim() && slug.trim()) onSubmit({ name: name.trim(), slug: slug.trim().toLowerCase() }); }} className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
      <TextField label="Название" value={name} onChange={setName} placeholder="Волейбол" required />
      <TextField label="Slug" value={slug} onChange={setSlug} placeholder="volleyball" required />
      <button disabled={disabled} className="mt-5 h-10 rounded-xl bg-slate-950 px-4 text-sm font-black text-white disabled:opacity-50">Добавить</button>
    </form>
  );
}

function GlobalHeaderForm({ sports, disabled, onSubmit }: { sports: TLineSport[]; disabled: boolean; onSubmit: (payload: Record<string, unknown>) => void }) {
  const [sportId, setSportId] = useState("");
  const [adminShapkaId, setAdminShapkaId] = useState("");
  const [name, setName] = useState("");
  useEffect(() => { if (!sportId && sports.length > 0) setSportId(sports[0].id); }, [sportId, sports]);
  return <form onSubmit={(event) => { event.preventDefault(); onSubmit({ sportId, adminShapkaId: adminShapkaId.trim(), name: name.trim() || null }); }} className="grid gap-3 lg:grid-cols-[200px_220px_1fr_auto]"><label><span className="mb-1 block text-xs font-black text-slate-600">Вид спорта</span><select value={sportId} onChange={(event) => setSportId(event.target.value)} required className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">{sports.map((sport) => <option key={sport.id} value={sport.id}>{sport.name}</option>)}</select></label><TextField label="Admin Shapka ID" value={adminShapkaId} onChange={setAdminShapkaId} placeholder="833524" required /><TextField label="Название Shapka" value={name} onChange={setName} placeholder="Волейбол России" /><button disabled={disabled} className="mt-5 h-10 rounded-xl bg-slate-950 px-4 text-sm font-black text-white disabled:opacity-50">Добавить</button></form>;
}

function GlobalHeaderRow({ header, disabled, onSave, onDisable }: { header: TLineGlobalHeader; disabled: boolean; onSave: (payload: Record<string, unknown>) => void; onDisable: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(header.name ?? "");
  const [adminShapkaId, setAdminShapkaId] = useState(header.adminShapkaId);
  useEffect(() => { setName(header.name ?? ""); setAdminShapkaId(header.adminShapkaId); }, [header]);
  if (editing) return <form onSubmit={(event) => { event.preventDefault(); onSave({ name: name.trim() || null, adminShapkaId: adminShapkaId.trim() }); setEditing(false); }} className="grid gap-3 px-4 py-3 lg:grid-cols-[220px_1fr_auto_auto]"><TextField label="Admin Shapka ID" value={adminShapkaId} onChange={setAdminShapkaId} placeholder="833524" required /><TextField label="Название" value={name} onChange={setName} placeholder="Волейбол России" /><button disabled={disabled} className="mt-5 h-10 rounded-lg bg-blue-600 px-3 text-xs font-black text-white">Сохранить</button><button type="button" onClick={() => setEditing(false)} className="mt-5 h-10 rounded-lg border border-slate-200 px-3 text-xs font-black">Отмена</button></form>;
  return <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><div><p className="font-black text-slate-900">{header.name || `Shapka #${header.adminShapkaId}`}</p><p className="text-xs text-slate-500">{header.sportName} · ID {header.adminShapkaId} · команд {header.teamCount} · чемпионатов {header.championships.length}</p></div><div className="flex gap-2"><button type="button" disabled={disabled} onClick={() => setEditing(true)} className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-black text-blue-700">Редактировать</button>{header.active && <button type="button" disabled={disabled} onClick={onDisable} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-black text-red-700">Отключить</button>}</div></div>;
}

function ChampionshipForm({ sports, globalHeaders, disabled, onSubmit }: { sports: TLineSport[]; globalHeaders: TLineGlobalHeader[]; disabled: boolean; onSubmit: (payload: Record<string, unknown>) => void }) {
  const [name, setName] = useState("");
  const [sportId, setSportId] = useState("");
  const [globalHeaderId, setGlobalHeaderId] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [tolerance, setTolerance] = useState("");
  useEffect(() => { if (!sportId && sports.length > 0) setSportId(sports[0].id); }, [sportId, sports]);
  return (
    <form onSubmit={(event) => { event.preventDefault(); onSubmit({ name: name.trim(), sportId, globalHeaderId: globalHeaderId || null, sourceUrl: sourceUrl.trim(), allowedTimeDriftMinutes: tolerance ? Number(tolerance) : null }); }} className="grid gap-3 lg:grid-cols-[1fr_180px_220px_1.5fr_160px_auto]">
      <TextField label="Название" value={name} onChange={setName} placeholder="Высшая лига А. Женщины" required />
      <label><span className="mb-1 block text-xs font-black text-slate-600">Вид спорта</span><select value={sportId} onChange={(event) => setSportId(event.target.value)} required className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"><option value="">Выберите</option>{sports.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label><span className="mb-1 block text-xs font-black text-slate-600">Global Header / Shapka</span><select value={globalHeaderId} onChange={(event) => setGlobalHeaderId(event.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"><option value="">Настроить позже</option>{globalHeaders.filter((header) => header.sportId === sportId && header.active).map((header) => <option key={header.id} value={header.id}>{header.name || `Shapka #${header.adminShapkaId}`}</option>)}</select></label>
      <TextField label="Официальный URL" type="url" value={sourceUrl} onChange={setSourceUrl} placeholder="https://volley.ru/calendar/..., https://нффр.рф/sport/calendar/... или https://hockey.by/calendar/" required />
      <TextField label="Допуск, минуты" type="number" value={tolerance} onChange={setTolerance} placeholder="5" required />
      <button disabled={disabled} className="mt-5 h-10 rounded-xl bg-slate-950 px-4 text-sm font-black text-white disabled:opacity-50">Добавить</button>
    </form>
  );
}

function AdminTeamImportForm({ championships, globalHeaders, disabled, onSubmit }: { championships: TLineChampionship[]; globalHeaders: TLineGlobalHeader[]; disabled: boolean; onSubmit: (championshipId: string, body: FormData) => void }) {
  const [championshipId, setChampionshipId] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => { if (!championshipId && championships.length > 0) setChampionshipId(championships[0].id); }, [championshipId, championships]);
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
      <label><span className="mb-1 block text-xs font-black text-slate-600">Чемпионат</span><select value={championshipId} onChange={(event) => setChampionshipId(event.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"><option value="">Выберите чемпионат</option>{championships.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <TextField label="Google Sheets URL" type="url" value={url} onChange={setUrl} placeholder="https://docs.google.com/spreadsheets/..." />
      <label><span className="mb-1 block text-xs font-black text-slate-600">XLSX-файл</span><input type="file" accept=".xlsx" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="block h-10 w-full rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:font-bold" /></label>
      <button disabled={disabled || (!url.trim() && !file)} className="mt-5 h-10 rounded-xl bg-blue-600 px-4 text-sm font-black text-white disabled:opacity-50">Импортировать</button>
      <p className="lg:col-span-4 text-xs text-slate-500">Справочник будет доступен всем чемпионатам выбранной Shapka: {sharedHeader?.championships.map((item) => item.name).join(", ") || "назначьте Shapka в настройках чемпионата"}.</p>
    </form>
  );
}

function ScheduleForm({ value, disabled, onSubmit }: { value: TLineSchedule; disabled: boolean; onSubmit: (payload: TLineSchedule) => void }) {
  const [enabled, setEnabled] = useState(value.enabled);
  useEffect(() => setEnabled(value.enabled), [value.enabled]);
  return (
    <form onSubmit={(event) => { event.preventDefault(); onSubmit({ ...value, enabled, slots: value.slots.length > 0 ? value.slots : emptySchedule.slots }); }} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 p-4">
      <div><p className="font-black text-slate-900">08:00 · 12:00 · 16:00 · 22:00 МСК</p><p className="mt-1 text-xs text-slate-500">Следующий запуск: {value.nextRunAt ? formatMoscow(value.nextRunAt) : "не запланирован"}</p></div>
      <div className="flex items-center gap-3"><label className="inline-flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />Включена</label><button disabled={disabled} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white disabled:opacity-50">Сохранить</button></div>
    </form>
  );
}

function MappingTable({ championshipId, mappings, loading, disabled, onSave, onAutomap, onClear, onUnlock }: {
  championshipId: string;
  mappings: TLineTeamMapping[];
  loading: boolean;
  disabled: boolean;
  onSave: (mapping: TLineTeamMapping, platformId: string, adminName: string) => void;
  onAutomap: (mapping: TLineTeamMapping) => void;
  onClear: (mapping: TLineTeamMapping) => void;
  onUnlock: (mapping: TLineTeamMapping) => void;
}) {
  if (loading) return <div className="mt-4"><LoadingRow /></div>;
  if (mappings.length === 0) return <div className="mt-4"><EmptyRow text="Команды источника ещё не синхронизированы." /></div>;
  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[1120px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3">Официальный источник</th><th className="px-4 py-3">Admin-наименование</th><th className="px-4 py-3">Team ID</th><th className="px-4 py-3">Статус</th><th className="px-4 py-3">Действия</th></tr></thead><tbody>{mappings.map((mapping) => <MappingRow key={mapping.sourceTeamId} championshipId={championshipId} mapping={mapping} disabled={disabled} onSave={onSave} onAutomap={onAutomap} onClear={onClear} onUnlock={onUnlock} />)}</tbody></table></div>
  );
}

function MappingRow({ championshipId, mapping, disabled, onSave, onAutomap, onClear, onUnlock }: {
  championshipId: string;
  mapping: TLineTeamMapping;
  disabled: boolean;
  onSave: (mapping: TLineTeamMapping, platformId: string, adminName: string) => void;
  onAutomap: (mapping: TLineTeamMapping) => void;
  onClear: (mapping: TLineTeamMapping) => void;
  onUnlock: (mapping: TLineTeamMapping) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState(mapping.adminTeamName ?? "");
  const [platformId, setPlatformId] = useState(mapping.adminTeamPlatformId ?? "");
  const [items, setItems] = useState<AdminTeamOption[]>([]);
  const [loading, setLoading] = useState(false);
  const listId = useId();

  useEffect(() => {
    if (editing) return;
    setQuery(mapping.adminTeamName ?? "");
    setPlatformId(mapping.adminTeamPlatformId ?? "");
  }, [editing, mapping.adminTeamName, mapping.adminTeamPlatformId]);

  useEffect(() => {
    if (!editing || query.trim().length < 2) {
      setItems([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ q: query.trim() });
        const data = await requestTLine<unknown>(
          `/api/tline/championships/${encodeURIComponent(championshipId)}/admin-teams?${params.toString()}`,
          { signal: controller.signal },
        );
        const values = isRecord(data) && Array.isArray(data.items) ? data.items : [];
        setItems(values.flatMap((value) => isRecord(value) && asString(value.id) ? [{
          id: asString(value.id),
          platformId: asString(value.platformId),
          name: asString(value.name),
        }] : []));
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setItems([]);
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [championshipId, editing, query]);

  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="px-4 py-3"><p className="font-bold text-slate-900">{mapping.sourceTeamName}</p><p className="mt-1 text-xs text-slate-500">Source ID: {mapping.sourceTeamExternalId || "—"}</p></td>
      <td className="relative px-4 py-3">{editing ? <><input id={`${listId}-input`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название Admin" className="h-9 w-full rounded-lg border border-slate-200 px-2" />{query.trim().length >= 2 && <div id={listId} className="absolute z-30 mt-1 max-h-48 w-80 overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl">{loading && <p className="px-2 py-1 text-xs text-slate-500">Поиск…</p>}{!loading && items.map((item) => <button key={item.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setQuery(item.name); setPlatformId(item.platformId); setItems([]); }} className="block w-full rounded px-2 py-1.5 text-left hover:bg-blue-50"><span className="font-bold">{item.name}</span><span className="ml-2 text-xs text-slate-500">#{item.platformId}</span></button>)}</div>}</> : <><p>{mapping.adminTeamName || "Не сопоставлена"}</p>{mapping.adminTeamId && !mapping.inDirectory && <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-black text-amber-800">Вне справочника</span>}</>}</td>
      <td className="px-4 py-3">{editing ? <input value={platformId} onChange={(event) => setPlatformId(event.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="Положительный Team ID" className="h-9 w-44 rounded-lg border border-slate-200 px-2" /> : mapping.adminTeamPlatformId || "—"}</td>
      <td className="px-4 py-3"><p className="font-bold">{mapping.status}</p><p className="mt-1 text-xs text-slate-500">{mapping.matchMethod || "—"} · {mapping.confidence === null ? "—" : `${Math.round(mapping.confidence * 100)}%`}</p>{mapping.locked && <span className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black">Заблокирован</span>}</td>
      <td className="px-4 py-3"><div className="flex max-w-[360px] flex-wrap gap-2">{editing ? <><button type="button" disabled={disabled || !/^\d+$/.test(platformId) || platformId === "0"} onClick={() => { onSave(mapping, platformId, query); setEditing(false); }} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-black text-white disabled:opacity-50">Сохранить</button><button type="button" onClick={() => { setEditing(false); setQuery(mapping.adminTeamName ?? ""); setPlatformId(mapping.adminTeamPlatformId ?? ""); }} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-black">Отмена</button></> : <button type="button" disabled={disabled} onClick={() => setEditing(true)} className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-black text-blue-700">Редактировать</button>}<button type="button" disabled={disabled || mapping.locked} onClick={() => onAutomap(mapping)} className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-black text-emerald-700 disabled:opacity-50">Подобрать автоматически</button><button type="button" disabled={disabled || mapping.id.startsWith("unmapped:")} onClick={() => onClear(mapping)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-black text-red-700 disabled:opacity-50">Очистить</button>{mapping.locked && !mapping.id.startsWith("unmapped:") && <button type="button" disabled={disabled} onClick={() => onUnlock(mapping)} className="rounded-lg border border-amber-200 px-3 py-1.5 text-xs font-black text-amber-800">Снять блокировку</button>}</div></td>
    </tr>
  );
}

function TextField({ label, value, onChange, placeholder, type = "text", required = false }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; type?: string; required?: boolean }) {
  return <label><span className="mb-1 block text-xs font-black text-slate-600">{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required={required} min={type === "number" ? "0" : undefined} className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label>;
}

function LoadingRow() { return <div className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" />Загрузка…</div>; }
function EmptyRow({ text }: { text: string }) { return <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">{text}</div>; }

const emptySchedule: TLineSchedule = { enabled: false, slots: ["08:00", "12:00", "16:00", "22:00"], nextRunAt: null };
const EMPTY_SPORTS: TLineSport[] = [];
const EMPTY_CHAMPIONSHIPS: TLineChampionship[] = [];
const EMPTY_GLOBAL_HEADERS: TLineGlobalHeader[] = [];

async function loadSports(url: string): Promise<TLineSport[]> {
  const data = await requestTLine<unknown>(url);
  const values = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.sports) ? data.sports : [];
  return values.flatMap((value) => isRecord(value) && asString(value.id) && asString(value.name) ? [{ id: asString(value.id), slug: asString(value.slug) || asString(value.id), name: asString(value.name), active: value.active !== false, autoEnabled: Boolean(value.autoEnabled), adminSportId: nullableString(value.adminSportId), autoPeriodFromOffsetMinutes: nullableNumber(value.autoPeriodFromOffsetMinutes), autoPeriodToOffsetMinutes: nullableNumber(value.autoPeriodToOffsetMinutes), candidateMatchWindowMinutes: nullableNumber(value.candidateMatchWindowMinutes), defaultAllowedTimeDriftMinutes: nullableNumber(value.defaultAllowedTimeDriftMinutes) }] : []);
}

async function loadChampionships(url: string): Promise<TLineChampionship[]> {
  const data = await requestTLine<unknown>(url);
  const values = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.championships) ? data.championships : [];
  return values.flatMap((value) => isRecord(value) && asString(value.id) && asString(value.name) ? [{ id: asString(value.id), name: asString(value.name), sportId: asString(value.sportId), sourceUrl: asString(value.sourceUrl), globalHeaderId: nullableString(value.globalHeaderId), globalHeader: parseGlobalHeaderRef(value.globalHeader), active: value.active !== false, autoEnabled: Boolean(value.autoEnabled), allowedTimeDriftMinutes: nullableNumber(value.allowedTimeDriftMinutes), candidateMatchWindowMinutes: nullableNumber(value.candidateMatchWindowMinutes), adminChampionshipId: nullableString(value.adminChampionshipId), adminChampionshipName: nullableString(value.adminChampionshipName) }] : []);
}

async function loadGlobalHeaders(url: string): Promise<TLineGlobalHeader[]> {
  const data = await requestTLine<unknown>(url);
  const values = Array.isArray(data) ? data : [];
  return values.flatMap((value) => isRecord(value) && asString(value.id) ? [{ id: asString(value.id), sportId: asString(value.sportId), sportName: asString(value.sportName), adminShapkaId: asString(value.adminShapkaId), name: nullableString(value.name), active: value.active !== false, teamCount: nullableNumber(value.teamCount) ?? 0, championships: Array.isArray(value.championships) ? value.championships.flatMap((championship) => isRecord(championship) && asString(championship.id) ? [{ id: asString(championship.id), name: asString(championship.name), active: championship.active !== false }] : []) : [] }] : []);
}

async function loadMappings(url: string): Promise<TLineTeamMapping[]> {
  const data = await requestTLine<unknown>(url);
  const values = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.mappings) ? data.mappings : [];
  return values.flatMap((value) => isRecord(value) && asString(value.id) && asString(value.sourceTeamId) ? [{ id: asString(value.id), sourceTeamId: asString(value.sourceTeamId), sourceTeamExternalId: nullableString(value.sourceTeamExternalId), sourceTeamName: asString(value.sourceTeamName || value.sourceName), adminTeamId: nullableString(value.adminTeamId), adminTeamPlatformId: nullableString(value.adminTeamPlatformId), adminTeamName: nullableString(value.adminTeamName), status: asString(value.status) || "UNMAPPED", matchMethod: nullableString(value.matchMethod), inDirectory: Boolean(value.inDirectory), locked: Boolean(value.locked), confidence: typeof value.confidence === "number" ? value.confidence : null }] : []);
}

async function loadSchedule(url: string): Promise<TLineSchedule> {
  const data = await requestTLine<unknown>(url);
  return isRecord(data) ? { enabled: Boolean(data.enabled), slots: Array.isArray(data.slots) ? data.slots.filter((value): value is string => typeof value === "string") : emptySchedule.slots, nextRunAt: nullableString(data.nextRunAt) } : emptySchedule;
}

async function loadAdminStatus(url: string): Promise<{ configured: boolean; connected: boolean }> {
  const data = await requestTLine<unknown>(url);
  return isRecord(data) ? { configured: Boolean(data.configured), connected: Boolean(data.connected) } : { configured: false, connected: false };
}

function formatMoscow(value: string) { return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" }).format(new Date(value)) + " МСК"; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function asString(value: unknown) { return typeof value === "string" ? value : typeof value === "number" ? String(value) : ""; }
function nullableString(value: unknown) { return asString(value) || null; }
function nullableNumber(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function parseGlobalHeaderRef(value: unknown): TLineChampionship["globalHeader"] { return isRecord(value) && asString(value.id) ? { id: asString(value.id), adminShapkaId: asString(value.adminShapkaId), name: nullableString(value.name), active: value.active !== false } : null; }
function messageOf(value: unknown) { return value instanceof Error ? value.message : "Неизвестная ошибка"; }

type AdminTeamOption = { id: string; platformId: string; name: string };
