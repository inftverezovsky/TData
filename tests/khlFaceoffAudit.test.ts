import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { normalizeKhlEventDetail } from "../backend/src/sources/results/khl/normalize";

type RawRow = Record<string, unknown>;
type RawMatch = RawRow & {
  text_events: (RawRow & { text: string })[];
  team_a: RawRow;
  team_b: RawRow;
  goals: RawRow[];
  violations: RawRow[];
};

const OT = "Статистика овертайма:";
const FINAL = "Статистика матча:";
const P1 = "Статистика 1-го периода:";

function fixture(): RawMatch {
  return JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/khl/shootout-901986.json"), "utf8"));
}

function assertNoCorrection(raw: RawMatch) {
  const match = normalizeKhlEventDetail(raw);
  assert.equal(match.validation.ok, false, "contradictory source evidence must stay rejected");
  assert.equal(match.validation.warnings, undefined, "ambiguous evidence must not authorize a correction");
  return match;
}

function completedFixture(): RawMatch {
  const raw = fixture();
  return {
    ...raw,
    text_events: raw.text_events.map((event) => event.text.startsWith(OT)
      ? { ...event, text: event.text.replace("Вбрасывания: 3-1", "Вбрасывания: 2-2") }
      : event),
  };
}

function rowFor(raw: RawMatch, prefix: string) {
  const row = raw.text_events.find((event) => event.text.startsWith(prefix));
  assert.ok(row);
  return row;
}

function interimRow(raw: RawMatch, prefix: string, period: unknown) {
  const row = rowFor(raw, prefix);
  return {
    ...row,
    period,
    seconds: Number(row.seconds) - 1,
    text: row.text.replace(/Броски в створ: \d+-\d+/, "Броски в створ: 0-0")
      .replace(/Вбрасывания: \d+-\d+/, "Вбрасывания: 0-0"),
  };
}

test("missing both team aggregates cannot hide a contradictory final faceoff summary", () => {
  for (const vbr of [null, undefined]) {
    const raw = fixture();
    const match = assertNoCorrection({ ...raw, team_a: { ...raw.team_a, vbr }, team_b: { ...raw.team_b, vbr } });
    assert.equal(match.teamStats.home.faceoffsWon.fullMatchTotal, 29);
    assert.equal(match.teamStats.away.faceoffsWon.fullMatchTotal, 25);
    assert.ok(match.validation.issues.length > 0);
  }
});

test("malformed team aggregates cannot make the disagreeing final faceoff summary disappear", () => {
  const raw = fixture();
  assertNoCorrection({
    ...raw,
    team_a: { ...raw.team_a, vbr: "unavailable" },
    team_b: { ...raw.team_b, vbr: "unavailable" },
  });
});

test("optional team aggregates may remain absent when the published periods and final summary agree", () => {
  const raw = fixture();
  const match = normalizeKhlEventDetail({
    ...raw,
    team_a: { ...raw.team_a, vbr: null },
    team_b: { ...raw.team_b, vbr: null },
    text_events: raw.text_events.map((event) => event.text.startsWith(OT)
      ? { ...event, text: event.text.replace("Вбрасывания: 3-1", "Вбрасывания: 2-2") }
      : event),
  });
  assert.equal(match.validation.ok, true);
  assert.equal(match.validation.warnings, undefined);
  assert.equal(match.teamStats.home.faceoffsWon.fullMatchTotal, 28);
  assert.equal(match.teamStats.away.faceoffsWon.fullMatchTotal, 26);
});

test("conflicting faceoff labels within one period or summary row cannot authorize reconciliation", () => {
  for (const prefix of [OT, FINAL]) {
    const raw = fixture();
    const changed = {
      ...raw,
      text_events: raw.text_events.map((event) => event.text.startsWith(prefix)
        ? { ...event, text: `${event.text} ; Вбрасывания: 90-91` }
        : event),
    };
    assertNoCorrection(changed);
  }
});

test("a malformed repeated faceoff label cannot be skipped in favor of a valid occurrence", () => {
  const raw = fixture();
  for (const insert of [
    "Вбрасывания: unavailable ; Вбрасывания: 3-1",
    "Вбрасывания: 3-1 ; Вбрасывания: unavailable",
  ]) {
    assertNoCorrection({
      ...raw,
      text_events: raw.text_events.map((event) => event.text.startsWith(OT)
        ? { ...event, text: event.text.replace("Вбрасывания: 3-1", insert) }
        : event),
    });
  }
});

test("an explicit second-overtime goal blocks reconstruction even when its elapsed clock resembles OT1", () => {
  const raw = fixture();
  const goal = raw.goals.find((event) => event.period !== null);
  assert.ok(goal);
  const match = assertNoCorrection({ ...raw, goals: [...raw.goals, { ...goal, period: 5, time: 3_701 }] });
  assert.equal(match.teamStats.home.faceoffsWon.segments.OT1, 3);
  assert.equal(match.teamStats.away.faceoffsWon.segments.OT1, 1);
});

test("an explicit second-overtime penalty blocks reconstruction independently of its elapsed clock", () => {
  const raw = fixture();
  const penalty = raw.violations.find((event) => event.violator);
  assert.ok(penalty);
  const match = assertNoCorrection({ ...raw, violations: [...raw.violations, { ...penalty, period: 5, time: 3_701 }] });
  assert.equal(match.teamStats.home.faceoffsWon.segments.OT1, 3);
  assert.equal(match.teamStats.away.faceoffsWon.segments.OT1, 1);
});

