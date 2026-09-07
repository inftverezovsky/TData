"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

type Props = { open: boolean; onAuthenticated: () => void; onCancel: () => void };

/** Пароль остаётся только в памяти формы. Нативный dialog управляет фокусом, Escape и возвратом к кнопке отправки. */
export function AdminLoginDialog({ open, onAuthenticated, onCancel }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const headingId = useId();
  const inputId = useId();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) dialog.current?.showModal();
    else {
      request.current?.abort();
      request.current = null;
      setBusy(false);
      setPassword("");
      setError(null);
      dialog.current?.close();
    }
    return () => { request.current?.abort(); };
  }, [open]);

  function cancel() {
    request.current?.abort();
    request.current = null;
    setPassword("");
    setError(null);
    onCancel();
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch("/api/admin-auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        throw new Error(response.status === 429
          ? `Слишком много попыток.${Number.isFinite(retryAfter) && retryAfter > 0 ? ` Повторите через ${retryAfter} сек.` : " Повторите позже."}`
          : response.status === 401 ? "Неверный пароль. Попробуйте ещё раз." : "Не удалось выполнить вход. Повторите попытку.");
      }
      if (controller.signal.aborted) return;
      setPassword("");
      onAuthenticated();
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "Не удалось выполнить вход.");
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <dialog ref={dialog} aria-labelledby={headingId} onCancel={(event) => { event.preventDefault(); cancel(); }} className="m-auto w-[calc(100%_-_2rem)] max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-xl backdrop:bg-slate-950/40">
      <form onSubmit={login} className="space-y-4">
        <h2 id={headingId} className="text-xl font-black">Вход для отправки</h2>
        <p className="text-sm text-slate-600">Подтвердите доступ администратора. После входа выбранные данные будут отправлены; правки в таблице сохранятся.</p>
        <label htmlFor={inputId} className="block text-sm font-bold">Пароль администратора</label>
        <input id={inputId} autoFocus type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3" />
        {error && <p role="alert" className="text-sm font-bold text-rose-700">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={cancel} disabled={busy} className="rounded-xl border border-slate-300 px-4 py-2">Отмена</button>
          <button type="submit" disabled={busy} className="rounded-xl bg-indigo-600 px-4 py-2 font-bold text-white disabled:opacity-50">{busy ? "Вход…" : "Войти и продолжить"}</button>
        </div>
      </form>
    </dialog>
  );
}
