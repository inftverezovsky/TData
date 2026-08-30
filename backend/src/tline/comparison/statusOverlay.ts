import type {
  TLineComparisonResult,
  TLineEffectiveStatus,
  TLineManualDecision,
} from "../domain/types";

export type TLineDisplayValue = "ok" | "ok*" | "okᵐ" | "—" | "loading";
export type TLineDisplayTone = "success" | "warning" | "error" | "critical" | "neutral";

export interface TLineResolvedStatus {
  readonly automaticStatus: TLineComparisonResult["automaticStatus"];
  readonly effectiveStatus: TLineEffectiveStatus;
  readonly display: TLineDisplayValue;
  readonly tone: TLineDisplayTone;
  readonly manual: boolean;
}

export function resolveEffectiveStatus(
  comparison: Pick<TLineComparisonResult, "automaticStatus" | "swappedSides">,
  options: { readonly decision?: TLineManualDecision | null; readonly now?: Date } = {},
): TLineResolvedStatus {
  const decision = options.decision ?? null;
  const now = options.now ?? new Date();

  if (decision?.kind === "MANUAL_OK") {
    return resolved(comparison.automaticStatus, "MANUAL_OK", "okᵐ", "success", true);
  }
  if (decision?.kind === "MANUAL_ERROR") {
    return resolved(comparison.automaticStatus, "MANUAL_ERROR", "—", "error", true);
  }
  if (decision?.kind === "EXCLUDE") {
    return resolved(comparison.automaticStatus, "IGNORED", "—", "neutral", true);
  }
  if (decision?.kind === "IGNORE_UNTIL" && new Date(decision.expiresAt).getTime() > now.getTime()) {
    return resolved(comparison.automaticStatus, "IGNORED", "—", "neutral", true);
  }

  if (comparison.automaticStatus === "AUTO_OK") {
    return resolved(
      comparison.automaticStatus,
      comparison.automaticStatus,
      comparison.swappedSides ? "ok*" : "ok",
      "success",
      false,
    );
  }
  if (comparison.automaticStatus === "PENDING" || comparison.automaticStatus === "PROCESSING") {
    return resolved(comparison.automaticStatus, comparison.automaticStatus, "loading", "neutral", false);
  }

  return resolved(
    comparison.automaticStatus,
    comparison.automaticStatus,
    "—",
    toneForAutomaticStatus(comparison.automaticStatus),
    false,
  );
}

function resolved(
  automaticStatus: TLineComparisonResult["automaticStatus"],
  effectiveStatus: TLineEffectiveStatus,
  display: TLineDisplayValue,
  tone: TLineDisplayTone,
  manual: boolean,
): TLineResolvedStatus {
  return { automaticStatus, effectiveStatus, display, tone, manual };
}

function toneForAutomaticStatus(status: TLineComparisonResult["automaticStatus"]): TLineDisplayTone {
  if (status === "TIME_WARNING" || status === "SOURCE_TIME_UNDEFINED") return "warning";
  if (status === "TIME_CRITICAL") return "critical";
  if (status === "CANCELLED") return "neutral";
  return "error";
}
