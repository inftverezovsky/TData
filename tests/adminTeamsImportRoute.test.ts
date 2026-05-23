import test from "node:test";
import assert from "node:assert/strict";
import { toGoogleSheetsExportUrl } from "../src/app/api/admin-teams/import/route";

test("toGoogleSheetsExportUrl converts edit URLs and preserves gid", () => {
  assert.equal(
    toGoogleSheetsExportUrl("https://docs.google.com/spreadsheets/d/sheet-id/edit?gid=123#gid=123"),
    "https://docs.google.com/spreadsheets/d/sheet-id/export?format=xlsx&gid=123"
  );
});

test("toGoogleSheetsExportUrl rejects non Google Sheets URLs", () => {
  assert.equal(toGoogleSheetsExportUrl("https://example.com/sheet-id"), null);
});
