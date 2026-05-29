import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLiquipediaSearchVariations,
  filterLiquipediaSearchResultsForQuery,
  isLiquipediaSearchTitleRelevant,
  shouldShowLiquipediaSearchResult,
} from "../src/lib/sources/TCyber/liquipedia/client";

test("Liquipedia search expands trailing league abbreviation", () => {
  const variations = buildLiquipediaSearchVariations("Dream L", 2026);

  assert.ok(variations.includes("DreamLeague"));
  assert.ok(variations.includes("Dream League"));
  assert.ok(variations.includes("DreamLeague 2026"));
});

test("Liquipedia search builds year-aware page path variations", () => {
  assert.ok(buildLiquipediaSearchVariations("PGL Astana 2026", 2026).includes("PGL/2026/Astana"));
  assert.ok(buildLiquipediaSearchVariations("Mid-Season Invitational 2026", 2026).includes("Mid-Season Invitational/2026"));
  assert.ok(buildLiquipediaSearchVariations("Source League 2026 Spring Promotion", 2026).includes("Source League/2026/Spring/Promotion"));
});

test("Liquipedia search treats roman tournament numbers as numeric path numbers", () => {
  const variations = buildLiquipediaSearchVariations("BLAST Slam VII", 2026);

  assert.ok(variations.includes("BLAST Slam 7"));
  assert.ok(variations.includes("BLAST/Slam/7"));
  assert.equal(isLiquipediaSearchTitleRelevant("BLAST Slam VII", "BLAST/Slam/7"), true);
});

test("Liquipedia search title relevance rejects unrelated MediaWiki matches", () => {
  assert.equal(isLiquipediaSearchTitleRelevant("Dream L", "DreamLeague/29"), true);
  assert.equal(isLiquipediaSearchTitleRelevant("Dream L", "The International/2014"), false);
  assert.equal(isLiquipediaSearchTitleRelevant("PGL Asta", "PGL Astana 2026"), true);
});

test("Liquipedia cached search filters stale old tournaments unless year is explicit", () => {
  const results = [
    { title: "DreamLeague/29", dates: "2026-05-13 — 2026-05-24" },
    { title: "DreamLeague/13", dates: "2020-01-18 — 2020-01-26" },
    { title: "The International/2014", dates: null },
  ];

  assert.deepEqual(
    filterLiquipediaSearchResultsForQuery("Dream L", results, 2026).map((result) => result.title),
    ["DreamLeague/29"]
  );
  assert.deepEqual(
    filterLiquipediaSearchResultsForQuery("DreamLeague 2020", results, 2026).map((result) => result.title),
    ["DreamLeague/13"]
  );
});

test("LoL future window keeps major tournaments in search results", () => {
  assert.equal(
    shouldShowLiquipediaSearchResult(
      "MSI",
      "Mid-Season Invitational/2026",
      "2026-06-28 — 2026-07-12",
      2026,
      { futureWindowDays: 180 }
    ),
    true
  );
});

test("Liquipedia default future window is 60 days", () => {
  const currentYear = new Date().getFullYear();
  const isoInDays = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  assert.equal(
    shouldShowLiquipediaSearchResult("European Pro League", "European Pro League", isoInDays(50), currentYear),
    true
  );
  assert.equal(
    shouldShowLiquipediaSearchResult("European Pro League", "European Pro League", isoInDays(75), currentYear),
    false
  );
});
