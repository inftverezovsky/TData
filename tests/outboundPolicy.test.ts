import assert from "node:assert/strict";
import test from "node:test";
import { validateOutboundUrl } from "../src/lib/http/outboundPolicy";

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
