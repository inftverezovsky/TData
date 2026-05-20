import assert from "node:assert/strict";
import test from "node:test";
import { detectTournamentSource, getTournamentSourceLabel } from "../src/lib/utils/tournamentSource";

test("detectTournamentSource detects HLTV URLs", () => {
  assert.equal(detectTournamentSource("https://www.hltv.org/events/8049/pgl-astana-2026"), "hltv");
  assert.equal(detectTournamentSource("https://hltv.org/events/8049/pgl-astana-2026"), "hltv");
});

test("detectTournamentSource defaults to Liquipedia", () => {
  assert.equal(detectTournamentSource("https://liquipedia.net/counterstrike/PGL/2026/Astana"), "liquipedia");
  assert.equal(detectTournamentSource(null), "liquipedia");
});

test("getTournamentSourceLabel returns user-facing labels", () => {
  assert.equal(getTournamentSourceLabel("hltv"), "HLTV Source");
  assert.equal(getTournamentSourceLabel("liquipedia"), "Liquipedia Source");
});
