import assert from "node:assert/strict";
import test from "node:test";
import { buildAdminServiceUrl, DEFAULT_ADMIN_SERVICE_URL } from "../src/lib/adminUpload/adminServiceUrl";

test("buildAdminServiceUrl appends encoded JSON link to configured admin service", () => {
  const serviceUrl = buildAdminServiceUrl(
    "https://tcyber.local/api/manual-import/json/token 1",
    "https://admin.example/upload?mode=fixtures",
  );

  assert.equal(
    serviceUrl,
    "https://admin.example/upload?mode=fixtures&link=https%3A%2F%2Ftcyber.local%2Fapi%2Fmanual-import%2Fjson%2Ftoken+1",
  );
});

test("buildAdminServiceUrl falls back to the legacy admin upload service", () => {
  const serviceUrl = buildAdminServiceUrl("https://tcyber.local/json/1", "");

  assert.equal(
    serviceUrl,
    `${DEFAULT_ADMIN_SERVICE_URL}?link=https%3A%2F%2Ftcyber.local%2Fjson%2F1`,
  );
});

test("buildAdminServiceUrl returns null for invalid explicit config", () => {
  assert.equal(buildAdminServiceUrl("https://tcyber.local/json/1", "not a url"), null);
});
