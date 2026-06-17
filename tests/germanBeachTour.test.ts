import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTournamentPageUrl,
  extractGermanBeachTourTournamentId,
  filterGermanBeachTourUpcomingTournaments,
  isActiveGermanBeachTourMatch,
  parseGermanBeachTourCalendar,
  parseGermanBeachTourMatches,
  parseGermanBeachTourTournamentPage,
  resolveGermanBeachTourUpcomingWindow,
} from "../backend/src/sources/tbvolley/GermanBeachTour";

test("German Beach Tour calendar parser keeps upcoming gender-specific tour events", () => {
  const html = `
    <table class="contenttable">
      <tr><td>Datum</td><td>Kategorie</td><td>Ort</td><td>Geschlecht</td><td>Teams</td></tr>
      <tr>
        <td>22.05. - 24.05.2026</td>
        <td>Deutsche Beach-Volleyball Tour\\Urlaubsguru Beach Cup</td>
        <td><a href="tur-show.php?id=14674">Norderney</a></td>
        <td><a href="tur-show.php?id=14674">Männer</a></td>
        <td align="right">23</td>
      </tr>
      <tr>
        <td>04.06. - 07.06.2026</td>
        <td>Deutsche Beach-Volleyball Tour\\German Beach Tour</td>
        <td><a href="tur-show.php?id=14684">Berlin</a></td>
        <td><a href="tur-show.php?id=14684">Männer</a></td>
        <td align="right">21</td>
      </tr>
      <tr>
        <td>04.06. - 07.06.2026</td>
        <td>Deutsche Beach-Volleyball Tour\\German Beach Tour</td>
        <td><a href="tur-show.php?id=14683">Berlin</a></td>
        <td><a href="tur-show.php?id=14683">Frauen</a></td>
        <td align="right">18</td>
      </tr>
      <tr>
        <td>02.07. - 05.07.2026</td>
        <td>Deutsche Beach-Volleyball Tour\\German Beach Tour</td>
        <td><a href="tur-show.php?id=14668">München</a></td>
        <td><a href="tur-show.php?id=14668">Männer</a></td>
        <td align="right">16</td>
      </tr>
      <tr>
        <td>27.08. - 30.08.2026</td>
        <td>Deutsche Beach-Volleyball Meisterschaften</td>
        <td><a href="tur-show.php?id=14643">Dortmund</a></td>
        <td><a href="tur-show.php?id=14643">Männer</a></td>
        <td>k.a.</td>
      </tr>
    </table>
  `;

  const tournaments = parseGermanBeachTourCalendar(html, { gender: "men" });
  assert.equal(tournaments.length, 3);
  assert.equal(tournaments[1].tournamentId, "14684");
  assert.equal(tournaments[1].type, "German Beach Tour");
  assert.equal(tournaments[1].pageUrl, "https://beach.volleyball-verband.de/public/tur-show.php?id=14684");

  const window = resolveGermanBeachTourUpcomingWindow(new Date("2026-05-27T09:00:00.000Z"));
  assert.equal(window.fromDate, "2026-05-27");
  assert.equal(window.toDate, "2026-06-27");
  assert.deepEqual(
    filterGermanBeachTourUpcomingTournaments(tournaments, window).map((tournament) => tournament.tournamentId),
    ["14684"],
  );
});

test("German Beach Tour tournament page parser extracts metadata", () => {
  const html = `
    <p class="pageheader">German Beach Tour Berlin I Männer</p>
    <table>
      <tr><td class="bez2">Datum von</td><td>04.06.2026</td></tr>
      <tr><td class="bez2">Datum bis</td><td>07.06.2026</td></tr>
      <tr><td class="bez2">Geschlecht</td><td>Männer</td></tr>
      <tr><td class="bez2">Typ</td><td>German Beach Tour</td></tr>
      <tr><td class="bez2">Ort</td><td>Berlin</td></tr>
      <tr><td class="bez2">Gelände</td><td>Funkhaus Beach</td></tr>
      <tr><td class="bez2">Preisgeld</td><td>10.000 Euro</td></tr>
      <tr><td class="bez2">Teams Hauptfeld</td><td>8</td></tr>
    </table>
  `;

  const tournament = parseGermanBeachTourTournamentPage(html, {
    tournamentId: "14684",
    gender: "men",
    pageUrl: buildTournamentPageUrl("14684"),
  });

  assert.equal(tournament.title, "German Beach Tour Berlin I");
  assert.equal(tournament.gender, "men");
  assert.equal(tournament.city, "Berlin");
  assert.equal(tournament.venue, "Funkhaus Beach");
  assert.equal(tournament.prizePool, "10.000 Euro");
  assert.equal(tournament.teams, 8);
});

