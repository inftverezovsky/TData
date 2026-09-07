import test from "node:test";
import assert from "node:assert/strict";
import { authenticatedRequest } from "../frontend/src/services/authenticatedRequest";

test("authenticated send retries the same selected payload once after login", async () => {
  const init = { method: "POST", body: JSON.stringify({ selectedMatchIds: ["selected-only"] }) };
  let calls = 0;
  let logins = 0;
  const response = await authenticatedRequest("/api/example/admin-fixt-send", init, async () => { logins += 1; return true; }, async (url, options) => {
    assert.equal(url, "/api/example/admin-fixt-send");
    assert.equal(options, init);
    calls += 1;
    return Response.json(calls === 1 ? { error: "Unauthorized" } : { ok: true }, { status: calls === 1 ? 401 : 200 });
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  assert.equal(logins, 1);
});

test("cancelled login and repeated 401 never loop or send again indefinitely", async () => {
  for (const allowLogin of [false, true]) {
    let calls = 0;
    const response = await authenticatedRequest("/api/send", {}, async () => allowLogin, async () => {
      calls += 1;
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    });
    assert.equal(response.status, 401);
    assert.equal(calls, allowLogin ? 2 : 1);
  }
});

test("already authorized requests and ambiguous server failures never trigger login or retry", async () => {
  for (const status of [200, 403, 429, 500]) {
    let calls = 0;
    const response = await authenticatedRequest("/api/send", {}, async () => { assert.fail("Login must not be requested"); }, async () => {
      calls += 1;
      return Response.json({}, { status });
    });
    assert.equal(response.status, status);
    assert.equal(calls, 1);
  }
});
