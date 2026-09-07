import assert from "node:assert/strict";
import test from "node:test";

import { requireTestDatabaseUrl } from "../scripts/helpers/testDatabase";

test("database tests accept only explicit local test databases", () => {
  for (const name of ["tdata_test_audit", "tdata_khl_test_20260907", "tdata_khl_browser_audit"]) {
    const url = `postgresql://127.0.0.1:54329/${name}?schema=public`;
    assert.equal(requireTestDatabaseUrl(url), url);
  }
  assert.doesNotThrow(() => requireTestDatabaseUrl("postgres://[::1]/tdata_test_audit"));
});

test("database tests reject production, remote and misleading connection names before connecting", () => {
  for (const url of [
    undefined, "", "not-a-url", "https://127.0.0.1/tdata_test_audit",
    "postgresql://db.internal/tdata_test_audit",
    "postgresql://127.0.0.1/tdata", "postgresql://127.0.0.1/contest",
    "postgresql://test-user@127.0.0.1/production?application_name=e2e",
    "postgresql://127.0.0.1/tdata_test_audit?host=production.internal",
    "postgresql://127.0.0.1/tdata_test_audit?schema=live",
    "postgresql://127.0.0.1/tdata_test_audit?schema=public&schema=live",
    "postgresql://127.0.0.1/tdata_test_audit?options=-csearch_path%3Dlive",
  ]) assert.throws(() => requireTestDatabaseUrl(url), /test database/i);
});

test("database validation errors never echo the supplied URL", () => {
  const value = "postgresql://fixture-user:synthetic-password@remote.internal/production";
  assert.throws(() => requireTestDatabaseUrl(value), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes(value));
    assert.ok(!error.message.includes("synthetic-password"));
    return true;
  });
});
