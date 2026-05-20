import type { ImportStatus } from "@prisma/client";

const labels: Record<string, string> = {
  PENDING: "pending",
  SUCCESS: "success",
  PARTIAL: "partial",
  FAILED: "failed",
  MANUAL_REVIEW: "manual review"
};

const styles: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-700 ring-amber-200",
  SUCCESS: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  PARTIAL: "bg-sky-50 text-sky-700 ring-sky-200",
  FAILED: "bg-red-50 text-red-700 ring-red-200",
  MANUAL_REVIEW: "bg-violet-50 text-violet-700 ring-violet-200"
};

export default function StatusBadge({ status }: { status?: ImportStatus | string | null }) {
  const key = status ?? "PARTIAL";
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${styles[key] ?? styles.PARTIAL}`}>
      {labels[key] ?? key.toLowerCase()}
    </span>
  );
}
