import assert from "node:assert/strict";
import test from "node:test";
import { decideTournamentSnapshotWrite, TournamentSnapshotRejectedError } from "../backend/src/sources/importSafety";

test("snapshot rejection errors map upstream timeouts and explicit statuses", () => {
  const timeout = new TournamentSnapshotRejectedError("slow upstream", "upstream_timeout");
  assert.equal(timeout.name, "TournamentSnapshotRejectedError");
  assert.equal(timeout.errorClass, "upstream_timeout");
  assert.equal(timeout.statusCode, 504);

  const explicit = new TournamentSnapshotRejectedError("invalid markup", "schema_drift", 409);
  assert.equal(explicit.statusCode, 409);
});

test("validated non-empty snapshots may replace previous tournament data", () => {
  assert.deepEqual(decideTournamentSnapshotWrite({
    incomingMatches: 4,
    sourceValidated: true,
  }), {
    allowed: true,
    reason: "validated_non_empty",
  });
});

test("unexplained empty snapshots are rejected even during force refresh", () => {
  assert.deepEqual(decideTournamentSnapshotWrite({
    incomingMatches: 0,
    sourceValidated: true,
    force: true,
  }), {
    allowed: false,
    reason: "unconfirmed_empty",
  });
});

test("an explicit authoritative empty state may replace previous data", () => {
  assert.deepEqual(decideTournamentSnapshotWrite({
    incomingMatches: 0,
    sourceValidated: true,
    explicitAuthoritativeEmpty: true,
  }), {
    allowed: true,
    reason: "authoritative_empty",
  });
});

test("invalid source responses never replace tournament data", () => {
  assert.deepEqual(decideTournamentSnapshotWrite({
    incomingMatches: 12,
    sourceValidated: false,
  }), {
    allowed: false,
    reason: "source_not_validated",
  });
});
