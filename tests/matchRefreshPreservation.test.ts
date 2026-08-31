import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import type { Prisma } from "@prisma/client";
import { refreshTournamentMatchesPreservingState } from "../backend/src/sources/matchPreservation";
import { prepareWttTournamentSnapshot } from "../backend/src/sources/tablet/WTT/importTournament";
import { prepareVolleyballWorldTournamentSnapshot } from "../backend/src/sources/tbvolley/VolleyballWorld/importTournament";
import type { WttMatch } from "../backend/src/sources/tablet/WTT";
import type { VolleyballWorldBeachMatch } from "../backend/src/sources/tbvolley/VolleyballWorld";

const ROOT = path.resolve(import.meta.dirname, "..");

const IMPORTERS = [
  "backend/src/sources/tablet/WTT/importTournament.ts",
  "backend/src/sources/tbvolley/VolleyballWorld/importTournament.ts",
  "backend/src/sources/tbvolley/beach.volley.ru/importTournament.ts",
  "backend/src/sources/tbvolley/GermanBeachTour/importTournament.ts",
  "backend/src/sources/tbvolley/TwelveNdr/importTournament.ts",
  "backend/src/sources/tbvolley/CBV/importTournament.ts",
  "backend/src/sources/tbvolley/Federvolley/importTournament.ts",
] as const;

const ESPORTS_IMPORTERS = [
  "backend/src/sources/tdata/hltv/importTournament.ts",
  "backend/src/sources/tdata/vlr/importTournament.ts",
  "backend/src/sources/tdata/dltv/importTournament.ts",
  "backend/src/sources/tdata/fandom/importTournament.ts",
  "backend/src/sources/tdata/liquipedia/importer/recursive.ts",
] as const;

type StoredMatch = {
  matchId: string;
  tournamentId: string;
  platformId: string | null;
  syncedAt: Date | null;
  lpNumericalId: bigint | null;
  teamAName: string | null;
  matchDate?: Date | null;
};

function createFakeTransaction(initial: StoredMatch[]) {
  const rows = new Map(initial.map((row) => [row.matchId, { ...row }]));
  const operations: string[] = [];

  const transaction = {
    $queryRaw: async (_query: TemplateStringsArray, ...values: unknown[]) => {
      operations.push(`lock:${String(values[0])}`);
      return [{ pg_advisory_xact_lock: null }];
    },
    tournamentMatch: {
      findMany: async () => {
        operations.push("findMany");
        return Array.from(rows.values()).map((row) => ({
          matchId: row.matchId,
          tournamentId: row.tournamentId,
          platformId: row.platformId,
          syncedAt: row.syncedAt,
          lpNumericalId: row.lpNumericalId,
        }));
      },
      upsert: async (args: {
        where: { matchId: string };
        create: StoredMatch;
        update: Partial<StoredMatch>;
      }) => {
        operations.push(`upsert:${args.where.matchId}`);
        const existing = rows.get(args.where.matchId);
        rows.set(
          args.where.matchId,
          existing ? { ...existing, ...args.update } : { ...args.create },
        );
      },
      deleteMany: async (args: {
        where: { tournamentId: string; matchId: { notIn: string[] } };
      }) => {
        operations.push("deleteMany");
        for (const [matchId, row] of rows) {
          if (
            row.tournamentId === args.where.tournamentId
            && !args.where.matchId.notIn.includes(matchId)
          ) {
            rows.delete(matchId);
          }
        }
        return { count: 1 };
      },
    },
  } as unknown as Prisma.TransactionClient;

  return { transaction, rows, operations };
}

