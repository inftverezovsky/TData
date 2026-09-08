import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { normalizeKhlEventDetail } from "../backend/src/sources/results/khl/normalize";
import { projectKhlPenaltyExtras } from "../backend/src/results/khl/penaltyExtras";

function fixture(name = "regulation-901973.json") {
  return JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/khl", name), "utf8"));
}

test("empty or truncated violations contradicting official penalty minutes cannot settle extras", () => {
  const raw = fixture();
  for (const violations of [[], raw.violations.slice(1)]) {
    const match = normalizeKhlEventDetail({ ...raw, violations });
    assert.equal(match.validation.ok, true, "Other validated statistics remain available");
    assert.equal(match.penaltyEvidence?.complete, false);
    assert.equal(projectKhlPenaltyExtras(match).available, false);
    assert.ok(projectKhlPenaltyExtras(match).extras.every((extra) => extra.value === null));
  }
});

test("completeness compares team sides individually, including 5/10/20 and overtime minutes", () => {
  for (const name of ["regulation-901973.json", "penalty-four-877124.json", "overtime-penalties-901702.json", "shootout-897491.json"]) {
    const raw = fixture(name);
    assert.equal(normalizeKhlEventDetail(raw).penaltyEvidence?.complete, true, name);
    const shifted = { ...raw, team_a: { ...raw.team_a, pim: raw.team_a.pim + 2 }, team_b: { ...raw.team_b, pim: raw.team_b.pim - 2 } };
    assert.equal(normalizeKhlEventDetail(shifted).penaltyEvidence?.complete, false, name);
  }
});

test("provided totals must be valid nonnegative integers, while absent optional totals are supported", () => {
  const raw = fixture();
  for (const pim of ["wrong", "", " ", true, [], -1, 6.5]) {
    assert.equal(normalizeKhlEventDetail({ ...raw, team_a: { ...raw.team_a, pim } }).penaltyEvidence?.complete, false);
  }
  assert.equal(normalizeKhlEventDetail({ ...raw, team_a: { ...raw.team_a, pim: "6" } }).penaltyEvidence?.complete, true);
  for (const pim of [null, undefined]) {
    assert.equal(normalizeKhlEventDetail({ ...raw, team_a: { ...raw.team_a, pim } }).penaltyEvidence?.complete, true);
    assert.equal(normalizeKhlEventDetail({ ...raw, team_a: { ...raw.team_a, pim }, team_b: { ...raw.team_b, pim: 0 } }).penaltyEvidence?.complete, false);
  }
});

test("confirmed zero-minute games remain complete but missing or null violation lists do not", () => {
  const raw = fixture("overtime-901952.json");
  assert.equal(normalizeKhlEventDetail(raw).penaltyEvidence?.complete, true);
  for (const violations of [undefined, null]) {
    assert.equal(normalizeKhlEventDetail({ ...raw, violations }).penaltyEvidence?.complete, false);
  }
});
