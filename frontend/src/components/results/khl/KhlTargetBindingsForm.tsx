"use client";

import { useEffect, useId, useState } from "react";

import type { KhlMatchProtocolView } from "@backend/results/khl/matchProtocol";

const TEAM_STATS = [
  ["shots_on_goal", "Броски в створ"],
  ["faceoffs_won", "Выигранные вбрасывания"],
  ["power_play_goals", "Голы в большинстве"],
  ["penalty_minutes_2_4", "Штрафные минуты 2/4"],
] as const;
const PLAYER_STATS = [
  ["goals", "Голы"],
  ["assists", "Передачи"],
  ["points", "Очки"],
] as const;

type TeamStatCode = typeof TEAM_STATS[number][0];
type PlayerStatCode = typeof PLAYER_STATS[number][0];
type Side = "home" | "away";

export type KhlTargetBindingsTemplate = {
  khlGameId: string;
  teamStatTypes: Record<TeamStatCode, string>;
  playerStatTypes: Record<PlayerStatCode, string>;
  teams: Record<Side, {
    stats: Record<TeamStatCode, { adminMatchStatId: string }>;
  }>;
  players: Array<{
    khlPlayerId: string;
    adminPlayerId: string;
    adminMatchPlayerId: string;
    stats: Record<PlayerStatCode, string>;
  }>;
};

export type KhlTargetBindingLabels = {
  homeTeam: string;
  awayTeam: string;
  players: Record<string, string>;
  playerBindings?: Record<string, { player: string; matchPlayer: string }>;
};

type DirectorySuggestion = {
  platformId: string;
  platformName: string;
  platformNameRu: string | null;
  platformNameEn: string | null;
  scopes: string[];
  score: number;
  matchType: string;
};

