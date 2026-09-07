import type { TeamMappingRecord } from "./types";

export function NameSourceIcon({ entry }: { entry: Partial<TeamMappingRecord> & { saved?: boolean } }) {
  if (!entry.platformId) return null;
  if (entry.nameSource !== "admin" && entry.nameSource !== "manual") return null;

  const label = entry.nameSource === "admin" ? "Имя из админа" : "Ручной ввод";
  const className =
    entry.nameSource === "admin"
      ? "border-emerald-200 bg-emerald-50 text-emerald-600"
      : "border-amber-300 bg-amber-50 text-amber-700";

  return (
    <span
      title={label}
      aria-label={label}
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${className}`}
    >
      <span className="h-2 w-2 rounded-full bg-current" />
    </span>
  );
}
