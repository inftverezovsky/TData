import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  normalizeKhlEventDetail,
  type NormalizedKhlMatch,
} from "../backend/src/sources/results/khl/normalize";

type TextEvent = Record<string, unknown> & { text: string };
type RawTeam = Record<string, unknown> & { players: Record<string, unknown>[] };
type RawMatch = Record<string, unknown> & {
  text_events: TextEvent[];
  team_a: RawTeam;
  team_b: RawTeam;
};

const PERIOD_ONE = "Статистика 1-го периода:";
const PERIOD_TWO = "Статистика 2-го периода:";
const PERIOD_THREE = "Статистика 3-го периода:";
const OVERTIME = "Статистика овертайма:";
const AFTER_TWO = "Статистика матча после двух периодов:";
const AFTER_THREE = "Статистика матча после трех периодов:";
const FINAL = "Статистика матча:";

function fixture(): RawMatch {
  return JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/khl/shootout-901986.json"), "utf8"));
}

function warnings(match: NormalizedKhlMatch) {
  return (match.validation as { warnings?: string[] }).warnings;
}

function replaceText(raw: RawMatch, prefix: string, before: string, after: string): RawMatch {
  assert.ok(raw.text_events.some((event) => event.text.startsWith(prefix) && event.text.includes(before)));
  return {
    ...raw,
    text_events: raw.text_events.map((event) => event.text.startsWith(prefix)
      ? { ...event, text: event.text.replace(before, after) }
      : event),
  };
}

function withoutSummary(raw: RawMatch, prefix: string): RawMatch {
  return { ...raw, text_events: raw.text_events.filter((event) => !event.text.startsWith(prefix)) };
}

function withFinalFaceoffs(raw: RawMatch, home: number, away: number): RawMatch {
  return {
    ...replaceText(raw, FINAL, "Вбрасывания: 28-26", `Вбрасывания: ${home}-${away}`),
    team_a: { ...raw.team_a, vbr: home },
    team_b: { ...raw.team_b, vbr: away },
  };
}

function assertUnreconciled(raw: RawMatch) {
  const match = normalizeKhlEventDetail(raw);
  assert.equal(match.validation.ok, false);
  assert.equal(warnings(match), undefined);
  return match;
}

function freezeRecursively(value: unknown) {
  if (!value || typeof value !== "object") return;
  Object.values(value).forEach(freezeRecursively);
  Object.freeze(value);
}

test("901986 derives its single overtime faceoffs from corroborated totals without changing regulation or raw evidence", () => {
  const raw = fixture();
  const original = JSON.stringify(raw);
  freezeRecursively(raw);

  const match = normalizeKhlEventDetail(raw);

  assert.equal(match.identity.khlGameId, "901986");
  assert.deepEqual(match.scores.regulation, { home: 3, away: 3 });
  assert.deepEqual(match.scores.official, { home: 3, away: 4 });
  assert.deepEqual(match.teamStats.home.faceoffsWon, {
    segments: { P1: 6, P2: 8, P3: 12, OT1: 2, SO: 0 },
    regulationTotal: 26,
    fullMatchTotal: 28,
  });
  assert.deepEqual(match.teamStats.away.faceoffsWon, {
    segments: { P1: 10, P2: 6, P3: 8, OT1: 2, SO: 0 },
    regulationTotal: 24,
    fullMatchTotal: 26,
  });
  assert.equal(match.teamStats.home.shotsOnGoal.regulationTotal, 24);
  assert.equal(match.teamStats.away.shotsOnGoal.regulationTotal, 26);
  assert.equal(match.validation.ok, true);
  assert.deepEqual(match.validation.issues, []);
  assert.equal(warnings(match)?.length, 1);
  assert.match(warnings(match)![0], /3\s*[:\-]\s*1/);
  assert.match(warnings(match)![0], /2\s*[:\-]\s*2/);
  assert.equal(JSON.stringify(raw), original);
});

test("reconciliation is independent of text-event ordering and identical duplicate summaries", () => {
  const raw = fixture();
  const baseline = normalizeKhlEventDetail(raw);
  const stats = raw.text_events.filter((event) => event.text.startsWith("Статистика"));
  const reordered = normalizeKhlEventDetail({ ...raw, text_events: [...raw.text_events].reverse() });
  const duplicated = normalizeKhlEventDetail({ ...raw, text_events: [...stats, ...raw.text_events, ...stats] });
  assert.equal(baseline.validation.ok, true);
  assert.deepEqual(reordered, baseline);
  assert.deepEqual(duplicated, baseline);
});

