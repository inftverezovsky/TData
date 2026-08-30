import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaClient } from "@prisma/client";

import {
  buildManualAdminTeamRecord,
  importTLineAdminDirectory,
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

test("directory import updates existing rows, adds memberships and never removes missing teams", async () => {
  const upserts: Array<Record<string, unknown>> = [];
  const transaction = {
    adminTeam: {
      findFirst: async ({ where }: { where: { platformId: string } }) => where.platformId === "1" ? { id: "admin-existing" } : null,
      upsert: async (input: Record<string, unknown>) => { upserts.push(input); return input; },
    },
    tLineGlobalHeaderAdminTeam: {
      findUnique: async ({ where }: { where: { globalHeaderId_adminTeamId: { adminTeamId: string } } }) => where.globalHeaderId_adminTeamId.adminTeamId === "admin-existing" ? { adminTeamId: "admin-existing" } : null,
      upsert: async (input: Record<string, unknown>) => input,
    },
  };
  const client = {
    tLineChampionship: {
      findUnique: async () => ({
        globalHeader: { id: "header-1", active: true },
        sportConfig: { discipline: { slug: "volleyball" } },
      }),
    },
    $transaction: async (callback: (value: typeof transaction) => unknown) => callback(transaction),
  } as unknown as PrismaClient;
  const record = (platformId: string, platformName: string) => ({
    platformId,
    platformName,
    platformNameRu: platformName,
    platformNameEn: null,
    normalizedName: platformName.toLowerCase(),
    normalizedNameRu: platformName.toLowerCase(),
    normalizedNameEn: null,
  });
  const result = await importTLineAdminDirectory(client, {
    championshipId: "champ-1",
    records: [record("1", "Первая"), record("2", "Вторая")],
    sourceFileName: "teams.xlsx",
    skippedCount: 1,
  });
  assert.equal(upserts.length, 2);
  assert.deepEqual(result, { importedCount: 2, createdCount: 1, updatedCount: 1, membershipCount: 1, skippedCount: 1, removedCount: 0 });
});

test("directory import requires a championship with an active Shapka", async () => {
  const missing = { tLineChampionship: { findUnique: async () => null } } as unknown as PrismaClient;
  await assert.rejects(importTLineAdminDirectory(missing, { championshipId: "missing", records: [], sourceFileName: "teams.xlsx" }), /not found/i);
  const unassigned = {
    tLineChampionship: { findUnique: async () => ({ globalHeader: null, sportConfig: { discipline: { slug: "volleyball" } } }) },
  } as unknown as PrismaClient;
  await assert.rejects(importTLineAdminDirectory(unassigned, { championshipId: "champ", records: [], sourceFileName: "teams.xlsx" }), /Assign an active Global Header/i);
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
