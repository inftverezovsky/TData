import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDota2Tournament } from "../src/lib/normalizers/dota2Tournament";
import { normalizeCounterStrikeTournament } from "../src/lib/normalizers/counterstrikeTournament";
import { normalizeLeagueOfLegendsTournament } from "../src/lib/normalizers/leagueoflegendsTournament";
import { normalizeValorantTournament } from "../src/lib/normalizers/valorantTournament";

const emptyBracketHtml = `
  <div class="brkts-match">
    <div class="brkts-opponent-entry"><span class="name">TBD</span></div>
    <div class="brkts-opponent-entry"><span class="name">TBD</span></div>
    <div class="brkts-match-info-popup"></div>
  </div>
`;

const infobox = "{{Infobox league|name=Parser Guard Cup|sdate=2026-05-13|edate=2026-05-24}}";

test("Liquipedia normalizers preserve pure placeholder bracket slots for future TBD handling", () => {
  const cases = [
    normalizeDota2Tournament({
      title: "Parser Guard Cup",
      pageUrl: "https://liquipedia.net/dota2/Parser_Guard_Cup",
      wikitext: infobox,
      parsedHtml: emptyBracketHtml,
    }),
    normalizeCounterStrikeTournament({
      title: "Parser Guard Cup",
      pageUrl: "https://liquipedia.net/counterstrike/Parser_Guard_Cup",
      wikitext: infobox,
      parsedHtml: emptyBracketHtml,
    }),
    normalizeLeagueOfLegendsTournament({
      title: "Parser Guard Cup",
      pageUrl: "https://liquipedia.net/leagueoflegends/Parser_Guard_Cup",
      wikitext: infobox,
      parsedHtml: emptyBracketHtml,
    }),
    normalizeValorantTournament({
      title: "Parser Guard Cup",
      pageUrl: "https://liquipedia.net/valorant/Parser_Guard_Cup",
      wikitext: infobox,
      parsedHtml: emptyBracketHtml,
    }),
  ];

  for (const normalized of cases) {
    assert.equal(normalized.matches.length, 1);
    assert.match(normalized.matches[0].teamAName || "", /^TBD\d+$/);
    assert.match(normalized.matches[0].teamBName || "", /^TBD\d+$/);
  }
});

test("Counter-Strike and LoL normalizers ignore crosstable matrix rows as match sources", () => {
  const html = `
    <div class="mw-heading mw-heading2"><h2>Group Stage</h2></div>
    <div class="mw-heading mw-heading3"><h3>Group A</h3></div>
    <div><div class="template-box">
      <table class="crosstable">
        <tr class="crosstable-tr">
          <th><a href="/counterstrike/Team_Alpha" title="Team Alpha">Team Alpha</a></th>
          <td class="crosstable-bgc-cross"></td>
          <td class="crosstable-bgc-r-r"></td>
        </tr>
        <tr class="crosstable-tr">
          <th><a href="/counterstrike/Team_Beta" title="Team Beta">Team Beta</a></th>
          <td class="crosstable-bgc-r-r"></td>
          <td class="crosstable-bgc-cross"></td>
        </tr>
      </table>
    </div></div>
  `;

  const cs = normalizeCounterStrikeTournament({
    title: "Parser Guard Cup",
    pageUrl: "https://liquipedia.net/counterstrike/Parser_Guard_Cup",
    wikitext: infobox,
    parsedHtml: html,
  });
  const lol = normalizeLeagueOfLegendsTournament({
    title: "Parser Guard Cup",
    pageUrl: "https://liquipedia.net/leagueoflegends/Parser_Guard_Cup",
    wikitext: infobox,
    parsedHtml: html.replaceAll("/counterstrike/", "/leagueoflegends/"),
  });

  assert.equal(cs.matches.length, 0);
  assert.equal(lol.matches.length, 0);
});

