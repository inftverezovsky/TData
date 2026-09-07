import test from "node:test";
import assert from "node:assert/strict";
import { selectManualImportImageItems } from "../frontend/src/components/manualImport/imageQueueModel";
import { getClientAiImageCacheKey } from "../frontend/src/components/manualImport/browserFiles";
import {
  mergeSelectedMatchesWithMappedIds,
  shiftTeamCellSetAfterRemove,
  mergeMatchesWithMappedIds,
  clearManualMatchPlatformIds,
  createAllSelectedIndexes,
  isValidManualAdminId,
  createLockedTeamCellsFromMappedMatches,
  mergeLockedTeamCellsFromSavedMappings,
  getTeamCellData,
  removeFromSet,
  getTeamSideFromMatchField,
  getSelectedMatches,
  mergeSelectedMappedMatches,
} from "../frontend/src/components/manualImport/matchModel";
import {
  getVisibleRecognitionStages,
  getRecognitionStageStatus,
  getParseSourceLabel,
  getImageStatusLabel,
  getImageStatusClass,
} from "../frontend/src/components/manualImport/recognitionModel";
import type { MappedMatch } from "../frontend/src/components/manualImport/types";

test("image queue accepts each new hash once and returns duplicate previews for disposal", () => {
  const files = [
    { hash: "same-image", previewUrl: "blob:first" },
    { hash: "same-image", previewUrl: "blob:duplicate" },
    { hash: "other-image", previewUrl: "blob:other" },
  ];
  const result = selectManualImportImageItems([], files);

  assert.deepEqual(result.acceptedItems, [files[0], files[2]]);
  assert.deepEqual(result.rejectedItems, [files[1]]);
  assert.equal(result.duplicateCount, 1);
  assert.equal(files.length, 3);
});

test("image queue rejects every preview of a hash already in the queue", () => {
  const files = [{ hash: "existing", previewUrl: "blob:again" }];
  const result = selectManualImportImageItems(["existing"], files);
  assert.deepEqual(result.acceptedItems, []);
  assert.deepEqual(result.rejectedItems, files);
});

test("AI image cache separates the same screenshot with different text context", async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { crypto: globalThis.crypto } });
  t.after(() =>
    original ? Object.defineProperty(globalThis, "window", original) : Reflect.deleteProperty(globalThis, "window"),
  );
  const image = new File(["schedule screenshot"], "schedule.png", { type: "image/png" });
  const first = await getClientAiImageCacheKey("73", image, "", "Время указано в Москве");
  const second = await getClientAiImageCacheKey("73", image, "", "Время указано в UTC");

  assert.notEqual(first, second);
  assert.equal(first, await getClientAiImageCacheKey("73", image, "", "Время указано в Москве"));
  assert.notEqual(first, await getClientAiImageCacheKey("74", image, "", "Время указано в Москве"));
});

test("AI image cache is disabled when browser hashing is unavailable", async () => {
  assert.equal(await getClientAiImageCacheKey("73", null, "data:image/png;base64,test", "text"), "");
});

test("selected match mapping preserves unselected rows and explicit IDs", () => {
  const original = [
    { team1: "A", team2: "B", date: "01.09.2026", team1PlatformId: "11" },
    { team1: "C", team2: "D", date: "02.09.2026" },
    { team1: "E", team2: "F", date: "03.09.2026" },
  ];
  const mapped: MappedMatch[] = [
    {
      id: "1",
      tournament: "test",
      team1: { name: "A", platformId: "99" },
      team2: { name: "B", platformId: "22" },
      date: "01.09.2026",
      isReady: true,
    },
    {
      id: "3",
      tournament: "test",
      team1: { name: "E", platformId: "55" },
      team2: { name: "F", platformId: "66" },
      date: "03.09.2026",
      isReady: true,
    },
  ];

  const result = mergeSelectedMatchesWithMappedIds(original, new Set([2, 0]), mapped);
  assert.equal(result[0].team1PlatformId, "11");
  assert.equal(result[0].team2PlatformId, "22");
  assert.equal(result[1], original[1]);
  assert.equal(result[2].team1PlatformId, "55");
  assert.equal(original[2].team1PlatformId, undefined);
});

test("removing a table row shifts saved team cells without mutating previous state", () => {
  const previous = new Set(["0:team1", "1:team2", "2:team1", "invalid"]);
  assert.deepEqual(shiftTeamCellSetAfterRemove(previous, 1), new Set(["0:team1", "1:team1"]));
  assert.deepEqual(previous, new Set(["0:team1", "1:team2", "2:team1", "invalid"]));
});

