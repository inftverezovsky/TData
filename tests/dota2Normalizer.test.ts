import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDota2Tournament } from "../src/lib/normalizers/dota2Tournament";

test("Dota2 normalizer preserves empty TBD playoff slots", () => {
  const html = `
    <div class="brkts-column">
      <div class="brkts-column-header">Quarterfinals (bo3)</div>
    <div class="brkts-match">
      <div class="brkts-opponent-entry"></div>
      <div class="brkts-opponent-entry"></div>
      <div class="brkts-match-info-popup">
        <span class="name">TBD</span>
        <span class="name">TBD</span>
      </div>
    </div>
    </div>
  `;

  const normalized = normalizeDota2Tournament({
    title: "DreamLeague/29",
    pageUrl: "https://liquipedia.net/dota2/DreamLeague/29",
    wikitext: "{{Infobox league|name=DreamLeague Season 29|sdate=2026-05-13|edate=2026-05-24}}",
    parsedHtml: html,
  });

  assert.equal(normalized.matches.length, 1);
  assert.match(normalized.matches[0].teamAName || "", /^TBD\d+$/);
  assert.match(normalized.matches[0].teamBName || "", /^TBD\d+$/);
  assert.equal(normalized.matches[0].round, "Quarterfinals (bo3)");
});

test("Dota2 normalizer does not treat regional qualifier tabs as event subpages", () => {
  const html = `
    <div class="tabs-static">
      <a href="/dota2/DreamLeague/29/North_America">North America</a>
      <a href="/dota2/DreamLeague/29/Western_Europe">Western Europe</a>
      <a href="/dota2/DreamLeague/29/Playoffs">Playoffs</a>
    </div>
  `;

  const normalized = normalizeDota2Tournament({
    title: "DreamLeague/29",
    pageUrl: "https://liquipedia.net/dota2/DreamLeague/29",
    wikitext: "{{Infobox league|name=DreamLeague Season 29|sdate=2026-05-13|edate=2026-05-24}}",
    parsedHtml: html,
  });

  assert.deepEqual(normalized.subPages, ["https://liquipedia.net/dota2/DreamLeague/29/Playoffs"]);
});

test("Dota2 normalizer discovers schedule subpages from template tournament refs", () => {
  const normalized = normalizeDota2Tournament({
    title: "BLAST/Slam/7",
    pageUrl: "https://liquipedia.net/dota2/BLAST/Slam/7",
    wikitext: `
      {{Infobox league|name=BLAST Slam VII|sdate=2026-05-26|edate=2026-06-07}}
      {{GroupTableLeague|tournament=BLAST/Slam/7/Group_Stage}}
      [[{{#var:home}}/Group_Stage#Matches|HERE]]
    `,
    parsedHtml: "",
  });

  assert.deepEqual(normalized.subPages, ["https://liquipedia.net/dota2/BLAST/Slam/7/Group_Stage"]);
});

