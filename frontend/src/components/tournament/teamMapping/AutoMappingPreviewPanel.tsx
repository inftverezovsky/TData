import type { AutoMappingPreview, AutoMappingPreviewItem } from "./types";
import { getPreviewSelectionKey, formatScore, formatPreviewReason } from "./model";

export function AutoMappingPreviewPanel({
  preview,
  selected,
  onToggle,
  onApply,
  onReplaceConflicts,
  applying,
}: {
  preview: AutoMappingPreview;
  selected: Set<string>;
  onToggle: (key: string) => void;
  onApply: () => void;
  onReplaceConflicts: () => void;
  applying: boolean;
}) {
  const selectable = [...preview.auto, ...preview.suggested].filter((item) => item.platformId);

  return (
    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h4 className="text-sm font-black text-slate-900">Предпросмотр авто-маппинга</h4>
          <p className="mt-1 text-xs font-bold text-slate-500">
            Безопасные {preview.auto.length} · Предложения {preview.suggested.length} · Спорные {preview.ambiguous.length} · Без ID {preview.unmapped.length} · Пропущено {preview.invalid.length}
          </p>
        </div>
        <button
          onClick={onApply}
          disabled={applying || selected.size === 0}
          className="rounded-xl bg-indigo-600 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:bg-slate-200 disabled:text-slate-400"
        >
          {applying ? "Применение..." : `Применить выбранные (${selected.size})`}
        </button>
        {preview.conflicts.length > 0 && (
          <button
            onClick={onReplaceConflicts}
            disabled={applying}
            className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-amber-700 disabled:bg-slate-100 disabled:text-slate-400"
          >
            Заменить конфликты ({preview.conflicts.length})
          </button>
        )}
      </div>

      {selectable.length > 0 && (
        <div className="mt-4 grid gap-2">
          {selectable.map((item) => {
            const key = getPreviewSelectionKey(item);
            return (
              <label key={key} className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-white bg-white/80 px-3 py-2 text-xs">
                <span className="min-w-0 font-bold text-slate-800">
                  {item.liquipediaName} → <span className="text-indigo-700">{item.adminName}</span>
                  <span className="ml-2 text-[10px] font-black text-slate-400">ID {item.platformId} · {formatScore(item.score)}%</span>
                </span>
                <input
                  type="checkbox"
                  checked={selected.has(key)}
                  onChange={() => onToggle(key)}
                  className="h-4 w-4"
                />
              </label>
            );
          })}
        </div>
      )}

      {(preview.ambiguous.length > 0 || preview.conflicts.length > 0 || preview.unmapped.length > 0 || preview.invalid.length > 0) && (
        <div className="mt-4 grid gap-3 text-[11px] font-bold text-slate-600 md:grid-cols-2">
          <PreviewList title="Спорные" items={preview.ambiguous} />
          <PreviewList title="Конфликты" items={preview.conflicts} />
          <PreviewList title="Без ID" items={preview.unmapped} />
          <PreviewList title="Пропущено" items={preview.invalid} />
        </div>
      )}
    </div>
  );
}

function PreviewList({ title, items }: { title: string; items: AutoMappingPreviewItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border border-white bg-white/70 p-3">
      <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">{title}: {items.length}</div>
      <div className="space-y-1">
        {items.slice(0, 8).map((item) => (
          <div key={`${title}-${item.liquipediaName}-${item.platformId || item.reason}`}>
            {item.liquipediaName}
            {item.adminName ? ` → ${item.adminName} (${formatScore(item.score)}%)` : ""}
            {item.reason ? ` · ${formatPreviewReason(item.reason)}` : ""}
          </div>
        ))}
        {items.length > 8 && <div>И ещё: {items.length - 8}</div>}
      </div>
    </div>
  );
}
