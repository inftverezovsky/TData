import { requireTestDatabaseUrl } from "../../scripts/helpers/testDatabase";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { normalizeKhlEventDetail } from "../../backend/src/sources/results/khl/normalize";
import type { KhlScheduleEvent } from "../../backend/src/sources/results/khl/client";
import type { KhlResultsSyncClient, KhlResultsSyncSummary, KhlSyncCheckpoint } from "../../backend/src/results/khl/autoSync";
import { enqueueKhlSync, getKhlSyncStatus, setKhlSyncPaused } from "../../backend/src/results/khl/syncQueue";
import { runKhlWorkerTick } from "../../backend/src/results/khl/syncWorker";
import { acquireKhlDatabaseSuiteLock } from "../helpers/khlDatabaseSuiteLock";

const databaseUrl = requireTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
let release: (() => Promise<void>) | undefined;
const raw = readFileSync(join(process.cwd(), "tests/fixtures/khl/regulation-901973.json"), "utf8");
const normalized = normalizeKhlEventDetail(JSON.parse(raw));

async function clear() {
  await prisma.$transaction([
    prisma.khlSyncControl.deleteMany(), prisma.khlSyncRun.deleteMany(),
    prisma.khlDeliveryAttempt.deleteMany(), prisma.khlDelivery.deleteMany(),
    prisma.khlPlayerStatTarget.deleteMany(), prisma.khlTeamStatTarget.deleteMany(),
    prisma.khlTeamStatBinding.deleteMany(), prisma.khlMatchParticipant.deleteMany(),
    prisma.khlMatchRevision.deleteMany(), prisma.khlRawSnapshot.deleteMany(),
    prisma.khlMatch.deleteMany(), prisma.khlPlayer.deleteMany(), prisma.khlTeam.deleteMany(),
    prisma.globalSettings.deleteMany({ where: { key: "khl_results_auto_sync_paused" } }),
  ]);
}
test.before(async () => { release = await acquireKhlDatabaseSuiteLock(databaseUrl); });
test.beforeEach(clear);
test.after(async () => { await clear(); await prisma.$disconnect(); await release?.(); });

function event(game = "901973", api = "2986031"): KhlScheduleEvent {
  return {
    apiEventId: api, khlGameId: game, matchId: game, stageId: normalized.identity.stageId,
    khlStageId: normalized.identity.khlStageId, stageName: "Test stage", name: "Test result",
    startsAt: normalized.startsAt, eventStartsAt: normalized.startsAt, status: "finished",
    score: { home: 0, away: 0 }, periodScores: { P1: null, P2: null, P3: null, OT: null, SO: null },
    teams: normalized.teams,
  };
}
function envelope(apiEventId: string) {
  const value = JSON.parse(raw);
  if (apiEventId !== normalized.identity.apiEventId) {
    value.id = Number(apiEventId); value.khl_id = 901974; value.match_id = "901974";
  }
  const rawBody = JSON.stringify(value);
  return { event: value, rawBody, rawBytes: Buffer.from(rawBody),
    sourceUrl: `https://khl.api.webcaster.pro/api/khl_mobile/event_v2.json?id=${apiEventId}&stage_id=${normalized.identity.stageId}`,
    contentType: "application/json", fetchedAt: new Date() };
}
function client(events: KhlScheduleEvent[] = [event()]): KhlResultsSyncClient {
  return {
    async listStages() { return [{ stageId: normalized.identity.stageId, khlStageId: normalized.identity.khlStageId, title: "Test", type: "regular", season: "2025/2026", current: false }]; },
    async listEvents() { return events; },
    async getEventDetailEnvelope(input) { return envelope(input.apiEventId); },
  };
}

test("manual historical API event ingests while paused and remains idempotent", async () => {
  await setKhlSyncPaused(prisma, true, true);
  await prisma.khlSyncControl.update({ where: { id: "khl" }, data: { bootstrapCompletedAt: new Date() } });
  const request = { apiEventId: normalized.identity.apiEventId, stageId: normalized.identity.stageId };
  await enqueueKhlSync(prisma, request);
  const first = await runKhlWorkerTick({ prisma, configured: true, client: client() });
  assert.equal(first?.status, "SUCCEEDED");
  assert.equal(await prisma.khlMatch.count(), 1);
  assert.equal(await prisma.khlRawSnapshot.count(), 1);
  assert.equal(await prisma.khlMatchRevision.count(), 1);
  await enqueueKhlSync(prisma, request);
  const repeated = await runKhlWorkerTick({ prisma, configured: true, client: client() });
  assert.equal(repeated?.status, "SUCCEEDED");
  assert.equal(await prisma.khlRawSnapshot.count(), 1);
  assert.equal(await prisma.khlMatchRevision.count(), 1);
  assert.equal(await prisma.khlDeliveryAttempt.count(), 0);
});

