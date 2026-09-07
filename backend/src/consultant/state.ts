import fs from "node:fs";
import path from "node:path";

import {
  emptyDailyUsage,
  normalizeDailyUsage,
  type ConsultantDailyUsage,
} from "./budget";

export interface ConsultantState {
  readonly schemaVersion: 1;
  readonly nextUpdateId: number | null;
  readonly usage: ConsultantDailyUsage;
  readonly lastPollAt: string | null;
}

export function readConsultantState(directory: string, now = new Date()): ConsultantState {
  const statePath = path.join(path.resolve(directory), "state.json");
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (!parsed || typeof parsed !== "object") return emptyState(now);
    const value = parsed as Partial<ConsultantState>;
    return {
      schemaVersion: 1,
      nextUpdateId: Number.isSafeInteger(value.nextUpdateId) && Number(value.nextUpdateId) >= 0
        ? Number(value.nextUpdateId)
        : null,
      usage: normalizeDailyUsage(value.usage, now),
      lastPollAt: typeof value.lastPollAt === "string" ? value.lastPollAt : null,
    };
  } catch {
    return emptyState(now);
  }
}

export function persistConsultantState(directory: string, state: ConsultantState) {
  const resolved = path.resolve(directory);
  fs.mkdirSync(resolved, { recursive: true });
  const target = path.join(resolved, "state.json");
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, target);
}

export function emptyState(now = new Date()): ConsultantState {
  return {
    schemaVersion: 1,
    nextUpdateId: null,
    usage: emptyDailyUsage(now),
    lastPollAt: null,
  };
}