test("Dota2 normalizer keeps Liquipedia bracket slot labels from wikitext", () => {
  const normalized = normalizeDota2Tournament({
    title: "BLAST/Slam/7",
    pageUrl: "https://liquipedia.net/dota2/BLAST/Slam/7",
    wikitext: `
      {{Infobox league|name=BLAST Slam VII|sdate=2026-05-26|edate=2026-06-07}}
      {{Bracket|Bracket/4L2D-2Q|matchsection=Play-In
      <!-- Round 1 -->
      |R1M1header=LCQ Round 1
      |R1M1={{Match
      <!--|opponent1={{TeamOpponent|}}|opponent2={{TeamOpponent|}}-->
      |opponent1={{LiteralOpponent|#8}}
      |opponent2={{LiteralOpponent|#9}}
      |date=May 30, 2026 - 14:00 {{Abbr/CEST}}
      |map1={{Map}}|map2={{Map}}|map3={{Map}}
      }}
      |R1M2={{Match
      <!--|opponent1={{TeamOpponent|}}|opponent2={{TeamOpponent|}}-->
      |opponent1={{LiteralOpponent|#7}}
      |opponent2={{LiteralOpponent|#10}}
      |date=May 30, 2026 - 14:00 {{Abbr/CEST}}
      |map1={{Map}}|map2={{Map}}|map3={{Map}}
      }}

      <!-- Lower Bracket Semifinal -->
      |R3M1={{Match
      |opponent1={{TeamOpponent|}}
      |opponent2={{TeamOpponent|}}
      |date=June 06, 2026 - 16:00 {{Abbr/CEST}}
      |map1={{Map}}|map2={{Map}}|map3={{Map}}
      }}

      <!-- Lower Bracket Final -->
      |R4M2={{Match
      |opponent1={{TeamOpponent|}}
      |opponent2={{TeamOpponent|}}
      |date=June 07, 2026 - 13:00 {{Abbr/CEST}}
      |map1={{Map}}|map2={{Map}}|map3={{Map}}
      }}
      }}
    `,
    parsedHtml: "",
  });

  assert.equal(normalized.matches.length, 4);
  assert.equal(normalized.matches.filter((match) => match.round === "LCQ Round 1").length, 2);
  assert.ok(normalized.matches.some((match) => match.round === "Lower Bracket Semifinal"));
  assert.ok(normalized.matches.some((match) => match.round === "Lower Bracket Final"));
  assert.equal(normalized.matches.every((match) => /^TBD\d+$/i.test(match.teamAName || "")), true);
});

test("Dota2 normalizer ignores crosstable matrix rows as match sources", () => {
  const html = `
    <div class="mw-heading mw-heading2"><h2>Group Stage</h2></div>
    <div class="mw-heading mw-heading3"><h3>Group A</h3></div>
    <div><div class="template-box">
      <table class="crosstable">
        <tr class="crosstable-tr">
          <th><a href="/dota2/Team_Alpha" title="Team Alpha">Team Alpha</a></th>
          <td class="crosstable-bgc-cross"></td>
          <td class="crosstable-bgc-r-r"></td>
          <td class="crosstable-bgc-r-r"></td>
        </tr>
        <tr class="crosstable-tr">
          <th><a href="/dota2/PlayTime" title="PlayTime">PlayTime</a></th>
          <td class="crosstable-bgc-r-r"></td>
          <td class="crosstable-bgc-cross"></td>
          <td class="crosstable-bgc-r-r"></td>
        </tr>
        <tr class="crosstable-tr">
          <th><a href="/dota2/Team_Gamma" title="Team Gamma">Team Gamma</a></th>
          <td class="crosstable-bgc-r-r"></td>
          <td class="crosstable-bgc-r-r"></td>
          <td class="crosstable-bgc-cross"></td>
        </tr>
      </table>
    </div></div>
  `;

  const normalized = normalizeDota2Tournament({
    title: "DreamLeague/29",
    pageUrl: "https://liquipedia.net/dota2/DreamLeague/29",
    wikitext: "{{Infobox league|name=DreamLeague Season 29|sdate=2026-05-13|edate=2026-05-24}}",
    parsedHtml: html,
  });

  assert.equal(normalized.matches.length, 0);
});

