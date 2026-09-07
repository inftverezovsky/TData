import assert from "node:assert/strict";
import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import test, { type TestContext } from "node:test";
import { sendFixtPayload } from "../backend/src/adminUpload/sendFixtPayload";
import { sendPinnedAdminRequest } from "../backend/src/adminUpload/pinnedTransport";
import { createEphemeralCertificate, listenLocally } from "./helpers/localHttpServer";

test("Admin sends to the checked IP without a second DNS lookup and preserves Host", async (t) => {
  configureLocalAdmin(t);
  const dnsCalls = simulateRebinding(t);
  const received: string[] = [];
  const port = await listenLocally(t, http.createServer((request, response) => {
    received.push(request.headers.host || "");
    response.end("1");
  }));

  const result = await sendFixtPayload(`http://admin.test:${port}/fixt`, "sample");

  assert.equal(result.status, "success_like", result.errorMessage);
  assert.deepEqual(received, [`admin.test:${port}`]);
  assert.deepEqual(dnsCalls, { checked: 1, unverified: 0 });
});

test("Admin keeps certificate verification and SNI for the original hostname with an mTLS agent", async (t) => {
  configureLocalAdmin(t);
  const fixture = createEphemeralCertificate();
  setEnvironment(t, {
    ADMIN_MTLS_ENABLED: "true",
    ADMIN_MTLS_CERT_BASE64: Buffer.from(fixture.cert).toString("base64"),
    ADMIN_MTLS_KEY_BASE64: Buffer.from(fixture.key).toString("base64"),
    ADMIN_MTLS_CA_BASE64: Buffer.from(fixture.cert).toString("base64"),
  });
  const dnsCalls = simulateRebinding(t);
  const serverNames: string[] = [];
  const port = await listenLocally(t, https.createServer(fixture, (request, response) => {
    serverNames.push((request.socket as unknown as { servername: string }).servername);
    response.end("ok");
  }));

  const result = await sendFixtPayload(`https://admin.test:${port}/fixt`, "sample");

  assert.equal(result.status, "success", result.errorMessage);
  assert.deepEqual(serverNames, ["admin.test"]);
  assert.deepEqual(dnsCalls, { checked: 1, unverified: 0 });
});

test("Admin refuses redirects without forwarding the payload to the next host", async (t) => {
  configureLocalAdmin(t);
  simulateRebinding(t);
  let redirectTargetRequests = 0;
  const targetPort = await listenLocally(t, http.createServer((_request, response) => {
    redirectTargetRequests += 1;
    response.end("unexpected");
  }));
  const port = await listenLocally(t, http.createServer((_request, response) => {
    response.writeHead(307, { Location: `http://127.0.0.1:${targetPort}/other` }).end();
  }));

  const result = await sendFixtPayload(`http://admin.test:${port}/fixt`, "sample");

  assert.equal(result.status, "failed");
  assert.match(result.errorMessage || "", /redirect/i);
  assert.equal(redirectTargetRequests, 0);
});

test("Admin does not expose upstream failure bodies to callers or upload logs", async (t) => {
  configureLocalAdmin(t);
  simulateRebinding(t);
  const port = await listenLocally(t, http.createServer((_request, response) => {
    response.writeHead(500).end("private upstream diagnostic marker");
  }));
  const result = await sendFixtPayload(`http://admin.test:${port}/fixt`, "sample");
  assert.equal(result.status, "failed");
  assert.equal(result.rawResponse, "");
  assert.equal(result.errorMessage, "Admin API returned HTTP 500.");
});

test("Admin sanitizes DNS failures before returning them", async (t) => {
  configureLocalAdmin(t);
  t.mock.method(dnsPromises, "lookup", async () => { throw new Error("private DNS diagnostic marker"); });
  const result = await sendFixtPayload("https://admin.test/fixt", "sample");
  assert.equal(result.status, "failed");
  assert.equal(result.errorMessage, "Admin API destination is unavailable.");
});

test("Admin sanitizes runtime configuration values before returning them", async (t) => {
  configureLocalAdmin(t);
  simulateRebinding(t);
  setEnvironment(t, { ADMIN_AUTH_MODE: "private configuration marker" });
  const result = await sendFixtPayload("https://admin.test/fixt", "sample");
  assert.equal(result.status, "failed");
  assert.equal(result.errorMessage, "Admin API configuration failed.");
});