test("match refresh updates source fields while preserving manual and sync state", async () => {
  const syncedAt = new Date("2026-08-29T12:00:00.000Z");
  const { transaction, rows, operations } = createFakeTransaction([
    {
      matchId: "provider-event-101",
      tournamentId: "tournament-1",
      platformId: "manual-platform-id",
      syncedAt,
      lpNumericalId: 91001n,
      teamAName: "Old team name",
    },
    {
      matchId: "provider-event-stale",
      tournamentId: "tournament-1",
      platformId: "stale-platform-id",
      syncedAt,
      lpNumericalId: 91002n,
      teamAName: "Stale team",
    },
  ]);

  await refreshTournamentMatchesPreservingState({
    tx: transaction,
    tournamentId: "tournament-1",
    matches: [{
      matchId: "provider-event-101",
      create: {
        matchId: "provider-event-101",
        tournamentId: "tournament-1",
        teamAName: "Fresh team name",
        platformId: "source-must-not-overwrite",
        syncedAt: new Date("2026-08-30T00:00:00.000Z"),
        lpNumericalId: 99999n,
      },
      update: {
        teamAName: "Fresh team name",
        platformId: "source-must-not-overwrite",
        syncedAt: new Date("2026-08-30T00:00:00.000Z"),
        lpNumericalId: 99999n,
      },
    }],
  });

  const refreshed = rows.get("provider-event-101");
  assert.equal(refreshed?.teamAName, "Fresh team name");
  assert.equal(refreshed?.platformId, "manual-platform-id");
  assert.equal(refreshed?.syncedAt, syncedAt);
  assert.equal(refreshed?.lpNumericalId, 91001n);
  assert.equal(rows.has("provider-event-stale"), false);
  assert.deepEqual(operations, [
    "lock:tournament-match:provider-event-101",
    "findMany",
    "upsert:provider-event-101",
    "deleteMany",
  ]);
});

test("match refresh locks unique incoming identities in deterministic order before checking ownership", async () => {
  const { transaction, operations } = createFakeTransaction([]);

  await refreshTournamentMatchesPreservingState({
    tx: transaction,
    tournamentId: "tournament-1",
    matches: ["provider-event-z", "provider-event-a", "provider-event-z"].map((matchId) => ({
      matchId,
      create: { matchId, tournamentId: "tournament-1", teamAName: matchId },
      update: { teamAName: matchId },
    })),
  });

  assert.deepEqual(operations.slice(0, 3), [
    "lock:tournament-match:provider-event-a",
    "lock:tournament-match:provider-event-z",
    "findMany",
  ]);
});

test("match refresh rejects a global matchId collision instead of moving another tournament's row", async () => {
  const { transaction, rows } = createFakeTransaction([{
    matchId: "provider-event-101",
    tournamentId: "different-tournament",
    platformId: "other-platform-id",
    syncedAt: null,
    lpNumericalId: null,
    teamAName: "Other tournament",
  }]);

  await assert.rejects(
    refreshTournamentMatchesPreservingState({
      tx: transaction,
      tournamentId: "tournament-1",
      matches: [{
        matchId: "provider-event-101",
        create: {
          matchId: "provider-event-101",
          tournamentId: "tournament-1",
          teamAName: "Incoming",
        },
        update: { teamAName: "Incoming" },
      }],
    }),
    /belongs to another tournament/,
  );
  assert.equal(rows.get("provider-event-101")?.tournamentId, "different-tournament");
});

test("a new match keeps incoming sync identity when no persisted state exists", async () => {
  const incomingSyncedAt = new Date("2026-08-30T10:00:00.000Z");
  const { transaction, rows } = createFakeTransaction([]);

  await refreshTournamentMatchesPreservingState({
    tx: transaction,
    tournamentId: "tournament-1",
    matches: [{
      matchId: "provider-event-new",
      create: {
        matchId: "provider-event-new",
        tournamentId: "tournament-1",
        teamAName: "Incoming team",
        platformId: "incoming-platform",
        syncedAt: incomingSyncedAt,
        lpNumericalId: 92001n,
      },
      update: { teamAName: "Incoming team" },
    }],
  });

  const created = rows.get("provider-event-new");
  assert.equal(created?.platformId, "incoming-platform");
  assert.equal(created?.syncedAt, incomingSyncedAt);
  assert.equal(created?.lpNumericalId, 92001n);
});

