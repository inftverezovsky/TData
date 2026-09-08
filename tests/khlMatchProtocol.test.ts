import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { buildKhlMatchProtocolView } from "../backend/src/results/khl/matchProtocol";
import { normalizeKhlEventDetail } from "../backend/src/sources/results/khl/normalize";

function fixture(name: string) {
  return JSON.parse(readFileSync(
    join(process.cwd(), "tests", "fixtures", "khl", name),
    "utf8"
  ));
}

test("the operator protocol retains the explanation for a corroborated overtime correction", () => {
  const normalized = normalizeKhlEventDetail(fixture("shootout-901986.json"));
  const protocol = buildKhlMatchProtocolView(normalized);
  assert.equal(protocol.validation.ok, true);
  assert.deepEqual(protocol.validation.warnings, normalized.validation.warnings);
  assert.match(protocol.validation.warnings![0], /3:1.*2:2/);
});

test("builds an operator protocol with team and every listed player stat before Admin mappings", () => {
  const normalized = normalizeKhlEventDetail(fixture("regulation-901973.json"));
  const protocol = buildKhlMatchProtocolView(normalized);

  assert.deepEqual(protocol.segments, ["P1", "P2", "P3"]);
  assert.deepEqual(protocol.scores.regulation, { home: 2, away: 3 });
  assert.deepEqual(protocol.scores.official, { home: 2, away: 3 });
  assert.equal(protocol.players.length, 43);
  assert.equal(protocol.players.filter((player) => player.regulation.points === 0).length, 35);

  const homeShots = protocol.teams.home.metrics.find(
    (metric) => metric.code === "shots_on_goal"
  );
  assert.deepEqual(homeShots, {
    code: "shots_on_goal",
    label: "Броски в створ",
    segments: { P1: 2, P2: 12, P3: 14 },
    regulationTotal: 28,
    fullMatchTotal: 28,
  });

  const player = protocol.players.find((candidate) => candidate.khlPlayerId === "42070");
  assert.deepEqual(player?.regulation, { goals: 2, assists: 0, points: 2 });
  assert.deepEqual(player?.fullMatch, { goals: 2, assists: 0, points: 2 });
  assert.ok(protocol.goals.length > 0);
  assert.ok(protocol.penalties.length > 0);
  assert.equal(protocol.playerExtras.version, "khl-player-extras-v1");
  assert.equal(protocol.playerExtras.available, true);
  assert.equal(protocol.players.every((candidate) => candidate.extras.length === 9), true);
});

test("keeps overtime visible while separating P1-P3 values intended for Admin", () => {
  const normalized = normalizeKhlEventDetail(fixture("overtime-901952.json"));
  const protocol = buildKhlMatchProtocolView(normalized);

  assert.deepEqual(protocol.segments, ["P1", "P2", "P3", "OT1", "OT2"]);
  assert.deepEqual(protocol.scores.regulation, { home: 3, away: 3 });
  assert.deepEqual(protocol.scores.official, { home: 4, away: 3 });

  const overtimeScorer = protocol.players.find(
    (candidate) => candidate.khlPlayerId === "30198"
  );
  assert.deepEqual(overtimeScorer?.regulation, { goals: 0, assists: 0, points: 0 });
  assert.deepEqual(overtimeScorer?.fullMatch, { goals: 1, assists: 0, points: 1 });
  assert.ok(protocol.goals.some((goal) => goal.segment === "OT2"));
});
