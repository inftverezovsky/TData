import assert from "node:assert/strict";
import test from "node:test";
import { isPrivateAddress, resolveHostAddresses, validateOutboundUrl } from "../backend/src/http/outboundPolicy";

test("outbound address policy blocks local and special-use representations", () => {
  const blocked = [
    "::", "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1", "::ffff:7f00:1",
    "::ffff:169.254.169.254", "::ffff:10.0.0.1", "fe90::1", "febf::1", "ff02::1",
    "100.64.0.1", "100.127.255.254", "198.18.0.1", "224.0.0.1", "255.255.255.255",
  ];
  for (const address of blocked) assert.equal(isPrivateAddress(address), true, address);
});

test("outbound address policy keeps ordinary public IPv4 and IPv6 destinations usable", () => {
  for (const address of ["8.8.8.8", "1.1.1.1", "192.0.8.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
    assert.equal(isPrivateAddress(address), false, address);
  }
});

test("IPv6 URL literals are checked directly without treating brackets as a DNS name", async () => {
  assert.deepEqual(await resolveHostAddresses("[::ffff:7f00:1]"), ["::ffff:7f00:1"]);
  await withEnv({ NODE_ENV: "production" }, async () => {
    await assert.rejects(
      () => validateOutboundUrl("https://[::ffff:7f00:1]/api", { policyName: "Test" }),
      /private address/,
    );
  });
});

test("validateOutboundUrl rejects production HTTP unless explicitly allowed", async () => {
  await withEnv({ NODE_ENV: "production" }, async () => {
    await assert.rejects(
      () => validateOutboundUrl("http://example.com/api", { policyName: "Test" }),
      /HTTPS in production/
    );
  });
});

test("validateOutboundUrl enforces production host allowlist when required", async () => {
  await withEnv({ NODE_ENV: "production", TEST_ALLOW_HTTP: "1" }, async () => {
    await assert.rejects(
      () => validateOutboundUrl("http://example.com/api", {
        policyName: "Test",
        allowInsecureHttpEnv: process.env.TEST_ALLOW_HTTP,
        requireAllowedHostsInProduction: true,
      }),
      /allowed hosts are required/
    );

    await assert.rejects(
      () => validateOutboundUrl("http://example.com/api", {
        policyName: "Test",
        allowedHostsEnv: ["allowed.example"],
        allowInsecureHttpEnv: process.env.TEST_ALLOW_HTTP,
        requireAllowedHostsInProduction: true,
      }),
      /not allowlisted/
    );
  });
});

test("validateOutboundUrl blocks localhost/private targets in production", async () => {
  await withEnv({ NODE_ENV: "production", TEST_ALLOW_HTTP: "1", TEST_HOSTS: "localhost" }, async () => {
    await assert.rejects(
      () => validateOutboundUrl("http://localhost:3000/api", {
        policyName: "Test",
        allowedHostsEnv: [process.env.TEST_HOSTS],
        allowInsecureHttpEnv: process.env.TEST_ALLOW_HTTP,
      }),
      /private host/
    );
  });
});

async function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void>) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