export function KhlTargetBindingsForm({
  template,
  labels,
  protocol,
  busyKey,
  onChange,
  onConfirmPlayer,
  showStatTypes = true,
}: {
  template: KhlTargetBindingsTemplate;
  labels: KhlTargetBindingLabels;
  protocol: KhlMatchProtocolView | null;
  busyKey: string | null;
  onChange: (template: KhlTargetBindingsTemplate) => void;
  onConfirmPlayer: (player: KhlTargetBindingsTemplate["players"][number]) => void;
  showStatTypes?: boolean;
}) {
  const update = (mutate: (next: KhlTargetBindingsTemplate) => void) => {
    const next = structuredClone(template);
    mutate(next);
    onChange(next);
  };
  const protocolPlayers = new Map(
    (protocol?.players || []).map((player) => [player.khlPlayerId, player])
  );

  return (
    <div data-testid="khl-target-bindings-form" className="mt-4 space-y-5">
      {showStatTypes && <section className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4">
        <h4 className="text-sm font-black text-slate-950">Типы статистики Admin</h4>
        <p className="mt-1 text-xs text-slate-600">
          Это semantic type ID. Они общие для метрики; конкретные target record ID ниже задаются отдельно каждой команде и каждому игроку.
        </p>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <StatTypeGroup
            title="Командные типы"
            rows={TEAM_STATS.map(([code, label]) => ({
              code,
              label,
              value: template.teamStatTypes[code],
              onChange: (value: string) => update((next) => { next.teamStatTypes[code] = value; }),
            }))}
          />
          <StatTypeGroup
            title="Игровые типы"
            rows={PLAYER_STATS.map(([code, label]) => ({
              code,
              label,
              value: template.playerStatTypes[code],
              onChange: (value: string) => update((next) => { next.playerStatTypes[code] = value; }),
            }))}
          />
        </div>
      </section>}

      <section>
        <h4 className="text-sm font-black text-slate-950">Статистика команд — отдельные привязки</h4>
        <p className="mt-1 text-xs text-slate-500">
          Для хозяев и гостей сохраняются разные Admin target record ID, даже когда semantic type одинаковый.
        </p>
        <div className="mt-3 grid gap-4 xl:grid-cols-2">
          {(["home", "away"] as const).map((side) => (
            <div key={side} data-testid={`khl-team-targets-${side}`} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-black uppercase tracking-wide text-violet-700">
                {side === "home" ? "Хозяева" : "Гости"}
              </div>
              <div className="mt-1 font-black text-slate-950">{labels[`${side}Team`]}</div>
              <div className="mt-3 space-y-3">
                {TEAM_STATS.map(([code, label]) => {
                  const metric = protocol?.teams[side].metrics.find((item) => item.code === code);
                  return (
                    <label key={code} className="block">
                      <span className="flex items-center justify-between gap-2 text-xs font-bold text-slate-700">
                        <span>{label}</span>
                        <span className="text-[10px] text-blue-700">P1–P3: {metric?.regulationTotal ?? "—"}</span>
                      </span>
                      <input
                        value={template.teams[side].stats[code].adminMatchStatId}
                        onChange={(event) => update((next) => {
                          next.teams[side].stats[code].adminMatchStatId = event.target.value;
                        })}
                        placeholder={`Admin target ID · ${label}`}
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h4 className="text-sm font-black text-slate-950">Игроки — Admin ID, ФИО и статистика</h4>
        <p className="mt-1 text-xs text-slate-500">
          Поиск по фамилии/имени использует локальный справочник «команды/спортсмены». Выбор подсказки только заполняет ID; подтверждение всегда ручное.
        </p>
        <div className="mt-3 grid gap-4 xl:grid-cols-2">
          {(["home", "away"] as const).map((side) => {
            const players = template.players.filter((player) => (
              protocolPlayers.get(player.khlPlayerId)?.teamSide === side
              || (!protocolPlayers.has(player.khlPlayerId) && side === "home")
            ));
            return (
              <details key={side} open className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <summary className="cursor-pointer text-sm font-black text-slate-950">
                  {side === "home" ? "Хозяева" : "Гости"} · {labels[`${side}Team`]} · {players.length}
                </summary>
                <div className="mt-3 space-y-3">
                  {players.map((player) => {
                    const details = protocolPlayers.get(player.khlPlayerId);
                    const statuses = labels.playerBindings?.[player.khlPlayerId];
                    const playerConfirmed = statuses?.player === "CONFIRMED";
                    const matchPlayerConfirmed = statuses?.matchPlayer === "CONFIRMED";
                    const saveKey = `player:${template.khlGameId}:${player.khlPlayerId}`;
                    const canSave = Boolean(player.adminPlayerId.trim()) && (
                      !playerConfirmed
                      || (Boolean(player.adminMatchPlayerId.trim()) && !matchPlayerConfirmed)
                    );
                    return (
                      <details key={player.khlPlayerId} data-testid="khl-player-binding" className="rounded-xl border border-slate-200 bg-white p-3">
                        <summary className="cursor-pointer list-none">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="font-black text-slate-900">
                                №{details?.shirtNumber ?? "—"} · {details?.name || labels.players[player.khlPlayerId] || `KHL ${player.khlPlayerId}`}
                              </div>
                              <div className="text-[10px] text-slate-500">KHL {player.khlPlayerId} · {details?.role || "роль не указана"}</div>
                            </div>
                            <div className="text-right text-[10px] font-black text-blue-800">
                              P1–P3: {details?.regulation.goals ?? 0} Г · {details?.regulation.assists ?? 0} П · {details?.regulation.points ?? 0} О
                            </div>
                          </div>
                        </summary>
                        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                          <KhlAdminDirectoryPicker
                            defaultQuery={details?.name || labels.players[player.khlPlayerId] || ""}
                            disabled={playerConfirmed}
                            placeholder="Фамилия, имя или точный Admin ID"
                            onSelect={(suggestion) => update((next) => {
                              const target = next.players.find((item) => item.khlPlayerId === player.khlPlayerId)!;
                              target.adminPlayerId = suggestion.platformId;
                            })}
                          />
                          <div className="grid gap-2 sm:grid-cols-2">
                            <label className="text-[11px] font-bold text-slate-600">
                              Admin player ID {playerConfirmed && <span className="text-emerald-700">· сохранён постоянно</span>}
                              <input
                                value={player.adminPlayerId}
                                disabled={playerConfirmed}
                                onChange={(event) => update((next) => {
                                  const target = next.players.find((item) => item.khlPlayerId === player.khlPlayerId)!;
                                  target.adminPlayerId = event.target.value;
                                })}
                                placeholder="Admin player ID"
                                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs disabled:bg-emerald-50"
                              />
                            </label>
                            <label className="text-[11px] font-bold text-slate-600">
                              Admin match-player ID {matchPlayerConfirmed && <span className="text-emerald-700">· сохранён для матча</span>}
                              <input
                                value={player.adminMatchPlayerId}
                                disabled={matchPlayerConfirmed}
                                onChange={(event) => update((next) => {
                                  const target = next.players.find((item) => item.khlPlayerId === player.khlPlayerId)!;
                                  target.adminMatchPlayerId = event.target.value;
                                })}
                                placeholder="Admin match-player ID"
                                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs disabled:bg-emerald-50"
                              />
                            </label>
                          </div>
                          <button
                            type="button"
                            onClick={() => onConfirmPlayer(player)}
                            disabled={!canSave || busyKey === saveKey}
                            className="rounded-xl bg-emerald-700 px-4 py-2 text-xs font-black text-white disabled:bg-slate-200 disabled:text-slate-500"
                          >
                            {busyKey === saveKey ? "Сохранение…" : canSave ? "Подтвердить игрока" : "Игрок сохранён"}
                          </button>
                          <div className="grid gap-2 sm:grid-cols-3">
                            {PLAYER_STATS.map(([code, label]) => (
                              <label key={code} className="text-[11px] font-bold text-slate-600">
                                Target · {label}
                                <input
                                  value={player.stats[code]}
                                  onChange={(event) => update((next) => {
                                    const target = next.players.find((item) => item.khlPlayerId === player.khlPlayerId)!;
                                    target.stats[code] = event.target.value;
                                  })}
                                  placeholder={`Admin ${code} record ID`}
                                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                                />
                              </label>
                            ))}
                          </div>
                        </div>
                      </details>
                    );
                  })}
                </div>
              </details>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function StatTypeGroup({ title, rows }: {
  title: string;
  rows: Array<{ code: string; label: string; value: string; onChange: (value: string) => void }>;
}) {
  return (
    <div className="rounded-xl border border-white bg-white p-3">
      <div className="text-xs font-black text-slate-800">{title}</div>
      <div className="mt-2 space-y-2">
        {rows.map((row) => (
          <label key={row.code} className="grid gap-1 text-[11px] font-bold text-slate-600 sm:grid-cols-[1fr_1.4fr] sm:items-center">
            <span>{row.label} <span className="font-mono text-[9px] text-slate-400">{row.code}</span></span>
            <input value={row.value} onChange={(event) => row.onChange(event.target.value)} placeholder="Admin stat type ID" className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
          </label>
        ))}
      </div>
    </div>
  );
}

export function KhlAdminDirectoryPicker({
  defaultQuery,
  disabled = false,
  placeholder,
  onSelect,
}: {
  defaultQuery: string;
  disabled?: boolean;
  placeholder: string;
  onSelect: (suggestion: DirectorySuggestion) => void;
}) {
  const [query, setQuery] = useState(defaultQuery);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<DirectorySuggestion[]>([]);
  const [error, setError] = useState("");
  const listId = useId();
  const canSearch = /^\d+$/.test(query.trim()) || query.trim().length >= 2;

  useEffect(() => {
    if (disabled || !open || !canSearch) {
      setItems([]);
      setLoading(false);
      setError("");
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ q: query, limit: "8" });
        const response = await fetch(`/api/results/khl/admin-directory/suggest?${params}`, {
          credentials: "same-origin",
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Не удалось загрузить подсказки");
        setItems(Array.isArray(data.items) ? data.items : []);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setItems([]);
        setError(cause instanceof Error ? cause.message : "Не удалось загрузить подсказки");
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [canSearch, disabled, open, query]);

  return (
    <div className="relative">
      <label className="text-[11px] font-bold text-slate-600">Поиск в локальном справочнике Admin</label>
      <input
        value={query}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs disabled:bg-slate-100"
      />
      {open && !disabled && canSearch && (
        <div id={listId} role="listbox" className="absolute z-50 mt-1 max-h-72 w-full min-w-[20rem] overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
          {loading ? (
            <div className="px-3 py-2 text-xs font-bold text-slate-400">Ищу по ID и имени…</div>
          ) : error ? (
            <div className="px-3 py-2 text-xs font-bold text-red-700">{error}</div>
          ) : items.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-500">Совпадений нет. Можно ввести точный Admin ID вручную или импортировать справочник спортсменов в Настройках.</div>
          ) : items.map((item) => (
            <button
              key={item.platformId}
              type="button"
              role="option"
              aria-selected={false}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onSelect(item);
                setQuery(item.platformName);
                setOpen(false);
              }}
              className="flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs hover:bg-indigo-50"
            >
              <span>
                <span className="block font-black text-slate-900">{item.platformName}</span>
                <span className="block text-[10px] text-slate-500">ID {item.platformId} · справочник {item.scopes.join(", ")}</span>
              </span>
              <span className="shrink-0 text-[10px] font-black text-indigo-700">{Math.round(item.score * 100)}%</span>
            </button>
          ))}
          {items.length > 0 && <div className="border-t border-slate-100 px-3 py-2 text-[10px] font-bold text-amber-700">Подсказка не подтверждает привязку автоматически.</div>}
        </div>
      )}
    </div>
  );
}
