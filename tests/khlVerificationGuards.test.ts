import assert from "node:assert/strict";
import test from "node:test";

import {
  requireIsolatedKhlDatabaseUrl,
  requireSameDatabaseUrl,
} from "../scripts/helpers/isolatedKhlDatabase";

const isolatedUrl = "postgresql://tester:local-only@127.0.0.1:54329/tdata_khl_test_20260821_ab12?schema=public";

test("verification database guard accepts only explicitly named loopback KHL test databases", () => {
  assert.equal(requireIsolatedKhlDatabaseUrl(isolatedUrl, "TEST_DATABASE_URL"), isolatedUrl);
  assert.throws(
    () => requireIsolatedKhlDatabaseUrl(
      "postgresql://tester:local-only@db.internal:5432/tdata_khl_test_20260821_ab12",
      "TEST_DATABASE_URL"
    ),
    /loopback/i
  );
  assert.throws(
    () => requireIsolatedKhlDatabaseUrl(
      "postgresql://tester:local-only@127.0.0.1:5432/tdata",
      "TEST_DATABASE_URL"
    ),
    /isolated KHL test database name/i
  );
});

test("browser verifier requires application and inspection database URLs to match", () => {
  assert.equal(requireSameDatabaseUrl(isolatedUrl, isolatedUrl), isolatedUrl);
  assert.throws(
    () => requireSameDatabaseUrl(
      isolatedUrl,
      isolatedUrl.replace("tdata_khl_test_", "tdata_khl_browser_")
    ),
    /must reference the same isolated database/i
  );
});
