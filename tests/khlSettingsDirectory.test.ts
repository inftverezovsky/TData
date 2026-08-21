import assert from "node:assert/strict";
import test from "node:test";

import {
  KhlBindingStatus,
  KhlMatchState,
  KhlStatScope,
  PrismaClient,
} from "@prisma/client";
import {
  confirmKhlStatTypes,
  KHL_PLAYER_STAT_CODES,
  KhlTargetBindingError,
} from "../backend/src/results/khl/targetBindings";
import {
  KHL_SETTINGS_CUTOFF,
  getKhlSettingsDirectory,
} from "../backend/src/results/khl/settingsDirectory";
import { KHL_TEAM_STAT_CODES } from "../backend/src/results/khl/adminPayload";
import { acquireKhlDatabaseSuiteLock } from "./helpers/khlDatabaseSuiteLock";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for khlSettingsDirectory.test.ts");
}
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
let releaseSuiteLock: (() => Promise<void>) | undefined;

const statTypeInput = {
  teamStatTypes: {
    shots_on_goal: "admin-team-stat-shots",
    faceoffs_won: "admin-team-stat-faceoffs",
    power_play_goals: "admin-team-stat-ppg",
    penalty_minutes_2_4: "admin-team-stat-pim",
  },
  playerStatTypes: {
    goals: "admin-player-stat-goals",
    assists: "admin-player-stat-assists",
    points: "admin-player-stat-points",
  },
  confirmedBy: "settings-test-admin",
} as const;

async function clearKhlTables() {
  await prisma.$transaction([
    prisma.khlDeliveryAttempt.deleteMany(),
    prisma.khlDelivery.deleteMany(),
    prisma.khlPlayerStatTarget.deleteMany(),
    prisma.khlTeamStatTarget.deleteMany(),
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
    try {
      await prisma.$disconnect();
    } finally {
      await releaseSuiteLock?.();
    }
  }
});

test.beforeEach(clearKhlTables);

