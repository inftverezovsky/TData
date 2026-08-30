import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaClient } from "@prisma/client";

import {
  assertTLineSchedulerReady,
  getTLineScheduleView,
  stopTLineSchedule,
  updateTLineSchedule,
} from "../backend/src/tline/application/scheduleState";
import {
  applyComparisonDecision,
  applyRunChampionshipDecision,
} from "../backend/src/tline/application/manualDecisions";
import { projectTLineManualOverlay } from "../backend/src/tline/application/runViews";

test("schedule state reads defaults and persists disabled settings", async () => {
  let state: Record<string, unknown> | null = null;
  const client = {
    tLineScheduleState: {
      findUnique: async () => state,
      upsert: async ({ update, create }: { update: object; create: object }) => {
        state = { ...(state ?? create), ...update, timezone: "Europe/Moscow", slotHours: [8, 12] };
        return state;
      },
    },
  } as unknown as PrismaClient;

  assert.deepEqual(await getTLineScheduleView(client), {
    enabled: false,
    timezone: "Europe/Moscow",
    slots: ["08:00", "12:00", "16:00", "22:00"],
    nextRunAt: null,
  });
  assert.deepEqual(await updateTLineSchedule(client, { enabled: false, slotHours: [8, 12] }), {
    enabled: false,
    timezone: "Europe/Moscow",
    slots: ["08:00", "12:00"],
    nextRunAt: null,
  });
});

test("scheduler readiness requires explicit rollout flags and complete sport settings", async () => {
  const previousEnabled = process.env.TLINE_ENABLED;
  const previousReady = process.env.TLINE_SCHEDULER_READY;
  const client = {
    tLineSportConfig: {
      findMany: async () => [{
        adminSportId: "73",
        autoPeriodFromOffsetMinutes: -60,
        autoPeriodToOffsetMinutes: 1_440,
        candidateMatchWindowMinutes: 180,
        defaultAllowedTimeDriftMinutes: 2,
        championships: [{
          adminChampionshipId: "admin-champ",
          globalHeader: { adminShapkaId: "833524" },
          allowedTimeDriftMinutes: null,
          candidateMatchWindowMinutes: null,
        }],
      }],
    },
  } as unknown as PrismaClient;
  try {
    process.env.TLINE_ENABLED = "0";
    process.env.TLINE_SCHEDULER_READY = "0";
    await assert.rejects(assertTLineSchedulerReady(client), /readiness/i);
    process.env.TLINE_ENABLED = "1";
    process.env.TLINE_SCHEDULER_READY = "1";
    await assert.doesNotReject(assertTLineSchedulerReady(client));
  } finally {
    restoreEnv("TLINE_ENABLED", previousEnabled);
    restoreEnv("TLINE_SCHEDULER_READY", previousReady);
  }
});

test("scheduler readiness rejects a championship without the full Admin hierarchy", { concurrency: false }, async () => {
  const previousEnabled = process.env.TLINE_ENABLED;
  const previousReady = process.env.TLINE_SCHEDULER_READY;
  const client = {
    tLineSportConfig: {
      findMany: async () => [{
        adminSportId: "73",
        autoPeriodFromOffsetMinutes: -60,
        autoPeriodToOffsetMinutes: 1_440,
        candidateMatchWindowMinutes: 180,
        defaultAllowedTimeDriftMinutes: 2,
        championships: [{
          adminChampionshipId: "admin-champ",
          globalHeader: null,
          allowedTimeDriftMinutes: null,
          candidateMatchWindowMinutes: null,
        }],
      }],
    },
  } as unknown as PrismaClient;
  try {
    process.env.TLINE_ENABLED = "1";
    process.env.TLINE_SCHEDULER_READY = "1";
    await assert.rejects(assertTLineSchedulerReady(client), /Admin Sport, Shapka and Championship IDs/i);
  } finally {
    restoreEnv("TLINE_ENABLED", previousEnabled);
    restoreEnv("TLINE_SCHEDULER_READY", previousReady);
  }
});

test("stopping schedule persists off state and requests cancellation of scheduled work", async () => {
  let transactionSize = 0;
  const client = {
    tLineScheduleState: {
      upsert: () => Promise.resolve({ enabled: false }),
      findUnique: () => Promise.resolve({ enabled: false, timezone: "Europe/Moscow", slotHours: [8, 12, 16, 22] }),
    },
    tLineRun: { updateMany: () => Promise.resolve({ count: 1 }) },
    tLineJob: { updateMany: () => Promise.resolve({ count: 1 }) },
    $transaction: async (operations: unknown[]) => {
      transactionSize = operations.length;
      return Promise.all(operations);
    },
  } as unknown as PrismaClient;

  const result = await stopTLineSchedule(client);
  assert.equal(transactionSize, 3);
  assert.equal(result.enabled, false);
});

