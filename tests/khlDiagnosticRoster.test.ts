import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { buildKhlMatchProtocolView } from "../backend/src/results/khl/matchProtocol";
import { normalizeKhlEventDetail } from "../backend/src/sources/results/khl/normalize";
import { KhlMatchProtocol } from "../frontend/src/components/results/khl/KhlMatchProtocol";

function fixture(name: string) {
  const body = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/khl", name), "utf8"));
  return body.event || body;
}

test("retains all 47 real 901981 roster slots when five official KHL player IDs are missing", () => {
  const match = normalizeKhlEventDetail(fixture("missing-player-ids-901981.json"));
  assert.equal(match.players.length, 47);
  const missing = match.players.filter((player) => player.khlPlayerId === null);
  assert.equal(missing.length, 5);
  assert.equal(new Set(missing.map((player) => player.apiPlayerId)).size, 5);
  assert.ok(missing.every((player) => /^[1-9]\d*$/.test(player.apiPlayerId)));
  assert.equal(match.validation.ok, false);
  assert.equal(match.validation.issues.filter((issue) => issue.includes("missing KHL player id")).length, 5);
  assert.deepEqual(match.scores.regulation, { home: 3, away: 3 });
  assert.deepEqual(match.scores.official, { home: 4, away: 3 });
  const protocol = buildKhlMatchProtocolView(match);
  assert.equal(protocol.players.length, 47);
  assert.equal(new Set(protocol.players.map((player) => `${player.teamSide}:${player.apiPlayerId}`)).size, 47);
  const html = renderToStaticMarkup(createElement(KhlMatchProtocol, { protocol, section: "players" }));
  assert.equal((html.match(/data-testid="khl-protocol-player"/g) || []).length, 47);
  assert.equal((html.match(/ID КХЛ пока отсутствует в источнике/g) || []).length, 5);
  assert.equal((html.match(/data-testid="khl-player-extras"/g) || []).length, 47);
  assert.match(html, /Допы/);
  assert.match(html, /Да/);
  assert.match(html, /Нет/);
  const complete = renderToStaticMarkup(createElement(KhlMatchProtocol, { protocol }));
  assert.equal((complete.match(/data-testid="khl-protocol-player"/g) || []).length, 47);
  assert.match(complete, /Командная статистика/);
  assert.match(complete, /Голы/);
});

test("missing external IDs do not merge roster rows or lose scorer and assistant points", () => {
  const raw = fixture("regulation-901973.json");
  const before = normalizeKhlEventDetail(raw);
  raw.team_a.players.forEach((player: { khl_id: number }) => { player.khl_id = 0; });
  raw.team_b.players.forEach((player: { khl_id: number | string }) => { player.khl_id = "0"; });
  const after = normalizeKhlEventDetail(raw);
  assert.equal(after.players.length, before.players.length);
  assert.ok(after.players.every((player) => player.khlPlayerId === null));
  for (const expected of before.players) {
    const actual = after.players.find((player) => player.teamSide === expected.teamSide
      && player.apiPlayerId === expected.apiPlayerId);
    assert.deepEqual(actual?.regulation, expected.regulation);
    assert.deepEqual(actual?.fullMatch, expected.fullMatch);
  }
  assert.equal(after.validation.ok, false);
});

test("only the known zero sentinel is tolerated and duplicate API roster identities fail closed", () => {
  for (const invalid of [null, undefined, -1, "unknown"]) {
    const raw = fixture("regulation-901973.json");
    raw.team_a.players[0].khl_id = invalid;
    assert.throws(() => normalizeKhlEventDetail(raw), /player khl_id/);
  }
  const raw = fixture("regulation-901973.json");
  raw.team_a.players[1].id = raw.team_a.players[0].id;
  const match = normalizeKhlEventDetail(raw);
  assert.equal(match.players.length, 43);
  assert.equal(match.validation.ok, false);
  assert.ok(match.validation.issues.some((issue) => issue.includes("Duplicate KHL API player")));
});

test("a source correction supplying genuine positive IDs makes the same full roster valid", () => {
  const raw = fixture("regulation-901973.json");
  const originalIds = raw.team_a.players.map((player: { khl_id: number }) => player.khl_id);
  raw.team_a.players.forEach((player: { khl_id: number }) => { player.khl_id = 0; });
  assert.equal(normalizeKhlEventDetail(raw).validation.ok, false);
  raw.team_a.players.forEach((player: { khl_id: number }, index: number) => { player.khl_id = originalIds[index]; });
  const corrected = normalizeKhlEventDetail(raw);
  assert.equal(corrected.players.length, 43);
  assert.equal(corrected.validation.ok, true);
});

test("in-game penalty shots count in regulation and OT penalty shots remain excluded", () => {
  for (const name of ["regulation-901973.json", "overtime-901952.json"]) {
    const raw = fixture(name);
    const before = normalizeKhlEventDetail(raw);
    raw.goals.forEach((goal: { status: string; status_abbr: string }) => {
      goal.status = "Буллит";
      goal.status_abbr = "шб";
    });
    const after = normalizeKhlEventDetail(raw);
    assert.deepEqual(after.players.map((player) => player.regulation), before.players.map((player) => player.regulation));
    assert.deepEqual(after.players.map((player) => player.fullMatch), before.players.map((player) => player.fullMatch));
    assert.equal(after.goals.some((goal) => goal.segment === "SO"), false);
  }
});
