"use client";

import { useEffect, useId, useState } from "react";
import { requestTLine } from "../api";
import type { TLineTeamMapping } from "../types";
import { isRecord, asString } from "./settingsData";
import { LoadingRow, EmptyRow } from "./SettingsUi";

/** Редактор сопоставления: поиск с отменой устаревшего запроса → выбор ID → подтверждённое сохранение. */
export function MappingTable({
  championshipId,
  mappings,
  loading,
  disabled,
  onSave,
  onAutomap,
  onClear,
  onUnlock,
}: {
  championshipId: string;
  mappings: TLineTeamMapping[];
  loading: boolean;
  disabled: boolean;
  onSave: (mapping: TLineTeamMapping, platformId: string, adminName: string) => Promise<boolean>;
  onAutomap: (mapping: TLineTeamMapping) => void;
  onClear: (mapping: TLineTeamMapping) => void;
  onUnlock: (mapping: TLineTeamMapping) => void;
}) {
  if (loading)
    return (
      <div className="mt-4">
        <LoadingRow />
      </div>
    );
  if (mappings.length === 0)
    return (
      <div className="mt-4">
        <EmptyRow text="Команды источника ещё не синхронизированы." />
      </div>
    );
  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[1120px] text-left text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            <th className="px-4 py-3">Официальный источник</th>
            <th className="px-4 py-3">Admin-наименование</th>
            <th className="px-4 py-3">Team ID</th>
            <th className="px-4 py-3">Статус</th>
            <th className="px-4 py-3">Действия</th>
          </tr>
        </thead>
        <tbody>
          {mappings.map((mapping) => (
            <MappingRow
              key={mapping.sourceTeamId}
              championshipId={championshipId}
              mapping={mapping}
              disabled={disabled}
              onSave={onSave}
              onAutomap={onAutomap}
              onClear={onClear}
              onUnlock={onUnlock}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MappingRow({
  championshipId,
  mapping,
  disabled,
  onSave,
  onAutomap,
  onClear,
  onUnlock,
}: {
  championshipId: string;
  mapping: TLineTeamMapping;
  disabled: boolean;
  onSave: (mapping: TLineTeamMapping, platformId: string, adminName: string) => Promise<boolean>;
  onAutomap: (mapping: TLineTeamMapping) => void;
  onClear: (mapping: TLineTeamMapping) => void;
  onUnlock: (mapping: TLineTeamMapping) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState(mapping.adminTeamName ?? "");
  const [platformId, setPlatformId] = useState(mapping.adminTeamPlatformId ?? "");
  const [items, setItems] = useState<AdminTeamOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
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
      setSearchError(null);
      try {
        const params = new URLSearchParams({ q: query.trim() });
        const data = await requestTLine<unknown>(
          `/api/tline/championships/${encodeURIComponent(championshipId)}/admin-teams?${params.toString()}`,
          { signal: controller.signal },
        );
        const values = isRecord(data) && Array.isArray(data.items) ? data.items : [];
        if (controller.signal.aborted) return;
        setItems(
          values.flatMap((value) =>
            isRecord(value) && asString(value.id)
              ? [
                  {
                    id: asString(value.id),
                    platformId: asString(value.platformId),
                    name: asString(value.name),
                  },
                ]
              : [],
          ),
        );
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        if (!controller.signal.aborted) {
          setItems([]);
          setSearchError("Поиск недоступен. Повторите запрос или введите Team ID вручную.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [championshipId, editing, query]);

  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="px-4 py-3">
        <p className="font-bold text-slate-900">{mapping.sourceTeamName}</p>
        <p className="mt-1 text-xs text-slate-500">Source ID: {mapping.sourceTeamExternalId || "—"}</p>
      </td>
      <td className="relative px-4 py-3">
        {editing ? (
          <>
            <input
              aria-label="Название команды Admin"
              id={`${listId}-input`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Название Admin"
              className="h-9 w-full rounded-lg border border-slate-200 px-2"
            />
            {query.trim().length >= 2 && (
              <div
                id={listId}
                className="absolute z-30 mt-1 max-h-48 w-80 overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl"
              >
                {searchError && (
                  <p role="alert" className="px-2 py-1 text-xs text-red-700">
                    {searchError}
                  </p>
                )}
                {loading && <p className="px-2 py-1 text-xs text-slate-500">Поиск…</p>}
                {!loading &&
                  items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setQuery(item.name);
                        setPlatformId(item.platformId);
                        setItems([]);
                      }}
                      className="block w-full rounded px-2 py-1.5 text-left hover:bg-blue-50"
                    >
                      <span className="font-bold">{item.name}</span>
                      <span className="ml-2 text-xs text-slate-500">#{item.platformId}</span>
                    </button>
                  ))}
              </div>
            )}
          </>
        ) : (
          <>
            <p>{mapping.adminTeamName || "Не сопоставлена"}</p>
            {mapping.adminTeamId && !mapping.inDirectory && (
              <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-black text-amber-800">
                Вне справочника
              </span>
            )}
          </>
        )}
      </td>
      <td className="px-4 py-3">
        {editing ? (
          <input
            aria-label="Team ID"
            value={platformId}
            onChange={(event) => setPlatformId(event.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder="Положительный Team ID"
            className="h-9 w-44 rounded-lg border border-slate-200 px-2"
          />
        ) : (
          mapping.adminTeamPlatformId || "—"
        )}
      </td>
      <td className="px-4 py-3">
        <p className="font-bold">{mapping.status}</p>
        <p className="mt-1 text-xs text-slate-500">
          {mapping.matchMethod || "—"} ·{" "}
          {mapping.confidence === null ? "—" : `${Math.round(mapping.confidence * 100)}%`}
        </p>
        {mapping.locked && (
          <span className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black">
            Заблокирован
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex max-w-[360px] flex-wrap gap-2">
          {editing ? (
            <>
              <button
                type="button"
                disabled={disabled || !/^\d+$/.test(platformId) || platformId === "0"}
                onClick={async () => {
                  if (await onSave(mapping, platformId, query)) setEditing(false);
                }}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-black text-white disabled:opacity-50"
              >
                Сохранить
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setQuery(mapping.adminTeamName ?? "");
                  setPlatformId(mapping.adminTeamPlatformId ?? "");
                }}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-black"
              >
                Отмена
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setEditing(true)}
              className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-black text-blue-700"
            >
              Редактировать
            </button>
          )}
          <button
            type="button"
            disabled={disabled || mapping.locked}
            onClick={() => onAutomap(mapping)}
            className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-black text-emerald-700 disabled:opacity-50"
          >
            Подобрать автоматически
          </button>
          <button
            type="button"
            disabled={disabled || mapping.id.startsWith("unmapped:")}
            onClick={() => onClear(mapping)}
            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-black text-red-700 disabled:opacity-50"
          >
            Очистить
          </button>
          {mapping.locked && !mapping.id.startsWith("unmapped:") && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onUnlock(mapping)}
              className="rounded-lg border border-amber-200 px-3 py-1.5 text-xs font-black text-amber-800"
            >
              Снять блокировку
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

type AdminTeamOption = { id: string; platformId: string; name: string };
