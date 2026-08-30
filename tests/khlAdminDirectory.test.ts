import assert from "node:assert/strict";
import test from "node:test";

import {
  buildKhlAdminDirectorySuggestions,
  buildKhlAdminDirectorySearch,
} from "../backend/src/results/khl/adminDirectory";

const directory = [
  {
    disciplineSlug: "hockey",
    platformId: "7001",
    platformName: "Иванов Иван Сергеевич",
    platformNameRu: "Иванов Иван Сергеевич",
    platformNameEn: "Ivan Ivanov",
  },
  {
    disciplineSlug: "46",
    platformId: "7002",
    platformName: "Иванов Пётр",
    platformNameRu: "Иванов Пётр",
    platformNameEn: null,
  },
  {
    disciplineSlug: "hockey",
    platformId: "8100",
    platformName: "ХК Динамо Москва",
    platformNameRu: "ХК Динамо Москва",
    platformNameEn: "Dynamo Moscow",
  },
];

test("Admin directory search accepts an exact ID and a surname/name anchor", () => {
  assert.deepEqual(buildKhlAdminDirectorySearch("7001"), {
    kind: "id",
    exactId: "7001",
    anchors: [],
  });
  const byName = buildKhlAdminDirectorySearch("Иван Иванов");
  assert.equal(byName.kind, "name");
  assert.ok(byName.anchors.includes("иванов"));
  assert.ok(byName.anchors.includes("иван"));
});

test("Admin directory suggestions support ID and surname/name without auto-confirming", () => {
  const byId = buildKhlAdminDirectorySuggestions(directory, "7001", 8);
  assert.equal(byId.length, 1);
  assert.equal(byId[0].platformId, "7001");
  assert.equal(byId[0].matchType, "exact_id");

  const reversedName = buildKhlAdminDirectorySuggestions(directory, "Иван Иванов", 8);
  assert.equal(reversedName[0].platformId, "7001");
  assert.equal(reversedName[0].platformName, "Иванов Иван Сергеевич");
  assert.ok(reversedName[0].score > 0.8);
  assert.deepEqual(reversedName[0].scopes, ["hockey"]);

  const team = buildKhlAdminDirectorySuggestions(directory, "Динамо Москва", 8);
  assert.equal(team[0].platformId, "8100");
});
