import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTournamentPageUrl,
  extractTwelveNdrTcode,
  extractTwelveNdrTimezone,
  filterTwelveNdrUpcomingTournaments,
  isActiveTwelveNdrMatch,
  parseTwelveNdrCalendarJson,
  parseTwelveNdrTournamentPage,
} from "../src/lib/sources/tbvolley/TwelveNdr";

test("12ndr calendar parser keeps CSVP rows and extracts tcode", () => {
  const json = JSON.stringify([
    {
      Name: "CSVP Lima",
      Men: '<a href="/tournament?tcode=M1CSVP26&timezone=14">03.05. - 06.05.</a>',
      Women: '<a href="/tournament?tcode=F1CSVP26&timezone=14">03.05. - 06.05.</a>',
      TournamentType: "CSV",
      Federation: "CSV",
      Country: "Peru",
    },
    {
      Name: "Other Event",
      Men: '<a href="/tournament?tcode=M1OTHER26&timezone=38">10.05. - 12.05.</a>',
      Women: '<a href="/tournament?tcode=F1OTHER26&timezone=38">10.05. - 12.05.</a>',
      TournamentType: "FUTURES",
      Federation: "FIVB",
      Country: "Austria",
    },
  ]);

  const men = parseTwelveNdrCalendarJson(json, {
    source: "twelvendrcsvp",
    calendarMode: "csvp",
    season: 2026,
    gender: "men",
  });
  const women = parseTwelveNdrCalendarJson(json, {
    source: "twelvendrcsvp",
    calendarMode: "csvp",
    season: 2026,
    gender: "women",
  });

  assert.equal(men.length, 1);
  assert.equal(men[0].tcode, "M1CSVP26");
  assert.equal(men[0].timezone, "14");
  assert.equal(men[0].sourceTitle, "CSVP Lima — Men [12NDR-CSVP:M1CSVP26]");
  assert.equal(women[0].tcode, "F1CSVP26");
});

test("12ndr tournament page parser extracts matches and Moscow time", () => {
  const html = `
    <h3>CSVP Lima (03.05. - 06.05.2026)</h3>
    <div id="results_md"></div>
    <div class="table-responsive">
      <table>
        <tr><td colspan="7">Quarter-finals</td></tr>
        <tr>
          <td>7</td>
          <td>03-May</td>
          <td>09:30</td>
          <td>4</td>
          <td>Team A PER [1]</td>
          <td>Team B BRA [8]</td>
          <td><a href="/match?match=7001">2-0 (21-15, 21-18)</a></td>
        </tr>
      </table>
    </div>
  `;

  const tournament = parseTwelveNdrTournamentPage(html, {
    source: "twelvendrcsvp",
    calendarMode: "csvp",
    tcode: "M1CSVP26",
    timezone: "14",
    gender: "men",
    pageUrl: buildTournamentPageUrl("M1CSVP26", "14"),
  });

  assert.equal(tournament.title, "CSVP Lima");
  assert.equal(tournament.startDate, "2026-05-03");
  assert.equal(tournament.endDate, "2026-05-06");
  assert.equal(tournament.matches?.length, 1);
  assert.equal(tournament.matches?.[0].id, "7001");
  assert.equal(tournament.matches?.[0].round, "Quarter-finals");
  assert.equal(tournament.matches?.[0].court, "Court 4");
  assert.equal(tournament.matches?.[0].teamA.name, "Team A");
  assert.equal(tournament.matches?.[0].teamB.country, "BRA");
  assert.equal(tournament.matches?.[0].startTimeMoscow, "03.05.2026 17:30:00");
  assert.deepEqual(tournament.matches?.[0].score.sets, [
    { no: 1, teamA: 21, teamB: 15 },
    { no: 2, teamA: 21, teamB: 18 },
  ]);
});

test("12ndr helpers resolve source ids and upcoming state", () => {
  assert.equal(extractTwelveNdrTcode("CSVP Lima — Men [12NDR-CSVP:M1CSVP26]"), "M1CSVP26");
  assert.equal(extractTwelveNdrTimezone("https://fivb.12ndr.at/tournament?tcode=M1CSVP26&timezone=14"), "14");
  assert.equal(isActiveTwelveNdrMatch({
    status: "upcoming",
    startTimeUtc: "2026-05-03T14:30:00.000Z",
  }, new Date("2026-05-01T00:00:00.000Z")), true);
  assert.equal(isActiveTwelveNdrMatch({
    status: "finished",
    startTimeUtc: "2026-05-03T14:30:00.000Z",
  }, new Date("2026-05-01T00:00:00.000Z")), false);
  assert.equal(isActiveTwelveNdrMatch({
    status: "upcoming",
    startTimeUtc: "2026-05-03T14:30:00.000Z",
  }, new Date("2026-06-11T00:00:00.000Z")), false);
});

test("12ndr tournament filter drops completed tournaments", () => {
  const json = JSON.stringify([
    {
      Name: "CSVP Old",
      Men: '<a href="/tournament?tcode=MOLD26&timezone=14">03.05. - 06.05.</a>',
      TournamentType: "CSV",
      Federation: "CSV",
      Country: "Peru",
    },
    {
      Name: "CSVP Future",
      Men: '<a href="/tournament?tcode=MFUT26&timezone=14">16.06. - 18.06.</a>',
      TournamentType: "CSV",
      Federation: "CSV",
      Country: "Peru",
    },
  ]);
  const tournaments = parseTwelveNdrCalendarJson(json, {
    source: "twelvendrcsvp",
    calendarMode: "csvp",
    season: 2026,
    gender: "men",
  });

  assert.deepEqual(
    filterTwelveNdrUpcomingTournaments(tournaments, new Date("2026-06-11T00:00:00.000Z")).map((tournament) => tournament.tcode),
    ["MFUT26"],
  );
});