test("one source error does not prevent another match from being preserved", async () => {
  const source = client([event("901972", "2986000"), event()]);
  let failedAttempts = 0;
  source.getEventDetailEnvelope = async ({ apiEventId }) => {
    if (apiEventId === "2986000") { failedAttempts++; throw new Error("KHL API returned HTTP 503."); }
    return envelope(apiEventId);
  };
  await enqueueKhlSync(prisma);
  const run = await runKhlWorkerTick({ prisma, configured: false, client: source });
  assert.equal(run?.status, "PARTIAL");
  assert.equal(failedAttempts, 3);
  assert.equal(await prisma.khlMatch.count(), 1);
  assert.equal((await getKhlSyncStatus(prisma)).bootstrapCompletedAt, null);
});

test("pausing an automatic run stops before fetching the next match", async () => {
  const source = client([event(), event("901974", "2986032")]);
  let fetches = 0;
  source.getEventDetailEnvelope = async ({ apiEventId }) => {
    fetches++;
    await setKhlSyncPaused(prisma, true, true);
    return envelope(apiEventId);
  };
  await setKhlSyncPaused(prisma, false, true);
  const run = await runKhlWorkerTick({ prisma, configured: true, client: source });
  assert.equal(run?.status, "CANCELLED");
  assert.equal(fetches, 1);
  assert.equal(await prisma.khlMatch.count(), 1);
  assert.equal((await getKhlSyncStatus(prisma)).bootstrapCompletedAt, null);
});

test("worker shutdown leaves saved progress reclaimable without fetching completed matches again", async () => {
  const events = [event(), event("901974", "2986032")];
  const stopping = new AbortController();
  const firstClient = client(events);
  firstClient.getEventDetailEnvelope = async ({ apiEventId }) => {
    if (apiEventId === "2986032") {
      stopping.abort(); throw new Error("worker fixture stopped");
    }
    return envelope(apiEventId);
  };
  const queued = await enqueueKhlSync(prisma);
  await assert.rejects(runKhlWorkerTick({ prisma, configured: false, client: firstClient, signal: stopping.signal }), /stopping/);
  const interrupted = await prisma.khlSyncRun.findUniqueOrThrow({ where: { id: queued.run.id } });
  assert.equal(interrupted.status, "RUNNING");
  assert.equal((interrupted.checkpoint as unknown as KhlSyncCheckpoint).eventIndex, 1);
  assert.equal(await prisma.khlMatch.count(), 1);
  await prisma.khlSyncControl.update({ where: { id: "khl" }, data: { leaseExpiresAt: new Date(Date.now() - 1) } });
  const refetched: string[] = [];
  const resumedClient = client(events);
  resumedClient.getEventDetailEnvelope = async ({ apiEventId }) => { refetched.push(apiEventId); return envelope(apiEventId); };
  const resumed = await runKhlWorkerTick({ prisma, configured: false, client: resumedClient });
  assert.equal(resumed?.id, queued.run.id);
  assert.equal(resumed?.status, "SUCCEEDED");
  assert.deepEqual(refetched, ["2986032"]);
  assert.equal(await prisma.khlMatch.count(), 2);
  assert.equal(await prisma.khlRawSnapshot.count(), 2);
  assert.equal(await prisma.khlMatchRevision.count(), 2);
});

test("single-match refresh forces a new fetch even after recent automatic ingestion", async () => {
  await enqueueKhlSync(prisma, { apiEventId: normalized.identity.apiEventId, stageId: normalized.identity.stageId });
  await runKhlWorkerTick({ prisma, configured: false, client: client() });
  let fetches = 0;
  const source = client();
  source.getEventDetailEnvelope = async ({ apiEventId }) => { fetches++; return envelope(apiEventId); };
  await enqueueKhlSync(prisma, { khlGameId: normalized.identity.khlGameId });
  const refreshed = await runKhlWorkerTick({ prisma, configured: false, client: source });
  assert.equal(refreshed?.status, "SUCCEEDED");
  assert.equal(fetches, 1);
  assert.equal(await prisma.khlMatchRevision.count(), 1);
});

