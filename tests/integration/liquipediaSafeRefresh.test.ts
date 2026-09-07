import assert from "node:assert/strict";
import test from "node:test";
import { requireTestDatabaseUrl } from "../../scripts/helpers/testDatabase";
import { prisma } from "../../backend/src/db/db";
import { clearTournamentForceRefreshState } from "../../backend/src/sources/tdata/liquipedia/importer/helpers";
import { replaceTournamentMatchSnapshot, publishTournamentSnapshot } from "../../backend/src/sources/tdata/liquipedia/importer/persistence";
import { mergeParticipantCandidates } from "../../backend/src/sources/tdata/liquipedia/importer/participants";
import { setTimeout as pause } from "node:timers/promises";

process.env.DATABASE_URL = requireTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const tournamentId = "safe-refresh-fixture";
const title = "Audit Safe Refresh";
const disciplineSlug = "audit-safe-refresh";
const previousMatch = { tournamentId, matchId: "safe-refresh-old", teamAName: "Alpha", teamBName: "Beta" };
const previousParticipant = { id: "safe-refresh-participant", tournamentId, name: "Alpha", platformId: "manual-binding" };
const replacement = { ...previousMatch, matchId: "safe-refresh-new" };
const participants = [{ ...previousParticipant, name: "Gamma" }];

async function cleanup() {
  await prisma.tournament.deleteMany({ where: { id: tournamentId } });
  await prisma.rawSnapshot.deleteMany({ where: { disciplineSlug } });
  await prisma.sourceFetchCache.deleteMany({ where: { disciplineSlug } });
  await prisma.discipline.deleteMany({ where: { slug: disciplineSlug } });
}
test.beforeEach(async () => {
  await cleanup();
  await prisma.tournament.create({ data: { id: tournamentId, sourceTitle: title, sourceUrl: "https://liquipedia.net/audit/Safe_Refresh", name: title, disciplineSlug } });
  await prisma.tournamentMatch.create({ data: previousMatch });
  await prisma.tournamentParticipant.create({ data: previousParticipant });
  await prisma.discipline.create({ data: { id: disciplineSlug, slug: disciplineSlug, name: title, tournamentImports: { create: { id: "safe-refresh-import", pageTitle: title, pageUrl: "https://liquipedia.net/audit/Safe_Refresh" } } } });
});
test.after(async () => { await cleanup(); await prisma.$disconnect(); });

test("force invalidates fetch caches without deleting the last good schedule, bindings or raw evidence", async () => {
  const snapshot = await prisma.rawSnapshot.create({ data: { tournamentImportId: "safe-refresh-import", source: "liquipedia", disciplineSlug, pageTitle: title, rawJson: { fixture: true } } });
  await prisma.sourceFetchCache.create({ data: { source: "liquipedia", disciplineSlug, resourceType: "page", resourceKey: title.toLowerCase() } });
  const stats = await clearTournamentForceRefreshState({ disciplineSlug, title });
  assert.equal(stats.sourceFetchCachesDeleted, 1);
  assert.equal(stats.matchesDeleted, 0);
  assert.equal(stats.participantsDeleted, 0);
  assert.equal(stats.rawSnapshotsDeleted, 0);
  assert.equal(await prisma.rawSnapshot.count({ where: { id: snapshot.id } }), 1);
  assert.equal(await prisma.tournamentMatch.count({ where: { tournamentId } }), 1);
  assert.equal((await prisma.tournamentParticipant.findUniqueOrThrow({ where: { id: previousParticipant.id } })).platformId, "manual-binding");
});

test("failed participant insertion rolls back both schedule and participant replacement", async () => {
  await assert.rejects(replaceTournamentMatchSnapshot(prisma, tournamentId, [replacement], [{ ...participants[0], tournamentId: "missing-tournament" }]));
  assert.equal((await prisma.tournamentMatch.findFirstOrThrow({ where: { tournamentId } })).matchId, previousMatch.matchId);
  assert.equal((await prisma.tournamentParticipant.findFirstOrThrow({ where: { tournamentId } })).name, previousParticipant.name);
});

