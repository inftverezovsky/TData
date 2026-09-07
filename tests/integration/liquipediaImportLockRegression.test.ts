import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import https from "node:https";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { requireTestDatabaseUrl } from "../../scripts/helpers/testDatabase";
import { prisma } from "../../backend/src/db/db";
import { createEmptyEsportsParsingDiagnostics } from "../../backend/src/matches/parsingDiagnostics";
import type { NormalizedTournament } from "../../backend/src/normalizers/types";
import { importTournamentRecursive } from "../../backend/src/sources/tdata/liquipedia/importer/recursive";

process.env.DATABASE_URL = requireTestDatabaseUrl(process.env.TEST_DATABASE_URL);

const disciplines = [
  { slug: "dota2", diagnosticsKey: "dota2Diagnostics" },
  { slug: "counterstrike", diagnosticsKey: null },
  { slug: "leagueoflegends", diagnosticsKey: "leagueOfLegendsDiagnostics" },
  { slug: "valorant", diagnosticsKey: "valorantDiagnostics" },
] as const;

test.after(async () => { await prisma.$disconnect(); });

for (const { slug, diagnosticsKey } of disciplines) {
  test(`${slug} recursive import commits cached pages, last-good cache and merged diagnostics`, { timeout: 15_000 }, async (context) => {
    const suffix = randomUUID();
    const title = `Lock regression ${suffix}`;
    const subTitle = `${title}/Playoffs`;
    const pageUrl = `https://liquipedia.net/${slug}/Lock_regression_${suffix}`;
    const subpageUrl = `${pageUrl}/Playoffs`;
    const importId = `lock-regression-${suffix}`;
    const teamNames = ["Alpha", "Beta", "Gamma", "Delta"].map((name) => `${name} ${suffix}`);
    const matchDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const existingDiscipline = await prisma.discipline.findUnique({ where: { slug } });
    const discipline = existingDiscipline ?? await prisma.discipline.create({ data: { slug, name: slug } });
    const networkAttempts: string[] = [];
    const rejectNetwork = () => { networkAttempts.push("request"); throw new Error("this cached import must not access the network"); };
    context.mock.method(http, "request", rejectNetwork);
    context.mock.method(https, "request", rejectNetwork);
    context.mock.method(globalThis, "fetch", rejectNetwork);

    try {
      await prisma.tournamentImport.create({
        data: { id: importId, disciplineId: discipline.id, pageTitle: title, pageUrl },
      });
      for (const [pageTitle, sourceUrl] of [[title, pageUrl], [subTitle, subpageUrl]]) {
        await prisma.rawSnapshot.create({ data: {
          tournamentImportId: importId,
          source: "liquipedia-mediawiki-api",
          disciplineSlug: slug,
          pageTitle,
          revisionId: 101,
          rawJson: { cachedFixture: true },
          rawWikitext: `{{Infobox league|name=${pageTitle}}}`,
          rawHtml: "<div>Cached HTML</div>",
          metadata: { pageUrl: sourceUrl },
        } });
      }

      const normalizedPages: string[] = [];
      const normalizer = (input: { title: string; pageUrl: string; wikitext: string; parsedHtml?: string }): NormalizedTournament => {
        normalizedPages.push(input.title);
        assert.equal(input.wikitext, `{{Infobox league|name=${input.title}}}`);
        assert.equal(input.parsedHtml, "<div>Cached HTML</div>");
        const isMain = input.title === title;
        const names = isMain ? teamNames.slice(0, 2) : teamNames.slice(2);
        return {
          sourceTitle: input.title,
          sourceUrl: input.pageUrl,
          name: title,
          participants: names.map((name) => ({ name })),
          matches: [{
            teamAName: names[0], teamBName: names[1], matchDate,
            scoreA: null, scoreB: null, format: "bo3", status: "scheduled",
            sourceUrl: input.pageUrl,
          }],
          subPages: isMain ? [subpageUrl] : [],
          warnings: [],
          status: "SUCCESS",
          ...(diagnosticsKey ? {
            [diagnosticsKey]: createEmptyEsportsParsingDiagnostics("liquipedia", { rawCandidates: 1, savedMatches: 0 }),
          } : {}),
        };
      };

      const result = await importTournamentRecursive({
        disciplineId: discipline.id, disciplineSlug: slug, title, pageUrl,
        apiUrl: "http://127.0.0.1:1/not-used/api.php", importRecordId: importId, normalizer,
      });

      assert.deepEqual(normalizedPages, [title, subTitle]);
      assert.deepEqual(networkAttempts, []);
      assert.equal(result.cacheHit, true);
      assert.equal(result.warning, null);
      assert.equal(result.processedMatchIds.length, 2);
      const tournament = await prisma.tournament.findUniqueOrThrow({
        where: { id: result.tournament.id }, include: { matches: true, participants: true },
      });
      assert.equal(tournament.extractionStatus, "SUCCESS");
      assert.equal(tournament.lastImportId, importId);
      assert.equal(tournament.matches.length, 2);
      assert.deepEqual(tournament.participants.map((participant) => participant.name).sort(), [...teamNames].sort());
      assert.equal((await prisma.tournamentImport.findUniqueOrThrow({ where: { id: importId } })).status, "SUCCESS");

      const snapshots = await prisma.rawSnapshot.findMany({ where: { tournamentImportId: importId }, select: { id: true } });
      const cache = await prisma.sourceFetchCache.findMany({ where: { rawSnapshotId: { in: snapshots.map((snapshot) => snapshot.id) } } });
      assert.equal(cache.length, 2, "both accepted pages must publish after the business transaction commits");
      assert.ok(cache.every((entry) => entry.lastGoodAt && entry.lastErrorClass === null && entry.externalRequests === 0));

      if (diagnosticsKey) {
        const diagnostics = jsonObject(jsonObject(tournament.normalization)[diagnosticsKey]);
        assert.equal(diagnostics.savedMatches, 2, "the separate diagnostics transaction must replace the main page's initial zero count");
        assert.equal(diagnostics.rawCandidates, 2, "diagnostics must include the main page and its subpage");
      }
    } finally {
      const snapshots = await prisma.rawSnapshot.findMany({ where: { tournamentImportId: importId }, select: { id: true } });
      await prisma.sourceFetchCache.deleteMany({ where: { rawSnapshotId: { in: snapshots.map((snapshot) => snapshot.id) } } });
      await prisma.tournament.deleteMany({ where: { disciplineSlug: slug, sourceTitle: { in: [title, subTitle] } } });
      await prisma.tournamentImport.deleteMany({ where: { id: importId } });
      if (!existingDiscipline) await prisma.discipline.delete({ where: { id: discipline.id } });
    }
  });
}

function jsonObject(value: Prisma.JsonValue | undefined): Prisma.JsonObject {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value;
}
