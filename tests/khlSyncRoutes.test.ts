import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { POST } from "../frontend/src/app/api/results/khl/sync/route";
import { GET } from "../frontend/src/app/api/results/khl/sync/[id]/route";

function request(body: unknown, origin = "http://localhost") {
  return new Request("http://localhost/api/results/khl/sync", {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
test("sync routes validate origin, body size, and identifiers before DB access", async () => {
  assert.equal((await POST(request({}, "https://untrusted.example"))).status, 403);
  assert.equal((await POST(request({ khlGameId: 901979 }))).status, 400);
  assert.equal((await POST(request({ other: "x".repeat(3_000) }))).status, 413);
  assert.equal((await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "../bad" }) })).status, 400);
});
test("sync endpoint queues and status endpoint returns bounded DTO without source fetch", async (context) => {
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previous = globals.prisma;
  const run = { id: "test-run", trigger: "MANUAL", status: "QUEUED", khlGameId: null, full: true,
    requestedAt: new Date("2026-09-05T12:00:00Z"), startedAt: null, completedAt: null, summary: null, error: null,
    checkpoint: { internal: "should not leak" }, leaseOwner: "internal-owner" };
  globals.prisma = { $transaction: async () => ({ reused: true, run }),
    khlSyncRun: { findUnique: async () => run } } as unknown as PrismaClient;
  context.mock.method(globalThis, "fetch", async () => { throw new Error("No source fetch in queue API"); });
  try {
    const queued = await POST(request({}));
    assert.equal(queued.status, 202);
    assert.equal((await queued.json()).run.id, "test-run");
    const status = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "test-run" }) });
    assert.equal(status.status, 200);
    assert.doesNotMatch(JSON.stringify(await status.json()), /internal|checkpoint|leaseOwner/);
  } finally { globals.prisma = previous; }
});
