import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeManualResponse,
  decodeManualPreview,
  decodeTeamImportResult,
} from "../frontend/src/components/manualImport/response";
import {
  decodeAdminSend,
  decodeAdminPreview,
  decodeSavedAdminMapping,
} from "../frontend/src/components/admin/uploadResponse";

test("manual response rejects malformed match fields before React renders them", () => {
  assert.throws(
    () => decodeManualResponse({ ok: true, rawMatches: [{ team1: {}, team2: "B", date: "today" }] }),
    /team1/,
  );
  assert.throws(
    () => decodeManualResponse({ ok: true, mappedMatches: [{ id: "1", tournament: "T", team1: "wrong", team2: {} }] }),
    /team1/,
  );
});
test("manual response rejects malformed arrays, counters and unrecognized parser sources", () => {
  assert.throws(() => decodeManualResponse({ ok: true, warnings: "bad" }), /warnings/);
  assert.throws(() => decodeManualResponse({ ok: true, savedCount: "10" }), /savedCount/);
  assert.throws(() => decodeManualResponse({ ok: true, parseSource: "unknown-source" }), /parseSource/);
});
test("manual preview rejects structurally incomplete export payloads", () => {
  assert.throws(() => decodeManualPreview({ ok: true, phpArray: { match: "invalid" } }), /phpArray/);
});
test("manual preview accepts the actual API envelope, including multiple header groups", () => {
  const payload = { shapka: 777, sport: 73, max: 1, match: [{ date: "07.09.2026 18:00:00", team1: 111, team2: 222 }] };
  const preview = decodeManualPreview({
    phpArray: [payload, { ...payload, shapka: 778 }],
    phpArrayText: "array()",
    serialized: "fixture",
    postBody: "fixt=fixture",
    readyMatchesCount: 2,
    skippedMatches: [],
    warnings: [],
    mappedMatches: [],
  });
  assert.deepEqual(preview.phpArray, [payload, { ...payload, shapka: 778 }]);
});
test("valid recognition data is preserved without trusting extra response keys", () => {
  const data = decodeManualResponse({
    ok: true,
    rawMatches: [{ team1: "A", team2: "B", date: "today" }],
    parseSource: "ai",
    extra: "ignored",
  });
  assert.equal(data.rawMatches?.[0].team1, "A");
  assert.equal(data.parseSource, "ai");
  assert.equal("extra" in data, false);
});

test("admin send and preview reject unsafe render values and unconfirmed mapping saves", () => {
  assert.throws(() => decodeAdminSend({ ok: true, rawResponse: {} }), /rawResponse/);
  assert.throws(() => decodeAdminPreview({ ok: true, phpArray: { match: [] } }), /phpArray/);
  assert.throws(() => decodeSavedAdminMapping({}), /adminShapkaId/);
  assert.equal(decodeAdminSend({ ok: true, status: 200, markedMatchesCount: 2 }).status, "200");
});

test("recognized matches retain manual provenance, conflict IDs and finite timing measurements", () => {
  const data = decodeManualResponse({
    ok: true,
    status: 200,
    timings: { parseMs: 123.5 },
    mappedMatches: [
      {
        id: "m1",
        tournament: "Cup",
        date: "today",
        isReady: false,
        team1: { name: "Alpha", platformId: "12", source: "manual" },
        team2: { name: "Beta", platformId: null, source: null },
      },
    ],
    conflicts: [{ teamName: "Alpha", normalizedTeamName: "alpha", existingPlatformId: "12", incomingPlatformId: "13" }],
    savedMappings: [{ teamName: "Beta", normalizedTeamName: "beta", platformId: "14" }],
  });
  assert.equal(data.mappedMatches?.[0].team1.source, "manual");
  assert.equal(data.conflicts?.[0].existingPlatformId, "12");
  assert.equal(data.savedMappings?.[0].platformId, "14");
  assert.deepEqual(data.timings, { parseMs: 123.5 });
  assert.equal(data.status, "200");
  assert.equal(decodeManualResponse({ ok: true, status: "accepted" }).status, "accepted");
  assert.throws(() => decodeManualResponse({ ok: true, timings: { parseMs: Number.NaN } }), /parseMs/);
});

test("team import response supports a headerless sheet while validating mapping counters", () => {
  const result = decodeTeamImportResult({
    importedCount: 2,
    skippedCount: 1,
    detectedLayout: { headerRowIndex: -1, dataStartRow: 0, idCol: 0, nameCol: 1, source: "data" },
    mappingResult: {
      adminTeamsCount: 2,
      liquipediaTeamsFound: 1,
      autoMappedCount: 1,
      ambiguousCount: 0,
      unmappedCount: 0,
      newlyMappedNames: ["Alpha"],
    },
  });
  assert.equal(result.success, true);
  assert.equal(result.detectedLayout?.dataStartRow, 0);
  assert.deepEqual(result.mappingResult?.newlyMappedNames, ["Alpha"]);
  assert.equal(decodeTeamImportResult({ success: false, importedCount: 0 }).success, false);
  assert.throws(() => decodeTeamImportResult({ importedCount: "2" }), /importedCount/);
  assert.throws(
    () => decodeTeamImportResult({ importedCount: 2, mappingResult: { adminTeamsCount: "bad" } }),
    /adminTeamsCount/,
  );
});
