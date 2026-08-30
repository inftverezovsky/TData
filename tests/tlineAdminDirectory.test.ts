import assert from "node:assert/strict";
import test from "node:test";

import {
  buildManualAdminTeamRecord,
  normalizeAdminExternalId,
  summarizeDirectoryImport,
} from "../backend/src/tline/admin/directory";

test("Admin hierarchy IDs accept only positive decimal strings", () => {
  assert.equal(normalizeAdminExternalId(" 833524 "), "833524");
  assert.equal(normalizeAdminExternalId(73), "73");
  for (const invalid of ["", "0", "-1", "73.5", "abc73", null]) {
    assert.throws(() => normalizeAdminExternalId(invalid), /positive integer/i);
  }
});

test("free manual Team ID creates a stable locked AdminTeam fallback", () => {
  const record = buildManualAdminTeamRecord({
    disciplineSlug: "volleyball",
    platformId: "987654",
    adminName: "",
    sourceTeamName: "Локомотив",
  });

  assert.deepEqual(record, {
    id: "admin_volleyball_987654",
    disciplineSlug: "volleyball",
    platformId: "987654",
    platformName: "Локомотив",
    platformNameRu: "Локомотив",
    platformNameEn: null,
    normalizedName: "локомотив",
    normalizedNameRu: "локомотив",
    normalizedNameEn: null,
    sourceFileName: "tline-manual",
  });
});

test("additive import summary never reports removals", () => {
  assert.deepEqual(summarizeDirectoryImport({ created: 2, updated: 3, linked: 4, skipped: 1 }), {
    importedCount: 5,
    createdCount: 2,
    updatedCount: 3,
    membershipCount: 4,
    skippedCount: 1,
    removedCount: 0,
  });
});
