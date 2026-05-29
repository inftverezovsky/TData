import assert from "node:assert/strict";
import test from "node:test";
import {
  extractFandomCargoScheduleMatches,
  normalizeFandomLeagueOfLegendsTournament,
} from "../src/lib/sources/TCyber/fandom/leagueoflegends";
import { expandScheduleAnnouncementsForDiscipline } from "../src/lib/matches/scheduleView";

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
  assert.equal(normalized.leagueOfLegendsDiagnostics?.coverage.withExactTime, 1);
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
  assert.equal(normalized.leagueOfLegendsDiagnostics?.fandom?.cargoRowsFound, 1);
  assert.equal(normalized.leagueOfLegendsDiagnostics?.fandom?.cargoRowsUsed, 1);
});

test("Fandom LoL cargo MatchId keeps stable match IDs when row order changes", () => {
  const target = {
    title: {
      MatchId: "EWC2026-M001",
      Team1: "G2 Esports",
      Team2: "T1",
      Team1Score: "",
      Team2Score: "",
      BestOf: "3",
      DateTime_UTC: "2026-07-15 12:00:00",
      HasTime: "1",
      Tab: "Knockout Stage",
      Round: "Quarterfinals",
    },
  };
  const insertedBefore = {
    title: {
      MatchId: "EWC2026-M000",
      Team1: "Fnatic",
      Team2: "Cloud9",
      Team1Score: "",
      Team2Score: "",
      DateTime_UTC: "2026-07-15 10:00:00",
      HasTime: "1",
    },
  };

  const first = normalizeFandomLeagueOfLegendsTournament({
    title: "Esports World Cup 2026",
    pageUrl: "https://lol.fandom.com/wiki/Esports_World_Cup_2026",
    wikitext: fandomInfobox,
    parsedHtml: "",
    cargoMatches: [target],
  });
  const second = normalizeFandomLeagueOfLegendsTournament({
    title: "Esports World Cup 2026",
    pageUrl: "https://lol.fandom.com/wiki/Esports_World_Cup_2026",
    wikitext: fandomInfobox,
    parsedHtml: "",
    cargoMatches: [insertedBefore, target],
  });

  const firstId = first.matches.find((match) => match.teamAName === "G2 Esports")?.matchId;
  const secondId = second.matches.find((match) => match.teamAName === "G2 Esports")?.matchId;
  assert.ok(firstId);
  assert.equal(secondId, firstId);
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

test("Fandom LoL diagnostics records cargo rows without exact time", () => {
  const normalized = normalizeFandomLeagueOfLegendsTournament({
    title: "Parser Cup",
    pageUrl: "https://lol.fandom.com/wiki/Parser_Cup",
    wikitext: fandomInfobox,
    parsedHtml: "",
    cargoMatches: [
      { title: { Team1: "Charlie Esports", Team2: "Delta Esports", DateTime_UTC: "2026-07-15 00:00:00", HasTime: "0" } },
    ],
  });

  assert.equal(normalized.matches.length, 0);
  assert.equal(normalized.leagueOfLegendsDiagnostics?.skipReasons.no_exact_time, 1);
  assert.equal(normalized.leagueOfLegendsDiagnostics?.issues[0].reason, "no_exact_time");
});

test("Fandom LoL parser uses HTML fallback dates and normalizes BestOf", () => {
  const normalized = normalizeFandomLeagueOfLegendsTournament({
    title: "Parser Cup",
    pageUrl: "https://lol.fandom.com/wiki/Parser_Cup",
    wikitext: fandomInfobox,
    parsedHtml: `
      <table>
        <tr class="matchlist-row" data-timestamp="1784116800">
          <td class="matchlist-team1 ml-team" data-teamhighlight="G2 Esports"></td>
          <td class="matchlist-score"></td>
          <td class="matchlist-score"></td>
          <td><span class="countdowndate">1784116800</span></td>
          <td class="matchlist-team2 ml-team" data-teamhighlight="TBD"></td>
          <td>Best of 3</td>
        </tr>
      </table>
    `,
  });

  assert.equal(normalized.matches.length, 1);
  assert.equal(normalized.matches[0].teamAName, "G2 Esports");
  assert.equal(normalized.matches[0].teamBName, "TBD");
  assert.equal(normalized.matches[0].matchDate?.toISOString(), "2026-07-15T12:00:00.000Z");
  assert.equal(normalized.matches[0].format, "BO3");
});

test("Fandom LoL parser merges cargo and HTML duplicate TBD stage slots", () => {
  const normalized = normalizeFandomLeagueOfLegendsTournament({
    title: "2026 Mid-Season Invitational",
    pageUrl: "https://lol.fandom.com/wiki/2026_Mid-Season_Invitational",
    wikitext: fandomInfobox,
    parsedHtml: `
      <h2><span class="mw-headline" id="Match_Schedule">Match Schedule</span></h2>
      <h3><span class="mw-headline" id="Stage_2_(Bracket)">Stage 2 (Bracket)</span></h3>
      <table>
        <tr class="ml-row ml-row-tbd" data-date="2026-06-28 03:00:00">
          <td class="matchlist-team1 ml-team" data-teamhighlight="TBD"></td>
          <td class="matchlist-score"></td>
          <td class="matchlist-score"></td>
          <td><span class="countdowndate">28 June 2026 03:00:00 +0000</span></td>
          <td class="matchlist-team2 ml-team" data-teamhighlight="TBD"></td>
        </tr>
      </table>
    `,
    cargoMatches: [
      {
        title: {
          MatchId: "2026 Mid-Season Invitational_Play-In Day 1_1",
          Team1: "TBD",
          Team2: "TBD",
          Team1Final: "TBD",
          Team2Final: "TBD",
          Team1Score: "",
          Team2Score: "",
          BestOf: "5",
          DateTime_UTC: "2026-06-28 03:00:00",
          HasTime: "1",
          Tab: "Play-In Day 1",
          Round: "Match Day 1",
        },
      },
    ],
  });

  assert.equal(normalized.matches.length, 1);
  assert.equal(normalized.matches[0].format, "BO5");
  assert.equal(normalized.matches[0].stage, "Play-In Day 1");
  assert.equal(normalized.matches[0].round, "Stage 2 (Bracket)");

  const announcements = expandScheduleAnnouncementsForDiscipline(
    normalized.matches.map((match) => ({ ...match, matchId: match.matchId || undefined })),
    "leagueoflegends",
    "fandom",
  );

  assert.equal(announcements.length, 1);
  assert.equal(announcements[0].isStageAnnouncement, true);
  assert.equal(announcements[0].singleAnnouncementTeamName, "Stage 2");
  assert.equal(announcements.some((entry) => /^TBD\d*$/i.test(entry.singleAnnouncementTeamName || "")), false);
});

test("Fandom LoL parser removes real-match HTML fallback covered by Cargo", () => {
  const normalized = normalizeFandomLeagueOfLegendsTournament({
    title: "Esports World Cup 2026",
    pageUrl: "https://lol.fandom.com/wiki/Esports_World_Cup_2026",
    wikitext: fandomInfobox,
    parsedHtml: `
      <h2>Results</h2>
      <table>
        <tr class="matchlist-row">
          <td class="matchlist-team1 ml-team" data-teamhighlight="G2 Esports"></td>
          <td class="matchlist-score"></td>
          <td class="matchlist-score"></td>
          <td><span class="countdowndate">15 July 2026 12:00:00 +0000</span></td>
          <td class="matchlist-team2 ml-team" data-teamhighlight="T1"></td>
          <td>Best of 5</td>
        </tr>
      </table>
    `,
    cargoMatches: [
      {
        title: {
          MatchId: "EWC2026-M001",
          Team1: "G2 Esports",
          Team2: "T1",
          Team1Score: "",
          Team2Score: "",
          BestOf: "3",
          DateTime_UTC: "2026-07-15 12:00:00",
          HasTime: "1",
          Tab: "Swiss Stage",
          Round: "Round 1",
        },
      },
    ],
  });

  assert.equal(normalized.matches.length, 1);
  assert.equal(normalized.matches[0].teamAName, "G2 Esports");
  assert.equal(normalized.matches[0].teamBName, "T1");
  assert.equal(normalized.matches[0].format, "BO3");
  assert.equal(normalized.matches[0].stage, "Swiss Stage");
});
