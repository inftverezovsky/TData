import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";
import { ingestKhlEventDetail } from "../backend/src/results/khl/repository";
import { acquireKhlDatabaseSuiteLock } from "./helpers/khlDatabaseSuiteLock";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for khlRepository.test.ts");
}

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
