import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { requireTLineAccess } from "../backend/src/tline/api/http";

const KHL_ROUTES = join(process.cwd(), "frontend", "src", "app", "api", "results", "khl");
const SANDBOX_ROUTE = join(process.cwd(), "frontend", "src", "app", "api", "admin", "sandbox", "route.ts");

test("TLine APIs are usable without the API-settings password", async () => {
  assert.equal(await requireTLineAccess(new Request("http://localhost/api/tline/sports")), null);

  const sameOrigin = await requireTLineAccess(new Request("http://localhost/api/tline/runs/manual", {
    method: "POST",
    headers: { origin: "http://localhost", "content-type": "application/json" },
  }), true);
  assert.equal(sameOrigin, null);

  const crossOrigin = await requireTLineAccess(new Request("http://localhost/api/tline/runs/manual", {
    method: "POST",
    headers: { origin: "https://attacker.example", "content-type": "application/json" },
  }), true);
  assert.equal(crossOrigin?.status, 403);
});

test("KHL and Sandbox operational APIs are public but mutations retain same-origin checks", () => {
  const operationalRoutes = [...collectRouteFiles(KHL_ROUTES), SANDBOX_ROUTE];
  for (const route of operationalRoutes) {
    const source = readFileSync(route, "utf8");
    assert.doesNotMatch(source, /\brequireAdmin\s*\(/, route);
    if (/export async function POST\s*\(/.test(source)) {
      assert.match(source, /\brequireSameOriginJsonMutation\s*\(/, route);
    }
  }
});

function collectRouteFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectRouteFiles(path);
    return entry.isFile() && entry.name === "route.ts" ? [path] : [];
  });
}
