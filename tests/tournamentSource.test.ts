import assert from "node:assert/strict";
import test from "node:test";
import { detectTournamentSource, getTournamentSourceLabel } from "../src/lib/utils/tournamentSource";

test("detectTournamentSource detects HLTV URLs", () => {
  assert.equal(detectTournamentSource("https://www.hltv.org/events/8049/pgl-astana-2026"), "hltv");
  assert.equal(detectTournamentSource("https://hltv.org/events/8049/pgl-astana-2026"), "hltv");
});

test("detectTournamentSource detects VLR URLs", () => {
  assert.equal(detectTournamentSource("https://www.vlr.gg/event/2954/esports-world-cup-2026-emea-qualifier"), "vlr");
  assert.equal(detectTournamentSource("https://vlr.gg/674859/fnatic-vs-karmine-corp"), "vlr");
});

test("detectTournamentSource detects DLTV URLs", () => {
  assert.equal(detectTournamentSource("https://ru.dltv.org/events/dreamleague-season-29"), "dltv");
  assert.equal(detectTournamentSource("https://dltv.org/matches/426528/team-spirit-vs-team-falcons"), "dltv");
});

test("detectTournamentSource detects Fandom LoL URLs", () => {
  assert.equal(detectTournamentSource("https://lol.fandom.com/wiki/Esports_World_Cup_2026"), "fandom");
});

test("detectTournamentSource defaults to Liquipedia", () => {
  assert.equal(detectTournamentSource("https://liquipedia.net/counterstrike/PGL/2026/Astana"), "liquipedia");
  assert.equal(detectTournamentSource(null), "liquipedia");
});

test("getTournamentSourceLabel returns user-facing labels", () => {
  assert.equal(getTournamentSourceLabel("hltv"), "Источник: HLTV");
  assert.equal(getTournamentSourceLabel("vlr"), "Источник: VLR");
  assert.equal(getTournamentSourceLabel("dltv"), "Источник: DLTV");
  assert.equal(getTournamentSourceLabel("fandom"), "Источник: Fandom");
  assert.equal(getTournamentSourceLabel("liquipedia"), "Источник: Liquipedia");
});
