import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEventGamesUrl,
  extractBeachVolleyRuEventId,
  filterBeachVolleyRuUpcomingTournaments,
  isActiveBeachVolleyRuMatch,
  parseBeachVolleyRuCalendar,
  parseBeachVolleyRuMatches,
  resolveBeachVolleyRuUpcomingWindow,
} from "../src/lib/tbvolley/beachVolleyRu";

test("BeachVolleyRu calendar parser keeps Russia Cup and Championship events", () => {
  const html = `
    <div class="vl-table">
      <a class="vl-table-line vl-table-mobile-card--type2" href="calendar/01CUP/results">
        <div class="vl-table-line__item">2026</div>
        <div class="vl-table-line__item">14.05.2026 – 17.05.2026</div>
        <div class="vl-table-line__item">Кубок России</div>
        <div class="vl-table-line__item">Волгоград</div>
        <div class="vl-table-line__item">Статус:Проведён</div>
        <div class="vl-table-line__item">Этап: Этап Кубка России</div>
        <div class="vl-table-line__item">1 000 000,00 руб.</div>
      </a>
      <a class="vl-table-line vl-table-mobile-card--type2" href="calendar/01CHAMP/regulations">
        <div class="vl-table-line__item">2026</div>
        <div class="vl-table-line__item">28.05.2026 – 31.05.2026</div>
        <div class="vl-table-line__item">Чемпионат России</div>
        <div class="vl-table-line__item">Тула</div>
        <div class="vl-table-line__item">Статус:Запланирован</div>
        <div class="vl-table-line__item">Этап: Этап Чемпионата России</div>
        <div class="vl-table-line__item">1 000 000,00 руб.</div>
      </a>
      <a class="vl-table-line vl-table-mobile-card--type2" href="calendar/01FEST/regulations">
        <div class="vl-table-line__item">2026</div>
        <div class="vl-table-line__item">11.06.2026 – 14.06.2026</div>
        <div class="vl-table-line__item">Любительский чемпионат</div>
        <div class="vl-table-line__item">Нижний Новгород</div>
        <div class="vl-table-line__item">Статус:Запланирован</div>
        <div class="vl-table-line__item">Этап: Комус FEST</div>
        <div class="vl-table-line__item"></div>
      </a>
    </div>
  `;

  const tournaments = parseBeachVolleyRuCalendar(html, { gender: "women", kind: "all" });
  assert.equal(tournaments.length, 2);
  assert.equal(tournaments[0].eventId, "01CUP");
  assert.equal(tournaments[0].kind, "cup");
  assert.equal(tournaments[0].pageUrl, "https://beach.volley.ru/calendar/01CUP/allgames?sex=0");
  assert.equal(tournaments[1].eventId, "01CHAMP");
  assert.equal(tournaments[1].kind, "championship");
});

test("BeachVolleyRu search window keeps upcoming and ongoing tournaments in the nearest month", () => {
  const html = `
    <div class="vl-table">
      <a class="vl-table-line vl-table-mobile-card--type2" href="calendar/01FINISHED/results">
        <div class="vl-table-line__item">2026</div>
        <div class="vl-table-line__item">14.05.2026 – 17.05.2026</div>
        <div class="vl-table-line__item">Кубок России</div>
        <div class="vl-table-line__item">Волгоград</div>
        <div class="vl-table-line__item">Статус:Проведён</div>
        <div class="vl-table-line__item">Этап: Этап Кубка России</div>
        <div class="vl-table-line__item"></div>
      </a>
      <a class="vl-table-line vl-table-mobile-card--type2 vl-table-line--now" href="calendar/01ONGOING/allgames">
        <div class="vl-table-line__item">2026</div>
        <div class="vl-table-line__item">26.05.2026 – 31.05.2026</div>
        <div class="vl-table-line__item">Чемпионат России</div>
        <div class="vl-table-line__item">Тула</div>
        <div class="vl-table-line__item">Статус:Идёт</div>
        <div class="vl-table-line__item">Этап: Этап Чемпионата России</div>
        <div class="vl-table-line__item"></div>
      </a>
      <a class="vl-table-line vl-table-mobile-card--type2" href="calendar/01SOON/regulations">
        <div class="vl-table-line__item">2026</div>
        <div class="vl-table-line__item">28.05.2026 – 31.05.2026</div>
        <div class="vl-table-line__item">Чемпионат России</div>
        <div class="vl-table-line__item">Тула</div>
        <div class="vl-table-line__item">Статус:Запланирован</div>
        <div class="vl-table-line__item">Этап: Этап Чемпионата России</div>
        <div class="vl-table-line__item"></div>
      </a>
      <a class="vl-table-line vl-table-mobile-card--type2" href="calendar/01FAR/regulations">
        <div class="vl-table-line__item">2026</div>
        <div class="vl-table-line__item">01.07.2026 – 04.07.2026</div>
        <div class="vl-table-line__item">Кубок России</div>
        <div class="vl-table-line__item">Нижний Новгород</div>
        <div class="vl-table-line__item">Статус:Запланирован</div>
        <div class="vl-table-line__item">Этап: Этап Кубка России</div>
        <div class="vl-table-line__item"></div>
      </a>
    </div>
  `;

  const window = resolveBeachVolleyRuUpcomingWindow(new Date("2026-05-27T09:00:00.000Z"));
  assert.equal(window.fromDate, "2026-05-27");
  assert.equal(window.toDate, "2026-06-27");

  const tournaments = parseBeachVolleyRuCalendar(html, { gender: "men", kind: "all" });
  const filtered = filterBeachVolleyRuUpcomingTournaments(tournaments, window);
  assert.deepEqual(filtered.map((tournament) => tournament.eventId), ["01ONGOING", "01SOON"]);
});

