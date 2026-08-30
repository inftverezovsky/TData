import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  normalizeKhlEventDetail,
  type NormalizedKhlMatch,
} from "../backend/src/sources/results/khl/normalize";

function loadFixture(name: string) {
  return JSON.parse(
    readFileSync(join(process.cwd(), "tests", "fixtures", "khl", name), "utf8")
  );
}

function player(match: NormalizedKhlMatch, khlPlayerId: string) {
  const value = match.players.find((item) => item.khlPlayerId === khlPlayerId);
  assert.ok(value, `KHL player ${khlPlayerId} must be present`);
  return value;
}

test("normalizes KHL game 901973 into regulation team and player statistics", () => {
  const match = normalizeKhlEventDetail(loadFixture("regulation-901973.json"));

  assert.equal(match.identity.khlGameId, "901973");
  assert.equal(match.identity.apiEventId, "2986031");
  assert.equal(match.identity.stageId, "395");
  assert.equal(match.identity.khlStageId, "1370");
  assert.equal(match.status, "finished");
  assert.deepEqual(match.teams.home, {
    apiTeamId: "40",
    khlTeamId: "53",
    name: "Ак Барс",
    location: "Казань",
  });
  assert.deepEqual(match.teams.away, {
    apiTeamId: "26",
    khlTeamId: "1",
    name: "Локомотив",
    location: "Ярославль",
  });
  assert.deepEqual(match.scores.regulation, { home: 2, away: 3 });
  assert.deepEqual(match.scores.official, { home: 2, away: 3 });

  assert.deepEqual(match.teamStats.home.shotsOnGoal, {
    segments: { P1: 2, P2: 12, P3: 14 },
    regulationTotal: 28,
    fullMatchTotal: 28,
  });
  assert.deepEqual(match.teamStats.away.shotsOnGoal, {
    segments: { P1: 7, P2: 10, P3: 7 },
    regulationTotal: 24,
    fullMatchTotal: 24,
  });
  assert.deepEqual(match.teamStats.home.faceoffsWon, {
    segments: { P1: 10, P2: 9, P3: 12 },
    regulationTotal: 31,
    fullMatchTotal: 31,
  });
  assert.deepEqual(match.teamStats.away.faceoffsWon, {
    segments: { P1: 8, P2: 9, P3: 5 },
    regulationTotal: 22,
    fullMatchTotal: 22,
  });
  assert.deepEqual(match.teamStats.home.powerPlayGoals, {
    segments: { P1: 0, P2: 0, P3: 0 },
    regulationTotal: 0,
    fullMatchTotal: 0,
  });
  assert.deepEqual(match.teamStats.away.powerPlayGoals, {
    segments: { P1: 0, P2: 0, P3: 0 },
    regulationTotal: 0,
    fullMatchTotal: 0,
  });
  assert.deepEqual(match.teamStats.home.penaltyMinutesQualifying, {
    segments: { P1: 4, P2: 0, P3: 2 },
    regulationTotal: 6,
    fullMatchTotal: 6,
  });
  assert.deepEqual(match.teamStats.away.penaltyMinutesQualifying, {
    segments: { P1: 2, P2: 4, P3: 2 },
    regulationTotal: 8,
    fullMatchTotal: 8,
  });

  assert.equal(match.players.length, 43);
  assert.deepEqual(player(match, "42070").regulation, {
    goals: 2,
    assists: 0,
    points: 2,
  });
  assert.equal(
    match.players.reduce(
      (sum, item) => sum + (item.teamSide === "home" ? item.regulation.goals : 0),
      0
    ),
    2
  );
  assert.equal(
    match.players.reduce(
      (sum, item) => sum + (item.teamSide === "away" ? item.regulation.goals : 0),
      0
    ),
    3
  );
  assert.deepEqual(match.validation, { ok: true, issues: [] });
});

test("retains official period faceoffs but fails closed when the source aggregate disagrees", () => {
  const raw = loadFixture("regulation-901973.json");
  raw.team_b.vbr = 23;

  const match = normalizeKhlEventDetail(raw);

  assert.deepEqual(match.teamStats.away.faceoffsWon, {
    segments: { P1: 8, P2: 9, P3: 5 },
    regulationTotal: 22,
    fullMatchTotal: 22,
  });
  assert.deepEqual(match.validation, {
    ok: false,
    issues: [
      "KHL away faceoffs won source aggregate mismatch: source=23, segments=22. "
        + "Period segments were retained; validation remains fail-closed.",
    ],
  });
});

