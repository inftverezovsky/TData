import assert from "node:assert/strict";
import test from "node:test";
import {
  importFandomTournament,
  resolveFandomSavedStatus,
  saveFandomTournamentData,
} from "../backend/src/sources/tdata/fandom/importTournament";

test("Fandom importer is scoped to League of Legends", async () => {
  await assert.rejects(
    importFandomTournament({
      slug: "valorant",
      disciplineId: "discipline",
      title: "Parser Cup",
      pageUrl: "https://lol.fandom.com/wiki/Parser_Cup",
    }),
    /League of Legends/,
  );
});

test("Fandom unexplained empty snapshots remain partial", () => {
  assert.equal(resolveFandomSavedStatus("SUCCESS", 0, 0), "PARTIAL");
});

test("Fandom refresh preserves participant edits and persisted match delivery state", async () => {
  const syncedAt = new Date("2026-08-30T10:00:00.000Z");
  const fixture = createFandomTransactionFixture({
    participants: [{
      name: "Team A",
      platformId: "manual-participant",
      seed: "manual-seed",
      region: "manual-region",
      status: "manual-status",
      logoUrl: "manual-logo",
      rawText: "manual-raw",
    }],
    matches: [{
      matchId: "fandom-match-1",
      tournamentId: "tournament-1",
      platformId: "manual-match",
      lpNumericalId: 4242n,
      syncedAt,
      teamAName: "Old Team A",
    }],
  });

  await saveFandomTournamentData({
    tournamentId: "tournament-1",
    slug: "leagueoflegends",
    title: "Fandom Cup",
    participants: [{
      name: "Team A",
      platformId: "source-participant",
      seed: "source-seed",
      region: "source-region",
      status: "source-status",
      logoUrl: "source-logo",
      rawText: "source-raw",
    }],
    matches: [futureFandomMatch({
      matchId: "fandom-match-1",
      platformId: "source-match",
      lpNumericalId: 9999n,
      syncedAt: new Date("2026-08-30T11:00:00.000Z"),
    })],
    force: true,
    sourceValidated: true,
    client: fixture.client as never,
  });

  assert.deepEqual(fixture.participants[0], {
    tournamentId: "tournament-1",
    name: "Team A",
    platformId: "manual-participant",
    seed: "manual-seed",
    region: "manual-region",
    status: "manual-status",
    logoUrl: "manual-logo",
    rawText: "manual-raw",
  });
  const match = fixture.matches.get("fandom-match-1");
  assert.equal(match?.platformId, "manual-match");
  assert.equal(match?.lpNumericalId, 4242n);
  assert.equal(match?.syncedAt, syncedAt);
  assert.equal(match?.teamAName, "Team A");
});

test("Fandom refresh rejects a foreign global matchId before destructive operations", async () => {
  const fixture = createFandomTransactionFixture({
    participants: [{ name: "Kept Team", platformId: "kept" }],
    matches: [{
      matchId: "global-collision",
      tournamentId: "another-tournament",
      platformId: "foreign-platform",
      lpNumericalId: 777n,
      syncedAt: null,
      teamAName: "Foreign Team",
    }],
  });

  await assert.rejects(
    saveFandomTournamentData({
      tournamentId: "tournament-1",
      slug: "leagueoflegends",
      title: "Fandom Cup",
      participants: [{ name: "Incoming Team" }],
      matches: [futureFandomMatch({ matchId: "global-collision" })],
      force: true,
      sourceValidated: true,
      client: fixture.client as never,
    }),
    /belongs to another tournament/,
  );

  assert.equal(fixture.matches.get("global-collision")?.tournamentId, "another-tournament");
  assert.deepEqual(fixture.participants, [{ tournamentId: "tournament-1", name: "Kept Team", platformId: "kept" }]);
  assert.equal(fixture.destructiveOperations.length, 0);
});

function futureFandomMatch(overrides: Record<string, unknown>) {
  const matchDate = new Date();
  matchDate.setUTCDate(matchDate.getUTCDate() + 1);
  matchDate.setUTCHours(12, 0, 0, 0);
  return {
    matchId: "fandom-match",
    matchDate,
    matchDateTime: matchDate.toISOString(),
    teamAName: "Team A",
    teamBName: "Team B",
    scoreA: null,
    scoreB: null,
    status: "upcoming",
    ...overrides,
  };
}

function createFandomTransactionFixture(input: {
  participants: Array<Record<string, unknown>>;
  matches: Array<Record<string, unknown> & { matchId: string }>;
}) {
  const participants: Array<Record<string, unknown>> = input.participants
    .map((participant) => ({ tournamentId: "tournament-1", ...participant }));
  const matches = new Map(input.matches.map((match) => [match.matchId, { ...match }]));
  const destructiveOperations: string[] = [];
  const client = {
    $queryRaw: async () => [{ pg_advisory_xact_lock: null }],
    teamMapping: {
      findMany: async () => [],
      createMany: async () => ({ count: 0 }),
    },
    tournamentParticipant: {
      findMany: async () => participants.map((participant, index) => ({
        ...participant,
        id: `participant-${index}`,
        createdAt: new Date(index),
      })),
      update: async ({ where, data }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const index = Number(where.id.replace("participant-", ""));
        participants[index] = { ...participants[index], ...data };
        return { ...participants[index], id: where.id };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const { id, ...stored } = data;
        const createdId = String(id || `participant-${participants.length}`);
        participants.push({ ...stored });
        return { ...stored, id: createdId };
      },
      deleteMany: async () => {
        destructiveOperations.push("participants:deleteMany");
        participants.splice(0, participants.length);
        return { count: 1 };
      },
    },
    tournamentMatch: {
      findMany: async () => Array.from(matches.values()).map((match) => ({ ...match })),
      upsert: async ({ where, create, update }: {
        where: { matchId: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const existing = matches.get(where.matchId);
        matches.set(
          where.matchId,
          existing
            ? { ...existing, ...update }
            : { ...create, matchId: where.matchId },
        );
        return matches.get(where.matchId);
      },
      deleteMany: async ({ where }: {
        where: { tournamentId: string; matchId: { notIn: string[] } };
      }) => {
        destructiveOperations.push("matches:deleteMany");
        for (const [matchId, match] of matches) {
          if (match.tournamentId === where.tournamentId && !where.matchId.notIn.includes(matchId)) {
            matches.delete(matchId);
          }
        }
        return { count: 0 };
      },
    },
  };
  return { client, participants, matches, destructiveOperations };
}
