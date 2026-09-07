import { Images, X } from "lucide-react";
import { MANUAL_IMPORT_MAX_IMAGES } from "@backend/manualImport/imageBatch";
import { getImageStatusClass, getImageStatusLabel } from "./recognitionModel";
import type { ManualImportImageItem } from "./types";

type Props = {
  imageItems: ManualImportImageItem[];
  parsing: boolean;
  onClear: () => void;
  onRemove: (id: string) => void;
};

/** Показывает очередь и статусы. Создание и освобождение preview URL выполняет координатор. */
export function ManualImportImageQueue({ imageItems, parsing, onClear, onRemove }: Props) {
  if (imageItems.length === 0) return null;
  return (
    <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-indigo-600 shadow-sm">
            <Images className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-black text-slate-950">Очередь скринов</h3>
            <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
              {imageItems.length}/{MANUAL_IMPORT_MAX_IMAGES} · вставляйте через Ctrl+V
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClear}
          disabled={parsing}
          className="h-9 rounded-xl border border-slate-200 bg-white px-4 text-[10px] font-black uppercase tracking-widest text-slate-500 transition hover:bg-slate-100 disabled:opacity-50"
        >
          Очистить все
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {imageItems.map((item, index) => (
          <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div
              className="relative h-28 overflow-hidden rounded-xl border border-slate-100 bg-slate-100 bg-cover bg-center"
              style={{ backgroundImage: `url(${item.previewUrl})` }}
              aria-label={item.name}
            >
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                disabled={parsing}
                aria-label={`Удалить скрин ${item.name}`}
                className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-slate-500 shadow-sm transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-xs font-black text-slate-950">
                  {index + 1}. {item.name}
                </p>
                <p className="mt-1 text-[10px] font-bold text-slate-400">
                  {item.rawMatches?.length ? `Матчей: ${item.rawMatches.length}` : item.error || "Ожидает распознавания"}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-widest ${getImageStatusClass(
                  item.status
                )}`}
              >
                {getImageStatusLabel(item.status)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
