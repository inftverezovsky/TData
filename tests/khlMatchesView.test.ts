import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { buildKhlMatchResponseItem } from "../frontend/src/app/api/results/khl/matches/route";
import { normalizeKhlEventDetail } from "../backend/src/sources/results/khl/normalize";

const SOURCE_SEGMENT_MISMATCH = "source/segment mismatch for shots_on_goal";

test("matches view exposes a rejected-first revision as diagnostic protocol metadata", () => {
  const rejected = rejectedNormalized();
  const latestRevision = revision({
    id: "revision-rejected-1",
    revisionNumber: 1,
    state: "REJECTED",
    normalizedJson: rejected,
  });

  const result = buildKhlMatchResponseItem({
    id: "match-rejected-first",
    khlGameId: "901956",
    activeRevision: null,
    revisions: [latestRevision],
  });

  assert.equal(result.activeRevision, null);
  assert.deepEqual(result.latestRevision, revisionMetadata(latestRevision));
  assert.deepEqual(result.displayRevision, {
    ...revisionMetadata(latestRevision),
    source: "LATEST_REJECTED",
  });
  assert.equal(result.protocol?.validation.ok, false);
  assert.deepEqual(result.protocol?.validation.issues, [SOURCE_SEGMENT_MISMATCH]);
});

test("matches view displays the newer rejected protocol while retaining active metadata", () => {
  const valid = validNormalized();
  const rejected = rejectedNormalized();
  rejected.scores.regulation.home = valid.scores.regulation.home + 20;
  const activeRevision = revision({
    id: "revision-valid-1",
    revisionNumber: 1,
    state: "VALIDATED",
    normalizedJson: valid,
  });
  const latestRevision = revision({
    id: "revision-rejected-2",
    revisionNumber: 2,
    state: "REJECTED",
    normalizedJson: rejected,
  });

  const result = buildKhlMatchResponseItem({
    id: "match-last-known-good",
    khlGameId: "901956",
    activeRevision,
    revisions: [latestRevision],
  });

  assert.deepEqual(result.activeRevision, revisionMetadata(activeRevision));
  assert.deepEqual(result.latestRevision, revisionMetadata(latestRevision));
  assert.deepEqual(result.displayRevision, {
    ...revisionMetadata(latestRevision),
    source: "LATEST_REJECTED",
  });
  assert.equal(result.protocol?.validation.ok, false);
  assert.deepEqual(result.protocol?.scores.regulation, rejected.scores.regulation);
  assert.notDeepEqual(result.protocol?.scores.regulation, valid.scores.regulation);
});

test("a newer 901981 diagnostic exposes all 47 roster slots including five absent KHL IDs", () => {
  const raw = JSON.parse(readFileSync(
    join(process.cwd(), "tests", "fixtures", "khl", "missing-player-ids-901981.json"), "utf8"
  ));
  const diagnostic = normalizeKhlEventDetail(raw.event || raw);
  // Model an earlier accepted projection; the new official diagnostic must not be hidden by it.
  const previous = structuredClone(diagnostic);
  previous.players = previous.players.filter((player) => player.khlPlayerId !== null);
  previous.validation = { ok: true, issues: [] };
  const activeRevision = revision({ id: "accepted-before-source-correction", revisionNumber: 1, state: "VALIDATED", normalizedJson: previous });
  const latestRevision = revision({ id: "current-source-diagnostic", revisionNumber: 2, state: "REJECTED", normalizedJson: diagnostic });
  const result = buildKhlMatchResponseItem({ khlGameId: "901981", activeRevision, revisions: [latestRevision] });
  assert.equal(result.displayRevision?.source, "LATEST_REJECTED");
  assert.equal(result.protocol?.players.length, 47);
  assert.equal(result.protocol?.players.filter((player) => player.khlPlayerId === null).length, 5);
  assert.equal(result.activeRevision?.id, activeRevision.id);
  assert.equal(result.protocol?.validation.ok, false);
});

function validNormalized() {
  const raw = JSON.parse(readFileSync(
    join(process.cwd(), "tests", "fixtures", "khl", "regulation-901973.json"),
    "utf8"
  ));
  return normalizeKhlEventDetail(raw);
}

function rejectedNormalized() {
  const normalized = structuredClone(validNormalized());
  normalized.validation = { ok: false, issues: [SOURCE_SEGMENT_MISMATCH] };
  return normalized;
}

function revision({
  id,
  revisionNumber,
  state,
  normalizedJson,
}: {
  id: string;
  revisionNumber: number;
  state: "VALIDATED" | "REJECTED";
  normalizedJson: ReturnType<typeof normalizeKhlEventDetail>;
}) {
  return {
    id,
    revisionNumber,
    normalizedHash: `${revisionNumber}`.repeat(64),
    state,
    validationIssues: normalizedJson.validation.issues,
    createdAt: new Date(`2026-08-21T12:0${revisionNumber}:00.000Z`),
    normalizedJson,
  };
}

function revisionMetadata(value: ReturnType<typeof revision>) {
  return {
    id: value.id,
    revisionNumber: value.revisionNumber,
    normalizedHash: value.normalizedHash,
    state: value.state,
    validationIssues: value.validationIssues,
    createdAt: value.createdAt.toISOString(),
  };
}
