import { requireTestDatabaseUrl } from "../../scripts/helpers/testDatabase";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";
import { ingestKhlEventDetail } from "../../backend/src/results/khl/repository";
import { acquireKhlDatabaseSuiteLock } from "../helpers/khlDatabaseSuiteLock";

const databaseUrl = requireTestDatabaseUrl(process.env.TEST_DATABASE_URL);

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
let releaseSuiteLock: (() => Promise<void>) | undefined;

function rawFixture() {
  return readFileSync(
    join(process.cwd(), "tests", "fixtures", "khl", "regulation-901973.json"),
    "utf8"
  );
}

function replaceTeamReferences(value: unknown, from: number, to: number): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => replaceTeamReferences(entry, from, to));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (key === "team_id" && entry === from) {
      (value as Record<string, unknown>)[key] = to;
    } else {
      replaceTeamReferences(entry, from, to);
    }
  }
}

async function clearKhlTables() {
  await prisma.$transaction([
    prisma.khlDeliveryAttempt.deleteMany(),
    prisma.khlDelivery.deleteMany(),
    prisma.khlPlayerStatTarget.deleteMany(),
    prisma.khlTeamStatTarget.deleteMany(),
    prisma.khlTeamStatBinding.deleteMany(),
    prisma.khlMatchParticipant.deleteMany(),
    prisma.khlMatchRevision.deleteMany(),
    prisma.khlRawSnapshot.deleteMany(),
    prisma.khlMatch.deleteMany(),
    prisma.khlPlayer.deleteMany(),
    prisma.khlTeam.deleteMany(),
  ]);
}

test.before(async () => {
  releaseSuiteLock = await acquireKhlDatabaseSuiteLock(databaseUrl);
  await clearKhlTables();
});

test.after(async () => {
  try {
    await clearKhlTables();
  } finally {
    try {
      await prisma.$disconnect();
    } finally {
      await releaseSuiteLock?.();
    }
  }
});