test("a consistent single overtime retains its published values without a reconciliation warning", () => {
  const raw = replaceText(fixture(), OVERTIME, "Вбрасывания: 3-1", "Вбрасывания: 2-2");
  const match = normalizeKhlEventDetail(raw);
  assert.equal(match.validation.ok, true);
  assert.equal(match.teamStats.home.faceoffsWon.segments.OT1, 2);
  assert.equal(match.teamStats.away.faceoffsWon.segments.OT1, 2);
  assert.equal(warnings(match), undefined);
});

test("the regulation summary supports Russian ё without requiring an optional two-period summary", () => {
  const raw = withoutSummary(fixture(), AFTER_TWO);
  const withYo = replaceText(raw, AFTER_THREE, "трех периодов", "трёх периодов");
  const match = normalizeKhlEventDetail(withYo);
  assert.equal(match.validation.ok, true);
  assert.equal(match.teamStats.home.faceoffsWon.segments.OT1, 2);
  assert.equal(match.teamStats.away.faceoffsWon.segments.OT1, 2);
  assert.equal(warnings(match)?.length, 1);
});

test("cumulative statistics support the existing source wording without матча", () => {
  const raw = fixture();
  const text_events = raw.text_events.map((event) => ({
    ...event,
    text: event.text.replace("Статистика матча после", "Статистика после"),
  }));
  const match = normalizeKhlEventDetail({ ...raw, text_events });
  assert.equal(match.validation.ok, true);
  assert.equal(match.teamStats.home.faceoffsWon.segments.OT1, 2);
  assert.equal(match.teamStats.away.faceoffsWon.segments.OT1, 2);
  assert.equal(warnings(match)?.length, 1);
});

test("contradictory cumulative statistics without матча cannot be ignored", () => {
  const raw = fixture();
  for (const [prefix, before, after] of [
    [AFTER_TWO, "Вбрасывания: 14-16", "Вбрасывания: 13-17"],
    [AFTER_THREE, "Вбрасывания: 26-24", "Вбрасывания: 25-25"],
  ]) {
    const changed = replaceText(raw, prefix, before, after);
    assertUnreconciled({
      ...changed,
      text_events: changed.text_events.map((event) => ({
        ...event,
        text: event.text.replace("Статистика матча после", "Статистика после"),
      })),
    });
  }
});

for (const prefix of [PERIOD_ONE, PERIOD_TWO, PERIOD_THREE, OVERTIME, AFTER_TWO, AFTER_THREE, FINAL]) {
  test(`conflicting duplicate ${prefix} blocks reconciliation in either array order`, () => {
    const raw = fixture();
    const selected = raw.text_events.find((event) => event.text.startsWith(prefix));
    assert.ok(selected);
    const conflicting = {
      ...selected,
      text: selected.text.replace(/Вбрасывания: \d+-\d+/, "Вбрасывания: 90-91"),
    };
    for (const text_events of [[conflicting, ...raw.text_events], [...raw.text_events, conflicting]]) {
      assertUnreconciled({ ...raw, text_events });
    }
  });
}

for (const prefix of [AFTER_THREE, FINAL]) {
  test(`a missing ${prefix} cannot authorize overtime reconstruction`, () => {
    const match = assertUnreconciled(withoutSummary(fixture(), prefix));
    assert.equal(match.teamStats.home.faceoffsWon.segments.OT1, 3);
    assert.equal(match.teamStats.away.faceoffsWon.segments.OT1, 1);
  });
}

test("published cumulative or final totals that contradict their supporting values remain blocked", () => {
  const raw = fixture();
  for (const [prefix, before, after] of [
    [AFTER_TWO, "Вбрасывания: 14-16", "Вбрасывания: 13-17"],
    [AFTER_THREE, "Вбрасывания: 26-24", "Вбрасывания: 25-25"],
    [FINAL, "Вбрасывания: 28-26", "Вбрасывания: 29-25"],
  ]) {
    assertUnreconciled(replaceText(raw, prefix, before, after));
  }
});

