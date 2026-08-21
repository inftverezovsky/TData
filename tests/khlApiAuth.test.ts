import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { createAdminSessionResponse } from "../backend/src/auth/adminAuth";
import { GET as getDiff } from "../frontend/src/app/api/results/khl/diff/route";
import { POST as postStageDelivery } from "../frontend/src/app/api/results/khl/delivery/stage/route";
import { GET as getSchedule } from "../frontend/src/app/api/results/khl/schedule/route";
import { GET as getStages } from "../frontend/src/app/api/results/khl/stages/route";
import { POST as postIngest } from "../frontend/src/app/api/results/khl/ingest/route";

const routesRoot = join(process.cwd(), "frontend", "src", "app", "api", "results", "khl");

test("every KHL operational route has a server-side admin guard", () => {
  const routeFiles = collectRouteFiles(routesRoot);
  assert.ok(routeFiles.length >= 3);
  const unguarded = routeFiles
    .filter((path) => !/\brequireAdmin\s*\(/.test(readFileSync(path, "utf8")))
    .map((path) => path.slice(routesRoot.length + 1));
  assert.deepEqual(unguarded, []);

  const unsafeMutationRoutes = routeFiles
    .filter((path) => /export async function POST\s*\(/.test(readFileSync(path, "utf8")))
    .filter((path) => !/\brequireSameOriginJsonMutation\s*\(/.test(readFileSync(path, "utf8")))
    .map((path) => path.slice(routesRoot.length + 1));
  assert.deepEqual(unsafeMutationRoutes, []);
});

test("KHL API handlers reject unauthenticated requests before validation or network access", async () => {
  const stages = await getStages(new Request("http://localhost/api/results/khl/stages"));
  assert.equal(stages.status, 401);

  const schedule = await getSchedule(
    new Request("http://localhost/api/results/khl/schedule?stageId=395")
  );
  assert.equal(schedule.status, 401);

  const diff = await getDiff(
    new Request("http://localhost/api/results/khl/diff?khlGameId=not-valid")
  );
  assert.equal(diff.status, 401);

  const stageDelivery = await postStageDelivery(
    new Request("http://localhost/api/results/khl/delivery/stage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    })
  );
  assert.equal(stageDelivery.status, 401);

  const ingest = await postIngest(new Request("http://localhost/api/results/khl/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "not-json",
  }));
  assert.equal(ingest.status, 401);
});

test("authenticated KHL mutations require same-origin JSON requests", async () => {
  const previousPassword = process.env.ADMIN_PASSWORD;
  const previousSecret = process.env.ADMIN_SESSION_SECRET;
  process.env.ADMIN_PASSWORD = "khl-auth-test-password";
  process.env.ADMIN_SESSION_SECRET = "khl-auth-test-session-secret";
  try {
    const session = await createAdminSessionResponse();
    const cookie = session.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(cookie);

    const crossOrigin = await postIngest(new Request("http://localhost/api/results/khl/ingest", {
      method: "POST",
      headers: {
        cookie,
        origin: "https://attacker.example",
        "content-type": "application/json",
      },
      body: "{}",
    }));
    assert.equal(crossOrigin.status, 403);

    const nonJson = await postIngest(new Request("http://localhost/api/results/khl/ingest", {
      method: "POST",
      headers: {
        cookie,
        origin: "http://localhost",
        "content-type": "text/plain",
      },
      body: "{}",
    }));
    assert.equal(nonJson.status, 415);

    const sameOriginJson = await postIngest(new Request("http://localhost/api/results/khl/ingest", {
      method: "POST",
      headers: {
        cookie,
        origin: "http://localhost",
        "content-type": "application/json; charset=utf-8",
      },
      body: "{}",
    }));
    assert.equal(sameOriginJson.status, 400);
  } finally {
    restoreEnvironment("ADMIN_PASSWORD", previousPassword);
    restoreEnvironment("ADMIN_SESSION_SECRET", previousSecret);
  }
});

function collectRouteFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectRouteFiles(path);
    return entry.isFile() && entry.name === "route.ts" ? [path] : [];
  });
}

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
