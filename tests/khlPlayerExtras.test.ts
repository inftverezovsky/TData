import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  KHL_PLAYER_EXTRA_DEFINITIONS,
  projectKhlPlayerExtras,
} from "../backend/src/results/khl/playerExtras";
import { normalizeKhlEventDetail } from "../backend/src/sources/results/khl/normalize";

function fixture(name: string) {
  const body = JSON.parse(readFileSync(
    join(process.cwd(), "tests", "fixtures", "khl", name),
    "utf8"
  ));
  return body.event || body;
}

function valueFor(
  projection: ReturnType<typeof projectKhlPlayerExtras>,
  apiPlayerId: string,
  code: string
) {
  const player = projection.players.find((candidate) => candidate.apiPlayerId === apiPlayerId);
  assert.ok(player, `player ${apiPlayerId} should exist`);
  const extra = player.extras.find((candidate) => candidate.code === code);
  assert.ok(extra, `extra ${code} should exist`);
  return extra.value;
}

test("calculates all nine P1-P3 player extras from structured scoring events", () => {
  const match = normalizeKhlEventDetail(fixture("regulation-901973.json"));
  const projection = projectKhlPlayerExtras(match);

  assert.equal(projection.available, true);
  assert.equal(projection.version, "khl-player-extras-v1");
  assert.equal(KHL_PLAYER_EXTRA_DEFINITIONS.length, 9);
  assert.equal(projection.players.length, 43);

  // Никита Лямкин забил и ассистировал в P3.
  assert.equal(valueFor(projection, "5563", "scores"), true);
  assert.equal(valueFor(projection, "5563", "assists"), true);
  assert.equal(valueFor(projection, "5563", "scores_and_assists"), true);
  assert.equal(valueFor(projection, "5563", "points_p3"), true);
  assert.equal(valueFor(projection, "5563", "scores_p3"), true);
  assert.equal(valueFor(projection, "5563", "points_p1"), false);

  // Игрок без очков всё равно присутствует и получает девять отрицательных значений.
  const zero = match.players.find((player) => player.regulation.points === 0);
  assert.ok(zero);
  const zeroProjection = projection.players.find((player) => (
    player.teamSide === zero.teamSide && player.apiPlayerId === zero.apiPlayerId
  ));
  assert.equal(zeroProjection?.extras.length, 9);
  assert.ok(zeroProjection?.extras.every((extra) => extra.value === false));
});

test("excludes overtime and post-match shootout scoring from every extra", () => {
  const overtime = projectKhlPlayerExtras(
    normalizeKhlEventDetail(fixture("overtime-901952.json"))
  );
  assert.equal(valueFor(overtime, "29185", "scores"), false);
  assert.equal(valueFor(overtime, "29185", "scores_p1"), false);
  assert.equal(valueFor(overtime, "29185", "scores_p2"), false);
  assert.equal(valueFor(overtime, "29185", "scores_p3"), false);

  const shootout = projectKhlPlayerExtras(
    normalizeKhlEventDetail(fixture("shootout-897491.json"))
  );
  assert.equal(valueFor(shootout, "29185", "scores"), false);
});

test("calculates extras for all 47 roster rows in 901981 including missing KHL IDs", () => {
  const projection = projectKhlPlayerExtras(
    normalizeKhlEventDetail(fixture("missing-player-ids-901981.json"))
  );

  assert.equal(projection.available, true);
  assert.equal(projection.players.length, 47);
  assert.equal(projection.players.filter((player) => player.khlPlayerId === null).length, 5);
  assert.equal(new Set(projection.players.map((player) => (
    `${player.teamSide}:${player.apiPlayerId}`
  ))).size, 47);
  assert.ok(projection.players.every((player) => player.extras.length === 9));
});

test("fails closed with unavailable values when structured scoring evidence conflicts", () => {
  const raw = fixture("regulation-901973.json");
  raw.scores.first_period = "0:1";
  const projection = projectKhlPlayerExtras(normalizeKhlEventDetail(raw, { validate: false }));

  assert.equal(projection.available, false);
  assert.ok(projection.issues.some((issue) => issue.includes("P1")));
  assert.ok(projection.players.every((player) => (
    player.extras.every((extra) => extra.value === null)
  )));
});

test("fails closed when a scorer or assistant cannot be resolved uniquely", () => {
  const raw = fixture("regulation-901973.json");
  raw.goals[0].author.shirt_number = 999;
  const projection = projectKhlPlayerExtras(normalizeKhlEventDetail(raw, { validate: false }));

  assert.equal(projection.available, false);
  assert.ok(projection.issues.some((issue) => issue.includes("участник")));
});

test("fails closed for duplicate participant identities even when that player has no points", () => {
  const match = normalizeKhlEventDetail(fixture("regulation-901973.json"));
  const zero = match.players.find((player) => player.regulation.points === 0);
  assert.ok(zero);
  const duplicated = {
    ...match,
    players: [
      ...match.players,
      { ...zero, regulation: { ...zero.regulation }, fullMatch: { ...zero.fullMatch } },
    ],
  };

  const projection = projectKhlPlayerExtras(duplicated);
  assert.equal(projection.available, false);
  assert.ok(projection.issues.some((issue) => issue.includes("встречается в составе 2 раза")));
});
