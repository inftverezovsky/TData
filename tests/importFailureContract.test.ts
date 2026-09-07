import assert from "node:assert/strict";
import test from "node:test";

import { sourceError } from "../backend/src/imports/dispatcher";
import { TournamentSnapshotRejectedError } from "../backend/src/sources/importSafety";
import { inferTournamentImportStatus } from "../frontend/src/app/api/[disciplineSlug]/import-tournament/route";

test("rejected parser snapshots preserve HTTP status and classification without exposing source diagnostics", () => {
  const result = sourceError(
    new TournamentSnapshotRejectedError("Cloudflare challenge; last-good data was preserved", "cloudflare_block"),
    "HLTV import failed",
    500,
  );

  assert.equal(result.status, 502);
  assert.deepEqual(result.body, {
    error: "HLTV import failed",
    errorClass: "cloudflare_block",
  });
});

test("untrusted parser diagnostics cannot leak through the message or classification", () => {
  const result = sourceError(
    Object.assign(new Error("synthetic-sensitive-upstream-value"), { errorClass: "synthetic-sensitive-class-value", statusCode: 502 }),
    "Import failed",
    500,
    true,
  );
  assert.equal(result.status, 502);
  assert.deepEqual(result.body, { error: "Import failed", userMessage: "Import failed", errorClass: "unknown" });
});

test("upstream timeouts map to HTTP 504", () => {
  const result = sourceError(
    new TournamentSnapshotRejectedError("Source timed out", "upstream_timeout"),
    "Import failed",
    500,
  );
  assert.equal(result.status, 504);
});

test("partial parser results cannot be presented by the import route as HTTP success", () => {
  assert.equal(inferTournamentImportStatus({ normalized: { status: "SUCCESS" } }), 200);
  assert.equal(inferTournamentImportStatus({ tournament: { id: "old" }, normalized: { status: "PARTIAL" } }), 502);
  assert.equal(inferTournamentImportStatus({ tournament: { id: "old" }, normalized: { status: "FAILED" } }), 502);
});
