import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { POST } from "../src/app/api/settings/clear-search-cache/route";
import { createAdminSessionResponse } from "../src/lib/auth/adminAuth";

test("clear search cache endpoint clears scoped cache without requiring an admin session", async () => {
  const cacheDir = path.join(process.cwd(), "cache", "hltv", "authless-route-test");
  const cacheFile = path.join(cacheDir, "one.json");
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cacheFile, "{}");

  const response = await POST(new Request("http://localhost/api/settings/clear-search-cache", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: "hltv", disciplineSlug: "authless-route-test" }),
  }));
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.deletedCount, 1);
  assert.equal(fs.existsSync(cacheFile), false);

  fs.rmSync(cacheDir, { recursive: true, force: true });
});

test("clear search cache rejects path traversal discipline scopes", async () => {
  const cookie = await getAdminSessionCookie();
  const response = await POST(new Request("http://localhost/api/settings/clear-search-cache", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ source: "hltv", disciplineSlug: "../vlr" }),
  }));
  const data = await response.json();

  assert.equal(response.status, 400);
  assert.equal(data.ok, false);
});

async function getAdminSessionCookie() {
  const response = await createAdminSessionResponse();
  return response.headers.get("set-cookie")?.split(";")[0] || "";
}
