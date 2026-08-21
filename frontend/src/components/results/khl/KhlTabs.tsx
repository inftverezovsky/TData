"use client";

type TabItem<T extends string> = {
  id: T;
  label: string;
  count?: number;
};

export function KhlTabs<T extends string>({
  items,
  value,
  onChange,
  label,
  compact = false,
}: {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  compact?: boolean;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={`flex max-w-full gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-slate-50 p-1 ${compact ? "w-fit" : "w-full"}`}
    >
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected}
            data-testid={`khl-tab-${item.id}`}
            onClick={() => onChange(item.id)}
            className={`shrink-0 rounded-xl px-4 py-2 text-xs font-black transition-colors ${selected
              ? "bg-white text-blue-700 shadow-sm ring-1 ring-slate-200"
              : "text-slate-600 hover:bg-white/70 hover:text-slate-900"}`}
          >
            {item.label}
            {typeof item.count === "number" && (
              <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] ${selected
                ? "bg-blue-50 text-blue-700"
                : "bg-slate-200 text-slate-600"}`}>
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
