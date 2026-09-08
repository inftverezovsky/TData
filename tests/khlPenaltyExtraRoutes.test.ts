import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { GET, POST } from "../frontend/src/app/api/results/khl/bindings/penalty-extra/route";

function request(body: unknown, origin = "http://localhost", contentType = "application/json") {
  return new Request("http://localhost/api/results/khl/bindings/penalty-extra", {
    method: "POST", headers: { origin, "content-type": contentType }, body: JSON.stringify(body),
  });
}

test("penalty extra route rejects unsafe and invalid mutations before DB access", async () => {
  assert.equal((await POST(request({}, "https://untrusted.example"))).status, 403);
  assert.equal((await POST(request({}, "http://localhost", "text/plain"))).status, 415);
  for (const body of [null, [], {}, { extraCode: "unknown", adminExtraId: "id" },
    { extraCode: "first_penalty_team", adminExtraId: 1 },
    { extraCode: "first_penalty_team", adminExtraId: "id", confirmedBy: "forged" },
    { extraCode: "first_penalty_team", adminExtraId: "a b" }]) {
    assert.equal((await POST(request(body))).status, 400);
  }
  assert.equal((await POST(request({ other: "x".repeat(3000) }))).status, 413);
});

test("penalty extra GET exposes all seven definitions with their saved IDs", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previous = globals.prisma;
  globals.prisma = { khlPenaltyExtraBinding: { findMany: async () => [{
    extraCode: "first_penalty_team", adminExtraId: "saved-extra-id", adminBindingStatus: "CONFIRMED",
    adminConfirmedBy: "internal-operator",
  }] } } as unknown as PrismaClient;
  try {
    const response = await GET();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.bindings.length, 7);
    assert.equal(body.bindings[0].adminExtraId, "saved-extra-id");
    assert.equal(body.bindings[1].adminExtraId, null);
    assert.doesNotMatch(JSON.stringify(body), /internal-operator/);
  } finally { globals.prisma = previous; }
});