test("accepted candidates publish matches and participants together", async () => {
  await replaceTournamentMatchSnapshot(prisma, tournamentId, [replacement], participants);
  assert.equal((await prisma.tournamentMatch.findFirstOrThrow({ where: { tournamentId } })).matchId, replacement.matchId);
  assert.equal((await prisma.tournamentParticipant.findFirstOrThrow({ where: { tournamentId } })).name, "Gamma");
});

test("an empty fetched result retains the previous schedule and participants", async () => {
  const result = await publishTournamentSnapshot(prisma, tournamentId, [], participants, false);
  assert.equal(result.keptPrevious, true);
  assert.equal(result.matches[0].matchId, previousMatch.matchId);
  assert.equal((await prisma.tournamentParticipant.findFirstOrThrow({ where: { tournamentId } })).name, "Alpha");
});

test("a failed subpage with a partial result retains the previous complete schedule", async () => {
  await prisma.tournamentMatch.create({ data: { ...previousMatch, matchId: "safe-refresh-old-second" } });
  const result = await publishTournamentSnapshot(prisma, tournamentId, [replacement], participants, true);
  assert.equal(result.keptPrevious, true);
  assert.equal(result.matches.length, 2);
});

test("a sparse subpage does not replace the main page participant metadata", async () => {
  const main = { ...previousParticipant, seed: "1", region: "Europe", logoUrl: "https://example.invalid/logo.png", rawText: "main page roster" };
  const sparse = { ...previousParticipant, seed: null, region: null, logoUrl: null, rawText: "subpage abbreviation" };
  const merged = mergeParticipantCandidates([main, sparse]);
  await publishTournamentSnapshot(prisma, tournamentId, [replacement], merged, false);
  const saved = await prisma.tournamentParticipant.findUniqueOrThrow({ where: { id: main.id } });
  assert.equal(saved.seed, "1");
  assert.equal(saved.region, "Europe");
  assert.equal(saved.logoUrl, main.logoUrl);
  assert.equal(saved.rawText, main.rawText);
});

test("an empty failed refresh preserves a roster-only tournament and its manual binding", async () => {
  await prisma.tournamentMatch.deleteMany({ where: { tournamentId } });
  const result = await publishTournamentSnapshot(prisma, tournamentId, [], [], true);
  assert.equal(result.keptPrevious, true);
  assert.equal((await prisma.tournamentParticipant.findUniqueOrThrow({ where: { id: previousParticipant.id } })).platformId, "manual-binding");
});

test("a concurrent weaker publication rechecks the committed snapshot after the tournament lock", async () => {
  const newerMatches = Array.from({ length: 12 }, (_, index) => ({ ...previousMatch, matchId: `concurrent-new-${index}` }));
  const ready = deferred();
  const release = deferred();
  const writer = prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT id FROM "Tournament" WHERE id = ${tournamentId} FOR UPDATE`;
    await transaction.tournamentMatch.deleteMany({ where: { tournamentId } });
    await transaction.tournamentMatch.createMany({ data: newerMatches });
    ready.resolve();
    await release.promise;
  }, { timeout: 10_000 });
  // If setup fails, wake the test instead of leaving a pending promise.
  void writer.catch(ready.reject);
  await ready.promise;
  const weakPublication = publishTournamentSnapshot(prisma, tournamentId, [replacement], participants, true);
  try {
    const deadline = Date.now() + 3000;
    let waitedForLock = false;
    while (Date.now() < deadline) {
      const waiting = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'
      `;
      if (waiting[0].count > 0n) { waitedForLock = true; break; }
      await pause(10);
    }
    assert.equal(waitedForLock, true, "The competing publication must reach the held database lock.");
  } finally {
    release.resolve();
    await writer;
  }
  const result = await weakPublication;
  assert.equal(result.keptPrevious, true);
  assert.equal(result.matches.length, 12);
  assert.equal(await prisma.tournamentMatch.count({ where: { tournamentId } }), 12);
  assert.equal(await prisma.tournamentMatch.count({ where: { tournamentId, matchId: replacement.matchId } }), 0);
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
