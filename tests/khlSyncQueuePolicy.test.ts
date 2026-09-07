import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { enqueueKhlSync } from "../backend/src/results/khl/syncQueue";

test("explicit full scan does not silently reuse a narrower running scan", async () => {
  const rolling = { id: "rolling", status: "RUNNING", trigger: "MANUAL", full: false };
  let createdFull: { id: string; full: boolean } | null = null;
  const tx = {
    $executeRaw: async () => 0, $queryRaw: async () => [],
    khlSyncControl: { findUniqueOrThrow: async () => ({ bootstrapCompletedAt: new Date() }) },
    khlSyncRun: {
      findFirst: async ({ where }: { where: { full?: boolean } }) => where.full ? createdFull : rolling,
      count: async () => 1,
      create: async ({ data }: { data: { full: boolean } }) => {
        createdFull = { id: "full-successor", full: data.full }; return createdFull;
      },
    },
  };
  const prisma = { $transaction: async (run: (input: typeof tx) => Promise<unknown>) => run(tx) } as unknown as PrismaClient;
  const requested = await enqueueKhlSync(prisma, { full: true });
  assert.equal(requested.run.full, true);
  assert.notEqual(requested.run.id, rolling.id);
  const repeated = await enqueueKhlSync(prisma, { full: true });
  assert.equal(repeated.run.id, requested.run.id);
  assert.equal(repeated.reused, true);
});
