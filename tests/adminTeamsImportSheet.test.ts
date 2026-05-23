import test from "node:test";
import assert from "node:assert/strict";
import {
  inferAdminTeamImportLayout,
  normalizeImportedAdminTeamId,
  normalizeImportedAdminTeamName,
} from "../src/lib/adminTeams/importSpreadsheet";

test("inferAdminTeamImportLayout recognizes headerless team sheets", () => {
  const layout = inferAdminTeamImportLayout([
    [849737, "Asian ITTC", "Asian ITTC"],
    [901677, "Caribbean Regional Championships", "Caribbean Regional Championships"],
    [964926, "Сибата С./Такамори М.", "Shibata S./Takamori M."],
  ]);

  assert.ok(layout);
  assert.equal(layout?.headerRowIndex, -1);
  assert.equal(layout?.dataStartRow, 0);
  assert.equal(layout?.idCol, 0);
  assert.equal(layout?.nameCol, 1);
  assert.equal(layout?.source, "data");
});

test("inferAdminTeamImportLayout recognizes explicit headers", () => {
  const layout = inferAdminTeamImportLayout([
    ["Platform ID", "Player Name", "Alias"],
    ["849737", "Asian ITTC", "Asian ITTC"],
  ]);

  assert.ok(layout);
  assert.equal(layout?.headerRowIndex, 0);
  assert.equal(layout?.dataStartRow, 1);
  assert.equal(layout?.idCol, 0);
  assert.equal(layout?.nameCol, 1);
  assert.equal(layout?.source, "header");
});

test("normalizeImportedAdminTeamId strips spreadsheet formatting", () => {
  assert.equal(normalizeImportedAdminTeamId("849 737,00"), "849737");
  assert.equal(normalizeImportedAdminTeamId(901677), "901677");
});

test("normalizeImportedAdminTeamName keeps readable labels", () => {
  assert.equal(normalizeImportedAdminTeamName("  Asian ITTC  "), "Asian ITTC");
});
