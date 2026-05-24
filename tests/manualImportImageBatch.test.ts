import test from "node:test";
import assert from "node:assert/strict";
import {
  buildManualImportBatchSummary,
  dedupeManualImportBatchMatches,
  MANUAL_IMPORT_MAX_IMAGES,
  selectManualImportImageHashes,
} from "../src/lib/manualImport/imageBatch";

test("dedupeManualImportBatchMatches removes same dated pair regardless of side order", () => {
  const result = dedupeManualImportBatchMatches([
    { team1: "Team Liquid", team2: "G2 Esports", date: "23.05.2026 16:10:00" },
    { team1: "G2 Esports", team2: "Team Liquid", date: "23.05.2026 16:10:00" },
    { team1: "Team Liquid", team2: "NAVI", date: "23.05.2026 17:10:00" },
  ]);

  assert.equal(result.duplicatesRemoved, 1);
  assert.equal(result.matches.length, 2);
  assert.equal(result.matches[0].team1, "Team Liquid");
});

test("selectManualImportImageHashes enforces max queue size", () => {
  const current = Array.from({ length: MANUAL_IMPORT_MAX_IMAGES - 1 }, (_, index) => `current-${index}`);
  const result = selectManualImportImageHashes(current, ["new-1", "new-2"]);

  assert.deepEqual(result.acceptedHashes, ["new-1"]);
  assert.equal(result.overflowCount, 1);
});

test("selectManualImportImageHashes skips duplicate pasted images", () => {
  const result = selectManualImportImageHashes(["existing"], ["existing", "fresh", "fresh"]);

  assert.deepEqual(result.acceptedHashes, ["fresh"]);
  assert.equal(result.duplicateCount, 2);
  assert.equal(result.overflowCount, 0);
});

test("buildManualImportBatchSummary counts success, empty, and errors", () => {
  const summary = buildManualImportBatchSummary(
    [
      { status: "success", rawMatches: [{}] },
      { status: "ocr", rawMatches: [{}] },
      { status: "empty" },
      { status: "error" },
      { status: "queued" },
    ],
    2,
    1
  );

  assert.deepEqual(summary, {
    total: 5,
    success: 2,
    empty: 1,
    error: 1,
    matches: 2,
    duplicatesRemoved: 1,
  });
});
