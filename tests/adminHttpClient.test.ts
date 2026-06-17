import assert from "node:assert/strict";
import test from "node:test";
import { getAdminHttpClientOptions } from "../backend/src/adminUpload/adminHttpClient";

test("admin HTTP client fails closed for auth none in production", () => {
  withEnv({ NODE_ENV: "production", ADMIN_AUTH_MODE: "none", ADMIN_MTLS_ENABLED: "false", ADMIN_AUTH_ALLOW_NONE: undefined }, () => {
    assert.throws(
      () => getAdminHttpClientOptions(),
      /Production admin upload requires/
    );
  });
});

test("admin HTTP client sets bearer auth header", () => {
  withEnv({ NODE_ENV: "test", ADMIN_AUTH_MODE: "bearer", ADMIN_API_TOKEN: "token-123", ADMIN_MTLS_ENABLED: "false" }, () => {
    const options = getAdminHttpClientOptions();
    assert.equal(options.headers.Authorization, "Bearer token-123");
  });
});

test("admin HTTP client rejects missing mTLS material", () => {
  withEnv({ NODE_ENV: "test", ADMIN_AUTH_MODE: "none", ADMIN_MTLS_ENABLED: "true" }, () => {
    assert.throws(
      () => getAdminHttpClientOptions(),
      /ADMIN_MTLS_ENABLED=true requires/
    );
  });
});

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
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
    fn();
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