test("Dota2 normalizer keeps scored crosstable results", () => {
  const html = `
    <div class="mw-heading mw-heading2"><h2>Group Stage</h2></div>
    <div class="mw-heading mw-heading3"><h3>Group A</h3></div>
    <div><div class="template-box">
      <table class="crosstable">
        <tr class="crosstable-tr">
          <th><a href="/dota2/Team_Alpha" title="Team Alpha">Team Alpha</a></th>
          <td class="crosstable-bgc-cross"></td>
          <td>2 - 1</td>
        </tr>
        <tr class="crosstable-tr">
          <th><a href="/dota2/Team_Beta" title="Team Beta">Team Beta</a></th>
          <td>1 - 2</td>
          <td class="crosstable-bgc-cross"></td>
        </tr>
      </table>
    </div></div>
  `;

  const normalized = normalizeDota2Tournament({
    title: "DreamLeague/29",
    pageUrl: "https://liquipedia.net/dota2/DreamLeague/29",
    wikitext: "{{Infobox league|name=DreamLeague Season 29|sdate=2026-05-13|edate=2026-05-24}}",
    parsedHtml: html,
  });

  assert.equal(normalized.matches.length, 1);
  assert.deepEqual(
    [normalized.matches[0].teamAName, normalized.matches[0].teamBName, normalized.matches[0].scoreA, normalized.matches[0].scoreB],
    ["Team Alpha", "Team Beta", 2, 1],
  );
});

test("Dota2 normalizer preserves repeated pair in different rounds without dates", () => {
  const normalized = normalizeDota2Tournament({
    title: "Repeat Pair Cup",
    pageUrl: "https://liquipedia.net/dota2/Repeat_Pair_Cup",
    wikitext: `
      {{Infobox league|name=Repeat Pair Cup|sdate=2026-05-13|edate=2026-05-24}}
      {{Match|team1=Team Alpha|team2=Team Beta|round=Group A}}
      {{Match|team1=Team Alpha|team2=Team Beta|round=Group B}}
    `,
    parsedHtml: "",
  });

  assert.equal(normalized.matches.length, 2);
  assert.deepEqual(normalized.matches.map((match) => match.round), ["Group A", "Group B"]);
});

test("Dota2 normalizer derives BO format from Liquipedia map slots", () => {
  const normalized = normalizeDota2Tournament({
    title: "Streamers Cup",
    pageUrl: "https://liquipedia.net/dota2/Streamers_Cup",
    wikitext: `
      {{Infobox league|name=Streamers Cup|sdate=2026-05-23|edate=2026-05-24}}
      {{Match
      |opponent1={{TeamOpponent|Miposhka Team}}
      |opponent2={{TeamOpponent|Stray Team}}
      |date=May 23, 2026 - 12:15 {{Abbr/MSK}}
      |map1={{Map}}
      |map2={{Map}}
      |map3={{Map|finished=skip}}
      }}
    `,
  });

  assert.equal(normalized.matches.length, 1);
  assert.equal(normalized.matches[0].format, "BO3");
});

test("Dota2 normalizer reports diagnostics and keeps Team vs TBD with exact time", () => {
  const normalized = normalizeDota2Tournament({
    title: "IEM Test Dota",
    pageUrl: "https://liquipedia.net/dota2/IEM_Test_Dota",
    wikitext: "{{Infobox league|name=IEM Test Dota|sdate=2026-06-01|edate=2026-06-02}}",
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
  assert.equal(normalized.dota2Diagnostics?.rawCandidates, 1);
  assert.equal(normalized.dota2Diagnostics?.savedMatches, 1);
  assert.equal(normalized.dota2Diagnostics?.coverage.teamVsTbd, 1);
});

test("Dota2 normalizer puts rows without exact time into diagnostics", () => {
  const normalized = normalizeDota2Tournament({
    title: "No Time Cup",
    pageUrl: "https://liquipedia.net/dota2/No_Time_Cup",
    wikitext: `
      {{Infobox league|name=No Time Cup|sdate=2026-06-01|edate=2026-06-02}}
      {{Match|team1=Team Alpha|team2=Team Beta|bestof=3}}
    `,
  });

  assert.equal(normalized.matches.length, 1);
  assert.equal(normalized.dota2Diagnostics?.coverage.withoutExactTime, 1);
  assert.equal(normalized.dota2Diagnostics?.skipReasons.no_exact_time, 1);
  assert.equal(normalized.dota2Diagnostics?.issues[0].reason, "no_exact_time");
});
