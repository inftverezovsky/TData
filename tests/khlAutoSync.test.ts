import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaClient } from "@prisma/client";

import {
  KHL_RESULTS_CUTOFF,
  KHL_RESULTS_CUTOFF_DAY,
  KHL_RESULTS_TIME_ZONE,
  syncKhlResults,
  type KhlResultsSyncClient,
} from "@backend/results/khl/autoSync";
import type { KhlScheduleEvent, KhlStage } from "@backend/sources/results/khl/client";

const MAY_10 = new Date("2026-05-10T18:00:00.000Z");

test("KHL results cutoff starts at midnight in Europe/Moscow", () => {
  assert.equal(KHL_RESULTS_CUTOFF_DAY, "2026-05-01");
  assert.equal(KHL_RESULTS_TIME_ZONE, "Europe/Moscow");
  assert.equal(KHL_RESULTS_CUTOFF.toISOString(), "2026-04-30T21:00:00.000Z");
});

test("automatic KHL sync clamps the range, ignores old/non-finished games and deduplicates", async () => {
  const listCalls: Array<{ stageId: string; from: Date; to: Date }> = [];
  const ingested: string[] = [];
  const relevantStage = stage("395", "2025/2026");
  const currentStage = stage("407", "2026/2027");
  const oldStage = stage("359", "2024/2025");
  const finished = event("901973", "2986031", "395", MAY_10, "finished");

  const client: KhlResultsSyncClient = {
    async listStages() {
      return [relevantStage, currentStage, oldStage];
    },
    async listEvents(options) {
      listCalls.push(options);
      return options.stageId === "395"
        ? [
            event("old", "old-event", "395", new Date("2026-04-30T20:59:59.000Z"), "finished"),
            finished,
            finished,
            event("live", "live-event", "395", MAY_10, "live"),
            event("scheduled", "scheduled-event", "395", MAY_10, "scheduled"),
          ]
        : [];
    },
    async getEventDetailEnvelope(input) {
      return envelope(input.apiEventId);
    },
  };

  const summary = await syncKhlResults({
    prisma: emptyPrisma(),
    client,
    inspectDetail: () => ({
      khlGameId: finished.khlGameId,
      stageId: finished.stageId,
      startsAt: new Date(finished.startsAt),
      status: "finished",
    }),
    from: new Date("2026-01-01T00:00:00.000Z"),
    to: new Date("2026-05-31T20:59:59.999Z"),
    ingest: async (_prisma, input) => {
      ingested.push(JSON.parse(input.rawBody).event.id);
      return { reusedSnapshot: false, reusedRevision: false };
    },
  });

  assert.equal(summary.range.from, KHL_RESULTS_CUTOFF.toISOString());
  assert.equal(listCalls.some((call) => call.stageId === oldStage.stageId), false);
  assert.equal(listCalls.every((call) => call.from >= KHL_RESULTS_CUTOFF), true);
  assert.deepEqual(ingested, [finished.apiEventId]);
  assert.equal(summary.events.eligible, 1);
  assert.equal(summary.events.ingested, 1);
  assert.equal(summary.events.skippedBeforeCutoff, 1);
  assert.equal(summary.events.skippedNotFinished, 2);
  assert.equal(summary.events.skippedDuplicate, 1);
  assert.deepEqual(summary.failures, []);
});

test("automatic KHL sync skips recently refreshed matches but retries stale matches", async () => {
  const now = new Date("2026-08-21T12:00:00.000Z");
  const recent = event("recent", "recent-event", "407", new Date("2026-08-20T18:00:00.000Z"), "finished");
  const stale = event("stale", "stale-event", "407", new Date("2026-08-19T18:00:00.000Z"), "finished");
  const ingested: string[] = [];

  const summary = await syncKhlResults({
    prisma: prismaWithSnapshots([
      { khlGameId: recent.khlGameId, lastFetchedAt: new Date("2026-08-21T10:00:00.000Z") },
      { khlGameId: stale.khlGameId, lastFetchedAt: new Date("2026-08-20T00:00:00.000Z") },
    ]),
    client: clientWithEvents([recent, stale]),
    inspectDetail: detailInspector([recent, stale]),
    from: new Date("2026-08-18T00:00:00.000Z"),
    to: now,
    now,
    refreshExistingAfterMs: 6 * 60 * 60 * 1000,
    ingest: async (_prisma, input) => {
      ingested.push(JSON.parse(input.rawBody).event.id);
      return { reusedSnapshot: true, reusedRevision: true };
    },
  });

  assert.deepEqual(ingested, [stale.apiEventId]);
  assert.equal(summary.events.skippedRecentlyFetched, 1);
  assert.equal(summary.events.ingested, 1);
  assert.equal(summary.events.reusedSnapshots, 1);
  assert.equal(summary.events.reusedRevisions, 1);
});