test("a partial VolleyballWorld snapshot preserves persisted matches outside the mutable search window", async () => {
  const syncedAt = new Date("2026-08-29T12:00:00.000Z");
  const { transaction, rows, operations } = createFakeTransaction([
    {
      matchId: "volleyballworld-501-outside-window",
      tournamentId: "tournament-1",
      platformId: "manual-outside-link",
      syncedAt,
      lpNumericalId: 93001n,
      teamAName: "Persisted outside team",
      matchDate: new Date("2026-07-01T10:00:00.000Z"),
    },
  ]);

  await refreshTournamentMatchesPreservingState({
    tx: transaction,
    tournamentId: "tournament-1",
    snapshotCompleteness: "partial",
    matches: [{
      matchId: "volleyballworld-501-in-window",
      create: {
        matchId: "volleyballworld-501-in-window",
        tournamentId: "tournament-1",
        teamAName: "Incoming in-window team",
        matchDate: new Date("2026-08-30T10:00:00.000Z"),
      },
      update: { teamAName: "Incoming in-window team" },
    }],
  });

  const outside = rows.get("volleyballworld-501-outside-window");
  assert.equal(outside?.platformId, "manual-outside-link");
  assert.equal(outside?.syncedAt, syncedAt);
  assert.equal(outside?.lpNumericalId, 93001n);
  assert.equal(operations.includes("deleteMany"), false);

  const source = fs.readFileSync(path.join(
    ROOT,
    "backend/src/sources/tbvolley/VolleyballWorld/importTournament.ts",
  ), "utf8");
  assert.match(source, /completeness:\s*"partial"/);
  assert.match(source, /snapshotCompleteness:\s*params\.snapshot\.completeness/);
});

test("WTT and VolleyballWorld keep unfinished undated matches and their manual fields", async () => {
  const wttSnapshot = prepareWttTournamentSnapshot({
    matches: [
      buildWttMatch("wtt-dated", "2099-08-30T10:00:00.000Z"),
      buildWttMatch("wtt-undated", null),
    ],
  });
  const volleyballWorldSnapshot = prepareVolleyballWorldTournamentSnapshot({
    slug: "beach-volleyball",
    sourceValidated: true,
    matches: [
      buildVolleyballWorldMatch("vw-dated", "2099-08-30T10:00:00.000Z"),
      buildVolleyballWorldMatch("vw-undated", null),
    ],
  });

  const cases = [
    { name: "WTT", matches: wttSnapshot.matches, undatedId: "wtt-undated" },
    {
      name: "VolleyballWorld",
      matches: volleyballWorldSnapshot.matches,
      undatedId: "volleyballworld-501-vw-undated",
    },
  ];
  for (const item of cases) {
    const syncedAt = new Date("2026-08-29T12:00:00.000Z");
    const { transaction, rows } = createFakeTransaction([{
      matchId: item.undatedId,
      tournamentId: "tournament-1",
      platformId: `${item.name}-manual-link`,
      syncedAt,
      lpNumericalId: 94001n,
      teamAName: "Persisted undated team",
      matchDate: null,
    }]);

    await refreshTournamentMatchesPreservingState({
      tx: transaction,
      tournamentId: "tournament-1",
      matches: item.matches.map((match) => ({
        matchId: match.matchId,
        create: { ...match, tournamentId: "tournament-1" },
        update: { ...match },
      })),
    });

    const undated = rows.get(item.undatedId);
    assert.ok(undated, `${item.name} undated match must remain persisted`);
    assert.equal(undated.matchDate, null);
    assert.equal(undated.platformId, `${item.name}-manual-link`);
    assert.equal(undated.syncedAt, syncedAt);
    assert.equal(undated.lpNumericalId, 94001n);
  }
});

