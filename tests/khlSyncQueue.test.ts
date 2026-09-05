import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { acquireKhlDatabaseSuiteLock } from "./helpers/khlDatabaseSuiteLock";
import {
  enqueueKhlSync, claimKhlSync, fenceKhlSyncWrite, finishKhlSync,
  heartbeatKhlWorker, getKhlSyncStatus, setKhlSyncPaused, tickKhlAutoSchedule,
} from "../backend/src/results/khl/syncQueue";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for khlSyncQueue.test.ts");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
let release: (() => Promise<void>) | undefined;
const now = new Date("2026-09-05T17:00:00Z");
test.before(async () => { release = await acquireKhlDatabaseSuiteLock(databaseUrl); });
test.beforeEach(async () => {
  await prisma.khlSyncControl.deleteMany();
  await prisma.khlSyncRun.deleteMany();
  await prisma.globalSettings.deleteMany({ where: { key: "khl_results_auto_sync_paused" } });
});
test.after(async () => {
  await prisma.khlSyncControl.deleteMany();
  await prisma.khlSyncRun.deleteMany();
  await prisma.globalSettings.deleteMany({ where: { key: "khl_results_auto_sync_paused" } });
  await prisma.$disconnect(); await release?.();
});

test("parallel manual requests coalesce and only one executor claims work", async () => {
  const requests = await Promise.all(Array.from({ length: 8 }, () => enqueueKhlSync(prisma, { now })));
  assert.equal(new Set(requests.map((value) => value.run.id)).size, 1);
  const claims = await Promise.all([claimKhlSync(prisma, "worker-a", now), claimKhlSync(prisma, "worker-b", now)]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(await prisma.khlSyncRun.count(), 1);
});

test("lease recovery preserves checkpoint and fences the previous executor", async () => {
  await enqueueKhlSync(prisma, { now });
  const first = (await claimKhlSync(prisma, "worker-a", now))!;
  await prisma.khlSyncRun.update({ where: { id: first.run.id }, data: { checkpoint: { eventIndex: 2 } } });
  const later = new Date(now.getTime() + 61_000);
  const second = (await claimKhlSync(prisma, "worker-b", later))!;
  assert.equal(second.run.id, first.run.id);
  assert.deepEqual(second.run.checkpoint, { eventIndex: 2 });
  await assert.rejects(prisma.$transaction((tx) => fenceKhlSyncWrite(tx, first, later)), /lease/i);
  await prisma.$transaction((tx) => fenceKhlSyncWrite(tx, second, later));
});

test("resume queues immediate bootstrap; pause cancels auto but allows manual", async () => {
  await setKhlSyncPaused(prisma, false, true, now);
  let run = await prisma.khlSyncRun.findFirstOrThrow();
  assert.equal(run.trigger, "AUTOMATIC"); assert.equal(run.full, true);
  await setKhlSyncPaused(prisma, true, true, now);
  run = await prisma.khlSyncRun.findUniqueOrThrow({ where: { id: run.id } });
  assert.equal(run.status, "CANCELLED");
  assert.equal(await tickKhlAutoSchedule(prisma, true, now), null);
  const manual = await enqueueKhlSync(prisma, { now });
  assert.equal(manual.run.trigger, "MANUAL");
  assert.ok(await claimKhlSync(prisma, "manual-worker", now));
});

test("successful no-change run records a check and schedules rolling window", async () => {
  await enqueueKhlSync(prisma, { now });
  const claim = (await claimKhlSync(prisma, "worker", now))!;
  const summary = {
    startedAt: now.toISOString(), completedAt: now.toISOString(), durationMs: 0,
    range: { from: claim.run.from.toISOString(), to: claim.run.to.toISOString() },
    stages: { available: 1, selected: 1, scannedWindows: 1 },
    events: { discovered: 0, eligible: 0, checked: 0, newlyChanged: 0, ingested: 0, reusedSnapshots: 0, reusedRevisions: 0, rejectedRevisions: 0, skippedBeforeCutoff: 0, skippedAfterRange: 0, skippedNotFinished: 0, skippedDuplicate: 0, skippedRecentlyFetched: 0 },
    failures: [], stopped: false,
  };
  await finishKhlSync(prisma, claim, summary, now);
  await heartbeatKhlWorker(prisma, null, now);
  const status = await getKhlSyncStatus(prisma);
  assert.equal(status.latestRun?.status, "SUCCEEDED");
  assert.equal(status.lastSuccessAt, now.toISOString());
  assert.equal(status.lastChangedAt, null);
  assert.equal(status.workerHeartbeatAt, now.toISOString());
  assert.equal(status.bootstrapCompletedAt, now.toISOString());
  const next = await enqueueKhlSync(prisma, { now: new Date(now.getTime() + 600_000) });
  assert.equal(next.run.full, false);
});

test("an unpersisted rolling failure resets completed bootstrap so historical retries are not lost", async () => {
  await enqueueKhlSync(prisma, { now });
  await prisma.khlSyncControl.update({ where: { id: "khl" }, data: { bootstrapCompletedAt: now } });
  await prisma.khlSyncRun.updateMany({ data: { full: false } });
  const claim = (await claimKhlSync(prisma, "worker", now))!;
  assert.equal(claim.run.full, false);
  await finishKhlSync(prisma, claim, {
    startedAt: now.toISOString(), completedAt: now.toISOString(), durationMs: 0,
    range: { from: claim.run.from.toISOString(), to: now.toISOString() },
    stages: { available: 1, selected: 1, scannedWindows: 1 },
    events: { discovered: 1, eligible: 1, checked: 1, newlyChanged: 0, ingested: 0, reusedSnapshots: 0, reusedRevisions: 0, rejectedRevisions: 0, skippedBeforeCutoff: 0, skippedAfterRange: 0, skippedNotFinished: 0, skippedDuplicate: 0, skippedRecentlyFetched: 0 },
    failures: [{ scope: "event", stageId: "395", khlGameId: "901973", apiEventId: "2986031", message: "KHL API returned HTTP 503." }], stopped: false,
  }, now);
  assert.equal((await getKhlSyncStatus(prisma)).bootstrapCompletedAt, null);
  const retry = await enqueueKhlSync(prisma, { now });
  assert.equal(retry.run.full, true);
});

test("manual request promotes coalesced automatic work so pausing does not cancel it", async () => {
  const auto = await enqueueKhlSync(prisma, { now, trigger: "AUTOMATIC" });
  const manual = await enqueueKhlSync(prisma, { now });
  assert.equal(manual.run.id, auto.run.id);
  assert.equal(manual.run.trigger, "MANUAL");
  await setKhlSyncPaused(prisma, true, true, now);
  assert.equal((await prisma.khlSyncRun.findUniqueOrThrow({ where: { id: manual.run.id } })).status, "QUEUED");
});

test("manual API event always accepts the supported historical range after bootstrap", async () => {
  await enqueueKhlSync(prisma, { now });
  await prisma.khlSyncRun.updateMany({ data: { status: "SUCCEEDED" } });
  await prisma.khlSyncControl.update({ where: { id: "khl" }, data: { bootstrapCompletedAt: now } });
  const event = await enqueueKhlSync(prisma, { now, apiEventId: "2986031", stageId: "395" });
  assert.equal(event.run.from.toISOString(), "2026-04-30T21:00:00.000Z");
  assert.equal(event.run.apiEventId, "2986031");
  assert.equal(event.run.full, false);
});

test("manual request during automatic cancellation creates a coalesced independent successor", async () => {
  const auto = await enqueueKhlSync(prisma, { now, trigger: "AUTOMATIC" });
  await claimKhlSync(prisma, "worker", now);
  await setKhlSyncPaused(prisma, true, true, now);
  const manual = await enqueueKhlSync(prisma, { now });
  const repeated = await enqueueKhlSync(prisma, { now });
  assert.notEqual(manual.run.id, auto.run.id);
  assert.equal(manual.run.trigger, "MANUAL");
  assert.equal(repeated.run.id, manual.run.id);
});
