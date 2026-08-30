"use client";

import { useRef, useState } from "react";

export type TLineDecision = "MANUAL_OK" | "MANUAL_ERROR" | "MANUAL_LINK" | "IGNORE_UNTIL" | "EXCLUDE" | "RESET" | "CONFIRM_CHAMPIONSHIP";

export function TLineDecisionMenu({ label, description, toneClass, manual, disabled, onDecision }: {
  label: string;
  description: string;
  toneClass: string;
  manual: boolean;
  disabled: boolean;
  onDecision: (decision: TLineDecision, expiresAt?: string, adminMatchId?: string) => Promise<void>;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const [expiry, setExpiry] = useState(() => defaultExpiry());
  const [adminMatchId, setAdminMatchId] = useState("");
  const choose = async (decision: TLineDecision, expiresAt?: string, selectedAdminMatchId?: string) => {
    await onDecision(decision, expiresAt, selectedAdminMatchId);
    details.current?.removeAttribute("open");
  };
  return (
    <details ref={details} className="relative">
      <summary title={description} aria-label={`${label}: ${description}`} className={`inline-flex min-w-20 cursor-pointer list-none justify-center rounded-lg px-3 py-2 text-xs font-black ${toneClass}`}>{label}</summary>
      <div className="absolute left-1/2 top-full z-40 mt-2 w-72 -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-2 text-left shadow-xl">
        <DecisionButton disabled={disabled} onClick={() => choose("MANUAL_OK")}>Подтвердить OK вручную</DecisionButton>
        <DecisionButton disabled={disabled} onClick={() => choose("MANUAL_ERROR")}>Отметить ошибкой вручную</DecisionButton>
        <label className="block px-2 py-1 text-[11px] font-black text-slate-500">ID матча Admin<input value={adminMatchId} onChange={(event) => setAdminMatchId(event.target.value)} maxLength={128} placeholder="Например, 987654" className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-xs font-semibold text-slate-800" /></label>
        <DecisionButton disabled={disabled || !adminMatchId.trim()} onClick={() => choose("MANUAL_LINK", undefined, adminMatchId.trim())}>Считать события одним матчем</DecisionButton>
        <div className="my-1 border-t border-slate-100" />
        <label className="block px-2 py-1 text-[11px] font-black text-slate-500">Игнорировать до<input type="datetime-local" value={expiry} min={minimumExpiry()} onChange={(event) => setExpiry(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-xs font-semibold text-slate-800" /></label>
        <DecisionButton disabled={disabled || !expiry} onClick={() => choose("IGNORE_UNTIL", new Date(expiry).toISOString())}>Применить временное игнорирование</DecisionButton>
        <DecisionButton disabled={disabled} onClick={() => choose("EXCLUDE")}>Не сравнивать это событие</DecisionButton>
        {manual && <><div className="my-1 border-t border-slate-100" /><DecisionButton disabled={disabled} onClick={() => choose("RESET")}>Сбросить ручное решение</DecisionButton></>}
      </div>
    </details>
  );
}

export function TLineChampionshipDecisionMenu({ disabled, manual, onDecision }: {
  disabled: boolean;
  manual: boolean;
  onDecision: (decision: TLineDecision) => Promise<void>;
}) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-black text-slate-600">Решение</summary>
      <div className="absolute right-0 top-full z-40 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
        <DecisionButton disabled={disabled} onClick={() => onDecision("CONFIRM_CHAMPIONSHIP")}>Подтвердить чемпионат вручную</DecisionButton>
        <DecisionButton disabled={disabled} onClick={() => onDecision("MANUAL_ERROR")}>Отметить чемпионат ошибочным</DecisionButton>
        {manual && <DecisionButton disabled={disabled} onClick={() => onDecision("RESET")}>Сбросить ручное решение</DecisionButton>}
      </div>
    </details>
  );
}

function DecisionButton({ disabled, onClick, children }: { disabled: boolean; onClick: () => void | Promise<void>; children: React.ReactNode }) {
  return <button type="button" disabled={disabled} onClick={() => { void Promise.resolve(onClick()).catch(() => undefined); }} className="block w-full rounded-lg px-2 py-2 text-left text-xs font-bold text-slate-700 hover:bg-blue-50 disabled:opacity-50">{children}</button>;
}

function defaultExpiry() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function minimumExpiry() {
  const date = new Date(Date.now() + 60_000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