test("keeps overtime source facts but excludes them from Admin regulation values", () => {
  const match = normalizeKhlEventDetail(loadFixture("overtime-901952.json"));

  assert.equal(match.identity.khlGameId, "901952");
  assert.deepEqual(match.scores.regulation, { home: 3, away: 3 });
  assert.deepEqual(match.scores.official, { home: 4, away: 3 });
  assert.deepEqual(match.teamStats.home.shotsOnGoal, {
    segments: { P1: 10, P2: 14, P3: 15, OT1: 4, OT2: 4 },
    regulationTotal: 39,
    fullMatchTotal: 47,
  });
  assert.deepEqual(match.teamStats.away.shotsOnGoal, {
    segments: { P1: 13, P2: 9, P3: 10, OT1: 9, OT2: 3 },
    regulationTotal: 32,
    fullMatchTotal: 44,
  });
  assert.deepEqual(match.teamStats.home.faceoffsWon, {
    segments: { P1: 16, P2: 15, P3: 11, OT1: 14, OT2: 3 },
    regulationTotal: 42,
    fullMatchTotal: 59,
  });
  assert.deepEqual(match.teamStats.away.faceoffsWon, {
    segments: { P1: 8, P2: 11, P3: 9, OT1: 14, OT2: 6 },
    regulationTotal: 28,
    fullMatchTotal: 48,
  });

  const overtimeGoal = match.goals.find((goal) => goal.segment === "OT2");
  assert.ok(overtimeGoal);
  assert.equal(overtimeGoal.scorer.khlPlayerId, "30198");
  assert.deepEqual(
    overtimeGoal.assistants.map((assistant) => assistant.khlPlayerId),
    ["22607", "17609"]
  );

  const scorer = player(match, "30198");
  assert.deepEqual(scorer.regulation, { goals: 0, assists: 0, points: 0 });
  assert.deepEqual(scorer.fullMatch, { goals: 1, assists: 0, points: 1 });
  assert.deepEqual(player(match, "22607").regulation, {
    goals: 0,
    assists: 0,
    points: 0,
  });
  assert.deepEqual(player(match, "22607").fullMatch, {
    goals: 0,
    assists: 1,
    points: 1,
  });

  assert.equal(
    match.players.reduce(
      (sum, item) => sum + (item.teamSide === "home" ? item.regulation.goals : 0),
      0
    ),
    3
  );
  assert.equal(
    match.players.reduce(
      (sum, item) => sum + (item.teamSide === "home" ? item.fullMatch.goals : 0),
      0
    ),
    4
  );
  assert.deepEqual(match.validation, { ok: true, issues: [] });
});

test("qualifying penalties include exactly 2 and 4 minutes", () => {
  const raw = loadFixture("regulation-901973.json");
  raw.violations = [
    { time: 100, period: 1, penalty_time: 2, penalty_reason: "minor", violator: { team_id: 40, shirt_number: 17, name: "Барабанов Александр" } },
    { time: 200, period: 1, penalty_time: 4, penalty_reason: "double minor", violator: { team_id: 40, shirt_number: 17, name: "Барабанов Александр" } },
    { time: 1300, period: 2, penalty_time: 5, penalty_reason: "major", violator: { team_id: 40, shirt_number: 17, name: "Барабанов Александр" } },
    { time: 2500, period: 3, penalty_time: 10, penalty_reason: "misconduct", violator: { team_id: 26, shirt_number: 70, name: "Сурин Егор" } },
  ];

  const match = normalizeKhlEventDetail(raw, { validate: false });
  assert.deepEqual(match.teamStats.home.penaltyMinutesQualifying, {
    segments: { P1: 6, P2: 0, P3: 0 },
    regulationTotal: 6,
    fullMatchTotal: 6,
  });
  assert.deepEqual(match.teamStats.away.penaltyMinutesQualifying, {
    segments: { P1: 0, P2: 0, P3: 0 },
    regulationTotal: 0,
    fullMatchTotal: 0,
  });
});

test("power-play goals are derived by segment from goal strength", () => {
  const raw = loadFixture("regulation-901973.json");
  raw.goals[0].status = "В большинстве";
  raw.goals[0].status_abbr = "бол";
  raw.goals.at(-1).status = "В большинстве";
  raw.goals.at(-1).status_abbr = "бол";

  const match = normalizeKhlEventDetail(raw);
  assert.deepEqual(match.teamStats.home.powerPlayGoals, {
    segments: { P1: 0, P2: 0, P3: 1 },
    regulationTotal: 1,
    fullMatchTotal: 1,
  });
  assert.deepEqual(match.teamStats.away.powerPlayGoals, {
    segments: { P1: 1, P2: 0, P3: 0 },
    regulationTotal: 1,
    fullMatchTotal: 1,
  });
});

