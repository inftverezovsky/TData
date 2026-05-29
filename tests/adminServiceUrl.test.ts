import assert from "node:assert/strict";
import test from "node:test";
import { buildAdminServiceUrl } from "../src/lib/adminUpload/adminServiceUrl";

test("buildAdminServiceUrl appends encoded JSON link without hardcoded host", () => {
  const serviceUrl = buildAdminServiceUrl(
    "https://tcyber.local/api/manual-import/json/token 1",
    "https://admin.example/upload?mode=fixtures",
  );

  assert.equal(
    serviceUrl,
    "https://admin.example/upload?mode=fixtures&link=https%3A%2F%2Ftcyber.local%2Fapi%2Fmanual-import%2Fjson%2Ftoken+1",
  );
});

test("buildAdminServiceUrl returns null for empty or invalid config", () => {
  assert.equal(buildAdminServiceUrl("https://tcyber.local/json/1", ""), null);
  assert.equal(buildAdminServiceUrl("https://tcyber.local/json/1", "not a url"), null);
});
