import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";

import { replaceTournamentMatchSnapshot } from "../backend/src/sources/tdata/liquipedia/importer/persistence";
import { resolveSubpageConcurrency } from "../backend/src/sources/tdata/liquipedia/importer/options";

type MatchRow = Prisma.TournamentMatchCreateManyInput;

const previousMatch: MatchRow = {
  tournamentId: "tournament-1", matchId: "old-match", teamAName: "Alpha", teamBName: "Beta",
};
const unrelatedMatch: MatchRow = { ...previousMatch, tournamentId: "tournament-2", matchId: "other-match" };
const replacement: MatchRow = { ...previousMatch, matchId: "new-match" };

test("failed snapshot insertion preserves the previous tournament schedule", async () => {
  const store = createSnapshotStore(true);

  await assert.rejects(
    replaceTournamentMatchSnapshot(store.client, "tournament-1", [replacement]),
    /simulated insertion failure/,
  );

  assert.deepEqual(store.rows(), [previousMatch, unrelatedMatch]);
});

test("successful snapshot replacement changes only the selected tournament", async () => {
  const store = createSnapshotStore();

  await replaceTournamentMatchSnapshot(store.client, "tournament-1", [replacement]);

  assert.deepEqual(store.rows(), [unrelatedMatch, replacement]);
});

test("an accepted empty snapshot clears only its own tournament", async () => {
  const store = createSnapshotStore();

  await replaceTournamentMatchSnapshot(store.client, "tournament-1", []);

  assert.deepEqual(store.rows(), [unrelatedMatch]);
});

test("subpage batches always advance with a positive safe integer", () => {
  for (const value of [undefined, "", " ", "0", "-2", "1.5", "NaN", "Infinity", "abc", "9007199254740992"]) {
    assert.equal(resolveSubpageConcurrency(value), 3, `unsafe concurrency: ${String(value)}`);
  }
  assert.equal(resolveSubpageConcurrency("1"), 1);
  assert.equal(resolveSubpageConcurrency(" 4 "), 4);
});

function createSnapshotStore(failInsert = false) {
  let committed = [previousMatch, unrelatedMatch];
  const makeDelegate = (read: () => MatchRow[], write: (rows: MatchRow[]) => void) => ({
    deleteMany: async ({ where }: { where: { tournamentId: string } }) => {
      write(read().filter((row) => row.tournamentId !== where.tournamentId));
      return { count: 1 };
    },
    createMany: async ({ data }: { data: MatchRow[] }) => {
      if (failInsert) throw new Error("simulated insertion failure");
      write([...read(), ...data]);
      return { count: data.length };
    },
  });
  const client = {
    tournamentMatch: makeDelegate(() => committed, (rows) => { committed = rows; }),
    $transaction: async (operation: (transaction: unknown) => Promise<void>) => {
      let pending = [...committed];
      const transaction = {
        tournamentMatch: makeDelegate(() => pending, (rows) => { pending = rows; }),
      };
      await operation(transaction);
      committed = pending;
    },
  } as unknown as PrismaClient;
  return { client, rows: () => committed };
}
