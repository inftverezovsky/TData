import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");

const IMPORTERS = [
  {
    file: "backend/src/sources/tablet/WTT/importTournament.ts",
    fetchMarker: "await fetchWttSchedule",
    prepareMarker: "prepareWttTournamentSnapshot",
    saveMarker: "saveWttTournamentSnapshot",
  },
  {
    file: "backend/src/sources/tbvolley/VolleyballWorld/importTournament.ts",
    fetchMarker: "await searchVolleyballWorldBeachTournaments",
    prepareMarker: "prepareVolleyballWorldTournamentSnapshot",
    saveMarker: "saveVolleyballWorldTournamentSnapshot",
  },
  {
    file: "backend/src/sources/tbvolley/beach.volley.ru/importTournament.ts",
    fetchMarker: "await fetchBeachVolleyRuTournament",
    prepareMarker: "prepareBeachVolleyRuTournamentSnapshot",
    saveMarker: "saveBeachVolleyRuTournamentSnapshot",
  },
  {
    file: "backend/src/sources/tbvolley/GermanBeachTour/importTournament.ts",
    fetchMarker: "await fetchGermanBeachTourTournament",
    prepareMarker: "prepareGermanBeachTourTournamentSnapshot",
    saveMarker: "saveGermanBeachTourTournamentSnapshot",
  },
  {
    file: "backend/src/sources/tbvolley/TwelveNdr/importTournament.ts",
    fetchMarker: "await fetchTwelveNdrTournament",
    prepareMarker: "prepareTwelveNdrTournamentSnapshot",
    saveMarker: "saveTwelveNdrTournamentSnapshot",
  },
  {
    file: "backend/src/sources/tbvolley/CBV/importTournament.ts",
    fetchMarker: "await fetchCBVTournament",
    prepareMarker: "prepareCBVTournamentSnapshot",
    saveMarker: "saveCBVTournamentSnapshot",
  },
  {
    file: "backend/src/sources/tbvolley/Federvolley/importTournament.ts",
    fetchMarker: "await fetchFedervolleyTournament",
    prepareMarker: "prepareFedervolleyTournamentSnapshot",
    saveMarker: "saveFedervolleyTournamentSnapshot",
  },
] as const;

test("WTT and beach tournament snapshots are validated before one interactive business transaction", () => {
  for (const importer of IMPORTERS) {
    const source = fs.readFileSync(path.join(ROOT, importer.file), "utf8");
    const fetchAt = source.indexOf(importer.fetchMarker);
    const prepareAt = source.indexOf(importer.prepareMarker);
    const transactionAt = source.indexOf("runSerializableTournamentImport(async (tx)");

    assert.ok(fetchAt >= 0, `${importer.file} must fetch its source before persistence`);
    assert.ok(prepareAt > fetchAt, `${importer.file} must normalize and gate after the source fetch`);
    assert.ok(transactionAt > prepareAt, `${importer.file} must gate the snapshot before the transaction`);
    assert.doesNotMatch(source, /prisma\.tournament\.upsert\s*\(/, `${importer.file} cannot mutate tournament metadata outside tx`);
    assert.doesNotMatch(source, /prisma\.\$transaction\s*\(\s*\[/, `${importer.file} cannot use a detached batch transaction`);
    assert.match(source, /tx:\s*Prisma\.TransactionClient/, `${importer.file} saver must use the interactive tx client`);
    assert.match(source, /const finalStatus:\s*ImportStatus\s*=\s*"SUCCESS";/, `${importer.file} validated commit must finish SUCCESS`);
    assert.match(source, /tx\.tournament\.upsert\s*\(/, `${importer.file} tournament metadata must commit inside tx`);
    assert.match(source, new RegExp(`await ${importer.saveMarker}\\s*\\(`), `${importer.file} snapshot rows must commit inside tx`);
    assert.match(source, /tx\.tournamentImport\.update\s*\(/, `${importer.file} SUCCESS audit must commit inside tx`);
    assert.match(
      source,
      /refreshTournamentMatchesPreservingState\s*\(\s*\{\s*tx,/,
      `${importer.file} match refresh must preserve manual/sync state inside tx`,
    );
    assert.match(
      source,
      /refreshTournamentParticipantsPreservingState\s*\(\s*\{\s*tx,/,
      `${importer.file} participant refresh must preserve row identity inside tx`,
    );
    assert.match(
      source,
      /tournamentImport\.updateMany\s*\([\s\S]*?where:\s*\{\s*id:\s*importRecord\.id,\s*status:\s*"PENDING"\s*\}/,
      `${importer.file} may mark FAILED only when SUCCESS did not commit`,
    );
    assert.match(source, /status:\s*"FAILED"/, `${importer.file} must persist a failure audit after rollback`);
  }
});
