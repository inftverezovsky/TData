import assert from "node:assert/strict";
import test from "node:test";
import { buildFixtPayloadsByShapka, type FixtMatch } from "../backend/src/adminUpload/buildFixtPayload";
import { toAdminFixtPayloadEnvelope } from "../backend/src/adminUpload/fixtPayloadFormat";
import {
  appendShapkaOverridesSearchParam,
  normalizeShapkaOverrides,
  readShapkaOverridesSearchParam,
} from "../backend/src/adminUpload/shapkaOverrides";
import { phpSerialize } from "../backend/src/adminUpload/phpSerialize";
import { toPhpString } from "../backend/src/adminUpload/utils";

test("admin FIxt payload is wrapped as the service array format", () => {
  const payload = {
    shapka: 833524,
    sport: 73,
    max: 5000,
    match: [
      { date: "15.05.2026 20:10:00", team1: 272339, team2: 426145 },
      { date: "15.05.2026 23:25:00", team1: 188628, team2: 357589 },
    ],
  };

  const envelope = toAdminFixtPayloadEnvelope(payload);

  assert.deepEqual(envelope, [payload]);
  assert.match(JSON.stringify(envelope), /^\[\{/);
  assert.match(toPhpString(envelope), /\[0\] => Array/);
  assert.match(phpSerialize(envelope), /^a:1:\{i:0;a:4:/);
});

test("admin FIxt envelope is not double wrapped", () => {
  const payload = {
    shapka: 833524,
    sport: 73,
    max: 5000,
    match: [{ date: "15.05.2026 20:10:00", team1: 272339, team2: "" as "" }],
  };
  const envelope = [payload] as [typeof payload];

  assert.equal(toAdminFixtPayloadEnvelope(envelope), envelope);
});

test("admin FIxt envelope supports multiple shapka payload blocks", () => {
  const payloads = [
    {
      shapka: 101,
      sport: 73,
      max: 5000,
      match: [{ date: "15.05.2026 20:10:00", team1: 272339, team2: 426145 }],
    },
    {
      shapka: 202,
      sport: 73,
      max: 5000,
      match: [{ date: "15.05.2026 23:25:00", team1: 188628, team2: 357589 }],
    },
  ];

  const envelope = toAdminFixtPayloadEnvelope(payloads);

  assert.equal(envelope, payloads);
  assert.match(JSON.stringify(envelope), /^\[\{/);
  assert.match(toPhpString(envelope), /\[1\] => Array/);
  assert.match(phpSerialize(envelope), /^a:2:\{i:0;a:4:/);
});

test("shapka override query encoding keeps only filled numeric group IDs", () => {
  const params = new URLSearchParams();

  appendShapkaOverridesSearchParam(params, {
    "match-1": "555",
    "match-2": "",
    "match-3::stage": "abc666",
  });

  assert.deepEqual(readShapkaOverridesSearchParam(params), {
    "match-1": "555",
    "match-3::stage": "666",
  });
  assert.deepEqual(normalizeShapkaOverrides({ "match-4": null, "match-5": "777" }), {
    "match-5": "777",
  });
});

test("admin FIxt payload blocks split by filled group shapka and merge empty fallback groups", () => {
  const fallbackMatch: FixtMatch = { date: "15.05.2026 20:10:00", team1: 272339, team2: 426145 };
  const overrideMatch: FixtMatch = { date: "15.05.2026 23:25:00", team1: 188628, team2: 357589 };
  const anotherFallbackMatch: FixtMatch = { date: "16.05.2026 19:00:00", team1: 111111, team2: 222222 };

  const groups = new Map<string, FixtMatch[]>([
    ["101", [fallbackMatch, anotherFallbackMatch]],
    ["202", [overrideMatch]],
  ]);

  assert.deepEqual(buildFixtPayloadsByShapka(groups, 73, 5000), [
    { shapka: 101, sport: 73, max: 5000, match: [fallbackMatch, anotherFallbackMatch] },
    { shapka: 202, sport: 73, max: 5000, match: [overrideMatch] },
  ]);
});
