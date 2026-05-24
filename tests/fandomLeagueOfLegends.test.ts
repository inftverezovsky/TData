import assert from "node:assert/strict";
import test from "node:test";
import {
  extractFandomCargoScheduleMatches,
  normalizeFandomLeagueOfLegendsTournament,
} from "../src/lib/fandom/leagueoflegends";

const fandomInfobox = `
{{Infobox Tournament
|name= Esports World Cup 2026
|sdate= 2026-07-15
|edate= 2026-07-19
|region= int
|prizepool=$ 2,000,000
|organizer=ESL FACEIT Group
}}
`;

test("Fandom LoL parser extracts infobox tournament metadata", () => {
  const normalized = normalizeFandomLeagueOfLegendsTournament({
    pageId: 1003820,
    title: "Esports World Cup 2026",
    pageUrl: "https://lol.fandom.com/wiki/Esports_World_Cup_2026",
    wikitext: fandomInfobox,
    parsedHtml: "",
  });

  assert.equal(normalized.name, "Esports World Cup 2026");
  assert.equal(normalized.region, "int");
  assert.equal(normalized.prizePool, "$ 2,000,000");
  assert.equal(normalized.startDate?.toISOString().slice(0, 10), "2026-07-15");
  assert.equal(normalized.endDate?.toISOString().slice(0, 10), "2026-07-19");
});

test("Fandom LoL parser extracts participants from roster HTML", () => {
  const normalized = normalizeFandomLeagueOfLegendsTournament({
    title: "Parser Cup",
    pageUrl: "https://lol.fandom.com/wiki/Parser_Cup",
    wikitext: `
      ${fandomInfobox}
      == Participants ==
      |team=BoostGate
      [[TCL/2026 Season/Spring Split|Spring #4]]
    `,
    parsedHtml: `
      <table class="wikitable tournament-roster">
        <tr><th class="tournament-roster-header"><a href="/wiki/PCIFIC_Esports" class="catlink-teams" title="PCIFIC Esports">PCF</a></th></tr>
        <tr><td><img data-src="https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/pacific.png" /></td></tr>
      </table>
      <table class="wikitable tournament-roster">
        <tr><th class="tournament-roster-header"><a href="/wiki/Ozarox_Esports" class="catlink-teams" title="Ozarox Esports">OZO</a></th></tr>
      </table>
      <table class="wikitable tournament-roster">
        <tr><th class="tournament-roster-header"><a href="/wiki/BoostGate_Esports" class="catlink-teams" title="BoostGate Esports">BGT</a></th></tr>
      </table>
    `,
  });

  assert.deepEqual(
    normalized.participants.map((participant) => participant.name).sort(),
    ["BoostGate Esports", "Ozarox Esports", "PCIFIC Esports"],
  );
  assert.equal(normalized.participants.find((participant) => participant.name === "PCIFIC Esports")?.logoUrl?.includes("pacific.png"), true);
  assert.equal(normalized.participants.some((participant) => participant.name.includes("Spring Split")), false);
  assert.equal(normalized.participants.some((participant) => participant.name === "BoostGate"), false);
});

test("Fandom LoL parser extracts scheduled matchlist rows with UTC time", () => {
  const normalized = normalizeFandomLeagueOfLegendsTournament({
    title: "Parser Cup",
    pageUrl: "https://lol.fandom.com/wiki/Parser_Cup",
    wikitext: fandomInfobox,
    parsedHtml: `
      <h2>Results</h2>
      <table>
        <tr class="matchlist-row">
          <td class="matchlist-team1 ml-team" data-teamhighlight="Ozarox Esports">
            <span class="teamname"><a class="catlink-teams" title="Ozarox Esports">OZO</a></span>
          </td>
          <td class="matchlist-score"></td>
          <td class="matchlist-score"></td>
          <td class="matchlist-time-cell">
            <span class="countdown"><span class="countdowndate">26 May 2026 15:00:00 +0000</span></span>
          </td>
          <td class="matchlist-team2 ml-team" data-teamhighlight="PCIFIC Esports">
            <span class="teamname"><a class="catlink-teams" title="PCIFIC Esports">PCF</a></span>
          </td>
        </tr>
      </table>
    `,
  });

  assert.equal(normalized.matches.length, 1);
  assert.equal(normalized.matches[0].teamAName, "Ozarox Esports");
  assert.equal(normalized.matches[0].teamBName, "PCIFIC Esports");
  assert.equal(normalized.matches[0].matchDate?.toISOString(), "2026-05-26T15:00:00.000Z");
});

test("Fandom LoL parser ignores finished scored matchlist rows", () => {
  const normalized = normalizeFandomLeagueOfLegendsTournament({
    title: "Parser Cup",
    pageUrl: "https://lol.fandom.com/wiki/Parser_Cup",
    wikitext: fandomInfobox,
    parsedHtml: `
      <table>
        <tr class="matchlist-row">
          <td class="matchlist-team1 ml-team" data-teamhighlight="SU Esports"></td>
          <td class="matchlist-score">3</td>
          <td class="matchlist-score">1</td>
          <td class="matchlist-time-cell"><span class="countdowndate">19 May 2026 15:00:00 +0000</span></td>
          <td class="matchlist-team2 ml-team" data-teamhighlight="BoostGate Esports"></td>
        </tr>
      </table>
    `,
  });

  assert.equal(normalized.matches.length, 0);
});

test("Fandom LoL parser extracts exact future matches from MatchSchedule cargo rows", () => {
  const normalized = normalizeFandomLeagueOfLegendsTournament({
    title: "Esports World Cup 2026",
    pageUrl: "https://lol.fandom.com/wiki/Esports_World_Cup_2026",
    wikitext: fandomInfobox,
    parsedHtml: `
      <h2><span class="mw-headline" id="Match_Schedule">Match Schedule</span></h2>
      <div id="matchlist-content-wrapper"></div>
    `,
    cargoMatches: [
      {
        title: {
          MatchId: "EWC2026-M001",
          Team1: "TBD",
          Team2: "G2 Esports",
          Team1Score: "",
          Team2Score: "",
          BestOf: "3",
          DateTime_UTC: "2026-07-15 12:00:00",
          HasTime: "1",
          Tab: "Knockout Stage",
          Round: "Quarterfinals",
        },
      },
    ],
  });

  assert.equal(normalized.matches.length, 1);
  assert.equal(normalized.matches[0].teamAName, "TBD");
  assert.equal(normalized.matches[0].teamBName, "G2 Esports");
  assert.equal(normalized.matches[0].matchDate?.toISOString(), "2026-07-15T12:00:00.000Z");
  assert.equal(normalized.matches[0].format, "BO3");
});

test("Fandom LoL cargo extraction skips finished rows and rows without exact time", () => {
  const matches = extractFandomCargoScheduleMatches([
    { title: { Team1: "Alpha Esports", Team2: "Bravo Esports", Team1Score: "1", Team2Score: "0", DateTime_UTC: "2026-07-15 12:00:00", HasTime: "1" } },
    { title: { Team1: "Charlie Esports", Team2: "Delta Esports", DateTime_UTC: "2026-07-15 00:00:00", HasTime: "0" } },
    { title: { Team1: "Echo Esports", Team2: "Foxtrot Esports", DateTime_UTC: "2026-07-16 14:30:00", HasTime: "1" } },
  ], "https://lol.fandom.com/wiki/Parser_Cup");

  assert.equal(matches.length, 1);
  assert.equal(matches[0].teamAName, "Echo Esports");
  assert.equal(matches[0].teamBName, "Foxtrot Esports");
});