test("malformed faceoff pairs cannot be partially parsed or hidden by valid duplicate rows", () => {
  const raw = fixture();
  const overtime = raw.text_events.find((event) => event.text.startsWith(OVERTIME));
  assert.ok(overtime);
  for (const pair of ["3-1.5", "-3-1", "3--1", "9007199254740992-1", "3-1 trailing", "3-1 / 2-2", ""]) {
    const malformed = { ...overtime, text: overtime.text.replace("Вбрасывания: 3-1", `Вбрасывания: ${pair}`) };
    assertUnreconciled(replaceText(raw, OVERTIME, "Вбрасывания: 3-1", `Вбрасывания: ${pair}`));
    for (const text_events of [[malformed, ...raw.text_events], [...raw.text_events, malformed]]) {
      assertUnreconciled({ ...raw, text_events });
    }
  }

  for (const prefix of [AFTER_THREE, FINAL]) {
    const summary = raw.text_events.find((event) => event.text.startsWith(prefix));
    assert.ok(summary);
    const malformed = { ...summary, text: summary.text.replace(/Вбрасывания: \d+-\d+/, "Вбрасывания: unknown") };
    for (const text_events of [[malformed, ...raw.text_events], [...raw.text_events, malformed]]) {
      assertUnreconciled({ ...raw, text_events });
    }
  }
});

test("overtime reconciliation cannot invent or remove a faceoff or produce a negative residual", () => {
  assertUnreconciled(withFinalFaceoffs(fixture(), 29, 26));
  assertUnreconciled(withFinalFaceoffs(fixture(), 25, 29));
});

test("missing and noninteger aggregate values cannot corroborate an overtime reconstruction", () => {
  for (const vbr of [null, undefined, "", "not-a-count", 28.5, -28, Number.MAX_SAFE_INTEGER + 1]) {
    const raw = fixture();
    assertUnreconciled({ ...raw, team_a: { ...raw.team_a, vbr } });
  }
});

test("the correction never reconstructs regulation periods or unfinished games", () => {
  for (const prefix of [PERIOD_ONE, PERIOD_TWO, PERIOD_THREE]) {
    assertUnreconciled(withoutSummary(fixture(), prefix));
  }
  assertUnreconciled({ ...fixture(), game_state_key: "live" });
});

test("a second overtime statistic prevents assigning the entire residual to OT1", () => {
  const raw = fixture();
  const overtime = raw.text_events.find((event) => event.text.startsWith(OVERTIME));
  assert.ok(overtime);
  const secondOvertime = {
    ...overtime,
    text: overtime.text.replace(OVERTIME, "Статистика 2-го овертайма:")
      .replace("Броски в створ: 2-1", "Броски в створ: 0-0")
      .replace("Вбрасывания: 3-1", "Вбрасывания: 0-0"),
  };
  assertUnreconciled({ ...raw, text_events: [...raw.text_events, secondOvertime] });
});

test("second-overtime event evidence blocks reconciliation even without a second statistics row", () => {
  const raw = fixture();
  const goals = raw.goals as Record<string, unknown>[];
  const ordinaryGoal = goals.find((goal) => goal.period !== null);
  assert.ok(ordinaryGoal);
  assertUnreconciled({
    ...raw,
    goals: [...goals, { ...ordinaryGoal, period: 5, time: 4_801 }],
  });

  const violations = raw.violations as Record<string, unknown>[];
  const playerPenalty = violations.find((penalty) => penalty.violator);
  assert.ok(playerPenalty);
  assertUnreconciled({
    ...raw,
    violations: [...violations, { ...playerPenalty, period: 5, time: 4_801 }],
  });
});

test("another validation failure remains blocking even when overtime faceoffs can be reconciled", () => {
  const raw = fixture();
  const badShots = normalizeKhlEventDetail({ ...raw, team_a: { ...raw.team_a, shots: 27 } });
  assert.equal(badShots.validation.ok, false);
  assert.ok(badShots.validation.issues.some((issue) => /shots on goal/.test(issue)));

  const missingIdentity = normalizeKhlEventDetail({
    ...raw,
    team_a: {
      ...raw.team_a,
      players: raw.team_a.players.map((player, index) => index === 0 ? { ...player, khl_id: 0 } : player),
    },
  });
  assert.equal(missingIdentity.validation.ok, false);
  assert.ok(missingIdentity.validation.issues.some((issue) => /missing KHL player id/.test(issue)));
});
