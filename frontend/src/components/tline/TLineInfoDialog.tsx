"use client";

import { useEffect, useRef, useState } from "react";
import { CircleHelp, X } from "lucide-react";

import { TLINE_HELP_TABS, type TLineHelpTab } from "./navigation";

export function TLineInfoDialog() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TLineHelpTab>("how");

  return (
    <>
      <button
        type="button"
        aria-label="Инфо"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-30 inline-flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-xl shadow-blue-200 transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200"
      >
        <CircleHelp aria-hidden="true" className="h-7 w-7" />
      </button>
      {open && <InfoModal tab={tab} onTabChange={setTab} onClose={() => setOpen(false)} />}
    </>
  );
}

function InfoModal({
  tab,
  onTabChange,
  onClose,
}: {
  tab: TLineHelpTab;
  onTabChange: (tab: TLineHelpTab) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      returnFocus?.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="tline-help-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="m-auto w-[min(680px,calc(100vw-2rem))] rounded-3xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/40"
    >
      <div className="p-6 md:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">TLine</p>
            <h2 id="tline-help-title" className="mt-1 text-2xl font-black">Справка TLine</h2>
          </div>
          <button
            type="button"
            aria-label="Закрыть справку"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>

        <div role="tablist" aria-label="Разделы справки" className="mt-6 flex gap-1 rounded-xl bg-slate-100 p-1">
          {TLINE_HELP_TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => onTabChange(item.id)}
              className={`rounded-lg px-4 py-2 text-sm font-bold ${tab === item.id ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-950"}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="mt-6 text-sm leading-6 text-slate-700">
          {tab === "how" ? (
            <div role="tabpanel" className="space-y-3">
              <p>TLine загружает свежий календарь официального источника и read-only линию Админа, сопоставляет команды и матчи, затем показывает расхождения.</p>
              <ol className="list-decimal space-y-2 pl-5">
                <li>Выберите вид спорта и период.</li>
                <li>Запустите ручную проверку или дождитесь автопроверки.</li>
                <li>Откройте чемпионат, чтобы увидеть обе стороны и причину статуса.</li>
              </ol>
              <p>Ручное решение не изменяет автоматический результат и всегда остаётся в истории.</p>
            </div>
          ) : (
            <div role="tabpanel" className="space-y-3">
              <StatusHelp badge="ok" text="Официальный источник и Admin совпали." tone="emerald" />
              <StatusHelp badge="ok*" text="Совпало с обратным порядком команд." tone="emerald" />
              <StatusHelp badge="okᵐ" text="Результат подтверждён вручную." tone="emerald" />
              <StatusHelp badge="—" text="Есть предупреждение, ошибка, неоднозначность или отсутствующая сторона. Причина доступна в строке матча." tone="red" />
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}

function StatusHelp({ badge, text, tone }: { badge: string; text: string; tone: "emerald" | "red" }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
      <span className={`inline-flex min-w-12 justify-center rounded-lg px-2 py-1 font-black ${tone === "emerald" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>{badge}</span>
      <span>{text}</span>
    </div>
  );
}
