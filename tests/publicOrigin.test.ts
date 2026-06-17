import test from "node:test";
import assert from "node:assert/strict";
import { resolvePublicOrigin } from "../backend/src/http/publicOrigin";

test("resolvePublicOrigin prefers configured public base URL", () => {
  const previous = process.env.TDATA_PUBLIC_BASE_URL;
  process.env.TDATA_PUBLIC_BASE_URL = "http://82.147.67.231:3010";

  try {
    const request = new Request("http://0.0.0.0:3010/api/manual-import/service-link", {
      headers: { host: "0.0.0.0:3010" },
    });

    assert.equal(resolvePublicOrigin(request), "http://82.147.67.231:3010");
  } finally {
    if (previous === undefined) delete process.env.TDATA_PUBLIC_BASE_URL;
    else process.env.TDATA_PUBLIC_BASE_URL = previous;
  }
});

test("resolvePublicOrigin uses Host header instead of wildcard request origin", () => {
  const previous = process.env.TDATA_PUBLIC_BASE_URL;
  delete process.env.TDATA_PUBLIC_BASE_URL;

  try {
    const request = new Request("http://0.0.0.0:3010/api/manual-import/service-link", {
      headers: { host: "82.147.67.231:3010" },
    });

    assert.equal(resolvePublicOrigin(request), "http://82.147.67.231:3010");
  } finally {
    if (previous === undefined) delete process.env.TDATA_PUBLIC_BASE_URL;
    else process.env.TDATA_PUBLIC_BASE_URL = previous;
  }
});

test("resolvePublicOrigin accepts explicit client origin before request origin", () => {
  const previous = process.env.TDATA_PUBLIC_BASE_URL;
  delete process.env.TDATA_PUBLIC_BASE_URL;

  try {
    const request = new Request("http://0.0.0.0:3010/api/manual-import/service-link", {
      headers: { host: "0.0.0.0:3010" },
    });

    assert.equal(resolvePublicOrigin(request, "http://82.147.67.231:3010"), "http://82.147.67.231:3010");
  } finally {
    if (previous === undefined) delete process.env.TDATA_PUBLIC_BASE_URL;
    else process.env.TDATA_PUBLIC_BASE_URL = previous;
  }
});
