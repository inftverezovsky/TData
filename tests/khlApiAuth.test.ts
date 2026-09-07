import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { POST as postAutomation } from "../frontend/src/app/api/results/khl/automation/route";
import { POST as postStatTypeBinding } from "../frontend/src/app/api/results/khl/bindings/stat-types/route";
import { POST as postTeamStatBinding } from "../frontend/src/app/api/results/khl/bindings/team-stats/route";
import { POST as postPlayerExtraBinding } from "../frontend/src/app/api/results/khl/bindings/player-extra/route";
import { POST as postIngest } from "../frontend/src/app/api/results/khl/ingest/route";

const routesRoot = join(process.cwd(), "frontend", "src", "app", "api", "results", "khl");

test("KHL operational routes are public and every mutation keeps same-origin validation", () => {
  const routeFiles = collectRouteFiles(routesRoot);
  assert.ok(routeFiles.length >= 3);

  const guarded = routeFiles
    .filter((path) => /\brequireAdmin\s*\(/.test(readFileSync(path, "utf8")))
    .map((path) => path.slice(routesRoot.length + 1));
  assert.deepEqual(guarded, []);

  const unsafeMutationRoutes = routeFiles
    .filter((path) => /export async function POST\s*\(/.test(readFileSync(path, "utf8")))
    .filter((path) => !/\brequireSameOriginJsonMutation\s*\(/.test(readFileSync(path, "utf8")))
    .map((path) => path.slice(routesRoot.length + 1));
  assert.deepEqual(unsafeMutationRoutes, []);
});

test("public KHL mutations reject cross-origin and non-JSON requests", async () => {
  const crossOrigin = await postIngest(new Request("http://localhost/api/results/khl/ingest", {
    method: "POST",
    headers: { origin: "https://attacker.example", "content-type": "application/json" },
    body: "{}",
  }));
  assert.equal(crossOrigin.status, 403);

  const nonJson = await postIngest(new Request("http://localhost/api/results/khl/ingest", {
    method: "POST",
    headers: { origin: "http://localhost", "content-type": "text/plain" },
    body: "{}",
  }));
  assert.equal(nonJson.status, 415);

  const crossOriginStatTypes = await postStatTypeBinding(new Request(
    "http://localhost/api/results/khl/bindings/stat-types",
    {
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body: "{}",
    }
  ));
  assert.equal(crossOriginStatTypes.status, 403);

  const crossOriginTeamStats = await postTeamStatBinding(new Request(
    "http://localhost/api/results/khl/bindings/team-stats",
    {
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body: "{}",
    }
  ));
  assert.equal(crossOriginTeamStats.status, 403);

  const crossOriginPlayerExtra = await postPlayerExtraBinding(new Request(
    "http://localhost/api/results/khl/bindings/player-extra",
    {
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body: "{}",
    }
  ));
  assert.equal(crossOriginPlayerExtra.status, 403);
});

test("same-origin KHL mutations continue to validate payloads and limits", async () => {
  const oversizedStatTypes = await postStatTypeBinding(new Request(
    "http://localhost/api/results/khl/bindings/stat-types",
    {
      method: "POST",
      headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(20_000) }),
    }
  ));
  assert.equal(oversizedStatTypes.status, 413);

  const oversizedPlayerExtra = await postPlayerExtraBinding(new Request(
    "http://localhost/api/results/khl/bindings/player-extra",
    {
      method: "POST",
      headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(20_000) }),
    }
  ));
  assert.equal(oversizedPlayerExtra.status, 413);

  const unknownPlayerExtraField = await postPlayerExtraBinding(new Request(
    "http://localhost/api/results/khl/bindings/player-extra",
    {
      method: "POST",
      headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ unexpected: true }),
    }
  ));
  assert.equal(unknownPlayerExtraField.status, 400);

  const sameOriginJson = await postIngest(new Request("http://localhost/api/results/khl/ingest", {
    method: "POST",
    headers: { origin: "http://localhost", "content-type": "application/json; charset=utf-8" },
    body: "{}",
  }));
  assert.equal(sameOriginJson.status, 400);

  const invalidAutomation = await postAutomation(new Request(
    "http://localhost/api/results/khl/automation",
    {
      method: "POST",
      headers: { origin: "http://localhost", "content-type": "application/json" },
      body: "{}",
    }
  ));
  assert.equal(invalidAutomation.status, 400);
});

function collectRouteFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectRouteFiles(path);
    return entry.isFile() && entry.name === "route.ts" ? [path] : [];
  });
}