test("manual decisions append audit rows and update only the overlay fields", async () => {
  const updates: Array<Record<string, unknown>> = [];
  const exceptionCreates: Array<Record<string, unknown>> = [];
  const persistentLinks: Array<Record<string, unknown>> = [];
  const transaction = {
    tLineComparison: {
      findUniqueOrThrow: async () => ({
        automaticStatus: "SOURCE_ONLY",
        severity: "ERROR",
        runChampionshipId: "run-championship",
        runChampionship: { championshipId: "championship-source" },
        sourceSnapshot: { sourceKey: "official-match-1" },
        adminSnapshot: null,
      }),
      update: async ({ data }: { data: Record<string, unknown> }) => { updates.push(data); return { id: "comparison", ...data }; },
    },
    tLineRunChampionship: {
      findUniqueOrThrow: async () => ({ automaticStatus: "TIME_WARNING", severity: "WARNING" }),
      update: async ({ data }: { data: Record<string, unknown> }) => { updates.push(data); return { id: "championship", ...data }; },
    },
    tLineManualDecision: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({ id: `decision-${updates.length}`, ...data }),
    },
    tLineException: {
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }: { data: Record<string, unknown> }) => { exceptionCreates.push(data); return data; },
    },
    tLineAdminMatchSnapshot: { findFirst: async () => ({ id: "admin-snapshot" }) },
    tLinePersistentMatchLink: {
      updateMany: async () => ({ count: 0 }),
      upsert: async ({ create }: { create: Record<string, unknown> }) => { persistentLinks.push(create); return create; },
    },
  };
  const client = {
    $transaction: async (callback: (tx: typeof transaction) => unknown) => callback(transaction),
  } as unknown as PrismaClient;

  await applyComparisonDecision(client, "comparison", {
    decisionType: "MANUAL_OK",
    note: "checked",
    persistent: false,
    expiresAt: null,
  });
  await applyComparisonDecision(client, "comparison", {
    decisionType: "RESET",
    note: null,
    persistent: false,
    expiresAt: null,
  });
  await applyRunChampionshipDecision(client, "championship", {
    decisionType: "MANUAL_ERROR",
    note: null,
    persistent: false,
    expiresAt: null,
  });
  await applyComparisonDecision(client, "comparison", {
    decisionType: "IGNORE_UNTIL",
    note: "temporarily accepted",
    persistent: true,
    expiresAt: new Date("2027-01-01T00:00:00Z"),
  });
  await applyComparisonDecision(client, "comparison", {
    decisionType: "MANUAL_LINK",
    note: null,
    persistent: true,
    expiresAt: null,
    adminMatchId: "admin-match-42",
  });

  assert.deepEqual(updates, [
    { manualStatus: "MANUAL_OK", effectiveStatus: "MANUAL_OK", effectiveSeverity: "OK" },
    { manualStatus: null, effectiveStatus: "SOURCE_ONLY", effectiveSeverity: "ERROR" },
    { manualStatus: "MANUAL_ERROR", effectiveStatus: "MANUAL_ERROR", effectiveSeverity: "ERROR" },
    { manualStatus: "IGNORED", effectiveStatus: "IGNORED", effectiveSeverity: "UNPROCESSED" },
    { manualStatus: "SOURCE_ONLY", effectiveStatus: "SOURCE_ONLY", effectiveSeverity: "ERROR" },
  ]);
  assert.deepEqual(exceptionCreates, [{
    championshipId: "championship-source",
    type: "IGNORE_UNTIL",
    sourceMatchKey: "official-match-1",
    adminMatchId: null,
    reason: "temporarily accepted",
    expiresAt: new Date("2027-01-01T00:00:00Z"),
    active: true,
  }]);
  assert.deepEqual(persistentLinks, [{
    championshipId: "championship-source",
    sourceMatchKey: "official-match-1",
    adminMatchId: "admin-match-42",
    active: true,
  }]);
});

test("run projection removes reset and expired manual overlays without changing automatic facts", () => {
  const base = {
    automaticStatus: "TIME_ERROR",
    automaticSeverity: "ERROR",
    effectiveStatus: "IGNORED",
    effectiveSeverity: "UNPROCESSED",
    manualStatus: "IGNORED",
  };
  assert.deepEqual(projectTLineManualOverlay({ ...base, latestDecision: { decisionType: "RESET", expiresAt: null } }), {
    effectiveStatus: "TIME_ERROR",
    effectiveSeverity: "ERROR",
    manual: false,
  });
  assert.deepEqual(projectTLineManualOverlay({ ...base, latestDecision: { decisionType: "IGNORE_UNTIL", expiresAt: new Date("2026-01-01T00:00:00Z") }, now: new Date("2026-08-30T00:00:00Z") }), {
    effectiveStatus: "TIME_ERROR",
    effectiveSeverity: "ERROR",
    manual: false,
  });
  assert.deepEqual(projectTLineManualOverlay({ ...base, latestDecision: { decisionType: "IGNORE_UNTIL", expiresAt: new Date("2027-01-01T00:00:00Z") }, now: new Date("2026-08-30T00:00:00Z") }), {
    effectiveStatus: "IGNORED",
    effectiveSeverity: "UNPROCESSED",
    manual: true,
  });
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
