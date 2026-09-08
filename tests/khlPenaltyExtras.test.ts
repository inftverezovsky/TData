import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { normalizeKhlEventDetail, type NormalizedKhlMatch, type NormalizedKhlPenalty } from "../backend/src/sources/results/khl/normalize";
import { KHL_PENALTY_EXTRA_DEFINITIONS, KHL_PENALTY_REASON_DEFINITIONS, isKhlPenaltyExtraCode, projectKhlPenaltyExtras } from "../backend/src/results/khl/penaltyExtras";

function fixture(name = "regulation-901973.json") {
  return normalizeKhlEventDetail(JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/khl", name), "utf8")));
}

function penalty(overrides: Partial<NormalizedKhlPenalty> = {}): NormalizedKhlPenalty {
  return { elapsedSeconds: 58, period: 1, segment: "P1", durationMinutes: 2, reason: "Подножка", teamSide: "home", player: null, qualifiesForAdmin: true, ...overrides };
}

function match(penalties: NormalizedKhlPenalty[], overrides: Partial<NormalizedKhlMatch> = {}) {
  return { ...fixture(), penaltyEvidence: { complete: true }, penalties, ...overrides } as NormalizedKhlMatch;
}

function result(input: NormalizedKhlMatch, code: string) {
  const item = projectKhlPenaltyExtras(input).extras.find((extra) => extra.code === code);
  assert.ok(item, code);
  return item;
}

test("defines seven unique stable penalty extras and guards unknown codes", () => {
  assert.equal(KHL_PENALTY_EXTRA_DEFINITIONS.length, 7);
  assert.equal(new Set(KHL_PENALTY_EXTRA_DEFINITIONS.map((item) => item.code)).size, 7);
  for (const item of KHL_PENALTY_EXTRA_DEFINITIONS) assert.ok(isKhlPenaltyExtraCode(item.code));
  assert.equal(isKhlPenaltyExtraCode("has_penalty"), false);
});

test("orders fixture events chronologically and retains simultaneous last-team ambiguity", () => {
  const input = fixture();
  const original = JSON.stringify(input);
  const projected = projectKhlPenaltyExtras(input);
  assert.equal(projected.version, "khl-penalty-extras-v1");
  assert.equal(projected.scope, "regulation");
  assert.equal(projected.available, true);
  assert.equal(result(input, "first_penalty_team").value, "home");
  assert.equal(result(input, "last_penalty_team").value, null);
  assert.match(result(input, "last_penalty_team").displayValue, /Обе команды/);
  assert.equal(result(input, "last_penalty_team").evidence.length, 2);
  assert.equal(result(input, "first_two_minute_penalty_type").value, "other_or_none");
  assert.equal(result(input, "first_penalty_first_five_minutes").value, false);
  assert.equal(result(input, "first_penalty_first_five_minutes").evidence[0].elapsedSeconds, 303);
  assert.equal(JSON.stringify(input), original);
  assert.deepEqual(projectKhlPenaltyExtras({ ...input, penalties: [...input.penalties].reverse() }), projected);
});

test("does not guess a team when both teams have the first penalty at the same clock", () => {
  const input = fixture("overtime-penalties-901702.json");
  assert.equal(result(input, "first_penalty_team").value, null);
  assert.ok(result(input, "first_penalty_team").issues.length);
  assert.equal(result(input, "first_two_minute_penalty_type").value, "roughing");
  assert.equal(result(input, "last_penalty_team").evidence[0].elapsedSeconds, 3111);
  assert.equal(result(input, "has_five_minute_penalty").value, true);
  assert.equal(result(input, "has_ten_minute_penalty").value, true);
  assert.equal(result(input, "has_game_misconduct").value, false);
  assert.equal(result(input, "first_penalty_first_five_minutes").value, true);
});

test("recognizes explicit 5+20 rows and excludes penalty shots from removals", () => {
  const input = fixture("penalty-four-877124.json");
  assert.equal(result(input, "first_penalty_team").evidence[0].elapsedSeconds, 1101);
  assert.equal(result(input, "has_five_minute_penalty").value, true);
  assert.equal(result(input, "has_game_misconduct").value, true);
  assert.equal(result(input, "has_ten_minute_penalty").value, false);
  assert.equal(result(input, "first_two_minute_penalty_type").value, "tripping");
});

test("recognizes the first team penalty even when no player is attached", () => {
  const input = fixture("shootout-897491.json");
  assert.equal(result(input, "first_penalty_team").value, "away");
  assert.equal(result(input, "first_two_minute_penalty_type").value, "too_many_players");
});

test("confirmed absence produces negative booleans and explicit no-penalty categories", () => {
  const input = match([]);
  assert.equal(projectKhlPenaltyExtras(input).available, true);
  assert.equal(result(input, "first_penalty_team").value, "none");
  assert.equal(result(input, "last_penalty_team").displayValue, "Нет удаления");
  assert.equal(result(input, "first_two_minute_penalty_type").value, "other_or_none");
  for (const item of projectKhlPenaltyExtras(input).extras.filter((extra) => extra.kind === "boolean")) {
    assert.equal(item.value, false);
    assert.equal(item.displayValue, "Нет");
  }
});

test("legacy nonempty evidence remains usable but unconfirmed empty or explicit incomplete evidence does not", () => {
  const { penaltyEvidence: _evidence, ...legacy } = match([]) as NormalizedKhlMatch & { penaltyEvidence?: { complete: boolean } };
  assert.equal(projectKhlPenaltyExtras(legacy).available, false);
  assert.equal(projectKhlPenaltyExtras({ ...legacy, penalties: [penalty()] }).available, true);
  const incomplete = { ...match([penalty()]), penaltyEvidence: { complete: false } };
  assert.equal(projectKhlPenaltyExtras(incomplete).available, false);
  assert.ok(projectKhlPenaltyExtras(incomplete).extras.every((extra) => extra.value === null));
  assert.ok(projectKhlPenaltyExtras(incomplete).issues.length);
});

test("unfinished and invalid matches never produce final penalty outcomes", () => {
  for (const input of [match([penalty()], { status: "live" }), match([penalty()], { validation: { ok: false, issues: ["source mismatch"] } })]) {
    const projection = projectKhlPenaltyExtras(input);
    assert.equal(projection.available, false);
    assert.ok(projection.extras.every((extra) => extra.value === null && extra.issues.length > 0));
  }
});

test("invalid source clocks or penalty durations make outcomes unavailable", () => {
  for (const candidate of [penalty({ elapsedSeconds: -1 }), penalty({ elapsedSeconds: NaN }), penalty({ durationMinutes: -2 }), penalty({ durationMinutes: Infinity })]) {
    assert.equal(projectKhlPenaltyExtras(match([candidate])).available, false);
  }
});

test("ignores overtime for all outcomes even when it contains every requested penalty kind", () => {
  const input = match([2, 5, 10, 20].map((durationMinutes) => penalty({ period: 4, segment: "OT1", elapsedSeconds: 3601, durationMinutes, reason: "Дисциплинарный штраф до конца игры" })));
  assert.ok(projectKhlPenaltyExtras(input).extras.filter((extra) => extra.kind === "boolean").every((extra) => extra.value === false));
  assert.equal(result(input, "first_penalty_team").value, "none");
});

test("zero-minute penalty shots and four-minute double minors are not two-minute penalties", () => {
  const input = match([penalty({ durationMinutes: 0 }), penalty({ durationMinutes: 4, elapsedSeconds: 120, reason: "Игра высоко поднятой клюшкой" }), penalty({ elapsedSeconds: 200, reason: "Удар клюшкой" })]);
  assert.equal(result(input, "first_penalty_team").evidence[0].elapsedSeconds, 120);
  assert.equal(result(input, "first_two_minute_penalty_type").value, "slashing");
  assert.equal(result(match([penalty({ durationMinutes: 4 })]), "first_two_minute_penalty_type").value, "other_or_none");
});

test("disciplinary-until-end requires both the 20-minute duration and explicit reason", () => {
  for (const candidate of [penalty({ durationMinutes: 5 }), penalty({ durationMinutes: 10, reason: "Дисциплинарный штраф" }), penalty({ durationMinutes: 25, reason: "Матч-штраф" }), penalty({ durationMinutes: 20, reason: "Драка" })]) {
    assert.equal(result(match([candidate]), "has_game_misconduct").value, false);
  }
  for (const reason of ["Дисциплинарный штраф до конца игры", "Дисциплинарный штраф до конца матча", "Game Misconduct"]) {
    assert.equal(result(match([penalty({ durationMinutes: 20, reason })]), "has_game_misconduct").value, true);
  }
});

test("the first-five-minutes interval is explicitly [00:00,05:00)", () => {
  for (const elapsedSeconds of [0, 59, 60, 299, 300, 301]) {
    assert.equal(result(match([penalty({ elapsedSeconds })]), "first_penalty_first_five_minutes").value, elapsedSeconds < 300);
  }
});

test("same-clock same-team penalties resolve a team while different first-minor reasons stay ambiguous", () => {
  const input = match([penalty(), penalty({ reason: "Грубость" })]);
  assert.equal(result(input, "first_penalty_team").value, "home");
  assert.equal(result(input, "last_penalty_team").value, "home");
  assert.equal(result(input, "first_two_minute_penalty_type").value, null);
  assert.ok(result(input, "first_two_minute_penalty_type").issues.length);
  assert.equal(result(match([penalty({ reason: "Грубость" }), penalty({ reason: "Roughing", teamSide: "away" })]), "first_two_minute_penalty_type").value, "roughing");
});

test("maps source reasons using explicit aliases and keeps unknown text distinct from missing text", () => {
  const examples = {
    tripping: ["Подножка", "  ПОДНОЖКА (Tripping)  "],
    interference: ["Блокировка", "Атака игрока, не владеющего шайбой", "Атака вратаря", "Interference on goalkeeper"],
    roughing: ["Грубость", "Грубая игра (Roughing)"],
    hooking: ["Задержка соперника клюшкой", "Задержка клюшкой (Hooking)"],
    holding: ["Задержка соперника", "Задержка клюшки соперника", "Holding the stick"],
    high_sticking: ["Игра высоко поднятой клюшкой", "High Sticking"],
    cross_checking: ["Толчок клюшкой", "Cross Checking"],
    slashing: ["Удар клюшкой", "Slashing"],
    kneeing: ["Удар коленом", "Kneeing"],
    too_many_players: ["Нарушение численного состава", "Too many players"],
    other_or_none: ["Выброс шайбы", "Совершенно новая причина"],
    tripping_interference: ["Подножка/Атака игрока"],
    tripping_roughing: ["Подножка/Грубая игра"],
    tripping_hooking: ["Подножка/Задержка клюшкой"],
    tripping_holding: ["Подножка/Задержка соперника"],
  };
  for (const [code, reasons] of Object.entries(examples)) {
    assert.ok(KHL_PENALTY_REASON_DEFINITIONS.some((item) => item.code === code));
    for (const reason of reasons) assert.equal(result(match([penalty({ reason })]), "first_two_minute_penalty_type").value, code, reason);
  }
  assert.equal(result(match([penalty({ reason: "  " })]), "first_two_minute_penalty_type").value, null);
});

test("projection does not share mutable evidence objects with the source", () => {
  const input = match([penalty()]);
  const projected = projectKhlPenaltyExtras(input);
  projected.extras[0].evidence[0].reason = "changed output";
  assert.equal(input.penalties[0].reason, "Подножка");
});
