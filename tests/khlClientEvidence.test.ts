import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { KhlApiClient } from "../backend/src/sources/results/khl/client";
import { ingestKhlEventDetail } from "../backend/src/results/khl/repository";

const request = { apiEventId: "3000063", stageId: "407" };
function clientWithBytes(bytes: Uint8Array) {
  return new KhlApiClient({ fetchImpl: async () => new Response(Buffer.from(bytes), {
    status: 200, headers: { "content-type": "application/json" },
  }) });
}
function evidencePrisma(writes: Array<Record<string, unknown>>) {
  const tx = { khlRawSnapshot: {
    async upsert(input: { create: Record<string, unknown> }) { writes.push(input.create); return input.create; },
  } };
  return { $transaction: async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx) } as unknown as PrismaClient;
}

test("malformed 2xx detail JSON and wrappers reach evidence persistence through the real client boundary", async () => {
  for (const body of ["{broken", '{"unexpected":[]}']) {
    const raw = Buffer.from(body);
    const envelope = await clientWithBytes(raw).getEventDetailEnvelope(request);
    assert.equal(envelope.event, null);
    const writes: Array<Record<string, unknown>> = [];
    await assert.rejects(ingestKhlEventDetail(evidencePrisma(writes), {
      ...envelope, contentType: envelope.contentType || undefined, expectedIdentity: request,
    }), /JSON|KHL event|KHL start_at/);
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].rawBody, raw);
    assert.equal(writes[0].externalKey, "api-event:3000063");
    await assert.rejects(clientWithBytes(raw).getEventDetail(request), /JSON|wrapper/);
  }
});

test("invalid UTF-8 retains and hashes the exact response bytes without replacement-character reencoding", async () => {
  const raw = Buffer.concat([Buffer.from('{"event":{"name":"'), Buffer.from([0xff]), Buffer.from('"}}')]);
  const envelope = await clientWithBytes(raw).getEventDetailEnvelope(request);
  assert.deepEqual(envelope.rawBytes, raw);
  assert.equal(envelope.event, null);
  await assert.rejects(clientWithBytes(raw).getEventDetail(request), /JSON|wrapper/);
  const writes: Array<Record<string, unknown>> = [];
  await assert.rejects(ingestKhlEventDetail(evidencePrisma(writes), {
    ...envelope, contentType: envelope.contentType || undefined, expectedIdentity: request,
  }), /UTF-8/);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].rawBody, raw);
  assert.equal(writes[0].contentHash, createHash("sha256").update(raw).digest("hex"));
});

test("raw text and byte disagreement is refused before evidence or projection writes", async () => {
  const writes: Array<Record<string, unknown>> = [];
  await assert.rejects(ingestKhlEventDetail(evidencePrisma(writes), {
    rawBody: "{modified", rawBytes: Buffer.from("{original"),
    sourceUrl: "https://khl.api.webcaster.pro/api/khl_mobile/event_v2.json?id=3000063&stage_id=407",
    expectedIdentity: request,
  }), /raw text and bytes/);
  assert.equal(writes.length, 0);
});
