"use client";

import { useState } from "react";

export function SyncMatchesButton({ 
  selectedIds, 
  disciplineSlug,
  onSuccess 
}: { 
  selectedIds: string[]; 
  disciplineSlug: string;
  onSuccess?: () => void;
}) {
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSync = async () => {
    if (selectedIds.length === 0) return;
    setSyncing(true);
    setError(null);

    try {
      const res = await fetch("/api/sync-matches", {
        method: "POST",
        body: JSON.stringify({ matchIds: selectedIds, disciplineSlug }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка синхронизации");

      alert(`Успешно отправлено матчей: ${data.count}`);
      onSuccess?.();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        onClick={handleSync}
        disabled={syncing || selectedIds.length === 0}
        className={`flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-bold shadow-lg transition-all ${
          syncing || selectedIds.length === 0
            ? "bg-slate-100 text-slate-400 cursor-not-allowed"
            : "bg-blue-600 text-white hover:bg-blue-700 active:scale-95"
        }`}
      >
        {syncing ? (
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
        ) : (
          <span>🚀 Залить в платформу ({selectedIds.length})</span>
        )}
      </button>
      {error && <span className="text-[10px] font-bold text-red-500 uppercase">{error}</span>}
    </div>
  );
}
