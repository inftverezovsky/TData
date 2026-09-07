import test from "node:test";
import assert from "node:assert/strict";
import {
  nextSuggestionIndex,
  buildMappingState,
  getPreviewSelectionKey,
  isValidPlatformId,
  formatScore,
  formatMappingStatus,
  formatPreviewReason,
  formatSuggestionAlternateName,
  formatSuggestionMatchType,
  formatMatchMethod,
} from "../frontend/src/components/tournament/teamMapping/model";
import {
  decodeTeamSuggestions,
  decodeAutoMappingPreview,
  decodeAutoMappingResponse,
  decodeMappingSaveResponse,
} from "../frontend/src/components/tournament/teamMapping/response";
import type { TeamMappingRecord } from "../frontend/src/components/tournament/teamMapping/types";

test("keyboard suggestion navigation wraps and handles an empty directory", () => {
  assert.equal(nextSuggestionIndex(-1, 1, 3), 0);
  assert.equal(nextSuggestionIndex(-1, -1, 3), 2);
  assert.equal(nextSuggestionIndex(2, 1, 3), 0);
  assert.equal(nextSuggestionIndex(0, -1, 3), 2);
  assert.equal(nextSuggestionIndex(0, 1, 0), -1);
});

test("mapping boundary rejects invalid lists and renders only validated suggestions", () => {
  assert.throws(() => decodeAutoMappingPreview({ auto: {} }), /adminTeamsCount|auto/);
  assert.throws(() => decodeTeamSuggestions({ items: [{ platformId: 1 }], adminTeamsCount: 1 }), /platformId/);
  const result = decodeTeamSuggestions({
    items: [{ platformId: "1", platformName: "A", score: 100, matchType: "exact" }],
    adminTeamsCount: 1,
  });
  assert.equal(result.items[0].platformName, "A");
});

test("the mapping editor restores the preferred manual alias without treating an unknown team as saved", () => {
  const automatic: TeamMappingRecord = {
    id: "auto",
    liquipediaName: "Alpha",
    alias: "Alpha Esports",
    canonicalName: "Alpha",
    platformId: "10",
    confidenceScore: 96,
    status: "auto_mapped",
    matchMethod: "exact",
    isManual: false,
    isLockedFromAutoMapping: false,
  };
  const manual = {
    ...automatic,
    id: "manual",
    platformId: "20",
    status: "manual_mapped",
    isManual: true,
    isLockedFromAutoMapping: true,
  };
  const records = [automatic, manual];
  const state = buildMappingState(["Alpha Esports", "Unknown"], records);
  assert.equal(state["Alpha Esports"].platformId, "20");
  assert.equal(state["Alpha Esports"].saved, true);
  assert.equal(state.Unknown.saved, false);
  state["Alpha Esports"].platformId = "changed in draft";
  assert.equal(manual.platformId, "20");
  assert.deepEqual(records, [automatic, manual]);
});

test("preview selections distinguish competing IDs and reject invalid platform identifiers", () => {
  const choice = { liquipediaName: " Alpha ", platformId: " 12 " };
  assert.equal(getPreviewSelectionKey(choice), getPreviewSelectionKey({ liquipediaName: "alpha", platformId: "12" }));
  assert.notEqual(getPreviewSelectionKey(choice), getPreviewSelectionKey({ ...choice, platformId: "13" }));
  assert.notEqual(getPreviewSelectionKey(choice), getPreviewSelectionKey({ liquipediaName: "Alpha" }));
  for (const invalid of [undefined, null, "0", "001", "-1", "1e6", "12.5"])
    assert.equal(isValidPlatformId(invalid), false);
  assert.equal(isValidPlatformId(" 12 "), true);
});

test("operator diagnostics distinguish a manual conflict from missing data and keep new server codes readable", () => {
  assert.equal(formatMappingStatus("manual_mapped"), "Ручное");
  assert.equal(formatMappingStatus("manual_unmapped"), "Очищено");
  assert.equal(formatMappingStatus(null), "Без ID");
  assert.equal(formatMappingStatus("pending_review"), "pending review");
  assert.equal(formatPreviewReason("locked_manual_conflict"), "конфликт с ручным ID");
  assert.equal(formatPreviewReason("no_admin_teams"), "справочник админ-команд не импортирован");
  assert.equal(formatPreviewReason("new_reason"), "new reason");
  assert.equal(formatPreviewReason(undefined), "");
  assert.equal(formatMatchMethod("manual_conflict_replace"), "замена конфликта вручную");
  assert.equal(formatMatchMethod("manual_suggest"), "ручной ввод");
  assert.equal(formatMatchMethod("alias_exact"), "точное совпадение по алиасу");
  assert.equal(formatMatchMethod(undefined), "не указан");
  assert.equal(formatMatchMethod("future_method"), "future method");
  assert.equal(formatScore(97.25), "97.3");
  assert.equal(formatScore(Number.NaN), "0.0");
});

test("bilingual suggestions display a different readable name without duplicating the matched alias", () => {
  const base = {
    platformId: "12",
    platformName: "Alpha",
    platformNameEn: "Alpha",
    platformNameRu: "Альфа",
    matchedName: "Альфа",
    score: 1,
    matchType: "exact" as const,
  };
  assert.equal(formatSuggestionAlternateName(base), "Alpha");
  assert.equal(formatSuggestionAlternateName({ ...base, matchedName: "Alpha", platformNameRu: null }), "");
  assert.equal(formatSuggestionMatchType(base.matchType), "точно");
  assert.equal(formatSuggestionMatchType("fuzzy"), "похоже");
});

test("mapping response boundaries retain locked records and reject malformed nested previews", () => {
  const mapping = {
    id: "m1",
    liquipediaName: "Alpha",
    alias: null,
    canonicalName: "Альфа",
    platformId: "12",
    confidenceScore: null,
    status: "manual_mapped",
    matchMethod: "manual",
    isManual: true,
    isLockedFromAutoMapping: true,
  };
  const result = decodeMappingSaveResponse({ mapping });
  assert.equal(result.mapping.isLockedFromAutoMapping, true);
  assert.equal(result.mapping.platformId, "12");
  assert.throws(() => decodeMappingSaveResponse({ mapping: { ...mapping, isManual: "true" } }), /isManual/);
  const preview = {
    adminTeamsCount: 2,
    liquipediaTeamsFound: 1,
    alreadyMappedCount: 0,
    auto: [],
    suggested: [],
    ambiguous: [],
    unmapped: [],
    invalid: [],
    conflicts: [
      {
        liquipediaName: "Alpha",
        platformId: "13",
        existingPlatformId: "12",
        reason: "locked_manual_conflict",
        score: null,
      },
    ],
  };
  const response = decodeAutoMappingResponse({ success: true, result: { appliedCount: 0, preview } });
  assert.equal(response.result?.preview?.conflicts[0].existingPlatformId, "12");
  assert.throws(
    () =>
      decodeAutoMappingResponse({
        success: true,
        result: { appliedCount: 1, preview: { ...preview, conflicts: [{}] } },
      }),
    /liquipediaName/,
  );
});