test("ingestion is idempotent and activates only validated revisions", async () => {
  const rawBody = rawFixture();
  const first = await ingestKhlEventDetail(prisma, {
    rawBody,
    sourceUrl: "https://khl.api.webcaster.pro/api/khl_mobile/event_v2.json?id=2986031&stage_id=395",
    fetchedAt: new Date("2026-08-20T12:00:00.000Z"),
  });

  assert.equal(first.reusedSnapshot, false);
  assert.equal(first.reusedRevision, false);
  assert.equal(first.activated, true);
  assert.equal(first.match.khlGameId, "901973");
  assert.equal(first.revision.state, "VALIDATED");
  assert.equal(first.match.activeRevisionId, first.revision.id);
  assert.equal(await prisma.khlTeam.count(), 2);
  assert.equal(await prisma.khlPlayer.count(), 43);
  assert.equal(await prisma.khlMatchParticipant.count(), 43);
  assert.equal(await prisma.khlRawSnapshot.count(), 1);
  assert.equal(await prisma.khlMatchRevision.count(), 1);

  const participant = await prisma.khlMatchParticipant.findFirstOrThrow({
    where: { matchId: first.match.id },
  });
  await prisma.$transaction([
    prisma.khlTeam.update({
      where: { id: first.match.homeTeamId },
      data: {
        adminTeamId: "test-admin-team-persistent",
        adminBindingStatus: "CONFIRMED",
      },
    }),
    prisma.khlPlayer.update({
      where: { id: participant.playerId },
      data: {
        adminPlayerId: "test-admin-player-persistent",
        adminBindingStatus: "CONFIRMED",
      },
    }),
    prisma.khlMatchParticipant.update({
      where: { id: participant.id },
      data: {
        adminMatchPlayerId: "test-admin-match-player-persistent",
        adminBindingStatus: "CONFIRMED",
      },
    }),
  ]);

  const repeated = await ingestKhlEventDetail(prisma, {
    rawBody,
    sourceUrl: "https://khl.api.webcaster.pro/api/khl_mobile/event_v2.json?id=2986031&stage_id=395",
    fetchedAt: new Date("2026-08-20T12:01:00.000Z"),
  });
  assert.equal(repeated.reusedSnapshot, true);
  assert.equal(repeated.reusedRevision, true);
  assert.equal(repeated.activated, false);
  assert.equal(await prisma.khlRawSnapshot.count(), 1);
  assert.equal(await prisma.khlMatchRevision.count(), 1);
  const [storedTeam, storedPlayer, storedParticipant] = await Promise.all([
    prisma.khlTeam.findUniqueOrThrow({ where: { id: first.match.homeTeamId } }),
    prisma.khlPlayer.findUniqueOrThrow({ where: { id: participant.playerId } }),
    prisma.khlMatchParticipant.findUniqueOrThrow({ where: { id: participant.id } }),
  ]);
  assert.equal(storedTeam.adminTeamId, "test-admin-team-persistent");
  assert.equal(storedTeam.adminBindingStatus, "CONFIRMED");
  assert.equal(storedPlayer.adminPlayerId, "test-admin-player-persistent");
  assert.equal(storedPlayer.adminBindingStatus, "CONFIRMED");
  assert.equal(storedParticipant.adminMatchPlayerId, "test-admin-match-player-persistent");
  assert.equal(storedParticipant.adminBindingStatus, "CONFIRMED");

  const invalid = JSON.parse(rawBody);
  invalid.text_events = invalid.text_events.filter(
    (event: { text?: string }) => !event.text?.startsWith("Статистика 3-го периода:")
  );
  invalid.start_at += 60_000;
  replaceTeamReferences(invalid, invalid.team_a.id, 999_999_990);
  invalid.team_a.id = 999_999_990;
  invalid.team_a.khl_id = 999_999_991;
  const rejected = await ingestKhlEventDetail(prisma, {
    rawBody: JSON.stringify(invalid),
    sourceUrl: "https://khl.api.webcaster.pro/api/khl_mobile/event_v2.json?id=2986031&stage_id=395",
    fetchedAt: new Date("2026-08-20T12:02:00.000Z"),
  });
  assert.equal(rejected.activated, false);
  assert.equal(rejected.revision.state, "REJECTED");
  assert.equal(rejected.match.activeRevisionId, first.revision.id);
  assert.equal(rejected.match.startsAt.toISOString(), first.match.startsAt.toISOString());
  assert.equal(rejected.match.homeTeamId, first.match.homeTeamId);
  assert.equal(rejected.match.awayTeamId, first.match.awayTeamId);
  assert.equal(await prisma.khlRawSnapshot.count(), 2);
  assert.equal(await prisma.khlMatchRevision.count(), 2);
});

test("new validated source facts create and atomically activate a revision", async () => {
  const raw = JSON.parse(rawFixture());
  const period = raw.text_events.find(
    (event: { text?: string }) => event.text?.startsWith("Статистика 3-го периода:")
  );
  period.text = period.text.replace("Броски в створ: 14-7", "Броски в створ: 15-7");
  raw.team_a.shots = 29;

  const result = await ingestKhlEventDetail(prisma, {
    rawBody: JSON.stringify(raw),
    sourceUrl: "https://khl.api.webcaster.pro/api/khl_mobile/event_v2.json?id=2986031&stage_id=395",
    fetchedAt: new Date("2026-08-20T12:03:00.000Z"),
  });

  assert.equal(result.activated, true);
  assert.equal(result.revision.state, "VALIDATED");
  assert.equal(result.revision.revisionNumber, 3);
  assert.equal(result.match.activeRevisionId, result.revision.id);
  assert.equal(await prisma.khlMatchRevision.count(), 3);
});

test("real missing-player IDs retain raw and a complete rejected diagnostic revision without activating players", async () => {
  const rawBody = readFileSync(join(process.cwd(), "tests/fixtures/khl/missing-player-ids-901981.json"), "utf8");
  const input = {
    rawBody,
    sourceUrl: "https://khl.api.webcaster.pro/api/khl_mobile/event_v2.json?id=3000063&stage_id=407",
    expectedIdentity: { khlGameId: "901981", apiEventId: "3000063", stageId: "407" },
    requireFinished: true,
  };
  const playersBefore = await prisma.khlPlayer.count();
  const first = await ingestKhlEventDetail(prisma, input);
  assert.equal(first.revision.state, "REJECTED");
  assert.equal(first.match.activeRevisionId, null);
  assert.equal(first.normalized.players.length, 47);
  assert.equal(first.normalized.players.filter((player) => player.khlPlayerId === null).length, 5);
  assert.deepEqual(first.snapshot.rawBody, Buffer.from(rawBody));
  assert.equal(await prisma.khlPlayer.count(), playersBefore);
  assert.equal(await prisma.khlMatchParticipant.count({ where: { matchId: first.match.id } }), 0);
  const second = await ingestKhlEventDetail(prisma, input);
  assert.equal(second.revision.id, first.revision.id);
  assert.equal(second.snapshot.id, first.snapshot.id);
  assert.equal(second.reusedRevision, true);
  assert.equal(second.activated, false);
});