test("all WTT and volleyball importers use the preserving refresh helper", () => {
  for (const relativePath of IMPORTERS) {
    const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
    assert.match(source, /refreshTournamentMatchesPreservingState\s*\(/, relativePath);
    assert.doesNotMatch(
      source,
      /tx\.tournamentMatch\.deleteMany\(\{\s*where:\s*\{\s*tournamentId:\s*params\.tournamentId\s*\}\s*\}\)/,
      `${relativePath} must not delete every match before upsert`,
    );
  }
});

test("all esports importers reject global match collisions through the preserving refresh helper", () => {
  for (const relativePath of ESPORTS_IMPORTERS) {
    const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
    assert.match(source, /refreshTournamentMatchesPreservingState\s*\(/, relativePath);
  }
});

test("Liquipedia re-reads match state inside the commit transaction", () => {
  const relativePath = "backend/src/sources/tdata/liquipedia/importer/recursive.ts";
  const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
  const transactionStart = source.indexOf("const commitResult = await prisma.$transaction(async (tx)");
  const transactionBody = source.slice(transactionStart);

  assert.ok(transactionStart >= 0, "Liquipedia commit transaction must exist");
  assert.match(transactionBody, /tx\.tournamentMatch\.findMany\s*\(/);
  assert.match(transactionBody, /refreshTournamentMatchesPreservingState\s*\(/);
  assert.doesNotMatch(
    source.slice(0, transactionStart),
    /preserveLiquipediaMatchState\s*\(/,
    "pre-transaction snapshots must not be copied into the committed match state",
  );
});

test("all seven providers derive match IDs from immutable upstream event and match identities", () => {
  const expectedIdentityMarkers = new Map<string, RegExp>([
    ["backend/src/sources/tablet/WTT/index.ts", /id:\s*`wtt-\$\{context\.eventId\}-\$\{code\}`/],
    ["backend/src/sources/tbvolley/VolleyballWorld/importTournament.ts", /matchId:\s*`volleyballworld-\$\{match\.tournamentNo\s*\|\|\s*match\.competitionSlug\}-\$\{match\.id\}`/],
    ["backend/src/sources/tbvolley/beach.volley.ru/importTournament.ts", /matchId:\s*`beachvolleyru-\$\{match\.eventId\}-\$\{params\.gender\}-\$\{match\.id\}`/],
    ["backend/src/sources/tbvolley/GermanBeachTour/importTournament.ts", /matchId:\s*`germanbeachtour-\$\{match\.tournamentId\}-\$\{params\.gender\}-\$\{match\.id\}`/],
    ["backend/src/sources/tbvolley/TwelveNdr/importTournament.ts", /matchId:\s*`12ndr-\$\{params\.source\}-\$\{params\.tcode\}-\$\{params\.gender\}-\$\{match\.id\}`/],
    ["backend/src/sources/tbvolley/CBV/importTournament.ts", /matchId:\s*`cbv-\$\{match\.campeonatoId\}-\$\{match\.temporadaId\}-\$\{match\.etapaId\}-\$\{params\.gender\}-\$\{match\.id\}`/],
    ["backend/src/sources/tbvolley/Federvolley/importTournament.ts", /matchId:\s*`federvolley-\$\{params\.nodeId\}-\$\{params\.matchshareLid\}-\$\{params\.gender\}-\$\{match\.id\}`/],
  ]);

  for (const [relativePath, marker] of expectedIdentityMarkers) {
    const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
    assert.match(source, marker, relativePath);
  }
});

function buildWttMatch(id: string, startTimeUtc: string | null): WttMatch {
  return {
    id,
    eventId: "101",
    code: id,
    status: "upcoming",
    startTimeUtc,
    startTimeMoscow: startTimeUtc ? "30.08.2099 13:00:00" : "TBD",
    dateKey: startTimeUtc ? "2099-08-30" : "TBD",
    endTimeUtc: null,
    subEvent: "Men's Singles",
    eventCategory: "Senior",
    round: "Round 1",
    draw: "Main Draw",
    stage: "Main Draw",
    court: "1",
    venueName: "Test Hall",
    sourceUrl: `https://worldtabletennis.com/match/${id}`,
    teamA: { code: "A", type: "player", organization: "A", seed: "", name: "Alpha", ifId: "1", rawText: null },
    teamB: { code: "B", type: "player", organization: "B", seed: "", name: "Beta", ifId: "2", rawText: null },
    rawText: null,
    categoryScope: "men",
  };
}

function buildVolleyballWorldMatch(id: string, startTimeUtc: string | null): VolleyballWorldBeachMatch {
  const team = (name: string, no: string) => ({
    no,
    code: name.slice(0, 3).toUpperCase(),
    country: "Test",
    name,
    players: [name],
    flagUrl: null,
  });
  return {
    id,
    tournamentNo: "501",
    tournamentName: "Test Event",
    competitionSlug: "test-event",
    gender: "men",
    status: "upcoming",
    startTimeUtc,
    startTimeMoscow: startTimeUtc ? "30.08.2099 13:00:00" : "TBD",
    dateKey: startTimeUtc ? "2099-08-30" : "TBD",
    isTbd: startTimeUtc === null,
    city: "Test City",
    country: "Test Country",
    court: "1",
    phase: "Main Draw",
    round: "Round 1",
    matchNoInTournament: id,
    teamA: team("Alpha/Beta", "1"),
    teamB: team("Gamma/Delta", "2"),
    score: { teamA: null, teamB: null, sets: [] },
    links: { matchCenter: null, watch: null, tickets: null, youtube: null },
  };
}