test("German Beach Tour match parser extracts teams, scores, and Moscow time", () => {
  const html = `
    <div class="content"><center>
      <div class="sectionheader">Achtelfinale Winner</div>
      <div>Spiele</div>
      <table width="100%">
        <tr class="bez2">
          <td>Spiel</td><td>Tag</td><td>Zeit</td><td>Court</td><td>Team 1</td><td>vs</td><td>Team 2</td>
          <td>Schiedsrichter</td><td>Ergebnis</td><td>Dauer</td><td>Platz</td><td></td>
        </tr>
        <tr>
          <td align="right">1</td>
          <td>08.05.2026</td>
          <td align="right">16:15</td>
          <td align="center">1</td>
          <td style="font-weight:bold"><a href="team.php?id=65873">Henning - Pfretzschner (1)</a></td>
          <td>:</td>
          <td><a href="team.php?id=60165">Bungert - Wüst (8)</a></td>
          <td>Grothe Theresa</td>
          <td><a href="tur-spiel.php?id=14662&feld=1&spiel=1">2:1 (21:16, 18:21, 15:12)</a></td>
          <td>38, 20, 15</td>
          <td></td>
          <td></td>
        </tr>
      </table>
    </center></div>
  `;

  const matches = parseGermanBeachTourMatches(html, { tournamentId: "14662", gender: "men", field: "main" });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, "14662-1-1");
  assert.equal(matches[0].stage, "Hauptfeld");
  assert.equal(matches[0].round, "Achtelfinale Winner");
  assert.equal(matches[0].court, "Court 1");
  assert.equal(matches[0].teamA.name, "Henning / Pfretzschner");
  assert.equal(matches[0].teamB.name, "Bungert / Wüst");
  assert.equal(matches[0].startTimeUtc, "2026-05-08T14:15:00.000Z");
  assert.equal(matches[0].startTimeMoscow, "08.05.2026 17:15:00");
  assert.equal(matches[0].status, "finished");
  assert.deepEqual(matches[0].score.sets, [
    { no: 1, teamA: 21, teamB: 16 },
    { no: 2, teamA: 18, teamB: 21 },
    { no: 3, teamA: 15, teamB: 12 },
  ]);
});

test("German Beach Tour parser keeps 0:0 empty-result rows upcoming", () => {
  const html = `
    <div class="content"><center>
      <div class="sectionheader">Viertelfinale</div>
      <div>Spiele</div>
      <table width="100%">
        <tr class="bez2">
          <td>Spiel</td><td>Tag</td><td>Zeit</td><td>Court</td><td>Team 1</td><td>vs</td><td>Team 2</td>
          <td>Schiedsrichter</td><td>Ergebnis</td><td>Dauer</td><td>Platz</td><td></td>
        </tr>
        <tr>
          <td align="right">1</td>
          <td>11.06.2026</td>
          <td align="right">15:30</td>
          <td align="center">1</td>
          <td><a href="team.php?id=60165">Bungert - Wüst (4)</a></td>
          <td>:</td>
          <td><a href="team.php?id=61233">Kaminski - Sambale (5)</a></td>
          <td>Müller Heike Grothe Theresa Vorspiel</td>
          <td><a href="tur-spiel.php?id=14686&feld=2&spiel=1">0:0 ()</a></td>
          <td></td>
          <td>Verl. 5</td>
          <td></td>
        </tr>
      </table>
    </center></div>
  `;

  const matches = parseGermanBeachTourMatches(html, { tournamentId: "14686", gender: "men", field: "qualification" });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].status, "upcoming");
  assert.equal(matches[0].score.teamA, null);
  assert.equal(matches[0].score.teamB, null);
  assert.deepEqual(matches[0].score.sets, []);
  assert.equal(matches[0].startTimeMoscow, "11.06.2026 16:30:00");
});

test("German Beach Tour active match filter drops finished and out-of-window matches", () => {
  const window = { fromDate: "2026-05-27", toDate: "2026-06-27", windowDays: 31 };

  assert.equal(isActiveGermanBeachTourMatch({
    status: "upcoming",
    startTimeUtc: "2026-06-04T14:00:00.000Z",
  }, window), true);
  assert.equal(isActiveGermanBeachTourMatch({
    status: "finished",
    startTimeUtc: "2026-06-04T14:00:00.000Z",
  }, window), false);
  assert.equal(isActiveGermanBeachTourMatch({
    status: "upcoming",
    startTimeUtc: "2026-07-02T14:00:00.000Z",
  }, window), false);
});

test("German Beach Tour helpers resolve source IDs", () => {
  assert.equal(extractGermanBeachTourTournamentId("tur-show.php?id=14684"), "14684");
  assert.equal(extractGermanBeachTourTournamentId("German Beach Tour Berlin I — Men [GBT:14684]"), "14684");
});
