import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../frontend/src/app/api/manual-import/arc-status/route";
import { POST as parseManualImport } from "../frontend/src/app/api/manual-import/parse/route";

test("ArcCodex health errors do not echo the upstream response body", async (context) => {
  const previous = process.env.ARCCODEX_API_KEY;
  process.env.ARCCODEX_API_KEY = "synthetic-fixture-only";
  context.after(() => {
    if (previous === undefined) delete process.env.ARCCODEX_API_KEY;
    else process.env.ARCCODEX_API_KEY = previous;
  });
  context.mock.method(globalThis, "fetch", async () => new Response("synthetic-sensitive-upstream-value", { status: 401 }));
  const response = await GET();
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.httpStatus, 401);
  assert.ok(!JSON.stringify(body).includes("synthetic-sensitive-upstream-value"));
});

test("manual AI fallback keeps parsed output but hides provider diagnostics", async (context) => {
  const previous = process.env.ARCCODEX_API_KEY;
  process.env.ARCCODEX_API_KEY = "synthetic-fixture-only";
  context.after(() => {
    if (previous === undefined) delete process.env.ARCCODEX_API_KEY;
    else process.env.ARCCODEX_API_KEY = previous;
  });
  context.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    error: { message: "synthetic-sensitive-provider-value" },
  }), { status: 401 }));
  const response = await parseManualImport(new Request("https://example.test/api/manual-import/parse", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "unstructured fixture", mode: "ai", fast: true }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.parseSource, "fallback");
  assert.ok(!JSON.stringify(body).includes("synthetic-sensitive-provider-value"));
  assert.ok(body.error);
});
