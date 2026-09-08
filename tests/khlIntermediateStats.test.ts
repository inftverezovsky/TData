import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { normalizeKhlEventDetail } from "../backend/src/sources/results/khl/normalize";

test("901983 uses completed period rows instead of earlier timed updates but keeps unresolved source errors blocking", () => {
  const raw = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/khl/intermediate-stats-901983.json"), "utf8"));
  const before = JSON.stringify(raw);
  const match = normalizeKhlEventDetail(raw);
  assert.deepEqual(match.teamStats.home.shotsOnGoal, {
    segments: { P1: 13, P2: 14, P3: 21, OT1: 0 }, regulationTotal: 48, fullMatchTotal: 48,
  });
  assert.deepEqual(match.teamStats.away.shotsOnGoal, {
    segments: { P1: 14, P2: 12, P3: 9, OT1: 2 }, regulationTotal: 35, fullMatchTotal: 37,
  });
  assert.equal(match.teamStats.home.faceoffsWon.fullMatchTotal, 32);
  assert.equal(match.teamStats.away.faceoffsWon.fullMatchTotal, 33);
  assert.equal(match.validation.ok, false);
  assert.equal(match.validation.warnings, undefined);
  assert.equal(match.validation.issues.length, 2);
  assert.ok(match.validation.issues.every((issue) => issue.includes("faceoffs won source aggregate mismatch")));
  assert.deepEqual(normalizeKhlEventDetail({ ...raw, text_events: [...raw.text_events].reverse() }), match);
  assert.equal(JSON.stringify(raw), before);
});
