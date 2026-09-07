import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import { ingestKhlEventDetail } from "../backend/src/results/khl/repository";
import { KhlApiClient } from "../backend/src/sources/results/khl/client";
import { requireIsolatedKhlDatabaseUrl } from "./helpers/isolatedKhlDatabase";

if (process.env.ALLOW_KHL_LIVE_VERIFY !== "1") {
  throw new Error("Set ALLOW_KHL_LIVE_VERIFY=1 for isolated live verification.");
}
const databaseUrl = requireIsolatedKhlDatabaseUrl(
  process.env.TEST_DATABASE_URL,
  "TEST_DATABASE_URL"
);

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const client = new KhlApiClient();

  try {
  const stages = await client.listStages();
  assert.ok(stages.some((stage) => stage.stageId === "395"), "KHL stage 395 is missing");

  const events = await client.listEvents({
    stageId: "395",
    from: new Date("2026-05-21T00:00:00.000Z"),
    to: new Date("2026-05-22T00:00:00.000Z"),
  });
  const event = events.find((candidate) => candidate.khlGameId === "901973");
  assert.ok(event, "Expected KHL game 901973 was not returned by live schedule");
  assert.equal(event.status, "finished");

  const envelope = await client.getEventDetailEnvelope({
    apiEventId: event.apiEventId,
    stageId: event.stageId,
  });
  assert.ok(envelope.rawBody.includes('"event"'));
  const first = await ingestKhlEventDetail(prisma, {
    rawBody: envelope.rawBody,
    rawBytes: envelope.rawBytes,
    sourceUrl: envelope.sourceUrl,
    fetchedAt: envelope.fetchedAt,
    contentType: envelope.contentType || undefined,
  });
  const repeated = await ingestKhlEventDetail(prisma, {
    rawBody: envelope.rawBody,
    rawBytes: envelope.rawBytes,
    sourceUrl: envelope.sourceUrl,
    fetchedAt: new Date(envelope.fetchedAt.getTime() + 1_000),
    contentType: envelope.contentType || undefined,
  });

  assert.equal(first.normalized.identity.khlGameId, "901973");
  assert.equal(first.normalized.validation.ok, true);
  assert.equal(first.normalized.players.length, 43);
  assert.equal(repeated.reusedSnapshot, true);
  assert.equal(repeated.reusedRevision, true);
  assert.equal(repeated.activated, false);
  assert.equal(first.normalizedHash, repeated.normalizedHash);
  const exactBytes = envelope.rawBytes ?? Buffer.from(envelope.rawBody, "utf8");
  const rawHash = createHash("sha256").update(exactBytes).digest("hex");
  const snapshot = await prisma.khlRawSnapshot.findUniqueOrThrow({ where: { id: first.snapshot.id } });
  assert.equal(snapshot.contentHash, rawHash);
  assert.deepEqual(snapshot.rawBody, exactBytes);

  console.log(JSON.stringify({
    ok: true,
    source: "khl.api.webcaster.pro",
    stageId: event.stageId,
    apiEventId: event.apiEventId,
    khlGameId: event.khlGameId,
    officialScore: first.normalized.scores.official,
    regulationScore: first.normalized.scores.regulation,
    players: first.normalized.players.length,
    normalizedHash: first.normalizedHash,
    rawHash,
    exactRawBytes: exactBytes.length,
    repeated: {
      reusedSnapshot: repeated.reusedSnapshot,
      reusedRevision: repeated.reusedRevision,
      activated: repeated.activated,
    },
  }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
