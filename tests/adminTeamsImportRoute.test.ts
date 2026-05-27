import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAdminTeamsImportScopeSlug,
  resolveAdminTeamsImportDisciplineSlug,
  toGoogleSheetsExportUrl,
} from "../src/app/api/admin-teams/import/route";

test("toGoogleSheetsExportUrl converts edit URLs and preserves gid", () => {
  assert.equal(
    toGoogleSheetsExportUrl("https://docs.google.com/spreadsheets/d/sheet-id/edit?gid=123#gid=123"),
    "https://docs.google.com/spreadsheets/d/sheet-id/export?format=xlsx&gid=123"
  );
});

test("toGoogleSheetsExportUrl rejects non Google Sheets URLs", () => {
  assert.equal(toGoogleSheetsExportUrl("https://example.com/sheet-id"), null);
});

test("resolveAdminTeamsImportDisciplineSlug does not fallback to dota2 without discipline data", () => {
  assert.equal(resolveAdminTeamsImportDisciplineSlug({}), null);
});

test("resolveAdminTeamsImportDisciplineSlug prefers numeric admin discipline ID", () => {
  assert.equal(
    resolveAdminTeamsImportDisciplineSlug({
      disciplineId: "73",
      disciplineSlug: "dota2",
    }),
    "73"
  );
});

test("resolveAdminTeamsImportDisciplineSlug accepts custom discipline scope", () => {
  assert.equal(
    resolveAdminTeamsImportDisciplineSlug({
      disciplineSlug: "Настольный теннис",
    }),
    "настольный-теннис"
  );
});

test("resolveAdminTeamsImportDisciplineSlug supports beach volleyball scopes", () => {
  assert.equal(
    resolveAdminTeamsImportDisciplineSlug({
      disciplineSlug: "beachvolleyball-men",
    }),
    "beachvolleyball-men"
  );
  assert.equal(
    resolveAdminTeamsImportDisciplineSlug({
      disciplineSlug: "beachvolleyball-women",
    }),
    "beachvolleyball-women"
  );
});

test("normalizeAdminTeamsImportScopeSlug rejects unsafe scope keys", () => {
  assert.equal(normalizeAdminTeamsImportScopeSlug("../tabletennis"), "");
});
