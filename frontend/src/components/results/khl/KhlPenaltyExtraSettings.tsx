"use client";

import { useCallback, useEffect, useState } from "react";
import {
  KHL_PENALTY_EXTRA_DEFINITIONS,
  type KhlPenaltyExtraCode,
} from "@backend/results/khl/penaltyExtras";

type Binding = {
  extraCode: KhlPenaltyExtraCode;
  adminExtraId: string | null;
  adminBindingStatus: "UNMAPPED" | "CONFIRMED";
};

const ENDPOINT = "/api/results/khl/bindings/penalty-extra";

export function KhlPenaltyExtraSettings() {
  const [bindings, setBindings] = useState<Binding[] | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<KhlPenaltyExtraCode, string>>>({});
  const [loading, setLoading] = useState(true);
  const [busyCode, setBusyCode] = useState<KhlPenaltyExtraCode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadBindings = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const body = await requestJson({ signal });
      const loaded = parseBindings(body.bindings);
      if (!signal?.aborted) setBindings(loaded);
    } catch (failure) {
      if (!signal?.aborted) setError(messageOf(failure));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadBindings(controller.signal);
    return () => controller.abort();
  }, [loadBindings]);

  async function saveBinding(extraCode: KhlPenaltyExtraCode) {
    if (busyCode || !bindings) return;
    const adminExtraId = (drafts[extraCode] ?? "").trim();
    if (!adminExtraId) return;
    setBusyCode(extraCode);
    setError(null);
    try {
      const body = await requestJson({ method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ extraCode, adminExtraId }) });
      if (body.ok !== true || !isRecord(body.binding) || body.binding.extraCode !== extraCode
        || body.binding.adminExtraId !== adminExtraId || body.binding.adminBindingStatus !== "CONFIRMED") {
        throw new Error("Сервер не подтвердил сохранение ID. Повторно откройте настройки для проверки.");
      }
      setBindings((current) => current?.map((binding) => binding.extraCode === extraCode
        ? { ...binding, adminExtraId, adminBindingStatus: "CONFIRMED" } : binding) ?? null);
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusyCode(null);
    }
  }

  const confirmedCount = bindings?.filter((binding) => binding.adminBindingStatus === "CONFIRMED").length ?? 0;

  return (
    <section data-testid="khl-penalty-extra-settings" aria-busy={loading}
      className="rounded-3xl border border-slate-200 bg-slate-50/60 p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-black text-slate-950">Допы штрафного времени</h3>
        {bindings && <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-black text-indigo-800">
          Привязано: {confirmedCount} из {KHL_PENALTY_EXTRA_DEFINITIONS.length}
        </span>}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        У каждого из семи допов свой постоянный Admin ID. Привязка действует для всех матчей КХЛ.
        После подтверждения ID доступен только для чтения.
      </p>
      <p className="mt-2 text-xs leading-relaxed text-slate-500">
        Расчёт за основное время: 60 минут, без овертайма. С 1 по 5 минуту — 00:00–04:59.
        Первый двухминутный штраф — ровно 2 минуты, без двойного малого (4 минуты).
      </p>
      {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {loading && <p role="status" className="mt-4 text-sm text-slate-500">Загрузка постоянных ID…</p>}
      {!loading && !bindings && (
        <button type="button" onClick={() => void loadBindings()}
          className="mt-3 rounded-xl border border-indigo-200 bg-white px-3 py-2 text-xs font-black text-indigo-800">
          Повторить загрузку
        </button>
      )}
      {bindings && (
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {KHL_PENALTY_EXTRA_DEFINITIONS.map((definition) => {
            const binding = bindings.find((item) => item.extraCode === definition.code)!;
            const confirmed = binding.adminBindingStatus === "CONFIRMED";
            const value = confirmed ? binding.adminExtraId ?? "" : drafts[definition.code] ?? binding.adminExtraId ?? "";
            const inputId = `khl-penalty-id-${definition.code}`;
            return (
              <div key={definition.code} data-testid={`khl-penalty-binding-${definition.code}`}
                className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
                <label htmlFor={inputId} className="text-xs font-black text-slate-900">{definition.label}</label>
                <p className={`mt-1 text-[11px] ${confirmed ? "font-bold text-emerald-700" : "text-slate-500"}`}>
                  {confirmed ? "Постоянная привязка сохранена" : "Укажите отдельный Admin ID этого допа"}
                </p>
                <div className="mt-3 flex flex-wrap gap-2 sm:flex-nowrap">
                  <input id={inputId} value={value} readOnly={confirmed} disabled={loading || busyCode !== null}
                    onChange={(event) => setDrafts((current) => ({ ...current, [definition.code]: event.target.value }))}
                    maxLength={128} autoComplete="off" spellCheck={false} placeholder="Admin ID допа"
                    className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs read-only:bg-emerald-50 disabled:bg-slate-100 disabled:text-slate-700" />
                  <button type="button" onClick={() => void saveBinding(definition.code)}
                    disabled={confirmed || loading || !value.trim() || busyCode !== null}
                    className="rounded-xl bg-indigo-700 px-3 py-2 text-xs font-black text-white disabled:opacity-40">
                    {confirmed ? "Сохранено" : busyCode === definition.code ? "Сохранение…" : "Подтвердить"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function parseBindings(value: unknown): Binding[] {
  if (!Array.isArray(value) || value.length !== KHL_PENALTY_EXTRA_DEFINITIONS.length) {
    throw new Error("Сервер вернул неполный список допов штрафного времени.");
  }
  return KHL_PENALTY_EXTRA_DEFINITIONS.map(({ code }) => {
    const candidates = value.filter((item) => isRecord(item) && item.extraCode === code);
    const binding: unknown = candidates[0];
    if (candidates.length !== 1 || !isRecord(binding)
      || !["UNMAPPED", "CONFIRMED"].includes(String(binding.adminBindingStatus))
      || !(binding.adminExtraId === null || typeof binding.adminExtraId === "string")
      || (binding.adminBindingStatus === "CONFIRMED" && !binding.adminExtraId?.trim())) {
      throw new Error("Сервер вернул некорректные привязки допов штрафного времени.");
    }
    return { extraCode: code, adminExtraId: binding.adminExtraId,
      adminBindingStatus: binding.adminBindingStatus as Binding["adminBindingStatus"] };
  });
}

async function requestJson(init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(ENDPOINT, { cache: "no-store", ...init });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isRecord(body) ? body.error : null;
    const message = typeof error === "string" ? error : isRecord(error) && typeof error.message === "string" ? error.message : null;
    throw new Error(message || `Не удалось выполнить запрос: HTTP ${response.status}.`);
  }
  if (!isRecord(body)) throw new Error("Сервер вернул некорректный ответ.");
  return body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function messageOf(value: unknown) {
  return value instanceof Error ? value.message : "Не удалось выполнить запрос. Попробуйте ещё раз.";
}