test("settings directory returns only post-cutoff global teams/players and all seven mappings", async () => {
  const currentHome = await prisma.khlTeam.create({
    data: {
      khlTeamId: "settings-team-home",
      name: "Current Home",
      location: "Moscow",
      adminTeamId: "admin-team-home",
      adminBindingStatus: KhlBindingStatus.CONFIRMED,
      adminConfirmedAt: new Date("2026-05-20T10:00:00.000Z"),
      adminConfirmedBy: "settings-test-admin",
    },
  });
  const currentAway = await prisma.khlTeam.create({
    data: { khlTeamId: "settings-team-away", name: "Current Away" },
  });
  const oldHome = await prisma.khlTeam.create({
    data: { khlTeamId: "settings-team-old-home", name: "Old Home" },
  });
  const oldAway = await prisma.khlTeam.create({
    data: { khlTeamId: "settings-team-old-away", name: "Old Away" },
  });

  const currentMatch = await prisma.khlMatch.create({
    data: {
      khlGameId: "settings-current-game",
      apiEventId: "settings-current-event",
      sourceMatchId: "settings-current-source",
      stageId: "settings-stage",
      khlStageId: "settings-stage",
      season: "2025/2026",
      startsAt: new Date("2026-05-21T16:30:00.000Z"),
      status: KhlMatchState.FINISHED,
      homeTeamId: currentHome.id,
      awayTeamId: currentAway.id,
    },
  });
  const oldMatch = await prisma.khlMatch.create({
    data: {
      khlGameId: "settings-old-game",
      apiEventId: "settings-old-event",
      sourceMatchId: "settings-old-source",
      stageId: "settings-old-stage",
      khlStageId: "settings-old-stage",
      season: "2025/2026",
      startsAt: new Date("2026-04-30T20:59:59.999Z"),
      status: KhlMatchState.FINISHED,
      homeTeamId: oldHome.id,
      awayTeamId: oldAway.id,
    },
  });

  const currentPlayer = await prisma.khlPlayer.create({
    data: {
      khlPlayerId: "settings-current-player",
      name: "Current Player",
      role: "F",
      adminPlayerId: "admin-player-current",
      adminBindingStatus: KhlBindingStatus.CONFIRMED,
      adminConfirmedAt: new Date("2026-05-20T10:05:00.000Z"),
      adminConfirmedBy: "settings-test-admin",
    },
  });
  const oldPlayer = await prisma.khlPlayer.create({
    data: { khlPlayerId: "settings-old-player", name: "Old Player" },
  });
  await prisma.khlMatchParticipant.createMany({
    data: [
      {
        matchId: currentMatch.id,
        teamId: currentHome.id,
        playerId: currentPlayer.id,
        shirtNumber: 17,
        role: "F",
        isListed: true,
        adminMatchPlayerId: "admin-match-player-current",
        adminBindingStatus: KhlBindingStatus.CONFIRMED,
        adminConfirmedAt: new Date("2026-05-20T10:10:00.000Z"),
        adminConfirmedBy: "settings-test-admin",
        firstSeenRevisionNumber: 1,
        lastSeenRevisionNumber: 1,
      },
      {
        matchId: oldMatch.id,
        teamId: oldHome.id,
        playerId: oldPlayer.id,
        shirtNumber: 9,
        role: "F",
        isListed: true,
        firstSeenRevisionNumber: 1,
        lastSeenRevisionNumber: 1,
      },
    ],
  });
  await prisma.khlStatMapping.create({
    data: {
      scope: KhlStatScope.TEAM,
      semanticCode: "shots_on_goal",
      adminStatTypeId: "admin-existing-shots",
      adminBindingStatus: KhlBindingStatus.CONFIRMED,
      adminConfirmedAt: new Date("2026-05-20T11:00:00.000Z"),
      adminConfirmedBy: "settings-test-admin",
    },
  });

  const directory = await getKhlSettingsDirectory(prisma);

  assert.equal(directory.cutoff, KHL_SETTINGS_CUTOFF.toISOString());
  assert.deepEqual(directory.teams.map((team) => team.khlTeamId), [
    "settings-team-away",
    "settings-team-home",
  ]);
  assert.deepEqual(
    directory.teams.find((team) => team.khlTeamId === "settings-team-home"),
    {
      khlTeamId: "settings-team-home",
      name: "Current Home",
      location: "Moscow",
      adminTeamId: "admin-team-home",
      adminBindingStatus: KhlBindingStatus.CONFIRMED,
      adminConfirmedAt: "2026-05-20T10:00:00.000Z",
      adminConfirmedBy: "settings-test-admin",
      matchCount: 1,
    }
  );
  assert.equal(directory.players.length, 1);
  assert.deepEqual(directory.players[0], {
    khlPlayerId: "settings-current-player",
    name: "Current Player",
    role: "F",
    adminPlayerId: "admin-player-current",
    adminBindingStatus: KhlBindingStatus.CONFIRMED,
    adminConfirmedAt: "2026-05-20T10:05:00.000Z",
    adminConfirmedBy: "settings-test-admin",
    matchCount: 1,
    recentAppearance: {
      khlGameId: "settings-current-game",
      startsAt: "2026-05-21T16:30:00.000Z",
      team: {
        khlTeamId: "settings-team-home",
        name: "Current Home",
      },
      adminMatchPlayerId: "admin-match-player-current",
      adminBindingStatus: KhlBindingStatus.CONFIRMED,
    },
  });
  assert.deepEqual(
    directory.statMappings.map(({ scope, semanticCode }) => `${scope}:${semanticCode}`),
    [
      ...KHL_TEAM_STAT_CODES.map((code) => `TEAM:${code}`),
      ...KHL_PLAYER_STAT_CODES.map((code) => `PLAYER:${code}`),
    ]
  );
  assert.equal(directory.statMappings.length, 7);
  assert.deepEqual(directory.statMappings[0], {
    scope: KhlStatScope.TEAM,
    semanticCode: "shots_on_goal",
    adminStatTypeId: "admin-existing-shots",
    adminBindingStatus: KhlBindingStatus.CONFIRMED,
    adminConfirmedAt: "2026-05-20T11:00:00.000Z",
    adminConfirmedBy: "settings-test-admin",
  });
  assert.deepEqual(directory.statMappings.at(-1), {
    scope: KhlStatScope.PLAYER,
    semanticCode: "points",
    adminStatTypeId: null,
    adminBindingStatus: KhlBindingStatus.UNMAPPED,
    adminConfirmedAt: null,
    adminConfirmedBy: null,
  });
});

