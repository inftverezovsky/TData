import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVlrEventMatchesUrl,
  parseVlrEventMatchesHtml,
  parseVlrEventsHtml,
  parseVlrMatchDetailHtml,
  parseVlrMatchesHtml,
  parseVlrUtcTimestamp,
} from "../backend/src/sources/tdata/vlr/parse";

test("buildVlrEventMatchesUrl points event imports at the full schedule page", () => {
  assert.equal(
    buildVlrEventMatchesUrl("https://www.vlr.gg/event/2765/valorant-masters-london-2026"),
    "https://www.vlr.gg/event/matches/2765/valorant-masters-london-2026",
  );
  assert.equal(
    buildVlrEventMatchesUrl("2765"),
    "https://www.vlr.gg/event/matches/2765",
  );
});

test("parseVlrMatchesHtml parses grouped VLR match cards", () => {
  const matches = parseVlrMatchesHtml(`
    <div class="wf-label mod-large">Sun, May 24, 2026 <span>Today</span></div>
    <a href="/674859/fnatic-vs-karmine-corp" class="wf-module-item match-item">
      <div class="match-item-time">6:00 PM</div>
      <div class="match-item-vs">
        <div class="match-item-vs-team"><div class="match-item-vs-team-name"><div class="text-of"><span class="flag"></span>FNATIC</div></div></div>
        <div class="match-item-vs-team"><div class="match-item-vs-team-name"><div class="text-of"><span class="flag"></span>Karmine Corp</div></div></div>
      </div>
      <div class="match-item-eta"><div class="ml"><div class="ml-status">Upcoming</div></div></div>
      <div class="match-item-event text-of"><div class="match-item-event-series text-of">Stage 2-Upper Semifinals</div>Esports World Cup 2026: EMEA Qualifier</div>
    </a>
  `);

  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, "674859");
  assert.equal(matches[0].team1, "FNATIC");
  assert.equal(matches[0].team2, "Karmine Corp");
  assert.equal(matches[0].tournament, "Esports World Cup 2026: EMEA Qualifier");
  assert.equal(matches[0].stage, "Stage 2-Upper Semifinals");
});

test("parseVlrMatchesHtml extracts card timestamp and BO format", () => {
  const matches = parseVlrMatchesHtml(`
    <div class="wf-label mod-large">Sun, May 24, 2026</div>
    <a href="/674860/paper-rex-vs-gen-g" class="wf-module-item match-item" data-utc-ts="1779620400">
      <div class="match-item-time">11:00 AM</div>
      <div class="match-item-vs">
        <div class="match-item-vs-team"><div class="match-item-vs-team-name"><div class="text-of">Paper Rex</div></div></div>
        <div class="match-item-vs-team"><div class="match-item-vs-team-name"><div class="text-of">Gen.G</div></div></div>
      </div>
      <div class="match-item-note">Best of 5</div>
      <div class="match-item-eta"><div class="ml"><div class="ml-status">Upcoming</div></div></div>
      <div class="match-item-event text-of"><div class="match-item-event-series text-of">Grand Final</div>Masters Toronto</div>
    </a>
  `);

  assert.equal(matches.length, 1);
  assert.equal(matches[0].utcTimestamp, "1779620400");
  assert.equal(matches[0].unix_time, 1779620400);
  assert.equal(matches[0].format, "BO5");
});

