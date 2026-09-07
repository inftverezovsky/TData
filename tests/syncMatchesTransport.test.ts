import assert from "node:assert/strict";
import dns from "node:dns/promises";
import http from "node:http";
import test, { type TestContext } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { POST } from "../frontend/src/app/api/sync-matches/route";
import { createAdminSessionResponse } from "../backend/src/auth/adminAuth";
import { listenLocally } from "./helpers/localHttpServer";

test("legacy sync pins its checked address and preserves JSON, Host and bearer credentials", async (t) => {
  const received: Array<{ host: string; authorization: string; body: string }> = [];
  const port = await listenLocally(t, http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      received.push({ host: request.headers.host ?? "", authorization: request.headers.authorization ?? "", body });
      response.end("ok");
    });
  }));
  const fixture = await setupSync(t, port);
  const response = await POST(fixture.request);
  assert.equal(response.status, 200);
  assert.equal(received.length, 1);
  assert.equal(received[0].host, `admin.test:${port}`);
  assert.equal(received[0].authorization, "Bearer local-api-key-fixture");
  assert.equal(JSON.parse(received[0].body).matches[0].externalId, "local-match");
  assert.equal(fixture.updates.length, 1);
});

test("legacy sync denies redirects and does not mark the matches synced", async (t) => {
  let forwarded = 0;
  const targetPort = await listenLocally(t, http.createServer((_request, response) => { forwarded += 1; response.end("unexpected"); }));
  const port = await listenLocally(t, http.createServer((_request, response) => {
    response.writeHead(307, { Location: `http://127.0.0.1:${targetPort}/redirect` }).end();
  }));
  const fixture = await setupSync(t, port);
  const response = await POST(fixture.request);
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /redirect/i);
  assert.equal(forwarded, 0);
  assert.equal(fixture.updates.length, 0);
});

async function setupSync(t: TestContext, port: number) {
  const values = {
    ADMIN_PASSWORD: "local-password-fixture", ADMIN_SESSION_SECRET: "local-session-fixture",
    EXTERNAL_PLATFORM_ALLOWED_HOSTS: "admin.test", EXTERNAL_PLATFORM_ALLOW_PRIVATE_HOSTS: "1",
    EXTERNAL_PLATFORM_ALLOW_INSECURE_HTTP: "1", NODE_ENV: "production",
  };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => Object.entries(previous).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }));
  // Only the policy resolver knows this local address. Native fetch is forbidden and cannot reach the network.
  t.mock.method(dns, "lookup", async () => [{ address: "127.0.0.1", family: 4 }]);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Unpinned fetch is prohibited."); });
  const updates: unknown[] = [];
  const runtime = globalThis as typeof globalThis & { prisma?: PrismaClient };
  const previousClient = runtime.prisma;
  runtime.prisma = {
    tournamentMatch: {
      findMany: async () => [{ id: "local-match", matchId: "local-fixture", teamAName: "Alpha", teamBName: "Beta", tournament: { name: "Local fixture" } }],
      updateMany: async (input: unknown) => { updates.push(input); return { count: 1 }; },
    },
    teamMapping: { findMany: async () => [
      { liquipediaName: "Alpha", platformId: "team-a" }, { liquipediaName: "Beta", platformId: "team-b" },
    ] },
    globalSettings: { findUnique: async ({ where }: { where: { key: string } }) => ({
      value: where.key === "external_platform_url" ? `http://admin.test:${port}/sync` : "local-api-key-fixture",
    }) },
  } as unknown as PrismaClient;
  t.after(() => { runtime.prisma = previousClient; });
  const session = await createAdminSessionResponse();
  return {
    updates,
    request: new Request("http://localhost/api/sync-matches", {
      method: "POST", body: JSON.stringify({ matchIds: ["local-match"], disciplineSlug: "dota2" }),
      headers: { Cookie: session.headers.get("set-cookie")!.split(";")[0], Origin: "http://localhost", "Content-Type": "application/json" },
    }),
  };
}
