import type { TLineManualDecisionType } from "@prisma/client";

import { objectBody, optionalBoolean, optionalText, requiredText } from "./parsers";
import { TLineValidationError } from "./validation";

const allowedDecisions = new Set<TLineManualDecisionType>([
  "MANUAL_OK",
  "MANUAL_ERROR",
  "CONFIRM_CHAMPIONSHIP",
  "MANUAL_LINK",
  "IGNORE_UNTIL",
  "EXCLUDE",
  "RESET",
]);

export function parseManualDecisionInput(value: unknown) {
  const body = objectBody(value);
  const decisionType = requiredText(body, "decision", 64) as TLineManualDecisionType;
  if (!allowedDecisions.has(decisionType)) {
    throw new TLineValidationError("INVALID_DECISION", "Unsupported manual decision.");
  }
  const expiresAt = parseExpiry(body.expiresAt);
  const adminMatchId = optionalText(body, "adminMatchId", 128);
  if (decisionType === "IGNORE_UNTIL" && !expiresAt) {
    throw new TLineValidationError("EXPIRY_REQUIRED", "expiresAt is required for IGNORE_UNTIL.");
  }
  if (decisionType === "MANUAL_LINK" && !adminMatchId) {
    throw new TLineValidationError("ADMIN_MATCH_REQUIRED", "adminMatchId is required for MANUAL_LINK.");
  }
  return {
    decisionType,
    note: optionalText(body, "note", 2_000),
    persistent: optionalBoolean(body, "persistent") ?? false,
    expiresAt,
    ...(decisionType === "MANUAL_LINK" ? { adminMatchId } : {}),
  };
}

export function resetManualDecisionInput() {
  return { decisionType: "RESET" as const, note: null, persistent: false, expiresAt: null };
}

function parseExpiry(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw invalidExpiry();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date <= new Date()) throw invalidExpiry();
  return date;
}

function invalidExpiry() {
  return new TLineValidationError("INVALID_EXPIRY", "expiresAt must be a future ISO timestamp.");
}
