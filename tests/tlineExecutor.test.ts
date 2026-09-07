import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaClient } from "@prisma/client";

import { FixtureAdminLineAdapter } from "../backend/src/tline/admin";
import { executeTLineRun } from "../backend/src/tline/application/executor";
import { createTLineLeaseGuard, TLineJobLeaseLostError } from "../backend/src/tline/jobs/leaseGuard";
import type { OfficialSourceAdapter } from "../backend/src/tline/sources/contracts";
import { createOfficialSourceRegistry } from "../backend/src/tline/sources/registry";

test("executor persists fresh source/Admin evidence and an automatic comparison", async () => {
  const fake = createExecutorFake();
  const result = await executeTLineRun(fake.client, "run-1", {
    officialSources: createOfficialSourceRegistry([officialAdapter(false)]),
    admin: adminAdapter(),
  });

  assert.equal(result.status, "SUCCEEDED");
  assert.equal(fake.comparisons.length, 1);
  assert.equal(fake.comparisons[0]?.automaticStatus, "AUTO_OK");
  assert.equal(fake.sourceSnapshots.length, 1);
  assert.equal(fake.adminSnapshots.length, 1);
  assert.equal(fake.runChampionship.automaticStatus, "AUTO_OK");
  assert.deepEqual(fake.sourceTeamLookups, [
    { championshipId: "champ-1", externalId: "source-home" },
    { championshipId: "champ-1", externalId: "source-away" },
  ]);
});

test("executor passes the persisted undated-source choice to the official adapter", async () => {
  const fake = createExecutorFake();
  fake.run.includeUndatedSourceMatches = true;
  let observed: boolean | undefined;
  await executeTLineRun(fake.client, "run-1", {
    officialSources: createOfficialSourceRegistry([officialAdapter(false, false, false, (value) => { observed = value; })]),
    admin: null,
  });
  assert.equal(observed, true);
});

test("executor fails closed after a fresh source failure and stores no stale comparison", async () => {
  const fake = createExecutorFake();
  const result = await executeTLineRun(fake.client, "run-1", {
    officialSources: createOfficialSourceRegistry([officialAdapter(true)]),
    admin: adminAdapter(),
  });

  assert.equal(result.status, "FAILED");
  assert.equal(fake.comparisons.length, 0);
  assert.equal(fake.runChampionship.automaticStatus, "PARSER_FAILED");
  assert.deepEqual(fake.runChampionship.reasonCodes, ["PARSER_FAILED"]);
});

test("executor keeps fresh Volley.ru evidence when the read-only Admin contract is not configured", async () => {
  const fake = createExecutorFake();
  const result = await executeTLineRun(fake.client, "run-1", {
    officialSources: createOfficialSourceRegistry([officialAdapter(false)]),
    admin: null,
  });

  assert.equal(result.status, "PARTIAL");
  assert.equal(fake.runChampionship.status, "PARTIAL");
  assert.equal(fake.runChampionship.automaticStatus, "SOURCE_ONLY");
  assert.deepEqual(fake.runChampionship.reasonCodes, ["ADMIN_LINE_NOT_CONFIGURED"]);
  assert.equal(fake.sourceSnapshots.length, 1);
  assert.equal(fake.adminSnapshots.length, 0);
  assert.equal(fake.comparisons.length, 1);
  assert.equal(fake.comparisons[0]?.automaticStatus, "SOURCE_ONLY");
  assert.equal(fake.comparisons[0]?.sourceSnapshotId, "source-snapshot-1");
  assert.equal(fake.comparisons[0]?.adminSnapshotId, null);
});

test("executor does not report a fresh empty official period as a source-only error", async () => {
  const fake = createExecutorFake();
  const result = await executeTLineRun(fake.client, "run-1", {
    officialSources: createOfficialSourceRegistry([officialAdapter(false, false, true)]),
    admin: null,
  });

  assert.equal(result.status, "PARTIAL");
  assert.equal(fake.runChampionship.status, "PARTIAL");
  assert.equal(fake.runChampionship.automaticStatus, "PENDING");
  assert.equal(fake.runChampionship.severity, "WARNING");
  assert.deepEqual(fake.runChampionship.reasonCodes, [
    "ADMIN_LINE_NOT_CONFIGURED",
    "NO_MATCHES_IN_PERIOD",
  ]);
  assert.equal(fake.sourceSnapshots.length, 0);
  assert.equal(fake.comparisons.length, 0);
});