test("a corrected source ID activates the whole roster without replacing existing confirmed player mappings", async () => {
  const raw = JSON.parse(rawFixture());
  // A distinct test-only match; player IDs come unchanged from the real regulation fixture.
  raw.khl_id = 999000001;
  raw.id = 999000003;
  raw.match_id = "test-corrected-roster";
  const expected = raw.team_a.players[0].khl_id;
  const existing = await prisma.khlPlayer.findUniqueOrThrow({ where: { khlPlayerId: String(expected) } });
  await prisma.khlPlayer.update({ where: { id: existing.id }, data: {
    adminPlayerId: "test-persistent-corrected-roster", adminBindingStatus: "CONFIRMED",
  } });
  raw.team_a.players[0].khl_id = 0;
  const base = { sourceUrl: "https://khl.api.webcaster.pro/api/khl_mobile/event_v2.json?id=999000003&stage_id=395" };
  const rejected = await ingestKhlEventDetail(prisma, { ...base, rawBody: JSON.stringify(raw) });
  assert.equal(rejected.revision.state, "REJECTED");
  assert.equal(rejected.match.activeRevisionId, null);
  raw.team_a.players[0].khl_id = expected;
  const corrected = await ingestKhlEventDetail(prisma, { ...base, rawBody: JSON.stringify(raw) });
  assert.equal(corrected.revision.state, "VALIDATED");
  assert.equal(corrected.activated, true);
  assert.equal(await prisma.khlMatchParticipant.count({ where: { matchId: corrected.match.id, isListed: true } }), 43);
  const saved = await prisma.khlPlayer.findUniqueOrThrow({ where: { id: existing.id } });
  assert.equal(saved.adminPlayerId, "test-persistent-corrected-roster");
  assert.equal(saved.adminBindingStatus, "CONFIRMED");
});

test("hard schema failures persist idempotent unassociated raw evidence, with no partial match/player mutation", async () => {
  const raw = JSON.parse(rawFixture());
  raw.khl_id = 999000002;
  delete raw.team_a.players[0].name;
  const rawBody = ` ${JSON.stringify(raw)}\n`;
  const before = await prisma.khlPlayer.count();
  const input = {
    rawBody,
    sourceUrl: "https://khl.api.webcaster.pro/api/khl_mobile/event_v2.json?id=2986031&stage_id=395",
    expectedIdentity: { khlGameId: "999000002", apiEventId: "2986031", stageId: "395" },
  };
  await assert.rejects(ingestKhlEventDetail(prisma, input), /player name/);
  await assert.rejects(ingestKhlEventDetail(prisma, input), /player name/);
  const snapshots = await prisma.khlRawSnapshot.findMany({ where: { externalKey: "999000002" } });
  assert.equal(snapshots.length, 1);
  assert.deepEqual(snapshots[0].rawBody, Buffer.from(rawBody));
  assert.equal(snapshots[0].fetchCount, 2);
  assert.equal(snapshots[0].matchId, null);
  assert.equal(await prisma.khlMatch.count({ where: { khlGameId: "999000002" } }), 0);
  assert.equal(await prisma.khlPlayer.count(), before);
});

test("lost sync lease prevents normal ingestion before any database projection is changed", async () => {
  const snapshotsBefore = await prisma.khlRawSnapshot.count();
  await assert.rejects(ingestKhlEventDetail(prisma, {
    rawBody: rawFixture(),
    sourceUrl: "https://khl.api.webcaster.pro/api/khl_mobile/event_v2.json?id=2986031&stage_id=395",
    assertCanWrite: async () => { throw new Error("test lease lost"); },
  }), /test lease lost/);
  assert.equal(await prisma.khlRawSnapshot.count(), snapshotsBefore);
});
