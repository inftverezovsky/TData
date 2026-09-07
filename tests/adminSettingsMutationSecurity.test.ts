import assert from "node:assert/strict";
import test from "node:test";
import { createAdminSessionResponse } from "../backend/src/auth/adminAuth";
import { POST as disciplineSettings } from "../frontend/src/app/api/admin-settings/[disciplineSlug]/route";
import { POST as proxySettings } from "../frontend/src/app/api/admin-settings/proxy-pool/route";
import { POST as proxies } from "../frontend/src/app/api/admin/proxies/route";
import { POST as sandbox } from "../frontend/src/app/api/admin/sandbox/route";
import { POST as globalSettings } from "../frontend/src/app/api/settings/global/route";
import { POST as settings } from "../frontend/src/app/api/settings/route";

const mutations = [
  { path: "admin-settings/dota2", handler: (request: Request) => disciplineSettings(request, { params: Promise.resolve({ disciplineSlug: "dota2" }) }) },
  { path: "admin-settings/proxy-pool", handler: proxySettings },
  { path: "admin/proxies", handler: proxies },
  { path: "admin/sandbox", handler: sandbox },
  { path: "settings/global", handler: globalSettings },
  { path: "settings", handler: settings },
];

for (const mutation of mutations) {
  test(`${mutation.path} rejects unsafe authenticated mutations before reading their body`, async (context) => {
    const previousPassword = process.env.ADMIN_PASSWORD;
    const previousSecret = process.env.ADMIN_SESSION_SECRET;
    process.env.ADMIN_PASSWORD = "mutation-security-test-password";
    process.env.ADMIN_SESSION_SECRET = "mutation-security-test-signing-key";
    context.mock.method(console, "error", () => {});
    try {
      const session = await createAdminSessionResponse();
      const cookie = session.headers.get("set-cookie")!.split(";", 1)[0];
      for (const scenario of [
        { origin: "https://other.example", contentType: "application/json", status: 403 },
        { origin: "https://tdata.example", contentType: "text/plain", status: 415 },
      ]) {
        const response = await mutation.handler(new Request(`https://tdata.example/api/${mutation.path}`, {
          method: "POST",
          headers: { cookie, origin: scenario.origin, "content-type": scenario.contentType },
          // Invalid JSON guarantees an unguarded baseline cannot reach the database or an integration.
          body: "not-json",
        }));
        assert.equal(response.status, scenario.status);
      }
    } finally {
      restoreEnv("ADMIN_PASSWORD", previousPassword);
      restoreEnv("ADMIN_SESSION_SECRET", previousSecret);
    }
  });
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
