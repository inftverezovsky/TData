import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDota2Tournament } from "../backend/src/normalizers/dota2Tournament";
import { normalizeCounterStrikeTournament } from "../backend/src/normalizers/counterstrikeTournament";
import { normalizeLeagueOfLegendsTournament } from "../backend/src/normalizers/leagueoflegendsTournament";
import { normalizeValorantTournament } from "../backend/src/normalizers/valorantTournament";
import * as dotaIdentity from "../backend/src/normalizers/dota2/matchIdentity";
import * as csIdentity from "../backend/src/normalizers/counterstrike/matchIdentity";
import * as lolIdentity from "../backend/src/normalizers/leagueoflegends/matchIdentity";
import * as valorantIdentity from "../backend/src/normalizers/valorant/matchIdentity";
import { extractMatchesFromParsedHtml as dotaHtml } from "../backend/src/normalizers/dota2/htmlMatches";
import { extractMatchesFromParsedHtml as csHtml } from "../backend/src/normalizers/counterstrike/htmlMatches";
import { extractMatchesFromParsedHtml as lolHtml } from "../backend/src/normalizers/leagueoflegends/htmlMatches";
import { extractMatchesFromParsedHtml as valorantHtml } from "../backend/src/normalizers/valorant/htmlMatches";
import type { NormalizedMatch } from "../backend/src/normalizers/types";

const parsers = [
  { slug: "dota2", normalize: normalizeDota2Tournament, html: dotaHtml, identity: dotaIdentity },
  { slug: "counterstrike", normalize: normalizeCounterStrikeTournament, html: csHtml, identity: csIdentity },
  { slug: "leagueoflegends", normalize: normalizeLeagueOfLegendsTournament, html: lolHtml, identity: lolIdentity },
  { slug: "valorant", normalize: normalizeValorantTournament, html: valorantHtml, identity: valorantIdentity },
];
const exactDate = "2026-05-20T12:30:00.000Z";

