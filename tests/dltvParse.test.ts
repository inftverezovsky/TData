import test from "node:test";
import assert from "node:assert/strict";
import { filterDltvEvents, parseDltvEventPage, parseDltvEvents, parseDltvMatchPage } from "../src/lib/dltv/parse";

test("parseDltvEvents extracts and filters live/upcoming events", () => {
  const html = `
    <section class="featured__events">
      <a class="events__card-head" href="https://ru.dltv.org/events/dreamleague-season-29">
        <div class="events__card-head__pic">LIVE 2026-05-13 00:00:00 - 2026-05-24 00:00:00</div>
        <div class="events__card-head__info">DreamLeague 29 Europe призовой фонд $1,000,000 A-Tier Tier 16 участников</div>
      </a>
      <a class="events__card-head" href="/events/blast-slam-7">
        2026-05-26 00:00:00 - 2026-06-07 00:00:00 Blast Slam 7 Denmark призовой фонд $1,000,000
      </a>
    </section>
  `;

  const events = parseDltvEvents(html);
  assert.equal(events.length, 2);
  assert.equal(events[0].id, "dreamleague-season-29");
  assert.equal(events[0].title, "DreamLeague 29");
  assert.equal(events[0].status, "live");
  assert.equal(events[0].dates, "2026-05-13 00:00:00 - 2026-05-24 00:00:00");
  assert.equal(filterDltvEvents(events, "blast")[0].id, "blast-slam-7");
});

test("parseDltvEventPage extracts participants and unique match urls", () => {
  const html = `
    <h1>DreamLeague 29</h1>
    <section class="event__title"><div class="event__title-dates">2026-05-13 00:00:00 - 2026-05-24 00:00:00</div></section>
    <section class="event__overview">live Даты 2026-05-13 00:00:00 - 2026-05-24 00:00:00 Страна Europe Тир турнира A-Tier Тип турнира Online призовой фонд $1,000,000 Участники 16 Команды</section>
    <a class="title overflow-text-1" href="https://ru.dltv.org/teams/team-spirit">Team Spirit</a>
    <a class="title overflow-text-1" href="/teams/team-falcons">Team Falcons</a>
    <a class="leaf" href="/matches/426528/team-spirit-vs-team-falcons-dreamleague-season-29">2 - 1</a>
    <a class="rose" href="/matches/426528/team-spirit-vs-team-falcons-dreamleague-season-29">1 - 2</a>
  `;

  const event = parseDltvEventPage(html, "https://ru.dltv.org/events/dreamleague-season-29");
  assert.equal(event.title, "DreamLeague 29");
  assert.equal(event.location, "Europe");
  assert.equal(event.prizePool, "$1,000,000");
  assert.deepEqual(event.participants.map((team) => team.name), ["Team Falcons", "Team Spirit"]);
  assert.equal(event.matchUrls.length, 1);
  assert.equal(event.matchUrls[0], "https://ru.dltv.org/matches/426528/team-spirit-vs-team-falcons-dreamleague-season-29");
});

test("parseDltvMatchPage extracts teams date score and stage", () => {
  const html = `
    <title>Team Spirit 1-2 Team Falcons (16 мая 2026) Итоговый Результат - DLTV</title>
    <script type="application/ld+json">{"itemListElement":[{"item":"https://ru.dltv.org/events/dreamleague-season-29","name":"DreamLeague 29"}]}</script>
    <section class="match__page">
      <section class="event__title">DreamLeague 29 Group Stage (Round-Robin)</section>
      <div class="match__page-title">
        <a class="team__stats-name">Team Spirit</a>
        <div class="score__date">2026-05-16 13:57:18</div>
        <a class="team__stats-name">Team Falcons</a>
      </div>
    </section>
  `;

  const match = parseDltvMatchPage(html, "https://ru.dltv.org/matches/426528/team-spirit-vs-team-falcons-dreamleague-season-29");
  assert.equal(match.id, "426528");
  assert.equal(match.team1, "Team Spirit");
  assert.equal(match.team2, "Team Falcons");
  assert.equal(match.scoreA, 1);
  assert.equal(match.scoreB, 2);
  assert.equal(match.stage, "DreamLeague 29 Group Stage (Round-Robin)");
  assert.equal(match.matchDate?.toISOString(), "2026-05-16T13:57:18.000Z");
  assert.equal(match.status, "finished");
});

test("parseDltvMatchPage keeps upcoming TBD 0-0 slots as announcements", () => {
  const html = `
    <title>Semifinals матч (05 июня 2026) счет без задержки - DLTV</title>
    <script type="application/ld+json">{"itemListElement":[{"item":"https://ru.dltv.org/events/blast-slam-7","name":"Blast Slam 7"}]}</script>
    <section class="match__page">
      <section class="event__title">Blast Slam 7 <div class="event__title-dates">Semifinals</div></section>
      <div class="match__page-title">
        <span class="team__stats-name">TBD</span>
        <div class="score">
          <div class="score__date">2026-06-05 09:00:00</div>
          <div class="score__scores"><span>0</span> - <span>0</span></div>
          <div class="score__format">Best of 3</div>
          <div class="score__finished">Предстоящие</div>
        </div>
        <span class="team__stats-name">TBD</span>
      </div>
    </section>
  `;

  const match = parseDltvMatchPage(html, "https://ru.dltv.org/matches/426647/tbd-vs-tbd-blast-slam-7");
  assert.equal(match.id, "426647");
  assert.equal(match.team1, "TBD");
  assert.equal(match.team2, "TBD");
  assert.equal(match.scoreA, null);
  assert.equal(match.scoreB, null);
  assert.equal(match.stage, "Semifinals");
  assert.equal(match.matchDate?.toISOString(), "2026-06-05T09:00:00.000Z");
  assert.equal(match.matchDateTime, "2026-06-05 09:00:00");
  assert.equal(match.format, "Best of 3");
  assert.equal(match.status, "upcoming");
});

test("parseDltvMatchPage understands Russian detail dates", () => {
  const html = `
    <title>TBD vs TBD (05 июня 2026) счет без задержки - DLTV</title>
    <section class="match__page">
      <section class="event__title">Blast Slam 7 <div class="event__title-dates">Semifinals</div></section>
      <div class="match__page-title">
        <span class="team__stats-name">TBD</span>
        <div class="score">
          <div class="score__date">5 июня 2026 г. - 12:00</div>
          <div class="score__scores">0 - 0</div>
          <div class="score__format">Best of 3</div>
          <div class="score__finished">Предстоящие</div>
        </div>
        <span class="team__stats-name">TBD</span>
      </div>
    </section>
  `;

  const match = parseDltvMatchPage(html, "https://ru.dltv.org/matches/426647/tbd-vs-tbd-blast-slam-7");
  assert.equal(match.matchDate?.toISOString(), "2026-06-05T09:00:00.000Z");
  assert.equal(match.scoreA, null);
  assert.equal(match.scoreB, null);
  assert.equal(match.status, "upcoming");
});