test("executor preserves an official-stage-not-published diagnostic for an empty eligible snapshot", async () => {
  const fake = createExecutorFake();
  const result = await executeTLineRun(fake.client, "run-1", {
    officialSources: createOfficialSourceRegistry([officialAdapter(false, false, true, undefined, true)]),
    admin: null,
  });

  assert.equal(result.status, "PARTIAL");
  assert.equal(fake.runChampionship.automaticStatus, "PENDING");
  assert.deepEqual(fake.runChampionship.reasonCodes, [
    "ADMIN_LINE_NOT_CONFIGURED",
    "SOURCE_STAGE_NOT_PUBLISHED",
  ]);
  assert.equal(fake.sourceSnapshots.length, 0);
  assert.equal(fake.comparisons.length, 0);
});

test("executor keeps source diagnostics at championship level when Admin comparison is configured", async () => {
  const fake = createExecutorFake();
  await executeTLineRun(fake.client, "run-1", {
    officialSources: createOfficialSourceRegistry([officialAdapter(false, false, true, undefined, true)]),
    admin: adminAdapter(),
  });

  assert.equal(fake.runChampionship.automaticStatus, "ADMIN_ONLY");
  assert.deepEqual(fake.runChampionship.reasonCodes, [
    "ADMIN_ONLY",
    "SOURCE_STAGE_NOT_PUBLISHED",
  ]);
});

test("an unpublished source stage cannot become a false green when Admin is also empty", async () => {
  const fake = createExecutorFake();
  const result = await executeTLineRun(fake.client, "run-1", {
    officialSources: createOfficialSourceRegistry([officialAdapter(false, false, true, undefined, true)]),
    admin: adminAdapter(true),
  });

  assert.equal(result.status, "PARTIAL");
  assert.equal(fake.runChampionship.status, "PARTIAL");
  assert.equal(fake.runChampionship.automaticStatus, "PENDING");
  assert.equal(fake.runChampionship.severity, "WARNING");
  assert.deepEqual(fake.runChampionship.reasonCodes, ["SOURCE_STAGE_NOT_PUBLISHED"]);
});

test("replaying a completed source-only run preserves PARTIAL instead of reporting false success", async () => {
  const fake = createExecutorFake();
  const dependencies = {
    officialSources: createOfficialSourceRegistry([officialAdapter(false)]),
    admin: null,
  };

  await executeTLineRun(fake.client, "run-1", dependencies);
  const replay = await executeTLineRun(fake.client, "run-1", dependencies);

  assert.equal(replay.status, "PARTIAL");
  assert.equal(fake.sourceSnapshots.length, 1);
  assert.equal(fake.comparisons.length, 1);
});

test("source-only date evidence keeps SOURCE_TIME_UNDEFINED while reporting missing Admin separately", async () => {
  const fake = createExecutorFake();
  await executeTLineRun(fake.client, "run-1", {
    officialSources: createOfficialSourceRegistry([officialAdapter(false, true)]),
    admin: null,
  });

  assert.equal(fake.runChampionship.automaticStatus, "SOURCE_TIME_UNDEFINED");
  assert.equal(fake.comparisons[0]?.automaticStatus, "SOURCE_TIME_UNDEFINED");
  assert.deepEqual(fake.comparisons[0]?.reasonCodes, [
    "ADMIN_LINE_NOT_CONFIGURED",
    "SOURCE_TIME_UNDEFINED",
  ]);
});

test("database lease fencing runs inside the evidence transaction before any snapshot write", async () => {
  const fake = createExecutorFake();
  const guard = createTLineLeaseGuard();

  await assert.rejects(
    executeTLineRun(fake.client, "run-1", {
      officialSources: createOfficialSourceRegistry([officialAdapter(false)]),
      admin: null,
      signal: guard.signal,
      verifyLease: async () => {
        guard.lose(new Error("lease expired during source collection"));
        guard.assertOwned();
      },
    }),
    TLineJobLeaseLostError,
  );
  assert.equal(fake.sourceSnapshots.length, 0);
  assert.equal(fake.comparisons.length, 0);
});

test("executor reapplies an active persistent exception without changing the automatic result", async () => {
  const fake = createExecutorFake([{
    id: "exception-1",
    type: "EXCLUDE",
    sourceMatchKey: "source-match",
    adminMatchId: null,
    reason: "operator exclusion",
    expiresAt: null,
    createdBy: null,
  }]);
  await executeTLineRun(fake.client, "run-1", {
    officialSources: createOfficialSourceRegistry([officialAdapter(false)]),
    admin: adminAdapter(),
  });

  assert.equal(fake.comparisons[0]?.automaticStatus, "AUTO_OK");
  assert.equal(fake.comparisons[0]?.effectiveStatus, "IGNORED");
  assert.equal(fake.comparisons[0]?.manualStatus, "IGNORED");
  assert.equal(fake.manualDecisions.length, 1);
  assert.equal(fake.manualDecisions[0]?.decisionType, "EXCLUDE");
});

