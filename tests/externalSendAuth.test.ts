import assert from "node:assert/strict";
import test from "node:test";
import { createAdminSessionResponse } from "../backend/src/auth/adminAuth";
import { POST as manualSend } from "../frontend/src/app/api/manual-import/send/route";
import { POST as hltvSend } from "../frontend/src/app/api/counterstrike/hltv/admin-send/route";
import { POST as syncMatches } from "../frontend/src/app/api/sync-matches/route";
import { POST as tournamentSend } from "../frontend/src/app/api/[disciplineSlug]/tournament/[id]/admin-fixt-send/route";

const handlers = [manualSend, hltvSend, syncMatches, (request: Request) => tournamentSend(request, {
  params: Promise.resolve({ disciplineSlug: "dota2", id: "test-tournament" }),
})];

test("all external send handlers reject unauthenticated calls before parsing or external side effects", async (context) => {
  context.mock.method(console, "error", () => {});
  for (const handler of handlers) {
    const response = await handler(new Request("https://tdata.example/api/send", { method: "POST", body: "not-json" }));
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, "AUTH_REQUIRED");
  }
});

test("external sends require same-origin JSON after session authentication", async (context) => {
  const previousPassword = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = "external-send-test-password";
  context.mock.method(console, "error", () => {});
  try {
    const session = await createAdminSessionResponse();
    const cookie = session.headers.get("set-cookie")!.split(";", 1)[0];
    for (const handler of handlers) {
      const response = await handler(new Request("https://tdata.example/api/send", {
        method: "POST", headers: { cookie, origin: "https://other.example", "content-type": "application/json" }, body: "not-json",
      }));
      assert.equal(response.status, 403);
    }
  } finally {
    if (previousPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousPassword;
  }
});
