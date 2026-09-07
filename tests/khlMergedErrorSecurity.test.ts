import assert from "node:assert/strict";
import test from "node:test";
import type { KhlSyncRun, PrismaClient } from "@prisma/client";
import { safeKhlSyncError } from "../backend/src/results/khl/syncErrors";
import { khlSyncRunView, KhlSyncRequestError } from "../backend/src/results/khl/syncQueue";
import { retryKhlRead } from "../backend/src/results/khl/autoSync";
import { POST as ingest } from "../frontend/src/app/api/results/khl/ingest/route";
import { POST as sync } from "../frontend/src/app/api/results/khl/sync/route";
import { GET as runStatus } from "../frontend/src/app/api/results/khl/sync/[id]/route";
import { POST as automation } from "../frontend/src/app/api/results/khl/automation/route";
import { POST as playerExtra } from "../frontend/src/app/api/results/khl/bindings/player-extra/route";
import { GET as matches } from "../frontend/src/app/api/results/khl/matches/route";

const diagnostic = "PRIVATE_UPSTREAM_PAYLOAD_7b51 /opt/private/internal-file";
const fallback = "KHL operation failed; protected server diagnostics are required.";

function request(body: unknown) {
  return new Request("http://localhost/api/results/khl/test", {
    method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const calls: Array<[string, () => Promise<Response>, number]> = [
  ["ingest", () => ingest(request({ apiEventId: "123", stageId: "407" })), 500],
  ["sync", () => sync(request({})), 503],
  ["run status", () => runStatus(new Request("http://localhost"), { params: Promise.resolve({ id: "run-1" }) }), 500],
  ["automation", () => automation(request({ paused: true })), 500],
  ["player extra", () => playerExtra(request({ khlPlayerId: "123", extraCode: "scores", adminExtraId: "extra-1" })), 500],
  ["matches", () => matches(new Request("http://localhost/api/results/khl/matches")), 500],
];

for (const [name, call, status] of calls) {
  test(`${name} converts unexpected failures to a safe API response and log`, async (context) => {
    const globals = globalThis as unknown as { prisma?: PrismaClient };
    const previous = globals.prisma;
    const error = Object.assign(new Error(diagnostic), { name: diagnostic });
    const fail = async () => { throw error; };
    globals.prisma = new Proxy({}, { get: (_, key) => String(key).startsWith("$")
      ? fail : new Proxy({}, { get: () => fail }) }) as PrismaClient;
    const logs: unknown[][] = [];
    context.mock.method(console, "error", (...args: unknown[]) => { logs.push(args); });
    try {
      const response = await call();
      assert.equal(response.status, status);
      const body = await response.json();
      assert.equal(body.ok, false);
      assert.equal(body.code, "INTERNAL_ERROR");
      assert.ok(logs.length > 0);
      assert.doesNotMatch(JSON.stringify({ body, logs }), /PRIVATE_UPSTREAM|internal-file/);
    } finally { globals.prisma = previous; }
  });
}

test("queue capacity remains an actionable 429 through the safe API contract", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previous = globals.prisma;
  globals.prisma = { $transaction: async () => {
    throw new KhlSyncRequestError("KHL sync queue is full. Wait for the current collection.", 429);
  } } as unknown as PrismaClient;
  try {
    const response = await sync(request({}));
    assert.equal(response.status, 429);
    assert.match((await response.json()).error, /queue is full/);
  } finally { globals.prisma = previous; }
});

test("sync diagnostics accept only controlled messages while retaining transient retry categories", async () => {
  assert.equal(safeKhlSyncError(new Error(diagnostic)), fallback);
  assert.equal(safeKhlSyncError(new Error(`KHL API request failed: ${diagnostic}`)), "KHL API request failed.");
  assert.equal(safeKhlSyncError(new Error("KHL API returned HTTP 503.")), "KHL API returned HTTP 503.");
  let attempts = 0;
  await assert.rejects(retryKhlRead(async () => {
    attempts += 1;
    throw new Error(`KHL API request failed: ${diagnostic}`);
  }, async () => undefined));
  assert.equal(attempts, 3);
});

test("run DTO redacts previously stored error and failure diagnostics without mutating evidence", () => {
  const stored = {
    id: "run-1", trigger: "MANUAL", status: "FAILED", khlGameId: null, full: true,
    requestedAt: new Date("2026-09-05T12:00:00Z"), startedAt: null, completedAt: null,
    summary: { failures: [{ scope: "event", stageId: "407", khlGameId: "123", apiEventId: "12", message: diagnostic }] },
    error: diagnostic,
  } as unknown as KhlSyncRun;
  const before = JSON.stringify(stored);
  const view = khlSyncRunView(stored);
  assert.equal(view.error, fallback);
  assert.equal(view.summary?.failures[0]?.message, fallback);
  assert.equal(JSON.stringify(stored), before);
});
