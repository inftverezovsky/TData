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