test("executor applies a persistent match link before automatic pairing and keeps its marker", async () => {
  const fake = createExecutorFake([], [{
    sourceMatchKey: "source-match",
    adminMatchId: "admin-match",
  }]);
  await executeTLineRun(fake.client, "run-1", {
    officialSources: createOfficialSourceRegistry([officialAdapter(false)]),
    admin: adminAdapter(),
  });

  assert.equal(fake.comparisons[0]?.automaticStatus, "AUTO_OK");
  assert.equal(fake.comparisons[0]?.manualStatus, "AUTO_OK");
  assert.equal(fake.manualDecisions[0]?.decisionType, "MANUAL_LINK");
});

function createExecutorFake(
  exceptions: Array<Record<string, unknown>> = [],
  persistentLinks: Array<Record<string, unknown>> = [],
) {
  const run = {
    id: "run-1",
    sportConfigId: "sport-1",
    trigger: "MANUAL",
    status: "QUEUED",
    periodFrom: new Date("2026-12-01T00:00:00.000Z"),
    periodTo: new Date("2026-12-02T00:00:00.000Z"),
    includeUndatedSourceMatches: false,
    startedAt: null as Date | null,
    sportConfig: {
      id: "sport-1",
      adminSportId: "admin-sport",
      defaultAllowedTimeDriftMinutes: 2,
      candidateMatchWindowMinutes: 180,
    },
    runChampionships: [] as unknown[],
  };
  const championship = {
    id: "champ-1",
    name: "Высшая лига А. Женщины",
    sourceProvider: "fixture-official",
    sourceUrl: "https://volley.ru/calendar/champ-1/allgames",
    sourceChampionshipId: "champ-1",
    sourceTimezone: "Europe/Moscow",
    adminChampionshipId: "admin-champ",
    globalHeader: { adminShapkaId: "admin-shapka", active: true },
    allowedTimeDriftMinutes: 2,
    candidateMatchWindowMinutes: 180,
  };
  const runChampionship: Record<string, unknown> = {
    id: "run-champ-1",
    runId: run.id,
    championshipId: championship.id,
    status: "QUEUED",
    automaticStatus: "PENDING",
    effectiveStatus: "PENDING",
    effectiveSeverity: "UNPROCESSED",
    createdAt: new Date(),
    championship,
  };
  run.runChampionships = [runChampionship];
  const storedTeams = [
    storedTeam("source-home", "admin-home"),
    storedTeam("source-away", "admin-away"),
  ];
  const sourceSnapshots: Array<Record<string, unknown>> = [];
  const adminSnapshots: Array<Record<string, unknown>> = [];
  const comparisons: Array<Record<string, unknown>> = [];
  const manualDecisions: Array<Record<string, unknown>> = [];
  const sourceTeamLookups: Array<Record<string, unknown>> = [];
  let client: Record<string, unknown>;

  client = {
    tLineRun: {
      findUniqueOrThrow: async () => run,
      findUnique: async () => ({ cancelRequestedAt: null }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(run, data);
        return { ...run };
      },
    },
    tLineRunChampionship: {
      update: async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(runChampionship, data);
        return { ...runChampionship };
      },
      updateMany: async () => ({ count: 0 }),
      findMany: async () => [{
        status: runChampionship.status,
        effectiveSeverity: runChampionship.effectiveSeverity,
      }],
    },
    tLineSourceTeam: {
      findMany: async () => storedTeams,
      findFirst: async ({ where }: { where: { championshipId: string; externalId?: string } }) => {
        sourceTeamLookups.push(where);
        const externalId = where.externalId;
        const found = storedTeams.find((team) => team.externalId === externalId);
        return found ? { id: found.id } : null;
      },
      update: async () => ({}),
      create: async () => ({}),
    },
    tLineComparison: {
      deleteMany: async () => { comparisons.splice(0); return { count: 0 }; },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        comparisons.push(data);
        return { id: `comparison-${comparisons.length}`, ...data };
      },
    },
    tLineException: { findMany: async () => exceptions },
    tLinePersistentMatchLink: { findMany: async () => persistentLinks },
    tLineManualDecision: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        manualDecisions.push(data);
        return { id: `decision-${manualDecisions.length}`, ...data };
      },
    },
    tLineSourceMatchSnapshot: {
      deleteMany: async () => { sourceSnapshots.splice(0); return { count: 0 }; },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const id = `source-snapshot-${sourceSnapshots.length + 1}`;
        sourceSnapshots.push({ id, ...data });
        return { id };
      },
    },
    tLineAdminMatchSnapshot: {
      deleteMany: async () => { adminSnapshots.splice(0); return { count: 0 }; },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const id = `admin-snapshot-${adminSnapshots.length + 1}`;
        adminSnapshots.push({ id, ...data });
        return { id };
      },
    },
    parserRequestLog: { create: async () => ({}) },
    $transaction: async (callback: unknown) => {
      if (Array.isArray(callback)) return Promise.all(callback);
      return (callback as (transaction: typeof client) => unknown)(client);
    },
  };

  return {
    client: client as unknown as PrismaClient,
    run,
    runChampionship,
    sourceSnapshots,
    adminSnapshots,
    comparisons,
    manualDecisions,
    sourceTeamLookups,
  };
}

