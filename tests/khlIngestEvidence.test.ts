import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { ingestKhlEventDetail } from "../backend/src/results/khl/repository";

const expectedIdentity = { khlGameId: "901973", apiEventId: "2986031", stageId: "395" };
const sourceUrl = "https://khl.api.webcaster.pro/api/khl_mobile/event_v2.json?id=2986031&stage_id=395";
function source() {
  return JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/khl/regulation-901973.json"), "utf8"));
}
function evidencePrisma(writes: Array<Record<string, unknown>>) {
  const tx = {
    khlRawSnapshot: {
      async upsert(input: { create: Record<string, unknown> }) { writes.push(input.create); return input.create; },
    },
  };
  return { $transaction: async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx) } as unknown as PrismaClient;
}

test("a hard roster schema failure retains exact bytes and hash without making a normalized revision", async () => {
  const raw = source();
  delete raw.team_a.players[0].name;
  const rawBody = `  ${JSON.stringify(raw)}\n`;
  const writes: Array<Record<string, unknown>> = [];
  await assert.rejects(ingestKhlEventDetail(evidencePrisma(writes), {
    rawBody, sourceUrl, expectedIdentity, requireFinished: true,
  }), /player name/);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].rawBody, Buffer.from(rawBody));
  assert.equal(writes[0].contentHash, createHash("sha256").update(rawBody).digest("hex"));
  assert.equal(writes[0].externalKey, "901973");
  assert.equal(writes[0].matchId, undefined);
});

test("identity mismatch is retained as unassociated request evidence and never normalized", async () => {
  const raw = source();
  raw.khl_id = 999999;
  const writes: Array<Record<string, unknown>> = [];
  await assert.rejects(ingestKhlEventDetail(evidencePrisma(writes), {
    rawBody: JSON.stringify(raw), sourceUrl, expectedIdentity,
  }), /identity/);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].externalKey, "api-event:2986031");
  assert.equal(writes[0].matchId, undefined);
});

test("manual and automatic boundary reject unfinished or out-of-range data while retaining evidence", async () => {
  for (const mode of ["unfinished", "outside-range"] as const) {
    const raw = source();
    if (mode === "unfinished") raw.game_state_key = "in_progress";
    const writes: Array<Record<string, unknown>> = [];
    await assert.rejects(ingestKhlEventDetail(evidencePrisma(writes), {
      rawBody: JSON.stringify(raw), sourceUrl, expectedIdentity,
      requireFinished: true,
      allowedDateRange: { from: new Date(mode === "outside-range" ? "2027-01-01" : "2026-05-01") },
    }), /finished|range/);
    assert.equal(writes.length, 1);
  }
});

test("failed evidence cannot be committed after sync lease ownership is lost", async () => {
  const writes: Array<Record<string, unknown>> = [];
  await assert.rejects(ingestKhlEventDetail(evidencePrisma(writes), {
    rawBody: "{broken", sourceUrl, expectedIdentity,
    assertCanWrite: async () => { throw new Error("lease lost"); },
  }), /lease lost/);
  assert.equal(writes.length, 0);
});
