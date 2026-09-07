import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_ADMIN_TEAM_SOURCE_BYTES,
  getSpreadsheetSourceErrorStatus,
  readAdminTeamRowsFromSpreadsheetSource,
} from "../backend/src/adminTeams/spreadsheetSource";

test("spreadsheet download cancels an oversized chunked body before reading the rest", async (context) => {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      if (pulls <= 2) controller.enqueue(new Uint8Array(MAX_ADMIN_TEAM_SOURCE_BYTES / 2 + 1));
      else controller.close();
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  context.mock.method(globalThis, "fetch", async () => new Response(body));

  await assert.rejects(
    readAdminTeamRowsFromSpreadsheetSource({ url: "https://docs.google.com/spreadsheets/d/oversize-test/edit" }),
    (error: unknown) => getSpreadsheetSourceErrorStatus(error) === 413,
  );
  assert.equal(pulls, 2);
  assert.equal(cancelled, true);
});

test("spreadsheet download discards a body rejected by Content-Length", async (context) => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  context.mock.method(globalThis, "fetch", async () => new Response(body, {
    headers: { "content-length": String(MAX_ADMIN_TEAM_SOURCE_BYTES + 1) },
  }));
  await assert.rejects(
    readAdminTeamRowsFromSpreadsheetSource({ url: "https://docs.google.com/spreadsheets/d/declared-oversize-test/edit" }),
    (error: unknown) => getSpreadsheetSourceErrorStatus(error) === 413,
  );
  assert.equal(cancelled, true);
});

test("spreadsheet file input rejects form text as a validation error", async () => {
  await assert.rejects(
    readAdminTeamRowsFromSpreadsheetSource({ file: "not-a-file" as unknown as File }),
    (error: unknown) => getSpreadsheetSourceErrorStatus(error) === 400,
  );
});

test("spreadsheet source reads a real XLSX upload and reuses a successful Google Sheets download", async (context) => {
  const bytes = readFileSync(join(process.cwd(), "tests/fixtures/admin-teams/basic.xlsx"));
  const expected = [["ID", "Name"], [101, "Fixture Team"]];
  const uploaded = await readAdminTeamRowsFromSpreadsheetSource({ file: new File([bytes], "teams.xlsx") });
  assert.deepEqual(uploaded.rows, expected);
  assert.equal(uploaded.sourceType, "file");
  assert.equal(uploaded.fileName, "teams.xlsx");
  assert.equal(uploaded.byteLength, bytes.length);

  const download = context.mock.method(globalThis, "fetch", async () => new Response(bytes));
  const input = { url: "https://docs.google.com/spreadsheets/d/valid-security-fixture/edit" };
  const first = await readAdminTeamRowsFromSpreadsheetSource(input);
  const cached = await readAdminTeamRowsFromSpreadsheetSource(input);
  assert.deepEqual(first.rows, expected);
  assert.equal(first.cacheHit, false);
  assert.deepEqual(cached.rows, expected);
  assert.equal(cached.cacheHit, true);
  assert.equal(download.mock.callCount(), 1);
});

test("spreadsheet source rejects empty, ambiguous and unsupported source inputs", async () => {
  for (const input of [
    {},
    { file: new File([], "empty.xlsx") },
    { url: "https://other.example/sheet.xlsx" },
    { file: new File([], "empty.xlsx"), url: "https://docs.google.com/spreadsheets/d/ambiguous/edit" },
  ]) {
    await assert.rejects(readAdminTeamRowsFromSpreadsheetSource(input),
      (error: unknown) => getSpreadsheetSourceErrorStatus(error) === 400);
  }
});

test("spreadsheet source handles unavailable and HTML Google Sheets responses as validation failures", async (context) => {
  const responses = [
    new Response(null, { status: 403 }),
    new Response(null, { status: 502 }),
    new Response("<!DOCTYPE html><html>Access denied</html>", { headers: { "content-type": "text/html" } }),
  ];
  for (const [index, response] of responses.entries()) {
    context.mock.method(globalThis, "fetch", async () => response);
    await assert.rejects(
      readAdminTeamRowsFromSpreadsheetSource({ url: `https://docs.google.com/spreadsheets/d/failed-${index}/edit` }),
      (error: unknown) => getSpreadsheetSourceErrorStatus(error) === 400,
    );
  }
});
