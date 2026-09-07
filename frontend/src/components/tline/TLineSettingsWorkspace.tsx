"use client";

import { CheckCircle2, Database, Link2, RefreshCw, Settings2, Upload } from "lucide-react";
import { jsonRequest, requestTLine } from "./api";
import { ChampionshipConfigEditor, SportConfigEditor } from "./TLineConfigEditors";
import { SettingsSection, LoadingRow, EmptyRow } from "./settings/SettingsUi";
import { SportForm, GlobalHeaderForm, GlobalHeaderRow, ChampionshipForm } from "./settings/CatalogForms";
import { AdminTeamImportForm, ScheduleForm } from "./settings/ImportScheduleForms";
import { MappingTable } from "./settings/MappingTable";
import { emptySchedule } from "./settings/settingsData";
import { useTLineSettings } from "./settings/useTLineSettings";

/** Страница соединяет независимые формы; загрузка, проверка HTTP и редакторы вынесены в settings/. */
export function TLineSettingsWorkspace() {
  const {
    sportsQuery,
    championshipsQuery,
    globalHeadersQuery,
    scheduleQuery,
    adminQuery,
    mappingsQuery,
    selectedChampionshipId,
    setSelectedChampionshipId,
    busy,
    message,
    error,
    sports,
    championships,
    globalHeaders,
    runAction,
    loadError,
    retryLoads,
  } = useTLineSettings();
  return (
    <div className="space-y-6 pb-10">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">TLine</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">Настройки TLine</h1>
        <p className="mt-2 text-sm text-slate-600">
          Источники, сопоставления и автопроверка. Все действия в Admin остаются read-only.
        </p>
      </div>

      {(message || error || loadError) && (
        <div
          role={error || loadError ? "alert" : "status"}
          className={`rounded-2xl border px-5 py-4 text-sm font-bold ${error || loadError ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}
        >
          {error ?? loadError ?? message}
          {loadError && (
            <button type="button" className="ml-3 underline" onClick={() => void retryLoads()}>
              Повторить загрузку
            </button>
          )}
        </div>
      )}

      <SettingsSection
        title="Виды спорта"
        description="Включайте только полностью настроенные спортивные контуры."
        icon={<Settings2 />}
      >
        <SportForm
          disabled={busy !== null}
          onSubmit={(payload) =>
            runAction("sport:create", async () => {
              await requestTLine("/api/tline/sports", jsonRequest("POST", payload));
              await sportsQuery.mutate();
              return "Вид спорта добавлен.";
            })
          }
        />
        <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {sportsQuery.isLoading && <LoadingRow />}
          {!sportsQuery.isLoading && sports.length === 0 && <EmptyRow text="Виды спорта ещё не настроены." />}
          {sports.map((sport) => (
            <div key={sport.id}>
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-black text-slate-900">{sport.name}</p>
                  <p className="text-xs text-slate-500">{sport.slug}</p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-black ${sport.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}
                >
                  {sport.active ? "Активен" : "Отключён"}
                </span>
              </div>
              <SportConfigEditor
                sport={sport}
                disabled={busy !== null}
                onSave={(payload) =>
                  runAction(`sport:update:${sport.id}`, async () => {
                    await requestTLine(
                      `/api/tline/sports/${encodeURIComponent(sport.id)}`,
                      jsonRequest("PATCH", payload),
                    );
                    await sportsQuery.mutate();
                    return "Параметры вида спорта сохранены.";
                  })
                }
              />
            </div>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Глобальные шапки"
        description="Общий справочник Admin-команд внутри одного вида спорта; каждая Shapka может обслуживать несколько чемпионатов."
        icon={<Database />}
      >
        <GlobalHeaderForm
          sports={sports}
          disabled={busy !== null || sports.length === 0}
          onSubmit={(payload) =>
            runAction("global-header:create", async () => {
              await requestTLine("/api/tline/global-headers", jsonRequest("POST", payload));
              await globalHeadersQuery.mutate();
              return "Global Header / Shapka добавлена.";
            })
          }
        />
        <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {globalHeadersQuery.isLoading && <LoadingRow />}
          {!globalHeadersQuery.isLoading && globalHeaders.length === 0 && (
            <EmptyRow text="Глобальные шапки ещё не настроены." />
          )}
          {globalHeaders.map((header) => (
            <GlobalHeaderRow
              key={header.id}
              header={header}
              disabled={busy !== null}
              onSave={(payload) =>
                runAction(`global-header:update:${header.id}`, async () => {
                  await requestTLine(
                    `/api/tline/global-headers/${encodeURIComponent(header.id)}`,
                    jsonRequest("PATCH", payload),
                  );
                  await globalHeadersQuery.mutate();
                  await championshipsQuery.mutate();
                  return "Параметры Shapka сохранены.";
                })
              }
              onDisable={() =>
                runAction(`global-header:disable:${header.id}`, async () => {
                  if (!window.confirm("Отключить Shapka? Плановые проверки связанных чемпионатов будут выключены."))
                    return;
                  await requestTLine(
                    `/api/tline/global-headers/${encodeURIComponent(header.id)}`,
                    jsonRequest("DELETE"),
                  );
                  await globalHeadersQuery.mutate();
                  await championshipsQuery.mutate();
                  return "Shapka безопасно отключена.";
                })
              }
            />
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Чемпионаты"
        description="Официальный URL, sport scope и допустимое расхождение времени."
        icon={<Link2 />}
      >
        <ChampionshipForm
          sports={sports}
          globalHeaders={globalHeaders}
          disabled={busy !== null || sports.length === 0}
          onSubmit={(payload) =>
            runAction("championship:create", async () => {
              await requestTLine("/api/tline/championships", jsonRequest("POST", payload));
              await championshipsQuery.mutate();
              return "Чемпионат добавлен.";
            })
          }
        />
        <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {championshipsQuery.isLoading && <LoadingRow />}
          {!championshipsQuery.isLoading && championships.length === 0 && (
            <EmptyRow text="Чемпионаты ещё не добавлены." />
          )}
          {championships.map((championship) => (
            <div key={championship.id}>
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-black text-slate-900">{championship.name}</p>
                  <p className="max-w-3xl truncate text-xs text-slate-500">
                    {championship.sourceUrl || "URL не задан"}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    runAction(`championship:test:${championship.id}`, async () => {
                      await requestTLine(
                        `/api/tline/championships/${encodeURIComponent(championship.id)}/test`,
                        jsonRequest("POST"),
                      );
                      return "Официальный источник доступен.";
                    })
                  }
                  className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-black text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                >
                  Проверить источник
                </button>
              </div>
              <ChampionshipConfigEditor
                championship={championship}
                globalHeaders={globalHeaders}
                disabled={busy !== null}
                onSave={(payload) =>
                  runAction(`championship:update:${championship.id}`, async () => {
                    await requestTLine(
                      `/api/tline/championships/${encodeURIComponent(championship.id)}`,
                      jsonRequest("PATCH", payload),
                    );
                    await championshipsQuery.mutate();
                    return "Параметры чемпионата сохранены.";
                  })
                }
              />
            </div>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Справочник команд Админа"
        description="Импорт существующего XLSX или публичной Google-таблицы без сохранения credentials."
        icon={<Upload />}
      >
        <AdminTeamImportForm
          championships={championships}
          globalHeaders={globalHeaders}
          disabled={busy !== null || championships.length === 0}
          onSubmit={(championshipId, formData) =>
            runAction("admin-teams:import", async () => {
              const response = await fetch(
                `/api/tline/championships/${encodeURIComponent(championshipId)}/admin-teams/import`,
                { method: "POST", body: formData },
              );
              const envelope = (await response.json().catch(() => null)) as {
                ok?: boolean;
                data?: {
                  importedCount?: number;
                  createdCount?: number;
                  updatedCount?: number;
                  membershipCount?: number;
                };
                error?: { message?: string };
              } | null;
              if (!response.ok || !envelope?.ok) throw new Error(envelope?.error?.message || `HTTP ${response.status}`);
              await globalHeadersQuery.mutate();
              return `Справочник обновлён. Добавлено: ${envelope.data?.createdCount ?? 0}, обновлено: ${envelope.data?.updatedCount ?? 0}, подключено к Shapka: ${envelope.data?.membershipCount ?? 0}.`;
            })
          }
        />
      </SettingsSection>

      <SettingsSection
        title="Маппинг команд"
        description="Маппинг всегда ограничен выбранным чемпионатом; неоднозначные варианты требуют подтверждения."
        icon={<Database />}
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="block flex-1">
            <span className="mb-1 block text-xs font-black text-slate-600">Чемпионат</span>
            <select
              value={selectedChampionshipId}
              onChange={(event) => setSelectedChampionshipId(event.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold"
            >
              <option value="">Выберите чемпионат</option>
              {championships.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!selectedChampionshipId || busy !== null}
            onClick={() =>
              runAction("mapping:sync", async () => {
                const result = await requestTLine<{ synced?: number }>(
                  `/api/tline/championships/${encodeURIComponent(selectedChampionshipId)}/sync-source-teams`,
                  jsonRequest("POST"),
                );
                await mappingsQuery.mutate();
                return `Синхронизация завершена. Команд: ${result.synced ?? 0}.`;
              })
            }
            className="h-10 rounded-xl border border-blue-200 px-4 text-sm font-black text-blue-700 hover:bg-blue-50 disabled:opacity-50"
          >
            Синхронизировать команды источника
          </button>
          <button
            type="button"
            disabled={!selectedChampionshipId || busy !== null}
            onClick={() =>
              runAction("mapping:automap", async () => {
                await requestTLine(
                  `/api/tline/championships/${encodeURIComponent(selectedChampionshipId)}/team-mappings/automap`,
                  jsonRequest("POST"),
                );
                await mappingsQuery.mutate();
                return "Автомаппинг завершён. Неоднозначные команды оставлены без привязки.";
              })
            }
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
          onSave={(mapping, platformId, adminName) =>
            runAction(`mapping:save:${mapping.sourceTeamId}`, async () => {
              const path = mapping.id.startsWith("unmapped:")
                ? `/api/tline/championships/${encodeURIComponent(selectedChampionshipId)}/team-mappings`
                : `/api/tline/team-mappings/${encodeURIComponent(mapping.id)}`;
              await requestTLine(
                path,
                jsonRequest(mapping.id.startsWith("unmapped:") ? "POST" : "PATCH", {
                  sourceTeamId: mapping.sourceTeamId,
                  platformId,
                  adminName,
                  locked: true,
                }),
              );
              await mappingsQuery.mutate();
              return "Ручной маппинг сохранён.";
            })
          }
          onAutomap={(mapping) =>
            runAction(`mapping:row-automap:${mapping.sourceTeamId}`, async () => {
              await requestTLine(
                `/api/tline/championships/${encodeURIComponent(selectedChampionshipId)}/team-mappings/automap`,
                jsonRequest("POST", { sourceTeamId: mapping.sourceTeamId }),
              );
              await mappingsQuery.mutate();
              return "Автомаппинг выполнен для доступных команд Shapka.";
            })
          }
          onClear={(mapping) =>
            runAction(`mapping:clear:${mapping.sourceTeamId}`, async () => {
              if (mapping.id.startsWith("unmapped:")) return "Связь уже отсутствует.";
              if (
                !window.confirm(
                  `Очистить маппинг команды «${mapping.sourceTeamName}» и заблокировать повторный автомаппинг?`,
                )
              )
                return;
              await requestTLine(`/api/tline/team-mappings/${encodeURIComponent(mapping.id)}`, jsonRequest("DELETE"));
              await mappingsQuery.mutate();
              return "Маппинг очищен и заблокирован от автомаппинга.";
            })
          }
          onUnlock={(mapping) =>
            runAction(`mapping:unlock:${mapping.sourceTeamId}`, async () => {
              await requestTLine(
                `/api/tline/team-mappings/${encodeURIComponent(mapping.id)}`,
                jsonRequest("PATCH", { locked: false }),
              );
              await mappingsQuery.mutate();
              return "Ручная блокировка снята.";
            })
          }
        />
      </SettingsSection>

      <SettingsSection
        title="Автопроверка"
        description="Плановые слоты рассчитываются в Europe/Moscow и сохраняются в PostgreSQL."
        icon={<RefreshCw />}
      >
        <ScheduleForm
          value={scheduleQuery.data ?? emptySchedule}
          disabled={busy !== null || scheduleQuery.isLoading || !scheduleQuery.data || Boolean(scheduleQuery.error)}
          onSubmit={(payload) =>
            runAction("schedule:save", async () => {
              await requestTLine("/api/tline/schedule", jsonRequest("PATCH", payload));
              await scheduleQuery.mutate();
              return "Настройки автопроверки сохранены.";
            })
          }
        />
      </SettingsSection>

      <SettingsSection
        title="Подключение к Admin"
        description="Проверяется только read-only доступ; секреты никогда не отображаются."
        icon={<CheckCircle2 />}
      >
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 p-4">
          <div>
            <p className="font-black text-slate-900">
              {adminQuery.data?.configured ? "Адаптер настроен" : "Адаптер не настроен"}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {adminQuery.data?.connected ? "Read-only соединение доступно" : "Соединение не подтверждено"}
            </p>
          </div>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              runAction("admin:test", async () => {
                await requestTLine("/api/tline/admin-connection/test", jsonRequest("POST"));
                await adminQuery.mutate();
                return "Read-only подключение к Admin проверено.";
              })
            }
            className="rounded-xl border border-blue-200 px-4 py-2 text-sm font-black text-blue-700 hover:bg-blue-50 disabled:opacity-50"
          >
            Проверить подключение
          </button>
        </div>
      </SettingsSection>
    </div>
  );
}
