import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSandboxAutoMappingPreviewFromRows, parseSourceNamesText } from "../backend/src/adminTeams/sandboxAutomap";
import { looksLikeHtml, readAdminTeamRowsFromSpreadsheetSource } from "../backend/src/adminTeams/spreadsheetSource";
import { POST } from "../frontend/src/app/api/admin/sandbox/automap/route";

test("sandbox automap parses admin rows and separates preview buckets", () => {
  const result = buildSandboxAutoMappingPreviewFromRows(
    [
      "Abdulaziz Al Abdulla",
      "Unknown Team",
      "Perusic",
      "Qwerty Squad",
      "{{TeamOpponent",
    ].join("\n"),
    [
      ["ID", "RU", "EN"],
      ["849245", "Абдулазиз Аль Абдулла", "Abdulaziz Al Abdulla"],
      ["777777", "Unknowns", "Unknowns"],
      ["101", "Perusik", "Perusik"],
      ["102", "Perusig", "Perusig"],
    ]
  );

  assert.equal(result.layout?.source, "header");
  assert.equal(result.records.length, 4);
  assert.equal(result.preview.auto.length, 1);
  assert.equal(result.preview.auto[0].platformId, "849245");
  assert.equal(result.preview.suggested.length, 1);
  assert.equal(result.preview.suggested[0].liquipediaName, "Unknown Team");
  assert.equal(result.preview.ambiguous.length, 1);
  assert.equal(result.preview.ambiguous[0].liquipediaName, "Perusic");
  assert.equal(result.preview.unmapped.length, 1);
  assert.equal(result.preview.unmapped[0].liquipediaName, "Qwerty Squad");
  assert.equal(result.preview.invalid.length, 1);
});

test("sandbox automap dedupes pasted source names", () => {
  assert.deepEqual(parseSourceNamesText(" Liquid \n\nLiquid\nG2 "), ["Liquid", "G2"]);
});

test("sandbox automap reports unknown admin columns without creating records", () => {
  const result = buildSandboxAutoMappingPreviewFromRows("Liquid", [
    ["Color", "City"],
    ["Blue", "Paris"],
  ]);

  assert.equal(result.layout, null);
  assert.equal(result.records.length, 0);
  assert.equal(result.preview.unmapped.length, 1);
});

test("sandbox automap endpoint validates empty source list", async () => {
  const formData = new FormData();
  formData.set("sourceNames", "  \n ");
  const response = await POST(new Request("http://localhost/api/admin/sandbox/automap", {
    method: "POST",
    body: formData,
  }));
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.error, /source/i);
});

test("sandbox automap endpoint validates exactly one admin source", async () => {
  const formData = new FormData();
  formData.set("sourceNames", "Liquid");
  formData.set("file", new File([new Uint8Array([1])], "teams.xlsx"));
  formData.set("url", "https://docs.google.com/spreadsheets/d/sheet-id/edit#gid=0");
  const response = await POST(new Request("http://localhost/api/admin/sandbox/automap", {
    method: "POST",
    body: formData,
  }));
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.error, /один источник/);
});

test("spreadsheet source rejects files larger than 10MB before parsing", async () => {
  const oversized = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "teams.xlsx");

  await assert.rejects(
    () => readAdminTeamRowsFromSpreadsheetSource({ file: oversized }),
    /File is too large/
  );
});

test("spreadsheet source detects html responses from Google Sheets", () => {
  assert.equal(looksLikeHtml(Buffer.from("<!doctype html><html></html>"), null), true);
  assert.equal(looksLikeHtml(Buffer.from("not html"), "text/html; charset=utf-8"), true);
  assert.equal(looksLikeHtml(Buffer.from("PK"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), false);
});

test("sandbox automap route stays database-free", () => {
  const routeSource = readFileSync(new URL("../frontend/src/app/api/admin/sandbox/automap/route.ts", import.meta.url), "utf8");
  const automapSource = readFileSync(new URL("../backend/src/adminTeams/sandboxAutomap.ts", import.meta.url), "utf8");

  assert.equal(routeSource.includes("@backend/db/db"), false);
  assert.equal(/\bprisma\b/.test(routeSource), false);
  assert.equal(automapSource.includes("@backend/db/db"), false);
  assert.equal(automapSource.includes("@backend/teams/mapping"), false);
});
