import test from "node:test";
import assert from "node:assert/strict";
import { buildEsportsParsingDiagnostics } from "../backend/src/matches/parsingDiagnostics";

test("diagnostics treat finished=true template flags as finished results", () => {
  const diagnostics = buildEsportsParsingDiagnostics({
    source: "liquipedia",
    rawCandidates: 1,
    savedMatches: 0,
    candidates: [
      {
        teamAName: "Alpha",
        teamBName: "Bravo",
        status: "true",
        matchDateTime: "May 17, 2026 - 13:00 CST",
      },
    ],
  });

  assert.equal(diagnostics.coverage.finishedResults, 1);
  assert.equal(diagnostics.skipReasons.finished_result, 1);
  assert.equal(diagnostics.skipReasons.no_exact_time, 0);
});