test("Counter-Strike normalizer extracts empty Bracket wikitext slots as dated announcements", () => {
  const normalized = normalizeCounterStrikeTournament({
    title: "Betclic Clash/2026/Online",
    pageUrl: "https://liquipedia.net/counterstrike/Betclic_Clash/2026/Online",
    wikitext: `
      ${infobox}
      ===Playoffs===
      {{Bracket|Bracket/8U4L2DSL1D
      <!-- Upper Bracket Quarterfinals -->
      |R1M1={{Match
        <!--|opponent1={{TeamOpponent|}}|opponent2={{TeamOpponent|}}-->
        |opponent1literal=Group B 2<sup>nd</sup> Place|opponent2literal=Group A 3<sup>rd</sup> Place
        |date=May 27, 2026 - 11:00 {{Abbr/CEST}}
        |map1={{Map|map=|finished=}}
        }}
      |R1M2={{Match
        <!--|opponent1={{TeamOpponent|}}|opponent2={{TeamOpponent|}}-->
        |opponent1literal=Group A 2<sup>nd</sup> Place|opponent2literal=Group B 3<sup>rd</sup> Place
        |date=May 27, 2026 - 11:00 {{Abbr/CEST}}
        |map1={{Map|map=|finished=}}
        }}
      <!-- Semifinals -->
      |R2M1={{Match
        <!--|opponent1={{TeamOpponent|}}|opponent2={{TeamOpponent|}}-->
        |opponent1literal=Group A 1<sup>st</sup> Place
        |date=May 28, 2026 - 11:00 {{Abbr/CEST}}
        |map1={{Map|map=|finished=}}
        }}
      |R2M2={{Match
        <!--|opponent1={{TeamOpponent|}}|opponent2={{TeamOpponent|}}-->
        |opponent1literal=Group B 1<sup>st</sup> Place
        |date=May 28, 2026 - 11:00 {{Abbr/CEST}}
        |map1={{Map|map=|finished=}}
        }}
      <!-- Lower Bracket Round 1 -->
      |R1M5={{Match
        |opponent1={{TeamOpponent|}}|opponent2={{TeamOpponent|}}
        |date=May 27, 2026 - 13:00 {{Abbr/CEST}}
        |map1={{Map|map=|finished=}}
        |map2={{Map|map=|finished=}}
        |map3={{Map|map=|finished=}}
        }}
      <!-- Third Place Match -->
      |RxMTP={{Match
        |opponent1={{TeamOpponent|}}|opponent2={{TeamOpponent|}}
        |date=May 31, 2026 - 14:00 {{Abbr/BRT}}
        |map1={{Map|map=|finished=}}
        |map2={{Map|map=|finished=}}
        |map3={{Map|map=|finished=}}
        }}
      }}
    `,
  });

  assert.equal(normalized.matches.length, 6);
  assert.equal(normalized.matches[0].matchDate?.toISOString(), "2026-05-27T09:00:00.000Z");
  assert.equal(normalized.matches[0].round, "Upper Bracket Quarterfinals");
  assert.equal(normalized.matches[1].round, "Upper Bracket Quarterfinals");
  assert.equal(normalized.matches[2].round, "Semifinals");
  assert.equal(normalized.matches[3].round, "Semifinals");
  assert.equal(normalized.matches[4].round, "Lower Bracket Round 1");
  assert.equal(normalized.matches[5].round, "Third Place Match");
  assert.equal(normalized.matches[5].matchDate?.toISOString(), "2026-05-31T17:00:00.000Z");
  assert.equal(normalized.matches[0].format, "BO1");
  assert.equal(normalized.matches[4].format, "BO3");
  assert.ok(normalized.matches[0].rawText?.startsWith("slot=R1M1"));
  assert.ok(normalized.matches[1].rawText?.startsWith("slot=R1M2"));
  assert.ok(normalized.matches[5].rawText?.startsWith("slot=RXMTP"));
});

test("Valorant normalizer only keeps stage subpages from the selected event", () => {
  const normalized = normalizeValorantTournament({
    title: "Source League/2026/Spring/Promotion",
    pageUrl: "https://liquipedia.net/valorant/Source_League/2026/Spring/Promotion",
    wikitext: `
      {{Infobox league|name=Source League Promotion|sdate=2026-05-15|edate=2026-05-24}}
      [[Source League/2026/Spring/Promotion/Group Stage]]
      [[Source League/2026/Spring/Promotion/Open Qualifier]]
      [[Source League/2026/Spring/Promotion/Europe]]
      [[Source League/2026/Spring/Regular Season]]
    `,
    parsedHtml: `
      <div class="tabs-static">
        <a href="/valorant/Source_League/2026/Spring/Promotion/Playoffs">Playoffs</a>
        <a href="/valorant/Source_League/2026/Spring/Promotion/Teams">Teams</a>
      </div>
    `,
  });

  assert.deepEqual(normalized.subPages, [
    "https://liquipedia.net/valorant/Source_League/2026/Spring/Promotion/Playoffs",
    "https://liquipedia.net/valorant/Source_League/2026/Spring/Promotion/Group_Stage",
  ]);
});

