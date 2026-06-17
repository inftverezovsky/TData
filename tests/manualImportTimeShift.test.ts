import test from "node:test";
import assert from "node:assert/strict";
import { shiftManualImportDate, shiftManualImportMatchDates } from "../backend/src/manualImport/timeShift";

test("shiftManualImportDate adds minutes and normalizes seconds", () => {
  assert.equal(shiftManualImportDate("24.05.2026 11:50", 60), "24.05.2026 12:50:00");
});

test("shiftManualImportDate subtracts minutes across the previous day", () => {
  assert.equal(shiftManualImportDate("01.06.2026 00:10:00", -20), "31.05.2026 23:50:00");
});

test("shiftManualImportDate accepts ISO-like dates", () => {
  assert.equal(shiftManualImportDate("2026-05-24 11:50:00", 10), "24.05.2026 12:00:00");
});

test("shiftManualImportMatchDates leaves invalid dates unchanged and reports them", () => {
  const result = shiftManualImportMatchDates(
    [
      { team1: "A", team2: "B", date: "24.05.2026 11:50:00" },
      { team1: "C", team2: "D", date: "Unknown" },
    ],
    -30
  );

  assert.equal(result.changedCount, 1);
  assert.equal(result.skippedCount, 1);
  assert.deepEqual(result.matches, [
    { team1: "A", team2: "B", date: "24.05.2026 11:20:00" },
    { team1: "C", team2: "D", date: "Unknown" },
  ]);
});
