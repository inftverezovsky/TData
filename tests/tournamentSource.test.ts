import assert from "node:assert/strict";
import test from "node:test";
import { detectTournamentSource, getTournamentSourceLabel, supportsStageAnnouncements } from "../src/lib/utils/tournamentSource";

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

test("detectTournamentSource detects VolleyballWorld URLs", () => {
  assert.equal(detectTournamentSource("https://en.volleyballworld.com/global-schedule#fromDate=2026-05-27&yeardiscipline=beach"), "volleyballworld");
  assert.equal(detectTournamentSource("https://www.volleyballworld.com/beachvolleyball/competitions/beach-pro-tour-2026/events/elite16-ostrava-cze/schedule/"), "volleyballworld");
});

test("detectTournamentSource detects beach.volley.ru URLs", () => {
  assert.equal(detectTournamentSource("https://beach.volley.ru/calendar/01K9CBPGKV0CWX0442H8T704M7/allgames?sex=1"), "beachvolleyru");
  assert.equal(detectTournamentSource("https://beach.volley.ru/games/01KRH2192B2KYF0Y8VZ3AR0CKJ"), "beachvolleyru");
});

test("detectTournamentSource detects German Beach Tour URLs", () => {
  assert.equal(detectTournamentSource("https://beach.volleyball-verband.de/public/tur.php"), "germanbeachtour");
  assert.equal(detectTournamentSource("https://beach.volleyball-verband.de/public/tur-show.php?id=14684"), "germanbeachtour");
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
  assert.equal(getTournamentSourceLabel("volleyballworld"), "Источник: VolleyballWorld");
  assert.equal(getTournamentSourceLabel("beachvolleyru"), "Источник: beach.volley.ru");
  assert.equal(getTournamentSourceLabel("germanbeachtour"), "Источник: German Beach Tour");
  assert.equal(getTournamentSourceLabel("liquipedia"), "Источник: Liquipedia");
});

test("supportsStageAnnouncements includes placeholder-slot sources", () => {
  for (const source of ["liquipedia", "hltv", "vlr", "dltv", "fandom", "volleyballworld", "beachvolleyru", "germanbeachtour"] as const) {
    assert.equal(supportsStageAnnouncements(source), true, source);
  }
  assert.equal(supportsStageAnnouncements(null), false);
});
