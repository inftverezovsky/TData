import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { GET } from "../frontend/src/app/api/cron/check-proxies/route";
import { listenLocally } from "./helpers/localHttpServer";
import { createAdminSessionResponse } from "../backend/src/auth/adminAuth";

test("cron rejects a cross-origin cookie request before checking proxies", async (t) => {
  const keys = ["CRON_PROXY_CHECK_SECRET", "ADMIN_PASSWORD", "ADMIN_SESSION_SECRET"] as const;
  const previous = keys.map((key) => process.env[key]);
  delete process.env.CRON_PROXY_CHECK_SECRET;
  process.env.ADMIN_PASSWORD = "local-password-fixture";
  process.env.ADMIN_SESSION_SECRET = "local-session-fixture";
  t.after(() => keys.forEach((key, index) => {
    if (previous[index] === undefined) delete process.env[key];
    else process.env[key] = previous[index];
  }));
  const runtime = globalThis as typeof globalThis & { prisma?: PrismaClient };
  const previousClient = runtime.prisma;
  let reads = 0;
  runtime.prisma = { proxyPool: { findMany: async () => { reads += 1; return []; } } } as unknown as PrismaClient;
  t.after(() => { runtime.prisma = previousClient; });
  const session = await createAdminSessionResponse();
  const response = await GET(new Request("http://localhost/api/cron/check-proxies", {
    headers: { Cookie: session.headers.get("set-cookie")!.split(";")[0], Origin: "https://untrusted.invalid" },
  }));
  assert.equal(response.status, 403);
  assert.equal(reads, 0);
});

test("cron checks the configured proxy tunnel and deactivates its third real failure", async (t) => {
  const secretBefore = process.env.CRON_PROXY_CHECK_SECRET;
  process.env.CRON_PROXY_CHECK_SECRET = "local-cron-fixture";
  t.after(() => {
    if (secretBefore === undefined) delete process.env.CRON_PROXY_CHECK_SECRET;
    else process.env.CRON_PROXY_CHECK_SECRET = secretBefore;
  });
  let tunnels = 0;
  const proxyServer = http.createServer();
  proxyServer.on("connect", (_request, socket) => {
    tunnels += 1;
    socket.end("HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n");
  });
  const proxyPort = await listenLocally(t, proxyServer);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Direct fetch is prohibited in this local test."); });
  const fixture = {
    id: "proxy-fixture", url: `http://127.0.0.1:${proxyPort}`, host: "127.0.0.1",
    port: proxyPort, failCount: 2, isActive: true,
  };
  const updates: unknown[] = [];
  const runtime = globalThis as typeof globalThis & { prisma?: PrismaClient };
  const previousClient = runtime.prisma;
  runtime.prisma = {
    proxyPool: {
      findMany: async () => [fixture],
      update: async (input: unknown) => { updates.push(input); return fixture; },
    },
  } as unknown as PrismaClient;
  t.after(() => { runtime.prisma = previousClient; });

  const response = await GET(new Request("http://localhost/api/cron/check-proxies", {
    headers: { Authorization: "Bearer local-cron-fixture" },
  }));
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(tunnels, 1);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], {
    where: { id: fixture.id },
    data: { failCount: 3, isActive: false, lastError: "Proxy target HTTP 407", lastUsed: (updates[0] as { data: { lastUsed: Date } }).data.lastUsed },
  });
  assert.match(data.summary, /Failed: 1, Deactivated: 1/);
});
