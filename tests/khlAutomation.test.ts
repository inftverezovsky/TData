import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaClient } from "@prisma/client";

import {
  KHL_RESULTS_AUTO_SYNC_PAUSED_KEY,
  getKhlResultsAutomationStatus,
  runKhlResultsAutoSync,
  setKhlResultsAutoSyncPaused,
} from "@backend/results/khl/automation";

test("KHL automatic sync pause is persisted and can be resumed", async () => {
  const settings = new Map<string, string>();
  const prisma = settingsPrisma(settings);

  assert.deepEqual(
    await getKhlResultsAutomationStatus(prisma, true),
    { configured: true, paused: false, enabled: true }
  );

  assert.deepEqual(
    await setKhlResultsAutoSyncPaused(prisma, true, true),
    { configured: true, paused: true, enabled: false }
  );
  assert.equal(settings.get(KHL_RESULTS_AUTO_SYNC_PAUSED_KEY), "1");
  assert.deepEqual(
    await getKhlResultsAutomationStatus(prisma, true),
    { configured: true, paused: true, enabled: false }
  );

  assert.deepEqual(
    await setKhlResultsAutoSyncPaused(prisma, false, true),
    { configured: true, paused: false, enabled: true }
  );
  assert.equal(settings.get(KHL_RESULTS_AUTO_SYNC_PAUSED_KEY), "0");
});

test("KHL automatic sync runner stops before its network-capable callback while paused", async () => {
  const settings = new Map([[KHL_RESULTS_AUTO_SYNC_PAUSED_KEY, "1"]]);
  let callbackCalls = 0;

  const outcome = await runKhlResultsAutoSync({
    prisma: settingsPrisma(settings),
    configured: true,
    run: async () => {
      callbackCalls += 1;
      return { fetched: true };
    },
  });

  assert.deepEqual(outcome, {
    executed: false,
    reason: "PAUSED",
    automation: { configured: true, paused: true, enabled: false },
  });
  assert.equal(callbackCalls, 0);
});

test("KHL automatic sync runner executes when configured and resumed", async () => {
  const outcome = await runKhlResultsAutoSync({
    prisma: settingsPrisma(new Map([[KHL_RESULTS_AUTO_SYNC_PAUSED_KEY, "0"]])),
    configured: true,
    run: async () => ({ fetched: true }),
  });

  assert.deepEqual(outcome, {
    executed: true,
    automation: { configured: true, paused: false, enabled: true },
    result: { fetched: true },
  });
});

test("KHL automatic sync runner fails closed when pause state cannot be read", async () => {
  let callbackCalls = 0;
  const prisma = {
    globalSettings: {
      async findUnique() {
        throw new Error("database unavailable");
      },
    },
  } as unknown as PrismaClient;

  await assert.rejects(
    runKhlResultsAutoSync({
      prisma,
      configured: true,
      run: async () => {
        callbackCalls += 1;
        return null;
      },
    }),
    /database unavailable/
  );
  assert.equal(callbackCalls, 0);
});

function settingsPrisma(settings: Map<string, string>): PrismaClient {
  return {
    globalSettings: {
      async findUnique(input: { where: { key: string } }) {
        const value = settings.get(input.where.key);
        return value === undefined ? null : { value };
      },
      async upsert(input: {
        where: { key: string };
        create: { key: string; value: string };
        update: { value: string };
      }) {
        const key = input.where.key;
        const value = settings.has(key) ? input.update.value : input.create.value;
        settings.set(key, value);
        return { key, value };
      },
    },
  } as unknown as PrismaClient;
}