function storedTeam(externalId: string, platformId: string) {
  return {
    id: `db-${externalId}`,
    externalId,
    mapping: { status: "AUTO_MAPPED", adminTeam: { platformId } },
  };
}

function officialAdapter(
  fails: boolean,
  dateOnly = false,
  empty = false,
  observeUndated?: (value: boolean) => void,
  stageNotPublished = false,
): OfficialSourceAdapter {
  return {
    provider: "fixture-official",
    testConnection: async () => ({
      ok: true,
      provider: "fixture-official",
      matchCount: 1,
      exactTimeCount: dateOnly ? 0 : 1,
      dateOnlyTimeCount: dateOnly ? 1 : 0,
      undefinedTimeCount: 0,
      teamCount: 2,
      eligibleMatchCount: 1,
      excludedMatchCount: 0,
      diagnostics: { reasonCodes: [], excludedStageNames: [], eligibleMatchCount: 1, excludedMatchCount: 0 },
      checkedAt: new Date().toISOString(),
    }),
    fetchChampionship: async ({ championship, includeUndatedSourceMatches }) => {
      observeUndated?.(includeUndatedSourceMatches);
      if (fails) throw new Error("fresh source failed");
      return {
        provider: "fixture-official",
        championshipId: championship.id,
        externalId: championship.externalId,
        name: championship.name,
        sourceUrl: championship.sourceUrl,
        fetchedAt: new Date().toISOString(),
        teams: empty ? [] : [
          { id: "source-home", championshipId: championship.id, externalId: "source-home", nameRu: "Динамо", nameEn: null, aliases: [] },
          { id: "source-away", championshipId: championship.id, externalId: "source-away", nameRu: "Локомотив", nameEn: null, aliases: [] },
        ],
        diagnostics: stageNotPublished
          ? { reasonCodes: ["SOURCE_STAGE_NOT_PUBLISHED"], excludedStageNames: ["Товарищеские матчи"], eligibleMatchCount: 0, excludedMatchCount: 20 }
          : undefined,
        matches: empty ? [] : [{
          id: "source-match",
          championshipId: championship.id,
          externalId: "source-match",
          home: { sourceTeamId: "source-home", name: "Динамо", adminTeamId: null },
          away: { sourceTeamId: "source-away", name: "Локомотив", adminTeamId: null },
          startTimeRaw: dateOnly ? "01.12.2026 г. Москва" : "01.12.2026 14:00",
          sourceTimezone: "Europe/Moscow",
          startTimeUtc: dateOnly ? null : "2026-12-01T11:00:00.000Z",
          timePrecision: dateOnly ? "DATE_ONLY" : "EXACT",
          status: "SCHEDULED",
          sourceUrl: "https://volley.ru/games/source-match",
        }],
      };
    },
  };
}

function adminAdapter(empty = false) {
  return new FixtureAdminLineAdapter({
    championships: [{
      sportId: "admin-sport",
      shapkaId: "admin-shapka",
      championshipId: "admin-champ",
      championshipName: "Высшая лига А. Женщины",
      matches: empty ? [] : [{
        id: "admin-match",
        championshipId: "admin-champ",
        team1Id: "admin-home",
        team1Name: "Динамо",
        team2Id: "admin-away",
        team2Name: "Локомотив",
        startsAtUtc: "2026-12-01T11:00:00.000Z",
        status: "SCHEDULED",
      }],
    }],
  });
}
