'use client';

import { useEffect } from 'react';
import { RotateCcw, AlertTriangle } from 'lucide-react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center animate-in">
      <div className="h-20 w-20 rounded-3xl bg-rose-50 flex items-center justify-center text-rose-500 mb-8 border border-rose-100 shadow-xl shadow-rose-500/5">
        <AlertTriangle className="h-10 w-10" />
      </div>
      
      <h2 className="text-3xl font-black text-slate-950 tracking-tight mb-4">
        Упс! <span className="text-rose-500">Ошибка базы данных.</span>
      </h2>
      
      <p className="text-slate-500 font-medium max-w-md leading-relaxed mb-10">
        Не удалось подключиться к серверу базы данных. Обычно это происходит при пробуждении сервера Neon или проблемах с интернетом.
      </p>

      <div className="flex flex-col sm:flex-row gap-4">
        <button
          onClick={() => reset()}
          className="flex items-center gap-3 px-8 py-4 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800 transition-all shadow-xl shadow-slate-900/10"
        >
          <RotateCcw className="h-5 w-5" />
          ПОПРОБОВАТЬ СНОВА
        </button>
        <button
          onClick={() => window.location.href = '/'}
          className="px-8 py-4 bg-white border border-slate-200 text-slate-600 rounded-2xl font-bold hover:bg-slate-50 transition-all"
        >
          НА ГЛАВНУЮ
        </button>
      </div>

      <div className="mt-12 p-4 bg-slate-50 rounded-xl border border-slate-100 max-w-xl overflow-hidden">
        <p className="text-[10px] font-mono text-slate-400 break-all">
          {error.message || "Unknown Error"}
        </p>
      </div>
    </div>
  );
}
