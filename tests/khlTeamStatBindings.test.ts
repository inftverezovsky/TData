import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { KhlBindingStatus, KhlMatchState, PrismaClient } from "@prisma/client";
import {
  confirmKhlStatTypes,
  confirmKhlTeamStatBindings,
  KhlTargetBindingError,
} from "../backend/src/results/khl/targetBindings";
import { getKhlSettingsDirectory } from "../backend/src/results/khl/settingsDirectory";
import { acquireKhlDatabaseSuiteLock } from "./helpers/khlDatabaseSuiteLock";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for khlTeamStatBindings.test.ts");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
let releaseSuiteLock: (() => Promise<void>) | undefined;

const statTypes = {
  teamStatTypes: {
    shots_on_goal: "type-team-shots",
    faceoffs_won: "type-team-faceoffs",
    power_play_goals: "type-team-ppg",
    penalty_minutes_2_4: "type-team-pim",
  },
  playerStatTypes: {
    goals: "type-player-goals",
    assists: "type-player-assists",
    points: "type-player-points",
  },
  confirmedBy: "team-stat-test",
} as const;

const teamStats = {
  shots_on_goal: "avangard-shots-target",
  faceoffs_won: "avangard-faceoffs-target",
  power_play_goals: "avangard-ppg-target",
  penalty_minutes_2_4: "avangard-pim-target",
} as const;

async function clearKhlTables() {
  await prisma.$transaction([
    prisma.khlDeliveryAttempt.deleteMany(),
    prisma.khlDelivery.deleteMany(),
    prisma.khlPlayerStatTarget.deleteMany(),
    prisma.khlTeamStatTarget.deleteMany(),
    prisma.khlTeamStatBinding.deleteMany(),
    prisma.khlStatMapping.deleteMany(),
    prisma.khlMatchParticipant.deleteMany(),
    prisma.khlMatchRevision.deleteMany(),
    prisma.khlRawSnapshot.deleteMany(),
    prisma.khlMatch.deleteMany(),
    prisma.khlPlayer.deleteMany(),
    prisma.khlTeam.deleteMany(),
  ]);
}

test.before(async () => {
  releaseSuiteLock = await acquireKhlDatabaseSuiteLock(databaseUrl);
  await clearKhlTables();
});

test.after(async () => {
  try {
    await clearKhlTables();
  } finally {
    await prisma.$disconnect();
    await releaseSuiteLock?.();
  }
});

test.beforeEach(clearKhlTables);

test("migration does not promote legacy match-scoped targets to persistent team bindings", () => {
  const migration = readFileSync(
    "backend/prisma/migrations/20260821154000_khl_team_stat_bindings/migration.sql",
    "utf8"
  );
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+"KhlTeamStatBinding"/i);
});

test("team statistic target ids persist once per KHL team and metric", async () => {
  const team = await createVisibleTeam("34", "Авангард", true);

  const first = await confirmKhlTeamStatBindings(prisma, {
    khlTeamId: team.khlTeamId,
    teamStats,
    confirmedBy: "team-stat-test",
  });
  const firstRows = await prisma.khlTeamStatBinding.findMany({
    where: { teamId: team.id },
    include: { statMapping: true },
    orderBy: { statMapping: { semanticCode: "asc" } },
  });
  assert.equal(first.bindings.length, 4);
  assert.equal(firstRows.length, 4);
  assert.ok(firstRows.every((row) => row.adminBindingStatus === KhlBindingStatus.CONFIRMED));
  assert.ok(firstRows.every((row) => (
    row.statMapping.adminBindingStatus === KhlBindingStatus.UNMAPPED
      && row.statMapping.adminStatTypeId === null
  )));

  const repeated = await confirmKhlTeamStatBindings(prisma, {
    khlTeamId: team.khlTeamId,
    teamStats,
    confirmedBy: "team-stat-test",
  });
  assert.deepEqual(
    repeated.bindings.map((binding) => binding.id).sort(),
    first.bindings.map((binding) => binding.id).sort()
  );
  assert.equal(await prisma.khlTeamStatBinding.count(), 4);

  const directory = await getKhlSettingsDirectory(prisma);
  const storedTeam = directory.teams.find((candidate) => candidate.khlTeamId === team.khlTeamId);
  assert.deepEqual(
    storedTeam?.statBindings.map((binding) => [
      binding.semanticCode,
      binding.adminTeamStatId,
      binding.adminBindingStatus,
    ]),
    [
      ["shots_on_goal", teamStats.shots_on_goal, "CONFIRMED"],
      ["faceoffs_won", teamStats.faceoffs_won, "CONFIRMED"],
      ["power_play_goals", teamStats.power_play_goals, "CONFIRMED"],
      ["penalty_minutes_2_4", teamStats.penalty_minutes_2_4, "CONFIRMED"],
    ]
  );
});

test("team statistic bindings fail closed for unbound teams, drift, and id collisions", async () => {
  const unbound = await createVisibleTeam("53", "Ак Барс", false);
  await confirmKhlStatTypes(prisma, statTypes);
  await assert.rejects(
    confirmKhlTeamStatBindings(prisma, {
      khlTeamId: unbound.khlTeamId,
      teamStats,
      confirmedBy: "team-stat-test",
    }),
    (error: unknown) => error instanceof KhlTargetBindingError && error.code === "TEAM_NOT_BOUND"
  );

  const first = await createVisibleTeam("1", "Локомотив", true);
  await confirmKhlTeamStatBindings(prisma, {
    khlTeamId: first.khlTeamId,
    teamStats,
    confirmedBy: "team-stat-test",
  });
  await assert.rejects(
    confirmKhlTeamStatBindings(prisma, {
      khlTeamId: first.khlTeamId,
      teamStats: { ...teamStats, shots_on_goal: "changed-target" },
      confirmedBy: "team-stat-test",
    }),
    (error: unknown) => error instanceof KhlTargetBindingError
      && error.code === "CONFIRMED_BINDING_IMMUTABLE"
  );

  const second = await createVisibleTeam("37", "Металлург Мг", true);
  await assert.rejects(
    confirmKhlTeamStatBindings(prisma, {
      khlTeamId: second.khlTeamId,
      teamStats,
      confirmedBy: "team-stat-test",
    }),
    (error: unknown) => error instanceof KhlTargetBindingError && error.code === "ADMIN_ID_COLLISION"
  );
  assert.equal(await prisma.khlTeamStatBinding.count(), 4);
});

async function createVisibleTeam(khlTeamId: string, name: string, confirmed: boolean) {
  const team = await prisma.khlTeam.create({
    data: {
      khlTeamId,
      name,
      adminTeamId: confirmed ? `admin-team-${khlTeamId}` : null,
      adminBindingStatus: confirmed ? KhlBindingStatus.CONFIRMED : KhlBindingStatus.UNMAPPED,
      adminConfirmedAt: confirmed ? new Date() : null,
      adminConfirmedBy: confirmed ? "team-stat-test" : null,
    },
  });
  const opponent = await prisma.khlTeam.create({
    data: { khlTeamId: `${khlTeamId}9`, name: `${name} соперник` },
  });
  await prisma.khlMatch.create({
    data: {
      khlGameId: `${khlTeamId}001`,
      apiEventId: `${khlTeamId}002`,
      sourceMatchId: `${khlTeamId}003`,
      stageId: "395",
      khlStageId: "395",
      season: "2025/2026",
      startsAt: new Date("2026-05-21T16:30:00.000Z"),
      status: KhlMatchState.FINISHED,
      homeTeamId: team.id,
      awayTeamId: opponent.id,
    },
  });
  return team;
}