test("stat type confirmation is complete, immutable, and idempotent", async () => {
  const first = await confirmKhlStatTypes(prisma, statTypeInput);
  const firstRows = await prisma.khlStatMapping.findMany({ orderBy: { id: "asc" } });
  assert.equal(first.mappings.length, 7);
  assert.equal(firstRows.length, 7);
  assert.ok(firstRows.every((row) => row.adminBindingStatus === KhlBindingStatus.CONFIRMED));

  const repeated = await confirmKhlStatTypes(prisma, statTypeInput);
  const repeatedRows = await prisma.khlStatMapping.findMany({ orderBy: { id: "asc" } });
  assert.equal(repeated.mappings.length, 7);
  assert.deepEqual(
    repeatedRows.map(({ id, adminConfirmedAt }) => [id, adminConfirmedAt?.toISOString()]),
    firstRows.map(({ id, adminConfirmedAt }) => [id, adminConfirmedAt?.toISOString()])
  );

  await assert.rejects(
    confirmKhlStatTypes(prisma, {
      ...statTypeInput,
      teamStatTypes: { ...statTypeInput.teamStatTypes, shots_on_goal: "different-stat-id" },
    }),
    (error: unknown) => error instanceof KhlTargetBindingError
      && error.code === "CONFIRMED_BINDING_IMMUTABLE"
  );
});

test("concurrent identical stat type confirmations converge without duplicate rows", async () => {
  const [first, second] = await Promise.all([
    confirmKhlStatTypes(prisma, statTypeInput),
    confirmKhlStatTypes(prisma, statTypeInput),
  ]);
  assert.equal(await prisma.khlStatMapping.count(), 7);
  assert.deepEqual(
    first.mappings.map((mapping) => mapping.id).sort(),
    second.mappings.map((mapping) => mapping.id).sort()
  );
});

test("stat type confirmation fails closed on an Admin id collision", async () => {
  await assert.rejects(
    confirmKhlStatTypes(prisma, {
      ...statTypeInput,
      teamStatTypes: {
        ...statTypeInput.teamStatTypes,
        faceoffs_won: statTypeInput.teamStatTypes.shots_on_goal,
      },
    }),
    (error: unknown) => error instanceof KhlTargetBindingError
      && error.code === "ADMIN_ID_COLLISION"
  );
  assert.equal(await prisma.khlStatMapping.count(), 0);
});

test("stat type confirmation rejects incomplete, extra, and oversized payloads", async () => {
  const invalidInputs = [
    {
      ...statTypeInput,
      teamStatTypes: { shots_on_goal: "only-one" },
    },
    {
      ...statTypeInput,
      playerStatTypes: { ...statTypeInput.playerStatTypes, saves: "unexpected" },
    },
    {
      ...statTypeInput,
      playerStatTypes: { ...statTypeInput.playerStatTypes, points: "x".repeat(129) },
    },
  ];
  for (const input of invalidInputs) {
    await assert.rejects(
      confirmKhlStatTypes(prisma, input as never),
      (error: unknown) => error instanceof KhlTargetBindingError
        && error.code === "INVALID_TARGET_BINDINGS"
    );
  }
  assert.equal(await prisma.khlStatMapping.count(), 0);
});
