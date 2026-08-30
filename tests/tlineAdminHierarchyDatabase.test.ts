import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

import { importTLineAdminDirectory } from "@backend/tline/admin/directory";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test("PostgreSQL keeps Shapka sports isolated and directory imports additive", {
  skip: testDatabaseUrl ? false : "TEST_DATABASE_URL is required for PostgreSQL integration",
}, async () => {
  const prisma = new PrismaClient({ datasources: { db: { url: requireIsolatedDatabaseUrl(testDatabaseUrl!) } } });
  const suffix = randomUUID();
  const ids = {
    disciplineA: `tline-hierarchy-discipline-a-${suffix}`,
    disciplineB: `tline-hierarchy-discipline-b-${suffix}`,
    sportA: `tline-hierarchy-sport-a-${suffix}`,
    sportB: `tline-hierarchy-sport-b-${suffix}`,
    headerA: `tline-hierarchy-header-a-${suffix}`,
    headerA2: `tline-hierarchy-header-a2-${suffix}`,
    headerB: `tline-hierarchy-header-b-${suffix}`,
    championshipA: `tline-hierarchy-champ-a-${suffix}`,
    championshipA2: `tline-hierarchy-champ-a2-${suffix}`,
    championshipOther: `tline-hierarchy-champ-other-${suffix}`,
    sourceTeam: `tline-hierarchy-source-${suffix}`,
  };
  const disciplineSlugA = `tline-hierarchy-a-${suffix}`;
  const imported = (platformId: string, name: string) => ({
    platformId,
    platformName: name,
    platformNameRu: name,
    platformNameEn: null,
    normalizedName: name.toLowerCase(),
    normalizedNameRu: name.toLowerCase(),
    normalizedNameEn: null,
  });

  try {
    await prisma.discipline.createMany({ data: [
      { id: ids.disciplineA, slug: disciplineSlugA, name: "Hierarchy A" },
      { id: ids.disciplineB, slug: `tline-hierarchy-b-${suffix}`, name: "Hierarchy B" },
    ] });
    await prisma.tLineSportConfig.createMany({ data: [
      { id: ids.sportA, disciplineId: ids.disciplineA },
      { id: ids.sportB, disciplineId: ids.disciplineB },
    ] });
    await prisma.tLineGlobalHeader.createMany({ data: [
      { id: ids.headerA, sportConfigId: ids.sportA, adminShapkaId: "101", name: "Shared A" },
      { id: ids.headerA2, sportConfigId: ids.sportA, adminShapkaId: "102", name: "Isolated A" },
      { id: ids.headerB, sportConfigId: ids.sportB, adminShapkaId: "201", name: "Other sport" },
    ] });
    await assert.rejects(
      prisma.tLineChampionship.create({ data: {
        id: `tline-hierarchy-invalid-${suffix}`,
        sportConfigId: ids.sportA,
        globalHeaderId: ids.headerB,
        name: "Invalid hierarchy",
        sourceProvider: "fixture",
        sourceUrl: `https://volley.ru/calendar/invalid-${suffix}/allgames`,
      } }),
      /same sport/i,
    );
    await prisma.tLineChampionship.createMany({ data: [
      { id: ids.championshipA, sportConfigId: ids.sportA, globalHeaderId: ids.headerA, name: "A1", sourceProvider: "fixture", sourceUrl: `https://volley.ru/calendar/a1-${suffix}/allgames` },
      { id: ids.championshipA2, sportConfigId: ids.sportA, globalHeaderId: ids.headerA, name: "A2", sourceProvider: "fixture", sourceUrl: `https://volley.ru/calendar/a2-${suffix}/allgames` },
      { id: ids.championshipOther, sportConfigId: ids.sportA, globalHeaderId: ids.headerA2, name: "Other", sourceProvider: "fixture", sourceUrl: `https://volley.ru/calendar/other-${suffix}/allgames` },
    ] });

    const first = await importTLineAdminDirectory(prisma, {
      championshipId: ids.championshipA,
      records: [imported("7001", "Первая"), imported("7002", "Вторая")],
      sourceFileName: "first.xlsx",
    });
    assert.deepEqual(first, { importedCount: 2, createdCount: 2, updatedCount: 0, membershipCount: 2, skippedCount: 0, removedCount: 0 });

    const firstTeam = await prisma.adminTeam.findFirstOrThrow({ where: { disciplineSlug: disciplineSlugA, platformId: "7001" } });
    await prisma.tLineSourceTeam.create({ data: { id: ids.sourceTeam, championshipId: ids.championshipA, externalId: "official-1", name: "Первая", normalizedName: "первая" } });
    await prisma.tLineTeamMapping.create({ data: { championshipId: ids.championshipA, sourceTeamId: ids.sourceTeam, adminTeamId: firstTeam.id, status: "MANUAL_MAPPED", isLocked: true } });

    const second = await importTLineAdminDirectory(prisma, {
      championshipId: ids.championshipA2,
      records: [imported("7002", "Вторая обновлённая"), imported("7003", "Третья")],
      sourceFileName: "second.xlsx",
    });
    assert.deepEqual(second, { importedCount: 2, createdCount: 1, updatedCount: 1, membershipCount: 1, skippedCount: 0, removedCount: 0 });
    assert.equal(await prisma.tLineGlobalHeaderAdminTeam.count({ where: { globalHeaderId: ids.headerA } }), 3);
    assert.equal(await prisma.tLineGlobalHeaderAdminTeam.count({ where: { globalHeaderId: ids.headerA2 } }), 0);
    assert.equal(await prisma.tLineGlobalHeaderAdminTeam.count({ where: { globalHeaderId: ids.headerB } }), 0);
    assert.equal((await prisma.adminTeam.findFirstOrThrow({ where: { disciplineSlug: disciplineSlugA, platformId: "7001" } })).platformName, "Первая");
    assert.equal((await prisma.adminTeam.findFirstOrThrow({ where: { disciplineSlug: disciplineSlugA, platformId: "7002" } })).platformName, "Вторая обновлённая");
    assert.equal((await prisma.tLineTeamMapping.findUniqueOrThrow({ where: { sourceTeamId: ids.sourceTeam } })).adminTeamId, firstTeam.id);
  } finally {
    await prisma.tLineTeamMapping.deleteMany({ where: { championshipId: { in: [ids.championshipA, ids.championshipA2, ids.championshipOther] } } });
    await prisma.tLineSourceTeam.deleteMany({ where: { championshipId: { in: [ids.championshipA, ids.championshipA2, ids.championshipOther] } } });
    await prisma.tLineGlobalHeaderAdminTeam.deleteMany({ where: { globalHeaderId: { in: [ids.headerA, ids.headerA2, ids.headerB] } } });
    await prisma.tLineChampionship.deleteMany({ where: { id: { in: [ids.championshipA, ids.championshipA2, ids.championshipOther] } } });
    await prisma.adminTeam.deleteMany({ where: { disciplineSlug: disciplineSlugA } });
    await prisma.tLineGlobalHeader.deleteMany({ where: { id: { in: [ids.headerA, ids.headerA2, ids.headerB] } } });
    await prisma.tLineSportConfig.deleteMany({ where: { id: { in: [ids.sportA, ids.sportB] } } });
    await prisma.discipline.deleteMany({ where: { id: { in: [ids.disciplineA, ids.disciplineB] } } });
    await prisma.$disconnect();
  }
});

function requireIsolatedDatabaseUrl(value: string) {
  const databaseName = new URL(value).pathname.replace(/^\//, "").toLowerCase();
  if (!databaseName.includes("test")) throw new Error("TEST_DATABASE_URL must name an isolated database containing test");
  return value;
}