for (const parser of parsers) {
  const pageUrl = `https://liquipedia.net/${parser.slug}/Boundary_Cup`;
  const normalize = (wikitext: string, parsedHtml?: string) => parser.normalize({ title: "Boundary Cup", pageUrl, wikitext, parsedHtml });

  test(`${parser.slug}: HTML fills missing metadata while wiki metadata retains priority`, (context) => {
    context.mock.method(Date, "now", () => Date.parse("2026-05-21T12:00:00Z"));
    const fields = {
      "Start Date:": "2026-05-20", "End Date:": "2026-05-22", "Location:": "Berlin",
      "Region:": "Europe", "Organizer:": "Fixture organizer", "Prize Pool:": "$1000", "Number of teams:": "8",
    };
    const html = `<div class="fo-ntax-infobox"><div class="infobox-header">HTML Cup</div>${Object.entries(fields)
      .map(([key, value]) => `<div class="infobox-cell-2">${key}</div><div class="infobox-cell-2">${value}</div>`).join("")}</div>`;
    const fromHtml = normalize("", html);
    assert.equal(fromHtml.name, "HTML Cup");
    assert.equal(fromHtml.startDate?.toISOString(), "2026-05-20T00:00:00.000Z");
    assert.equal(fromHtml.endDate?.toISOString(), "2026-05-22T00:00:00.000Z");
    assert.equal(fromHtml.location, "Berlin");
    assert.equal(fromHtml.region, "Europe");
    assert.equal(fromHtml.organizer, "Fixture organizer");
    assert.equal(fromHtml.prizePool, "$1000");
    assert.equal(fromHtml.tournamentStatus, "ongoing");
    const fromWiki = normalize("{{Infobox league|name=Wiki Cup|sdate=2026-05-10|edate=2026-05-12|location=Paris|region=EU|organizer=Wiki organizer|prizepool=2000|teams=unknown}}", html);
    assert.equal(fromWiki.name, "Wiki Cup");
    assert.equal(fromWiki.location, "Paris");
    assert.equal(fromWiki.tournamentStatus, "finished");
    assert.equal(fromWiki.startDate?.toISOString(), "2026-05-10T00:00:00.000Z");
    for (const [dates, expected] of [
      ["|sdate=2026-05-22", "upcoming"], ["|sdate=2026-05-20", "ongoing"],
    ]) {
      assert.equal(normalize(`{{Infobox league${dates}}}`).tournamentStatus, expected);
    }
    const empty = normalize("", "<div class='fo-ntax-infobox'><div class='infobox-cell-2'>Number of teams:</div><div class='infobox-cell-2'>unknown</div></div>");
    assert.equal(empty.name, "Boundary Cup");
    assert.equal(empty.matches.length, 0);
    assert.equal(empty.status, "PARTIAL");
    assert.equal(normalize("").startDate, null);
  });

  test(`${parser.slug}: malformed cards are ignored and alternate team labels preserve names`, () => {
    const names = [
      `<div class="brkts-matchlist-opponent" aria-label="Alpha"><span class="name">Short</span></div>`,
      `<section aria-label="Alpha"><div class="brkts-matchlist-opponent"><span class="name">Short</span></div></section>`,
      `<div class="brkts-matchlist-opponent"><span class="name"><a title="Alpha">Short</a></span></div>`,
      `<div class="brkts-matchlist-opponent"><a href="/${parser.slug}/Alpha" title="Alpha">Short</a></div>`,
      `<div class="brkts-matchlist-opponent"><span class="name"><a title="Time">Alpha</a></span></div>`,
      `<div class="brkts-matchlist-opponent"><span class="name">Alpha</span></div>`,
    ];
    for (const team of names) {
      const matches = parser.html(`<div class="brkts-matchlist-match"><div class="brkts-matchlist-opponent">incomplete</div></div>
        <h3>Group A [edit]</h3><p>Introductory text</p><div class="brkts-matchlist-match">${team}
        <div class="brkts-matchlist-opponent"><span class="name">Beta</span></div>
        <span class="timer-object" data-timestamp="1779280200" data-finished="finished"></span>
        <span class="brkts-matchlist-score">2</span><span class="brkts-matchlist-score">0</span><span data-bestof="3">BO3</span></div>`, pageUrl);
      assert.equal(matches.length, 1);
      assert.equal(matches[0].teamAName, "Alpha");
      assert.equal(matches[0].teamBName, "Beta");
      assert.equal(matches[0].matchDate?.toISOString(), exactDate);
      assert.equal(matches[0].scoreA, 2);
      assert.equal(matches[0].scoreB, 0);
      assert.equal(matches[0].status, "finished");
      assert.equal(matches[0].stage, "Group A");
    }
  });

  test(`${parser.slug}: exact clocks recover invalid timestamps while date-only cards stay undated`, () => {
    for (const [clock, expected] of [
      ["May 20, 2026 - 12:30 UTC", exactDate], ["May 20, 2026", undefined], ["not a date", undefined],
    ]) {
      const result = parser.html(`<div class="brkts-match"><div class="brkts-opponent-entry"><span class="name">Alpha</span></div>
        <div class="brkts-opponent-entry"><span class="name">TBD</span></div>
        <div class="brkts-match-info-popup"><span class="timer-object" data-timestamp="invalid">${clock}</span></div></div>`, pageUrl);
      assert.equal(result.length, 1);
      assert.equal(result[0].matchDate?.toISOString(), expected);
      assert.equal(result[0].scoreA, null);
      assert.equal(result[0].teamBName, "TBD");
    }
  });

  test(`${parser.slug}: navigation ignores editing links, other events and non-stage tabs`, () => {
    const normalized = normalize("", `<div class="tabs-static">
      <a>empty</a><a href="#Schedule">section</a>
      <a href="/${parser.slug}/Boundary_Cup/Playoffs?action=edit">edit</a>
      <a href="/${parser.slug}/Other_Cup/Playoffs">other event</a>
      <a href="/${parser.slug}/Boundary_Cup/Teams">teams</a>
      <a href="/${parser.slug}/Boundary_Cup/Open_Qualifier">qualifier</a>
      <a href="/${parser.slug}/Boundary_Cup/Unknown_Section">unknown</a>
      <a href="/${parser.slug}/Boundary_Cup/Playoffs">playoffs</a>
      <a href="/${parser.slug}/Boundary_Cup/Playoffs#Final">same stage anchor</a>
    </div>`);
    assert.deepEqual(normalized.subPages, [`${pageUrl}/Playoffs`]);
  });

  test(`${parser.slug}: stable identities preserve explicit IDs and richer duplicates without merging rounds`, () => {
    assert.equal(parser.identity.normalizeMatchCandidate({}, "Boundary Cup", ""), null);
    const placeholder = parser.identity.normalizeMatchCandidate({}, "Boundary Cup", "0")!;
    assert.equal(placeholder.teamAName, "TBD");
    assert.equal(placeholder.teamBName, "TBD");
    const explicit = parser.identity.normalizeMatchCandidate({ matchId: "external-42", teamAName: " Alpha ", teamBName: "Beta", court: "1" }, "Boundary Cup", "1")!;
    assert.equal(explicit.matchId, "external-42");
    assert.equal(explicit.teamAName, "Alpha");
    assert.equal(explicit.court, "1");
    assert.ok(explicit.lpNumericalId! > 0n);
    const summary: NormalizedMatch = { matchId: "shared", teamAName: "Alpha", teamBName: "Beta" };
    const detailed = { ...summary, matchDate: new Date(exactDate), matchDateTime: "12:30 UTC", format: "BO3", stage: "Playoffs", round: "Final", sourceUrl: pageUrl };
    assert.deepEqual(parser.identity.dedupeMatches([{}, summary, detailed, summary]), [detailed]);
    const otherRound = { ...detailed, matchId: "next-round", round: "Grand Final" };
    assert.equal(parser.identity.dedupeMatches([detailed, otherRound]).length, 2);
    const pairSummary = { ...summary, matchId: "pair-summary" };
    const pairDetails = { ...pairSummary, matchId: "pair-details", sourceUrl: pageUrl };
    const pairResult = parser.identity.dedupeMatches([pairSummary, pairDetails, { ...pairSummary, matchId: "again" }]);
    assert.equal(pairResult.length, 1);
    assert.equal(pairResult[0].teamAName, "Alpha");
    assert.equal(pairResult[0].teamBName, "Beta");
    // У CS нет общего scoring для sourceUrl; проверяем обогащение только в дисциплинах с этим контрактом.
    if (parser.slug !== "counterstrike") assert.equal(pairResult[0].sourceUrl, pageUrl);
  });
}

test("wiki participant lists supplement HTML, deduplicate aliases and exclude placeholders or layout noise", () => {
  for (const parser of parsers.filter((item) => item.slug !== "valorant")) {
    const normalized = parser.normalize({ title: "Participants Cup", pageUrl: `https://liquipedia.net/${parser.slug}/Participants_Cup`,
      wikitext: `== Participants ==\n{{Team|Alpha}}{{Team|Beta}}{{Team|TBD}}{{Team|A}}{{Team|bad=value}}[[Team:Gamma|G]]\n|team=Beta\n== Results ==\n{{Team|Unrelated}}`,
      parsedHtml: `<div class="team-card"><a>ignored</a><a href="/${parser.slug}/Category:Teams">Category</a><a href="/${parser.slug}/Alpha" title="Alpha">A</a><img src="/alpha.png"></div>
        <div class="team-card"><a href="/${parser.slug}/TBD" title="TBD">TBD</a></div>`,
    });
    assert.deepEqual(normalized.participants.map((team) => team.name).sort(), ["Alpha", "Beta", "Gamma"]);
    assert.equal(normalized.participants.find((team) => team.name === "Alpha")?.logoUrl, "https://liquipedia.net/alpha.png");
  }
});