test("Counter-Strike and LoL normalizers only keep stage subpages", () => {
  const cs = normalizeCounterStrikeTournament({
    title: "Source Cup",
    pageUrl: "https://liquipedia.net/counterstrike/Source_Cup",
    wikitext: infobox,
    parsedHtml: `
      <div class="tabs-static">
        <a href="/counterstrike/Source_Cup/Playoffs">Playoffs</a>
        <a href="/counterstrike/Source_Cup/Teams">Teams</a>
        <a href="/counterstrike/Source_Cup/Europe">Europe</a>
      </div>
    `,
  });

  const lol = normalizeLeagueOfLegendsTournament({
    title: "Source League",
    pageUrl: "https://liquipedia.net/leagueoflegends/Source_League",
    wikitext: `
      ${infobox}
      [[Source League/Group Stage]]
      [[Source League/Teams]]
      [[Source League/Europe]]
    `,
    parsedHtml: `
      <div class="tabs-static">
        <a href="/leagueoflegends/Source_League/Playoffs">Playoffs</a>
      </div>
    `,
  });

  assert.deepEqual(cs.subPages, [
    "https://liquipedia.net/counterstrike/Source_Cup/Playoffs",
  ]);
  assert.deepEqual(lol.subPages, [
    "https://liquipedia.net/leagueoflegends/Source_League/Playoffs",
    "https://liquipedia.net/leagueoflegends/Source_League/Group_Stage",
  ]);
});

test("LoL normalizer extracts match-info vertical schedule cards and season tabs", () => {
  const normalized = normalizeLeagueOfLegendsTournament({
    title: "LCK 2026 Season",
    pageUrl: "https://liquipedia.net/leagueoflegends/LCK/2026",
    wikitext: `
      {{Infobox league|name=LCK 2026 Season|sdate=2026-04-01|edate=2026-09-13}}
      [[LCK/2026/Rounds 1-2]]
      [[LCK/2026/Road to MSI]]
      [[LCK/2026/Rounds 3-4]]
    `,
    parsedHtml: `
      <div class="tabs-static">
        <a href="/leagueoflegends/LCK/2026/Cup">Cup</a>
        <a href="/leagueoflegends/LCK/2026/Rounds_1-2">Rounds 1-2</a>
        <a href="/leagueoflegends/LCK/2026/Road_to_MSI">Road to MSI</a>
        <a href="/leagueoflegends/LCK/2026/Play-In">Play-In</a>
        <a href="/leagueoflegends/LCK/2026/Playoffs">Playoffs</a>
      </div>
      <div class="match-info match-info--vertical">
        <div class="match-info-top-row">
          <span class="match-info-countdown"><span class="timer-object" data-format="compact" data-timestamp="1779436800">May 22 - 17:00 <abbr data-tz="+09:00" title="Korea Standard Time (UTC+9)">KST</abbr></span></span>
        </div>
        <span class="match-info-stage">Week 8</span>
        <div class="match-info-header match-info-header-vertical">
          <div class="match-info-opponent-row"><div class="match-info-opponent-identity"><div class="block-team"><span class="name"><a href="/leagueoflegends/SOOPers" title="SOOPers">DNS</a></span></div></div><span class="match-info-opponent-score"></span></div>
          <div class="match-info-opponent-row"><div class="match-info-opponent-identity"><div class="block-team"><span class="name"><a href="/leagueoflegends/DRX" title="DRX">KRX</a></span></div></div><span class="match-info-opponent-score"></span></div>
        </div>
      </div>
    `,
  });

  assert.ok(normalized.subPages.includes("https://liquipedia.net/leagueoflegends/LCK/2026/Rounds_1-2"));
  assert.ok(normalized.matches.some((match) => match.teamAName === "SOOPers" && match.teamBName === "DRX"));
  assert.equal(normalized.leagueOfLegendsDiagnostics?.coverage.withExactTime, 1);
  assert.equal(normalized.leagueOfLegendsDiagnostics?.savedMatches, 1);
});

test("LoL normalizer reports diagnostics and keeps Team vs TBD with exact time", () => {
  const normalized = normalizeLeagueOfLegendsTournament({
    title: "LoL Parser Cup",
    pageUrl: "https://liquipedia.net/leagueoflegends/LoL_Parser_Cup",
    wikitext: "{{Infobox league|name=LoL Parser Cup|sdate=2026-06-01|edate=2026-06-02}}",
    parsedHtml: `
      <div class="brkts-matchlist">
        <div class="brkts-matchlist-title"><b>Swiss Stage</b></div>
        <div class="brkts-matchlist-match">
          <div class="brkts-matchlist-opponent"><span class="name"><a title="Monte">Monte</a></span></div>
          <div class="brkts-matchlist-score"></div>
          <div class="brkts-matchlist-score"></div>
          <div class="brkts-matchlist-opponent"><span class="name">TBD</span></div>
          <span class="match-info-countdown" data-timestamp="1780309800">13:30</span>
          <span class="brkts-matchlist-format">Best of 1</span>
        </div>
      </div>
    `,
  });

  assert.equal(normalized.matches.length, 1);
  assert.equal(normalized.matches[0].teamAName, "Monte");
  assert.equal(normalized.matches[0].teamBName, "TBD");
  assert.equal(normalized.matches[0].matchDate?.toISOString(), "2026-06-01T10:30:00.000Z");
  assert.equal(normalized.matches[0].format, "BO1");
  assert.equal(normalized.leagueOfLegendsDiagnostics?.coverage.teamVsTbd, 1);
});

