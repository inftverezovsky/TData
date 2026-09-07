import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  createAdminSessionResponse,
  hasValidAdminSession,
  requireSameOriginJsonMutation,
} from "../backend/src/auth/adminAuth";

test("same-origin guard ignores forwarded origin unless proxy trust is explicitly enabled", () => {
  const previous = process.env.TRUST_PROXY_HEADERS;
  delete process.env.TRUST_PROXY_HEADERS;
  try {
    const request = new Request("https://tdata.example/api/results/khl/ingest", {
      method: "POST",
      headers: {
        origin: "https://other.example",
        "x-forwarded-host": "other.example",
        "x-forwarded-proto": "https",
        "content-type": "application/json",
      },
      body: "{}",
    });
    assert.equal(requireSameOriginJsonMutation(request)?.status, 403);
    for (const enabled of ["1", "true"]) {
      process.env.TRUST_PROXY_HEADERS = enabled;
      assert.equal(requireSameOriginJsonMutation(request), null);
    }
  } finally {
    restoreEnv("TRUST_PROXY_HEADERS", previous);
  }
});

test("same-origin guard uses the actual Host when NextRequest canonicalizes loopback URLs", () => {
  const previous = process.env.TRUST_PROXY_HEADERS;
  delete process.env.TRUST_PROXY_HEADERS;
  try {
    for (const authority of ["127.0.0.1:3012", "[::1]:3012"]) {
      const request = new NextRequest(`http://${authority}/api/admin-auth/login`, {
        method: "POST", headers: { host: authority, origin: `http://${authority}`, "content-type": "application/json" }, body: "{}",
      });
      assert.equal(new URL(request.url).hostname, "localhost");
      assert.equal(requireSameOriginJsonMutation(request), null);
    }
  } finally {
    restoreEnv("TRUST_PROXY_HEADERS", previous);
  }
});

test("same-origin Host checks reject another origin, port, scheme, internal alias and malformed authority", () => {
  const previous = process.env.TRUST_PROXY_HEADERS;
  delete process.env.TRUST_PROXY_HEADERS;
  try {
    for (const origin of ["http://other.example:3012", "http://127.0.0.1:3013", "https://127.0.0.1:3012", "http://localhost:3012"]) {
      const request = new NextRequest("http://127.0.0.1:3012/api/admin-auth/login", {
        method: "POST", headers: { host: "127.0.0.1:3012", origin, "content-type": "application/json" }, body: "{}",
      });
      assert.equal(requireSameOriginJsonMutation(request)?.status, 403);
    }
    for (const host of ["127.0.0.1:3012/path", "127.0.0.1:3012@other.example", "127.0.0.1:3012, other.example", "127.0.0.1:99999"]) {
      const request = new Request("http://127.0.0.1:3012/api/admin-auth/login", {
        method: "POST", headers: { host, origin: "http://127.0.0.1:3012", "content-type": "application/json" }, body: "{}",
      });
      assert.equal(requireSameOriginJsonMutation(request)?.status, 403);
    }
  } finally {
    restoreEnv("TRUST_PROXY_HEADERS", previous);
  }
});

test("changing the configured password invalidates previously signed sessions", async () => {
  const previousPassword = process.env.ADMIN_PASSWORD;
  const previousSecret = process.env.ADMIN_SESSION_SECRET;
  process.env.ADMIN_PASSWORD = "session-security-test-original";
  process.env.ADMIN_SESSION_SECRET = "session-security-test-signing-key";
  try {
    const response = await createAdminSessionResponse();
    const cookie = response.headers.get("set-cookie")!.split(";", 1)[0];
    const request = new Request("https://tdata.example/api/admin-auth/session", { headers: { cookie } });
    assert.equal(await hasValidAdminSession(request), true);
    process.env.ADMIN_PASSWORD = "session-security-test-replacement";
    assert.equal(await hasValidAdminSession(request), false);
    const replacement = await createAdminSessionResponse();
    const newCookie = replacement.headers.get("set-cookie")!.split(";", 1)[0];
    assert.equal(await hasValidAdminSession(new Request(request.url, { headers: { cookie: newCookie } })), true);
  } finally {
    restoreEnv("ADMIN_PASSWORD", previousPassword);
    restoreEnv("ADMIN_SESSION_SECRET", previousSecret);
  }
});

test("session tokens reject extra segments rather than accepting a valid prefix", async () => {
  const previousPassword = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = "session-security-test-format";
  try {
    const response = await createAdminSessionResponse();
    const cookie = response.headers.get("set-cookie")!.split(";", 1)[0];
    const request = new Request("https://tdata.example/api/admin-auth/session", {
      headers: { cookie: `${cookie}.unexpected` },
    });
    assert.equal(await hasValidAdminSession(request), false);
  } finally {
    restoreEnv("ADMIN_PASSWORD", previousPassword);
  }
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