test("restoring a parsed table preserves explicit IDs and locks only saved manual mappings", () => {
  const raw = [{ team1: "Alpha", team2: "Beta", date: "today", team1PlatformId: "17" }];
  const mapped: MappedMatch[] = [
    {
      id: "m1",
      tournament: "Cup",
      date: "today",
      isReady: true,
      team1: { name: "Alpha", platformId: "18", source: "admin_team" },
      team2: { name: "Beta", platformId: "29", source: "manual" },
    },
  ];
  const merged = mergeMatchesWithMappedIds(raw, mapped);
  assert.equal(merged[0].team1PlatformId, "17");
  assert.equal(merged[0].team2PlatformId, "29");
  assert.deepEqual(createLockedTeamCellsFromMappedMatches(mapped), new Set(["0:team2"]));
  assert.deepEqual(clearManualMatchPlatformIds(merged[0]), { ...raw[0], team1PlatformId: "", team2PlatformId: "" });
  assert.equal(merged[0].team2PlatformId, "29");
  assert.equal(mergeMatchesWithMappedIds(raw, [])[0].team2PlatformId, "");
  assert.deepEqual(getTeamCellData([], mapped, 0, "team1"), { name: "Alpha", platformId: "18" });
  assert.deepEqual(getTeamCellData([], [], 0, "team2"), { name: "", platformId: "" });
});

test("saving a normalized team alias locks its repeated cells but never a team without an ID", () => {
  const matches = [
    { team1: "  ALPHA_team ", team2: "Beta.Team", date: "today", team1PlatformId: "17", team2PlatformId: "29" },
    { team1: "Alpha-Team", team2: "Beta Team", date: "tomorrow", team1PlatformId: "17" },
  ];
  const previous = new Set(["9:team1"]);
  const saved = [
    { teamName: "Alpha Team", platformId: "17" },
    { normalizedTeamName: "betateam", platformId: "29" },
  ];
  assert.deepEqual(
    mergeLockedTeamCellsFromSavedMappings(previous, matches, [], saved),
    new Set(["9:team1", "0:team1", "0:team2", "1:team1"]),
  );
  assert.deepEqual(previous, new Set(["9:team1"]));
  assert.equal(mergeLockedTeamCellsFromSavedMappings(previous, matches, [], []), previous);
});

test("row selection follows table order even when clicks and mapped responses have different indexes", () => {
  const matches = [0, 1, 2].map((index) => ({ team1: `A${index}`, team2: `B${index}`, date: "today" }));
  assert.deepEqual([...createAllSelectedIndexes(3)], [0, 1, 2]);
  const selected = removeFromSet(createAllSelectedIndexes(3), 1);
  assert.deepEqual(getSelectedMatches(matches, selected), [matches[0], matches[2]]);
  const mapped: MappedMatch[] = matches.map((match, index) => ({
    id: String(index),
    tournament: "Cup",
    date: match.date,
    isReady: true,
    team1: { name: match.team1, platformId: String(index + 1) },
    team2: { name: match.team2, platformId: "9" },
  }));
  const updated = { ...mapped[0], id: "updated" };
  const result = mergeSelectedMappedMatches(mapped, new Set([2, 0]), [updated]);
  assert.equal(result[0], updated);
  assert.equal(result[1], mapped[1]);
  assert.equal(result[2], mapped[2]);
  assert.equal(mapped[0].id, "0");
  assert.equal(getTeamSideFromMatchField("team1PlatformId"), "team1");
  assert.equal(getTeamSideFromMatchField("team2"), "team2");
  assert.equal(getTeamSideFromMatchField("date"), null);
  for (const invalid of ["0", "-3", "1.5", "1e3", "", "01"]) assert.equal(isValidManualAdminId(invalid), false);
  assert.equal(isValidManualAdminId(" 73 "), true);
});

test("AI-only progress never claims that OCR ran and completion preserves visited fallback stages", () => {
  const stages = getVisibleRecognitionStages("ai-fallback", {});
  assert.equal(
    stages.some((stage) => stage.id === "ocr"),
    false,
  );
  assert.equal(getRecognitionStageStatus("ai-fallback", "preparing", stages), "done");
  assert.equal(getRecognitionStageStatus("ai-fallback", "ai-fallback", stages), "active");
  assert.equal(getRecognitionStageStatus("ai-fallback", "mapping", stages), "pending");
  assert.equal(getRecognitionStageStatus("idle", "preparing", stages), "pending");
  assert.equal(getRecognitionStageStatus("ai-fallback", "ocr", stages), "pending");
  const completed = getVisibleRecognitionStages("done", { ocr: "OCR завершён", "local-parser": "Разобрано" });
  assert.ok(completed.some((stage) => stage.id === "ocr"));
  assert.equal(getRecognitionStageStatus("done", "done", completed), "done");
  assert.equal(getParseSourceLabel("ocr-cache"), "Кэш OCR");
  assert.equal(getParseSourceLabel("new-provider"), "Распознавание");
  assert.notEqual(getImageStatusLabel("error"), getImageStatusLabel("empty"));
  assert.notEqual(getImageStatusClass("error"), getImageStatusClass("success"));
  assert.equal(getImageStatusClass("queued"), "bg-slate-100 text-slate-500");
});