test("parseVlrMatchDetailHtml extracts utc timestamp and BO format", () => {
  const detail = parseVlrMatchDetailHtml(`
    <div class="wf-card match-header">
      <a href="/event/2954/esports-world-cup-2026-emea-qualifier/stage-2" class="match-header-event">
        <div><div>Esports World Cup 2026: EMEA Qualifier</div><div class="match-header-event-series">Stage 2: Upper Semifinals</div></div>
      </a>
      <div class="match-header-date">
        <div class="moment-tz-convert" data-utc-ts="2026-05-24 11:00:00">Sunday, May 24</div>
      </div>
      <div class="match-header-vs">
        <a class="match-header-link"><div class="match-header-link-name"><div class="wf-title-med">FNATIC</div></div></a>
        <div class="match-header-vs-score"><div class="match-header-vs-note">Bo3</div></div>
        <a class="match-header-link"><div class="match-header-link-name"><div class="wf-title-med">Karmine Corp</div></div></a>
      </div>
    </div>
  `, "https://www.vlr.gg/674859/fnatic-vs-karmine-corp");

  assert.equal(detail.tournament, "Esports World Cup 2026: EMEA Qualifier");
  assert.equal(detail.team1, "FNATIC");
  assert.equal(detail.team2, "Karmine Corp");
  assert.equal(detail.utcTimestamp, "2026-05-24 11:00:00");
  assert.equal(detail.unix_time, 1779620400);
  assert.equal(detail.format, "BO3");
});

test("parseVlrMatchDetailHtml supports alternate team and time selectors", () => {
  const detail = parseVlrMatchDetailHtml(`
    <div class="wf-card match-header">
      <a class="match-header-event"><div><div>Masters Toronto</div><div class="match-header-event-series">Upper Final</div></div></a>
      <time datetime="2026-05-25T12:30:00Z">May 25 12:30 UTC</time>
      <div class="match-header-vs">
        <a class="match-header-link" title="Rex Regum Qeon"><span class="wf-title-med">Rex Regum Qeon</span></a>
        <div class="match-header-vs-note">Best of 3</div>
        <a class="match-header-link" title="Team Heretics"><span class="wf-title-med">Team Heretics</span></a>
      </div>
    </div>
  `, "https://www.vlr.gg/674861/rex-regum-qeon-vs-team-heretics");

  assert.equal(detail.team1, "Rex Regum Qeon");
  assert.equal(detail.team2, "Team Heretics");
  assert.equal(detail.utcTimestamp, "2026-05-25T12:30:00Z");
  assert.equal(detail.unix_time, 1779712200);
  assert.equal(detail.format, "BO3");
});

test("parseVlrMatchDetailHtml omits empty fields so detail enrichment preserves schedule data", () => {
  const detail = parseVlrMatchDetailHtml(`
    <main>
      <div class="wf-card">Match page shell without loaded header data</div>
    </main>
  `, "https://www.vlr.gg/674862/natus-vincere-vs-tbd");

  assert.equal(detail.id, "674862");
  assert.equal(detail.url, "https://www.vlr.gg/674862/natus-vincere-vs-tbd");
  assert.equal("team1" in detail, false);
  assert.equal("team2" in detail, false);
  assert.equal("utcTimestamp" in detail, false);
  assert.equal("unix_time" in detail, false);
  assert.equal("format" in detail, false);
  assert.equal("status" in detail, false);
});

test("parseVlrEventMatchesHtml parses upcoming sidebar matches with TBD", () => {
  const parsed = parseVlrEventMatchesHtml(`
    <h1 class="wf-title">Esports World Cup 2026: EMEA Qualifier</h1>
    <div class="event-sidebar-matches">
      <h2>Upcoming Matches</h2>
      <a class="wf-module-item" href="/674862/natus-vincere-vs-tbd">
        <div class="event-sidebar-matches-series">Stage 2-Lower Round 2</div>
        <div class="event-sidebar-matches-team"><div class="name"><i></i><span>TBD</span></div><div class="score mod-upcoming">-</div></div>
        <div class="event-sidebar-matches-team"><div class="name"><i></i><span>Natus Vincere</span></div><div class="score mod-upcoming">-</div></div>
      </a>
    </div>
  `, "https://www.vlr.gg/event/2954/test");

  assert.equal(parsed.title, "Esports World Cup 2026: EMEA Qualifier");
  assert.equal(parsed.matches.length, 1);
  assert.equal(parsed.matches[0].team1, "TBD");
  assert.equal(parsed.matches[0].team2, "Natus Vincere");
});

