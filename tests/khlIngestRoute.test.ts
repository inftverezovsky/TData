import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { POST } from "../frontend/src/app/api/results/khl/ingest/route";

function request(body: unknown) {
  return new Request("http://localhost/api/results/khl/ingest", {
    method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("manual event ingestion queues durable work and returns 202 without a source HTTP request", async (context) => {
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previous = globals.prisma;
  let transactions = 0;
  let fetches = 0;
  context.mock.method(globalThis, "fetch", async () => { fetches += 1; throw new Error("No HTTP in enqueue request"); });
  globals.prisma = { $transaction: async () => {
    transactions += 1;
    return { reused: true, run: {
      id: "test-run", trigger: "MANUAL", status: "QUEUED", khlGameId: null, full: false,
      requestedAt: new Date("2026-09-05T12:00:00Z"), startedAt: null, completedAt: null,
      summary: null, error: null,
    } };
  } } as unknown as PrismaClient;
  try {
    const response = await POST(request({ apiEventId: "3000063", stageId: "407" }));
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {
      reused: true, run: {
        id: "test-run", trigger: "MANUAL", status: "QUEUED", khlGameId: null, full: false,
        requestedAt: "2026-09-05T12:00:00.000Z", startedAt: null, completedAt: null,
        summary: null, error: null,
      },
    });
    assert.equal(transactions, 1);
    assert.equal(fetches, 0);
  } finally {
    globals.prisma = previous;
  }
});

test("manual event ingestion validates IDs before queue or source access", async (context) => {
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previous = globals.prisma;
  globals.prisma = { $transaction: async () => { throw new Error("Unexpected DB request"); } } as unknown as PrismaClient;
  context.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected HTTP request"); });
  try {
    for (const body of [{ apiEventId: 3000063, stageId: "407" }, { apiEventId: "3000063", stageId: "0" }]) {
      const response = await POST(request(body));
      assert.equal(response.status, 400);
    }
  } finally {
    globals.prisma = previous;
  }
});
