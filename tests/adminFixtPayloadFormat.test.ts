import assert from "node:assert/strict";
import test from "node:test";
import { toAdminFixtPayloadEnvelope } from "../src/lib/adminUpload/fixtPayloadFormat";
import { phpSerialize } from "../src/lib/adminUpload/phpSerialize";
import { toPhpString } from "../src/lib/adminUpload/utils";

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