test("parseVlrEventMatchesHtml keeps positional TBD vs TBD sidebar slots", () => {
  const parsed = parseVlrEventMatchesHtml(`
    <h1 class="wf-title">Esports World Cup 2026: EMEA Qualifier</h1>
    <div class="event-sidebar-matches">
      <a class="wf-module-item" href="/674863/tbd-vs-tbd">
        <div class="event-sidebar-matches-series">Stage 2-Lower Round 3</div>
        <div class="event-sidebar-matches-team"><div class="name"><span>TBD</span></div><div class="score mod-upcoming">-</div></div>
        <div class="event-sidebar-matches-team"><div class="name"><span>TBD</span></div><div class="score mod-upcoming">-</div></div>
        <div class="moment-tz-convert" data-utc-ts="1780138800">6:00 pm</div>
      </a>
    </div>
  `, "https://www.vlr.gg/event/2954/test");

  assert.equal(parsed.matches.length, 1);
  assert.equal(parsed.matches[0].team1, "TBD");
  assert.equal(parsed.matches[0].team2, "TBD");
  assert.equal(parsed.matches[0].unix_time, 1780138800);
});

test("parseVlrEventMatchesHtml merges bracket timestamps into sidebar matches", () => {
  const parsed = parseVlrEventMatchesHtml(`
    <h1 class="wf-title">Esports World Cup 2026: EMEA Qualifier</h1>
    <div class="event-sidebar-matches">
      <a class="wf-module-item" href="/674862/natus-vincere-vs-tbd">
        <div class="event-sidebar-matches-series">Stage 2-Lower Round 2</div>
        <div class="event-sidebar-matches-team"><div class="name"><span>TBD</span></div><div class="score mod-upcoming">-</div></div>
        <div class="event-sidebar-matches-team"><div class="name"><span>Natus Vincere</span></div><div class="score mod-upcoming">-</div></div>
      </a>
    </div>
    <div class="bracket-col">
      <div class="bracket-col-label">Lower Round 2</div>
      <a class="bracket-item" title="TBD vs. Natus Vincere" href="/674862/natus-vincere-vs-tbd">
        <div class="bracket-item-team"><div class="bracket-item-team-name"><span>TBD</span></div><div class="bracket-item-team-score"></div></div>
        <div class="bracket-item-team"><div class="bracket-item-team-name"><span>Natus Vincere</span></div><div class="bracket-item-team-score"></div></div>
        <div class="bracket-item-status moment-tz-convert" data-utc-ts="1780138800"><div>6:00 pm MSK, May 30</div></div>
      </a>
    </div>
  `, "https://www.vlr.gg/event/2954/test");

  assert.equal(parsed.matches.length, 1);
  assert.equal(parsed.matches[0].utcTimestamp, "1780138800");
  assert.equal(parsed.matches[0].unix_time, 1780138800);
});

test("parseVlrEventsHtml parses VLR event cards", () => {
  const events = parseVlrEventsHtml(`
    <a class="wf-card mod-flex event-item" href="/event/2954/esports-world-cup-2026-emea-qualifier">
      <div class="event-item-inner">
        <div class="event-item-title">Esports World Cup 2026: EMEA Qualifier</div>
        <div class="event-item-desc-item"><span class="event-item-desc-item-status mod-ongoing">ongoing</span></div>
        <div class="event-item-desc-item mod-dates">May 11-Jun 1<div class="event-item-desc-item-label">Dates</div></div>
      </div>
    </a>
  `);

  assert.equal(events.length, 1);
  assert.equal(events[0].id, "2954");
  assert.equal(events[0].status, "ongoing");
});

test("parseVlrUtcTimestamp accepts VLR datetime and unix values", () => {
  assert.equal(parseVlrUtcTimestamp("2026-05-24 11:00:00"), 1779620400);
  assert.equal(parseVlrUtcTimestamp("1779620400"), 1779620400);
});
