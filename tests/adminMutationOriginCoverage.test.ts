import assert from "node:assert/strict";
import test from "node:test";
import { createAdminSessionResponse } from "../backend/src/auth/adminAuth";
import { DELETE as deleteProxies } from "../frontend/src/app/api/admin/proxies/route";
import { DELETE as deleteProxySettings } from "../frontend/src/app/api/admin-settings/proxy-pool/route";
import { POST as identitySync } from "../frontend/src/app/api/admin-settings/identity-sync/route";
import { POST as hltvManual } from "../frontend/src/app/api/counterstrike/hltv/matches/manual/route";
import { POST as logout } from "../frontend/src/app/api/admin-auth/logout/route";

test("every remaining privileged mutation rejects cross-origin requests before its body or persistence", async (context) => {
  const previousPassword = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = "mutation-origin-test-password";
  context.mock.method(console, "error", () => {});
  try {
    const session = await createAdminSessionResponse();
    const cookie = session.headers.get("set-cookie")!.split(";", 1)[0];
    for (const handler of [deleteProxies, deleteProxySettings, identitySync, hltvManual, logout]) {
      const response = await handler(new Request("https://tdata.example/api/test", {
        method: handler === deleteProxies || handler === deleteProxySettings ? "DELETE" : "POST",
        headers: { cookie, origin: "https://other.example", "content-type": "application/json" }, body: "not-json",
      }));
      assert.equal(response.status, 403);
    }
  } finally {
    if (previousPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousPassword;
  }
});