test("a statistics row explicitly marked as period five cannot be treated as the sole OT1", () => {
  const raw = fixture();
  assertNoCorrection({
    ...raw,
    text_events: raw.text_events.map((event) => event.text.startsWith(OT) ? { ...event, period: 5 } : event),
  });
});

test("a regulation-period goal carrying an overtime clock cannot authorize faceoff reconciliation", () => {
  const raw = fixture();
  const goal = raw.goals.find((event) => event.period !== null);
  assert.ok(goal);
  const match = assertNoCorrection({ ...raw, goals: [...raw.goals, { ...goal, period: 3, time: 3_701 }] });
  assert.equal(match.teamStats.home.faceoffsWon.segments.OT1, 3);
  assert.equal(match.teamStats.away.faceoffsWon.segments.OT1, 1);
});

test("a regulation-period penalty carrying an overtime clock cannot hide the phase conflict", () => {
  const raw = fixture();
  const penalty = raw.violations.find((event) => event.violator);
  assert.ok(penalty);
  const match = assertNoCorrection({ ...raw, violations: [...raw.violations, { ...penalty, period: 3, time: 4_801 }] });
  assert.equal(match.teamStats.home.faceoffsWon.segments.OT1, 3);
  assert.equal(match.teamStats.away.faceoffsWon.segments.OT1, 1);
});

test("completed null-period rows take precedence over lower in-period observations independently of array order", () => {
  const raw = fixture();
  const expected = normalizeKhlEventDetail(raw);
  const interim = [1, 2, 3].map((period) => interimRow(raw, `Статистика ${period}-го периода:`, period));
  for (const text_events of [
    [...interim, ...raw.text_events],
    [...raw.text_events, ...interim],
    [...interim, ...raw.text_events].reverse(),
  ]) {
    const match = normalizeKhlEventDetail({ ...raw, text_events });
    assert.equal(match.validation.ok, true);
    assert.deepEqual(match, expected);
  }
});

test("two different final null-period rows remain a conflict even when one has lower counts", () => {
  const raw = fixture();
  const conflicting = interimRow(raw, P1, null);
  for (const text_events of [[conflicting, ...raw.text_events], [...raw.text_events, conflicting]]) {
    assertNoCorrection({ ...raw, text_events });
  }
});

test("an interim count exceeding a final count cannot be silently discarded for either metric or team", () => {
  const raw = fixture();
  for (const label of ["Броски в створ", "Вбрасывания"]) {
    for (const pair of ["99-0", "0-99"]) {
      const row = interimRow(raw, P1, 1);
      const conflict = { ...row, text: row.text.replace(`${label}: 0-0`, `${label}: ${pair}`) };
      assertNoCorrection({ ...raw, text_events: [...raw.text_events, conflict] });
    }
  }
});

test("unknown or contradictory period metadata cannot identify a lower duplicate as an interim row", () => {
  const raw = fixture();
  for (const period of [undefined, "1", 2, 5]) {
    assertNoCorrection({ ...raw, text_events: [...raw.text_events, interimRow(raw, P1, period)] });
  }
});

test("a missing explicit null completion marker cannot authorize selection among different period rows", () => {
  const raw = fixture();
  assertNoCorrection({
    ...raw,
    text_events: [
      ...raw.text_events.map((event) => event.text.startsWith(P1) ? { ...event, period: undefined } : event),
      interimRow(raw, P1, 1),
    ],
  });
});

test("ambiguous final summaries cannot disappear when any required aggregate corroboration is absent", () => {
  const raw = completedFixture();
  const summary = rowFor(raw, FINAL);
  const conflicting = { ...summary, text: summary.text.replace("Вбрасывания: 28-26", "Вбрасывания: 29-25") };
  for (const side of ["team_a", "team_b"] as const) {
    for (const field of ["vbr", "shots"] as const) {
      assertNoCorrection({
        ...raw,
        [side]: { ...raw[side], [field]: null },
        text_events: [...raw.text_events, conflicting],
      });
    }
  }
});

test("a malformed final summary cannot disappear alongside both missing faceoff aggregates", () => {
  const raw = fixture();
  assertNoCorrection({
    ...raw,
    team_a: { ...raw.team_a, vbr: null },
    team_b: { ...raw.team_b, vbr: null },
    text_events: raw.text_events.map((event) => event.text.startsWith(FINAL)
      ? { ...event, text: event.text.replace("Вбрасывания: 28-26", "Вбрасывания: unknown") }
      : event),
  });
});

test("conflicting explicit cumulative summaries remain blocking even when the final totals already agree", () => {
  const raw = completedFixture();
  for (const prefix of ["Статистика матча после двух периодов:", "Статистика матча после трех периодов:"]) {
    const summary = rowFor(raw, prefix);
    const conflicting = { ...summary, text: summary.text.replace(/Вбрасывания: \d+-\d+/, "Вбрасывания: 90-91") };
    assertNoCorrection({ ...raw, text_events: [...raw.text_events, conflicting] });
  }
});
