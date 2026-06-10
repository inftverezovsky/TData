import assert from "node:assert/strict";
import test from "node:test";
import { getSourceProvider, sourceProviders } from "../src/lib/sources/providerRegistry";
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

test("detectTournamentSource detects 12ndr CSVP and ÖVV URLs", () => {
  assert.equal(detectTournamentSource("https://fivb.12ndr.at/?season=2026&international=int"), "twelvendrcsvp");
  assert.equal(detectTournamentSource("https://fivb.12ndr.at/oevv?season=2026"), "twelvendroevv");
  assert.equal(detectTournamentSource("CSVP — Women [12NDR-CSVP:F3CSVP26]"), "twelvendrcsvp");
  assert.equal(detectTournamentSource("ÖVV — Men [12NDR-OEVV:M1AUT26]"), "twelvendroevv");
});

test("detectTournamentSource detects CBV and Federvolley URLs", () => {
  assert.equal(detectTournamentSource("https://evolleyball.cbv.com.br/#!/tabelas?etapaId=950"), "cbv");
  assert.equal(detectTournamentSource("CBVP ADULTO [CBV:37:23:950]"), "cbv");
  assert.equal(detectTournamentSource("https://beachvolley.federvolley.it/index.php/node/66744"), "federvolley");
  assert.equal(detectTournamentSource("https://srv.matchshare.it/bvl_test/bracket.php?lid=11518&client_name=bvl_development"), "federvolley");
  assert.equal(detectTournamentSource("Caorle [FIPAV:assoluto:66744:11518]"), "federvolley");
});

test("detectTournamentSource detects WTT URLs", () => {
  assert.equal(detectTournamentSource("https://www.worldtabletennis.com/eventInfo?eventId=3031"), "wtt");
  assert.equal(detectTournamentSource("WTT Contender [WTT:3031]"), "wtt");
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
  assert.equal(getTournamentSourceLabel("twelvendrcsvp"), "Источник: 12ndr CSVP");
  assert.equal(getTournamentSourceLabel("twelvendroevv"), "Источник: 12ndr ÖVV");
  assert.equal(getTournamentSourceLabel("cbv"), "Источник: CBV");
  assert.equal(getTournamentSourceLabel("federvolley"), "Источник: Federvolley");
  assert.equal(getTournamentSourceLabel("wtt"), "Источник: WTT");
  assert.equal(getTournamentSourceLabel("liquipedia"), "Источник: Liquipedia");
});

test("supportsStageAnnouncements includes placeholder-slot sources", () => {
  for (const source of ["liquipedia", "hltv", "vlr", "dltv", "fandom", "volleyballworld", "beachvolleyru", "germanbeachtour", "twelvendrcsvp", "twelvendroevv", "cbv", "federvolley", "wtt"] as const) {
    assert.equal(supportsStageAnnouncements(source), true, source);
  }
  assert.equal(supportsStageAnnouncements(null), false);
});

test("source provider registry contains all known tournament sources", () => {
  assert.deepEqual(
    sourceProviders.map((provider) => provider.id),
    ["liquipedia", "hltv", "vlr", "dltv", "fandom", "volleyballworld", "beachvolleyru", "germanbeachtour", "twelvendroevv", "twelvendrcsvp", "cbv", "federvolley", "wtt"],
  );

  for (const provider of sourceProviders) {
    assert.equal(getSourceProvider(provider.id), provider);
    assert.equal(getTournamentSourceLabel(provider.id), provider.label);
    assert.equal(supportsStageAnnouncements(provider.id), provider.supportsStageAnnouncements);
  }
});