test("Admin completes a truncated response as a failure instead of leaving the request pending", async (t) => {
  configureLocalAdmin(t);
  simulateRebinding(t);
  const port = await listenLocally(t, http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Length": "100", Connection: "close" });
    response.end("short body");
  }));
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    sendFixtPayload(`http://admin.test:${port}/fixt`, "sample"),
    new Promise<null>((resolve) => { timeout = setTimeout(() => resolve(null), 500); }),
  ]).finally(() => clearTimeout(timeout));

  assert.notEqual(result, null, "truncated response left the transport Promise pending");
  assert.equal(result?.status, "failed");
});

test("Admin rejects private DNS answers without opt-in before opening a socket", async (t) => {
  configureLocalAdmin(t);
  setEnvironment(t, { ADMIN_UPLOAD_ALLOW_PRIVATE_HOSTS: "0" });
  const calls = simulateRebinding(t);

  const result = await sendFixtPayload("https://admin.test/fixt", "sample");

  assert.equal(result.status, "failed");
  assert.match(result.errorMessage || "", /private address/);
  assert.deepEqual(calls, { checked: 1, unverified: 0 });
});

test("pinned transport rejects an unresolved hostname without a DNS request", async (t) => {
  const calls = simulateRebinding(t);
  const result = await sendPinnedAdminRequest("https:", { hostname: "admin.test" }, "sample");
  assert.equal(result.status, "failed");
  assert.deepEqual(calls, { checked: 0, unverified: 0 });
});

test("pinned transport caps the response bytes", async (t) => {
  const port = await listenLocally(t, http.createServer((_request, response) => response.end("too much data")));
  const result = await sendPinnedAdminRequest("http:", { hostname: "127.0.0.1", port, method: "POST" }, "sample", {
    timeoutMs: 500, maxResponseBytes: 4,
  });
  assert.equal(result.status, "failed");
  assert.match(result.errorMessage || "", /too large/);
});

test("pinned transport times out a continuous response that never ends", async (t) => {
  const port = await listenLocally(t, http.createServer((_request, response) => {
    response.writeHead(200);
    response.write("start");
    const interval = setInterval(() => response.write("."), 10);
    response.on("close", () => clearInterval(interval));
  }));
  const result = await sendPinnedAdminRequest("http:", { hostname: "127.0.0.1", port, method: "POST" }, "sample", {
    timeoutMs: 80, maxResponseBytes: 4096,
  });
  assert.equal(result.status, "failed");
  assert.match(result.errorMessage || "", /timed out/);
});

test("pinned transport decodes multibyte text after joining response chunks", async (t) => {
  const payload = Buffer.from("Принято ✓", "utf8");
  const port = await listenLocally(t, http.createServer((_request, response) => {
    response.write(payload.subarray(0, 1));
    setTimeout(() => response.end(payload.subarray(1)), 10);
  }));
  const result = await sendPinnedAdminRequest("http:", { hostname: "127.0.0.1", port, method: "POST" }, "sample");
  assert.equal(result.status, "success");
  assert.equal(result.rawResponse, "Принято ✓");
});

function configureLocalAdmin(t: TestContext) {
  setEnvironment(t, {
    NODE_ENV: "production", ADMIN_UPLOAD_ALLOWED_HOSTS: "admin.test",
    ADMIN_UPLOAD_ALLOW_PRIVATE_HOSTS: "1", ADMIN_UPLOAD_ALLOW_INSECURE_HTTP: "1",
    ADMIN_AUTH_MODE: "none", ADMIN_AUTH_ALLOW_NONE: "1", ADMIN_MTLS_ENABLED: "false",
  });
}

function simulateRebinding(t: TestContext) {
  const calls = { checked: 0, unverified: 0 };
  const originalLookup = dns.lookup;
  t.mock.method(dnsPromises, "lookup", (async () => {
    calls.checked += 1;
    return [{ address: "127.0.0.1", family: 4 }];
  }) as unknown as typeof dnsPromises.lookup);
  t.mock.method(dns, "lookup", ((...args: unknown[]) => {
    if (args[0] !== "admin.test") return Reflect.apply(originalLookup, dns, args);
    calls.unverified += 1;
    const callback = args.at(-1) as (...values: unknown[]) => void;
    const options = args[1] as { all?: boolean };
    process.nextTick(() => options?.all
      ? callback(null, [{ address: "127.0.0.2", family: 4 }])
      : callback(null, "127.0.0.2", 4));
  }) as typeof dns.lookup);
  return calls;
}

function setEnvironment(t: TestContext, values: Record<string, string>) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}