test("LoL normalizer tracks no-time rows in diagnostics and infers BO from map slots", () => {
  const normalized = normalizeLeagueOfLegendsTournament({
    title: "LoL No Time Cup",
    pageUrl: "https://liquipedia.net/leagueoflegends/LoL_No_Time_Cup",
    wikitext: `
      {{Infobox league|name=LoL No Time Cup|sdate=2026-06-01|edate=2026-06-02}}
      {{Match|team1=Alpha|team2=Bravo|map1={{Map}}|map2={{Map}}|map3={{Map}}}}
    `,
  });

  assert.equal(normalized.matches.length, 1);
  assert.equal(normalized.matches[0].format, "BO3");
  assert.equal(normalized.leagueOfLegendsDiagnostics?.coverage.withoutExactTime, 1);
  assert.equal(normalized.leagueOfLegendsDiagnostics?.skipReasons.no_exact_time, 1);
});

test("Valorant wikitext extraction does not duplicate MatchSchedule templates", () => {
  const normalized = normalizeValorantTournament({
    title: "Valorant Parser Cup",
    pageUrl: "https://liquipedia.net/valorant/Valorant_Parser_Cup",
    wikitext: `
      ${infobox}
      {{MatchSchedule|team1=Alpha|team2=Bravo|date=2026-05-13 12:00 UTC}}
    `,
  });

  assert.equal(normalized.matches.length, 1);
});

test("Valorant normalizer reports diagnostics and keeps Team vs TBD with exact time", () => {
  const normalized = normalizeValorantTournament({
    title: "Valorant Parser Cup",
    pageUrl: "https://liquipedia.net/valorant/Valorant_Parser_Cup",
    wikitext: "{{Infobox league|name=Valorant Parser Cup|sdate=2026-06-01|edate=2026-06-02}}",
    parsedHtml: `
      <div class="brkts-matchlist">
        <div class="brkts-matchlist-title"><b>Swiss Stage</b></div>
        <div class="brkts-matchlist-match">
          <div class="brkts-matchlist-opponent"><span class="name"><a title="9z Team">9z Team</a></span></div>
          <div class="brkts-matchlist-score"></div>
          <div class="brkts-matchlist-score"></div>
          <div class="brkts-matchlist-opponent"><span class="name">TBD</span></div>
          <span class="match-info-countdown" data-timestamp="1780309800">13:30</span>
          <span class="brkts-matchlist-format">Best of 3</span>
        </div>
      </div>
    `,
  });

  assert.equal(normalized.matches.length, 1);
  assert.equal(normalized.matches[0].teamAName, "9z Team");
  assert.equal(normalized.matches[0].teamBName, "TBD");
  assert.equal(normalized.matches[0].matchDate?.toISOString(), "2026-06-01T10:30:00.000Z");
  assert.equal(normalized.matches[0].format, "BO3");
  assert.equal(normalized.valorantDiagnostics?.coverage.teamVsTbd, 1);
  assert.equal(normalized.valorantDiagnostics?.coverage.withExactTime, 1);
});

test("Valorant normalizer tracks no-time rows and infers BO from map slots", () => {
  const normalized = normalizeValorantTournament({
    title: "Valorant No Time Cup",
    pageUrl: "https://liquipedia.net/valorant/Valorant_No_Time_Cup",
    wikitext: `
      {{Infobox league|name=Valorant No Time Cup|sdate=2026-06-01|edate=2026-06-02}}
      {{Match|team1=Alpha|team2=Bravo|map1={{Map}}|map2={{Map}}|map3={{Map}}}}
    `,
  });

  assert.equal(normalized.matches.length, 1);
  assert.equal(normalized.matches[0].format, "BO3");
  assert.equal(normalized.valorantDiagnostics?.coverage.withoutExactTime, 1);
  assert.equal(normalized.valorantDiagnostics?.skipReasons.no_exact_time, 1);
});
