import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  buildKhlAdminCanonicalPayload,
  KhlAdminPayloadError,
  type KhlAdminBindings,
} from "../backend/src/results/khl/adminPayload";
import { normalizeKhlEventDetail } from "../backend/src/sources/results/khl/normalize";

function fixture(name: string) {
  return JSON.parse(
    readFileSync(join(process.cwd(), "tests", "fixtures", "khl", name), "utf8")
  );
}

function bindingsFor(match: ReturnType<typeof normalizeKhlEventDetail>): KhlAdminBindings {
  return {
    adminMatchId: "50001",
    teams: {
      home: {
        adminTeamId: "101",
        stats: {
          shots_on_goal: { adminStatTypeId: "11", adminMatchStatId: "70001" },
          faceoffs_won: { adminStatTypeId: "12", adminMatchStatId: "70002" },
          power_play_goals: { adminStatTypeId: "13", adminMatchStatId: "70003" },
          penalty_minutes_2_4: { adminStatTypeId: "14", adminMatchStatId: "70004" },
        },
      },
      away: {
        adminTeamId: "202",
        stats: {
          shots_on_goal: { adminStatTypeId: "11", adminMatchStatId: "80001" },
          faceoffs_won: { adminStatTypeId: "12", adminMatchStatId: "80002" },
          power_play_goals: { adminStatTypeId: "13", adminMatchStatId: "80003" },
          penalty_minutes_2_4: { adminStatTypeId: "14", adminMatchStatId: "80004" },
        },
      },
    },
    playerStatTypes: {
      goals: "21",
      assists: "22",
      points: "23",
    },
    players: Object.fromEntries(
      match.players.map((player, index) => [
        player.khlPlayerId,
        {
          adminPlayerId: String(9000 + index),
          adminMatchPlayerId: String(880000 + index),
          adminPlayerStatIds: {
            goals: String(910000 + index * 3),
            assists: String(910001 + index * 3),
            points: String(910002 + index * 3),
          },
        },
      ])
    ),
  };
}

test("builds deterministic regulation-only canonical Admin payload", () => {
  const match = normalizeKhlEventDetail(fixture("overtime-901952.json"));
  const result = buildKhlAdminCanonicalPayload({
    match,
    bindings: bindingsFor(match),
    revisionId: "rev-1",
    sourceContentHash: "a".repeat(64),
    parserVersion: "khl-mobile-v1",
    rulesVersion: "khl-admin-regulation-v1",
  });

  assert.equal(result.payload.schemaVersion, "khl-results.v1");
  assert.equal(result.payload.source.khlGameId, "901952");
  assert.equal(result.payload.match.adminMatchId, "50001");
  assert.deepEqual(result.payload.match.officialScore, { home: 4, away: 3 });
  assert.deepEqual(result.payload.match.regulationScore, { home: 3, away: 3 });

  const shots = result.payload.teamStatistics.find(
    (stat) => stat.statCode === "shots_on_goal"
  );
  assert.deepEqual(shots, {
    statCode: "shots_on_goal",
    adminStatTypeId: "11",
    home: {
      adminTeamId: "101",
      adminMatchStatId: "70001",
      total: 39,
      p1: 10,
      p2: 14,
      p3: 15,
    },
    away: {
      adminTeamId: "202",
      adminMatchStatId: "80001",
      total: 32,
      p1: 13,
      p2: 9,
      p3: 10,
    },
  });

  assert.equal(result.payload.players.length, match.players.length);
  const overtimeScorer = result.payload.players.find(
    (player) => player.externalPlayerId === "30198"
  );
  assert.deepEqual(
    {
      goals: overtimeScorer?.goals,
      assists: overtimeScorer?.assists,
      points: overtimeScorer?.points,
    },
    { goals: 0, assists: 0, points: 0 }
  );
  assert.match(result.payloadHash, /^[a-f0-9]{64}$/);

  const repeated = buildKhlAdminCanonicalPayload({
    match,
    bindings: bindingsFor(match),
    revisionId: "rev-1",
    sourceContentHash: "a".repeat(64),
    parserVersion: "khl-mobile-v1",
    rulesVersion: "khl-admin-regulation-v1",
  });
  assert.equal(repeated.canonicalJson, result.canonicalJson);
  assert.equal(repeated.payloadHash, result.payloadHash);
});

test("blocks the entire payload when one participant binding is missing", () => {
  const match = normalizeKhlEventDetail(fixture("regulation-901973.json"));
  const bindings = bindingsFor(match);
  delete bindings.players[match.players[0].khlPlayerId];

  assert.throws(
    () => buildKhlAdminCanonicalPayload({
      match,
      bindings,
      revisionId: "rev-2",
      sourceContentHash: "b".repeat(64),
      parserVersion: "khl-mobile-v1",
      rulesVersion: "khl-admin-regulation-v1",
    }),
    (error: unknown) =>
      error instanceof KhlAdminPayloadError &&
      error.issues.some((issue) => issue.includes(match.players[0].khlPlayerId))
  );
});

test("blocks payloads from invalid or unfinished source revisions", () => {
  const match = normalizeKhlEventDetail(fixture("regulation-901973.json"));
  match.status = "live";

  assert.throws(
    () => buildKhlAdminCanonicalPayload({
      match,
      bindings: bindingsFor(match),
      revisionId: "rev-3",
      sourceContentHash: "c".repeat(64),
      parserVersion: "khl-mobile-v1",
      rulesVersion: "khl-admin-regulation-v1",
    }),
    /finished/i
  );
});
