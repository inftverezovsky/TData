import test from "node:test";
import assert from "node:assert/strict";
import {
  inferAdminTeamImportLayout,
  normalizeImportedAdminTeamId,
  normalizeImportedAdminTeamName,
  parseAdminTeamImportRows,
} from "../backend/src/adminTeams/importSpreadsheet";

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
  assert.equal(layout?.nameRuCol, 1);
  assert.equal(layout?.nameEnCol, 2);
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

test("blank spreadsheet rows do not shift the header or become imported teams", () => {
  const result = parseAdminTeamImportRows([
    [],
    [null, null],
    ["Platform ID", "Player Name"],
    [101, "Fixture Team"],
  ]);
  assert.equal(result.layout?.headerRowIndex, 2);
  assert.equal(result.layout?.dataStartRow, 3);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].platformId, "101");
});

test("parseAdminTeamImportRows keeps Russian and English admin names", () => {
  const result = parseAdminTeamImportRows([
    ["849 245,00", "Абдулазиз Аль Абдулла", "Abdulaziz Al Abdulla"],
    ["920455", "Абдулазиз Бу Шулайби/Алсувайлем С.", "Abdulaziz Bu Shulaybi/Salem Alsuwailem"],
  ]);

  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].platformId, "849245");
  assert.equal(result.records[0].platformName, "Абдулазиз Аль Абдулла");
  assert.equal(result.records[0].platformNameRu, "Абдулазиз Аль Абдулла");
  assert.equal(result.records[0].platformNameEn, "Abdulaziz Al Abdulla");
  assert.equal(result.records[0].normalizedNameRu, "абдулазиз аль абдулла");
  assert.equal(result.records[0].normalizedNameEn, "abdulaziz al abdulla");
});

test("normalizeImportedAdminTeamId strips spreadsheet formatting", () => {
  assert.equal(normalizeImportedAdminTeamId("849 737,00"), "849737");
  assert.equal(normalizeImportedAdminTeamId(901677), "901677");
});

test("normalizeImportedAdminTeamName keeps readable labels", () => {
  assert.equal(normalizeImportedAdminTeamName("  Asian ITTC  "), "Asian ITTC");
});
