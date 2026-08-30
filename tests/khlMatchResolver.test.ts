import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveAdminMatch,
  type AdminMatchCandidate,
  type KhlMatchResolutionInput,
} from "../backend/src/results/khl/matchResolver";

const input: KhlMatchResolutionInput = {
  khlGameId: "901973",
  season: "2025/2026",
  stageId: "395",
  startsAt: "2026-05-19T16:30:00.000Z",
  homeAdminTeamId: "admin-team-home",
  awayAdminTeamId: "admin-team-away",
};

const exactCandidate: AdminMatchCandidate = {
  adminMatchId: "admin-match-42",
  startsAt: "2026-05-19T16:30:00.000Z",
  homeAdminTeamId: "admin-team-home",
  awayAdminTeamId: "admin-team-away",
  displayName: "Arbitrary labels must not affect matching",
  season: "2025/2026",
  stageId: "395",
};

test("blocks matching until both team mappings are confirmed", () => {
  const result = resolveAdminMatch({ ...input, awayAdminTeamId: null }, [exactCandidate]);
  assert.deepEqual(result, {
    status: "blocked",
    reason: "unmapped_team",
    diagnostics: { inputCandidates: 1, compatibleCandidates: 0 },
  });
});

test("returns one exact oriented team/date candidate", () => {
  const result = resolveAdminMatch(input, [exactCandidate]);
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.equal(result.mode, "AUTO");
  assert.equal(result.candidate.adminMatchId, "admin-match-42");
  assert.equal(result.matchKey.khlGameId, "901973");
  assert.equal(result.matchKey.stageId, "395");
  assert.equal(result.matchKey.adminMatchId, "admin-match-42");
});

test("blocks ambiguous candidates instead of selecting the first", () => {
  const result = resolveAdminMatch(input, [
    exactCandidate,
    { ...exactCandidate, adminMatchId: "admin-match-43", startsAt: "2026-05-19T17:00:00.000Z" },
  ]);
  assert.deepEqual(result, {
    status: "blocked",
    reason: "ambiguous_match",
    diagnostics: { inputCandidates: 2, compatibleCandidates: 2 },
  });
});

test("deduplicates repeated rows for the same Admin match id", () => {
  const result = resolveAdminMatch(input, [exactCandidate, { ...exactCandidate }]);
  assert.equal(result.status, "ready");
  if (result.status === "ready") assert.equal(result.candidate.adminMatchId, "admin-match-42");
});

test("does not use labels or swapped team order as identity", () => {
  const result = resolveAdminMatch(input, [{
    ...exactCandidate,
    displayName: "Perfect textual match",
    homeAdminTeamId: "admin-team-away",
    awayAdminTeamId: "admin-team-home",
  }]);
  assert.deepEqual(result, {
    status: "blocked",
    reason: "no_compatible_match",
    diagnostics: { inputCandidates: 1, compatibleCandidates: 0 },
  });
});

test("explicit manual selection is accepted only for one compatible candidate", () => {
  const selected = resolveAdminMatch(
    { ...input, confirmedAdminMatchId: "admin-match-42" },
    [exactCandidate]
  );
  assert.equal(selected.status, "ready");
  if (selected.status === "ready") {
    assert.equal(selected.mode, "MANUAL");
    assert.equal(selected.candidate.adminMatchId, "admin-match-42");
  }

  const rejected = resolveAdminMatch(
    { ...input, confirmedAdminMatchId: "unknown-match" },
    [exactCandidate]
  );
  assert.deepEqual(rejected, {
    status: "blocked",
    reason: "manual_match_not_compatible",
    diagnostics: { inputCandidates: 1, compatibleCandidates: 1 },
  });
});

test("manual selection cannot bypass an ambiguous compatible candidate set", () => {
  const candidates = [
    exactCandidate,
    { ...exactCandidate, adminMatchId: "admin-match-43", startsAt: "2026-05-19T17:00:00.000Z" },
  ];
  const result = resolveAdminMatch(
    { ...input, confirmedAdminMatchId: "admin-match-42" },
    candidates
  );
  assert.deepEqual(result, {
    status: "blocked",
    reason: "ambiguous_match",
    diagnostics: { inputCandidates: 2, compatibleCandidates: 2 },
  });
});

test("rejects candidates outside the bounded start-time tolerance", () => {
  const result = resolveAdminMatch(input, [{
    ...exactCandidate,
    startsAt: "2026-05-20T12:30:00.000Z",
  }], { startTimeToleranceMinutes: 360 });
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") assert.equal(result.reason, "no_compatible_match");
});

test("rejects candidates from a different season or stage when identity is supplied", () => {
  for (const candidate of [
    { ...exactCandidate, season: "2024/2025" },
    { ...exactCandidate, stageId: "999" },
  ]) {
    const result = resolveAdminMatch(input, [candidate]);
    assert.equal(result.status, "blocked");
    if (result.status === "blocked") assert.equal(result.reason, "no_compatible_match");
  }
});