test("BeachVolleyRu match parser extracts teams, sets, and Moscow time", () => {
  const html = `
    <div class="main-content">
      <h3 class="result-cards-title__h3">КВАЛИФИКАЦИЯ</h3>
      <div class="result-card" data-link="games/01MATCH" data-ts="14.05.2026 10:00">
        <div class="result-card__number"><a href="games/01MATCH">№ 1</a></div>
        <div class="result-card__court">Корт 1</div>
        <div class="result-card-col__team result-card-col__team--left">
          <div class="result-card-col__team-name">ФВ-Волгоградская обл., Волгоград</div>
          <div class="result-card-col__team-players">Андреева / Зеленская</div>
        </div>
        <div class="result-card-col__score">
          <div class="result-card-col__score-numb">0</div>
          <div class="result-card-col__score-numb-separator">:</div>
          <div class="result-card-col__score-numb">2</div>
        </div>
        <div class="result-card-col__team result-card-col__team--right">
          <div class="result-card-col__team-name">Песок и мяч, Санкт-Петербург</div>
          <div class="result-card-col__team-players">Симонова / Зажигина</div>
        </div>
        <span class="result-table-col__sets-stats-numb">15 : 21</span>
        <span class="result-table-col__sets-stats-numb">18 : 21</span>
      </div>
    </div>
  `;

  const matches = parseBeachVolleyRuMatches(html, { eventId: "01EVENT", gender: "women" });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].stage, "КВАЛИФИКАЦИЯ");
  assert.equal(matches[0].teamA.name, "Андреева / Зеленская");
  assert.equal(matches[0].teamB.club, "Песок и мяч, Санкт-Петербург");
  assert.equal(matches[0].startTimeUtc, "2026-05-14T07:00:00.000Z");
  assert.deepEqual(matches[0].score.sets, [
    { no: 1, teamA: 15, teamB: 21 },
    { no: 2, teamA: 18, teamB: 21 },
  ]);
});

test("BeachVolleyRu active match filter drops finished and out-of-window matches", () => {
  const window = { fromDate: "2026-05-27", toDate: "2026-06-27", windowDays: 31 };

  assert.equal(isActiveBeachVolleyRuMatch({
    status: "upcoming",
    startTimeUtc: "2026-05-28T07:00:00.000Z",
  }, window), true);
  assert.equal(isActiveBeachVolleyRuMatch({
    status: "finished",
    startTimeUtc: "2026-05-28T07:00:00.000Z",
  }, window), false);
  assert.equal(isActiveBeachVolleyRuMatch({
    status: "upcoming",
    startTimeUtc: "2026-07-02T07:00:00.000Z",
  }, window), false);
});

test("BeachVolleyRu helpers resolve relative IDs and gender URLs", () => {
  assert.equal(extractBeachVolleyRuEventId("calendar/01ABC/results"), "01ABC");
  assert.equal(extractBeachVolleyRuEventId("https://beach.volley.ru/calendar/01ABC/allgames?sex=1"), "01ABC");
  assert.equal(buildEventGamesUrl("01ABC", "men"), "https://beach.volley.ru/calendar/01ABC/allgames?sex=1");
  assert.equal(buildEventGamesUrl("01ABC", "women"), "https://beach.volley.ru/calendar/01ABC/allgames?sex=0");
});