test("every general automatic and manual pass refetches recent protocols and sees source corrections", async () => {
  const wrapper = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/khl/missing-player-ids-901981.json"), "utf8"));
  const original = wrapper.event || wrapper;
  const diagnostic = normalizeKhlEventDetail(original);
  const corrected = structuredClone(original);
  let correctionIndex = 0;
  for (const player of [...corrected.team_a.players, ...corrected.team_b.players]) {
    // Synthetic source correction only; no Admin identifiers are involved.
    if (player.khl_id === 0) player.khl_id = 990_000_000 + ++correctionIndex;
  }
  const scheduled: KhlScheduleEvent = {
    ...event(), apiEventId: diagnostic.identity.apiEventId, khlGameId: diagnostic.identity.khlGameId,
    matchId: diagnostic.identity.matchId, stageId: diagnostic.identity.stageId,
    khlStageId: diagnostic.identity.khlStageId, startsAt: diagnostic.startsAt,
    eventStartsAt: diagnostic.startsAt, teams: diagnostic.teams,
  };
  let fetches = 0;
  const source: KhlResultsSyncClient = {
    async listStages() { return [{ stageId: "407", khlStageId: "1436", title: "Fixture", type: "regular", season: "2026/2027", current: true }]; },
    async listEvents() { return [scheduled]; },
    async getEventDetailEnvelope() {
      const base = ++fetches === 1 ? original : corrected;
      const value = fetches >= 4 ? { ...base, source_transport_note: "new ignored raw metadata" } : base;
      const rawBody = JSON.stringify(value);
      return { event: value, rawBody, rawBytes: Buffer.from(rawBody), fetchedAt: new Date(), contentType: "application/json",
        sourceUrl: "https://khl.api.webcaster.pro/api/khl_mobile/event_v2.json?id=3000063&stage_id=407" };
    },
  };
  const rangeEnd = new Date("2026-09-06T00:00:00Z");
  await enqueueKhlSync(prisma, { now: rangeEnd, trigger: "AUTOMATIC" });
  const first = await runKhlWorkerTick({ prisma, configured: true, client: source });
  assert.equal(first?.status, "PARTIAL");
  assert.equal(fetches, 1);
  const firstStatus = await getKhlSyncStatus(prisma);
  assert.ok(firstStatus.bootstrapCompletedAt);

  const secondRequest = await enqueueKhlSync(prisma, { now: rangeEnd, trigger: "AUTOMATIC" });
  assert.equal(secondRequest.run.full, false);
  const second = await runKhlWorkerTick({ prisma, configured: true, client: source });
  assert.equal(fetches, 2, "a recent raw snapshot must not suppress the next automatic source request");
  assert.equal(second?.status, "SUCCEEDED");
  assert.equal(await prisma.khlMatchRevision.count(), 2);
  assert.equal(await prisma.khlMatchParticipant.count(), 47);
  const secondStatus = await getKhlSyncStatus(prisma);
  assert.ok(Date.parse(secondStatus.lastAttemptAt!) > Date.parse(firstStatus.lastAttemptAt!));

  await enqueueKhlSync(prisma, { now: rangeEnd, trigger: "MANUAL" });
  const repeated = await runKhlWorkerTick({ prisma, configured: true, client: source });
  assert.equal(fetches, 3, "general manual collection also fetches the protocol again");
  assert.equal(repeated?.status, "SUCCEEDED");
  const summary = repeated?.summary as unknown as KhlResultsSyncSummary;
  assert.equal(summary.events.checked, 1);
  assert.equal(summary.events.reusedSnapshots, 1);
  assert.equal(summary.events.skippedRecentlyFetched, 0);
  assert.equal(await prisma.khlRawSnapshot.count(), 2);
  assert.equal(await prisma.khlMatchRevision.count(), 2);
  assert.equal(await prisma.khlDeliveryAttempt.count(), 0);
  const unchangedStatus = await getKhlSyncStatus(prisma);

  await enqueueKhlSync(prisma, { apiEventId: "3000063", stageId: "407" });
  const rawOnlyChange = await runKhlWorkerTick({ prisma, configured: true, client: source });
  assert.equal(rawOnlyChange?.status, "SUCCEEDED");
  assert.equal(fetches, 4);
  const rawOnlySummary = rawOnlyChange?.summary as unknown as KhlResultsSyncSummary;
  assert.equal(rawOnlySummary.events.newlyChanged, 0);
  assert.equal(rawOnlySummary.events.reusedRevisions, 1);
  assert.equal(rawOnlySummary.events.reusedSnapshots, 0);
  assert.equal(await prisma.khlRawSnapshot.count(), 3);
  assert.equal(await prisma.khlMatchRevision.count(), 2);
  assert.equal((await getKhlSyncStatus(prisma)).lastChangedAt, unchangedStatus.lastChangedAt);
});