test("shootout goals never become player goals and ordinary overtime text maps to OT1", () => {
  const match = normalizeKhlEventDetail(loadFixture("shootout-897491.json"));

  assert.deepEqual(match.scores.regulation, { home: 1, away: 1 });
  assert.deepEqual(match.scores.official, { home: 2, away: 1 });
  assert.deepEqual(match.scores.segments.SO, { home: 2, away: 1 });
  assert.deepEqual(match.teamStats.home.shotsOnGoal, {
    segments: { P1: 11, P2: 15, P3: 7, OT1: 2, SO: 0 },
    regulationTotal: 33,
    fullMatchTotal: 35,
  });
  assert.deepEqual(match.teamStats.away.faceoffsWon, {
    segments: { P1: 9, P2: 9, P3: 6, OT1: 1, SO: 0 },
    regulationTotal: 24,
    fullMatchTotal: 25,
  });
  assert.deepEqual(match.teamStats.away.powerPlayGoals, {
    segments: { P1: 0, P2: 0, P3: 1, OT1: 0, SO: 0 },
    regulationTotal: 1,
    fullMatchTotal: 1,
  });
  assert.deepEqual(match.teamStats.away.penaltyMinutesQualifying, {
    segments: { P1: 8, P2: 6, P3: 0, OT1: 2, SO: 0 },
    regulationTotal: 14,
    fullMatchTotal: 16,
  });

  const shootoutGoal = match.goals.find((goal) => goal.segment === "SO");
  assert.ok(shootoutGoal);
  assert.equal(shootoutGoal.period, null);
  assert.deepEqual(player(match, "30198").regulation, { goals: 0, assists: 0, points: 0 });
  assert.deepEqual(player(match, "30198").fullMatch, { goals: 0, assists: 0, points: 0 });
  assert.deepEqual(match.validation, { ok: true, issues: [] });
});

test("real historical double-minor counts 4 while 0, 5, 20 and overtime are excluded", () => {
  const match = normalizeKhlEventDetail(loadFixture("penalty-four-877124.json"));

  assert.deepEqual(match.scores.regulation, { home: 3, away: 3 });
  assert.deepEqual(match.scores.official, { home: 4, away: 3 });
  assert.deepEqual(match.teamStats.home.penaltyMinutesQualifying, {
    segments: { P1: 0, P2: 0, P3: 4, OT1: 2 },
    regulationTotal: 4,
    fullMatchTotal: 6,
  });
  assert.deepEqual(match.teamStats.away.penaltyMinutesQualifying, {
    segments: { P1: 0, P2: 2, P3: 8, OT1: 0 },
    regulationTotal: 10,
    fullMatchTotal: 10,
  });
  assert.equal(match.teamStats.home.powerPlayGoals.regulationTotal, 2);
  assert.equal(match.teamStats.away.powerPlayGoals.regulationTotal, 1);
  assert.deepEqual(player(match, "15663").regulation, { goals: 0, assists: 0, points: 0 });
  assert.deepEqual(player(match, "15663").fullMatch, { goals: 1, assists: 0, points: 1 });
  assert.deepEqual(match.validation, { ok: true, issues: [] });
});

test("modern 5/10-minute and overtime penalties are not included in Admin totals", () => {
  const match = normalizeKhlEventDetail(loadFixture("overtime-penalties-901702.json"));

  assert.deepEqual(match.scores.regulation, { home: 3, away: 3 });
  assert.deepEqual(match.scores.official, { home: 3, away: 4 });
  assert.equal(match.teamStats.home.penaltyMinutesQualifying.regulationTotal, 10);
  assert.equal(match.teamStats.home.penaltyMinutesQualifying.fullMatchTotal, 12);
  assert.equal(match.teamStats.away.penaltyMinutesQualifying.regulationTotal, 8);
  assert.equal(match.teamStats.away.penaltyMinutesQualifying.fullMatchTotal, 8);
  assert.deepEqual(player(match, "20700").regulation, { goals: 0, assists: 1, points: 1 });
  assert.deepEqual(player(match, "20700").fullMatch, { goals: 1, assists: 1, points: 2 });
  assert.deepEqual(match.validation, { ok: true, issues: [] });
});

test("a finished game may omit violations entirely", () => {
  const raw = loadFixture("overtime-901952.json");
  delete raw.violations;
  const match = normalizeKhlEventDetail(raw);
  assert.deepEqual(match.penalties, []);
  assert.deepEqual(match.validation, { ok: true, issues: [] });
});