test("automatic KHL sync records a per-match failure and continues", async () => {
  const first = event("first", "first-event", "407", MAY_10, "finished");
  const second = event("second", "second-event", "407", MAY_10, "finished");
  const ingested: string[] = [];

  const summary = await syncKhlResults({
    prisma: emptyPrisma(),
    client: clientWithEvents([first, second]),
    inspectDetail: detailInspector([first, second]),
    from: KHL_RESULTS_CUTOFF,
    to: new Date("2026-05-31T23:59:59.999Z"),
    ingest: async (_prisma, input) => {
      const id = JSON.parse(input.rawBody).event.id as string;
      if (id === first.apiEventId) throw new Error("fixture fetch failed");
      ingested.push(id);
      return { reusedSnapshot: false, reusedRevision: false };
    },
  });

  assert.deepEqual(ingested, [second.apiEventId]);
  assert.equal(summary.events.ingested, 1);
  assert.equal(summary.failures.length, 1);
  assert.equal(summary.failures[0]?.khlGameId, first.khlGameId);
  assert.match(summary.failures[0]?.message || "", /fixture fetch failed/);
});

test("automatic KHL sync rejects a detail response outside the configured scope", async () => {
  const scheduled = event("new-game", "new-event", "407", MAY_10, "finished");
  let ingestCalled = false;
  const summary = await syncKhlResults({
    prisma: emptyPrisma(),
    client: clientWithEvents([scheduled]),
    from: KHL_RESULTS_CUTOFF,
    to: new Date("2026-05-31T23:59:59.999Z"),
    inspectDetail: () => ({
      khlGameId: scheduled.khlGameId,
      stageId: scheduled.stageId,
      startsAt: new Date("2026-04-30T20:59:59.000Z"),
      status: "finished",
    }),
    ingest: async () => {
      ingestCalled = true;
      return { reusedSnapshot: false, reusedRevision: false };
    },
  });

  assert.equal(ingestCalled, false);
  assert.equal(summary.failures.length, 1);
  assert.match(summary.failures[0]?.message || "", /identity, date or finished status/);
});

test("automatic KHL sync reports a stored rejected revision as a failed result", async () => {
  const scheduled = event("rejected-game", "rejected-event", "407", MAY_10, "finished");
  const summary = await syncKhlResults({
    prisma: emptyPrisma(),
    client: clientWithEvents([scheduled]),
    from: KHL_RESULTS_CUTOFF,
    to: new Date("2026-05-31T23:59:59.999Z"),
    inspectDetail: detailInspector([scheduled]),
    ingest: async () => ({
      reusedSnapshot: false,
      reusedRevision: false,
      revision: { state: "REJECTED" },
    }),
  });

  assert.equal(summary.events.ingested, 1);
  assert.equal(summary.events.rejectedRevisions, 1);
  assert.equal(summary.failures.length, 1);
  assert.match(summary.failures[0]?.message || "", /stored as REJECTED/);
});

function stage(stageId: string, season: string): KhlStage {
  return {
    stageId,
    khlStageId: stageId,
    title: "Stage",
    type: "regular",
    season,
    current: stageId === "407",
  };
}

function event(
  khlGameId: string,
  apiEventId: string,
  stageId: string,
  startsAt: Date,
  status: KhlScheduleEvent["status"]
): KhlScheduleEvent {
  return {
    apiEventId,
    khlGameId,
    matchId: khlGameId,
    stageId,
    khlStageId: stageId,
    stageName: "Stage",
    name: khlGameId,
    startsAt: startsAt.toISOString(),
    eventStartsAt: startsAt.toISOString(),
    status,
    score: { home: 1, away: 0 },
    periodScores: { P1: null, P2: null, P3: null, OT: null, SO: null },
    teams: {
      home: { khlTeamId: "1", apiTeamId: "1", name: "Home", location: null },
      away: { khlTeamId: "2", apiTeamId: "2", name: "Away", location: null },
    },
  };
}

function envelope(apiEventId: string) {
  return {
    event: { id: apiEventId },
    rawBody: JSON.stringify({ event: { id: apiEventId } }),
    sourceUrl: `https://khl.api.webcaster.pro/api/khl_mobile/event_v2.json?id=${apiEventId}`,
    contentType: "application/json",
    fetchedAt: new Date("2026-08-21T12:00:00.000Z"),
  };
}

function clientWithEvents(events: KhlScheduleEvent[]): KhlResultsSyncClient {
  return {
    async listStages() {
      return [stage("407", "2026/2027")];
    },
    async listEvents() {
      return events;
    },
    async getEventDetailEnvelope(input) {
      return envelope(input.apiEventId);
    },
  };
}

function detailInspector(events: KhlScheduleEvent[]) {
  return (detail: Record<string, unknown>) => {
    const matched = events.find((event) => event.apiEventId === detail.id);
    if (!matched) throw new Error("Unknown fixture event.");
    return {
      khlGameId: matched.khlGameId,
      stageId: matched.stageId,
      startsAt: new Date(matched.startsAt),
      status: matched.status,
    };
  };
}

function emptyPrisma(): PrismaClient {
  return prismaWithSnapshots([]);
}

function prismaWithSnapshots(
  snapshots: Array<{ khlGameId: string; lastFetchedAt: Date }>
): PrismaClient {
  return {
    khlMatch: {
      async findMany() {
        return snapshots.map((snapshot) => ({
          khlGameId: snapshot.khlGameId,
          rawSnapshots: [{ lastFetchedAt: snapshot.lastFetchedAt }],
        }));
      },
    },
  } as unknown as PrismaClient;
}
