import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveDltvEventStatus,
  extractDltvEventId,
  filterDltvEvents,
  filterDltvEventsByWindow,
  normalizeDltvUrl,
  parseDltvEventPage,
  parseDltvEvents,
  parseDltvMatchPage,
} from "../backend/src/sources/tdata/dltv/parse";
import {
  classifyDltvHttpFailure,
  fetchDltvWithRedirects,
  resolveDltvRedirectUrl,
  validateDltvFetchUrl,
} from "../backend/src/sources/tdata/dltv/client";
import { buildDltvTournamentIdentity, findExistingDltvTournament, resolveDltvImportFailureClass, resolveDltvImportStatus, shouldReplaceDltvMatchesOnImport } from "../backend/src/sources/tdata/dltv/importTournament";

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

  const events = parseDltvEvents(html, undefined, new Date("2026-05-20T12:00:00Z"));
  assert.equal(events.length, 2);
  assert.equal(events[0].id, "dreamleague-season-29");
  assert.equal(events[0].title, "DreamLeague 29");
  assert.equal(events[0].status, "live");
  assert.equal(events[0].dates, "2026-05-13 00:00:00 - 2026-05-24 00:00:00");
  assert.equal(filterDltvEvents(events, "blast")[0].id, "blast-slam-7");
});

test("DLTV identity uses the complete canonical event path", () => {
  const closed = "https://ru.dltv.org/events/qualifiers/europe/elite-league?utm_source=test#matches";
  const open = "https://ru.dltv.org/events/qualifiers/americas/elite-league/";

  assert.equal(extractDltvEventId(closed), "qualifiers/europe/elite-league");
  assert.equal(extractDltvEventId(open), "qualifiers/americas/elite-league");
  assert.notEqual(extractDltvEventId(closed), extractDltvEventId(open));
  assert.equal(
    normalizeDltvUrl(closed),
    "https://ru.dltv.org/events/qualifiers/europe/elite-league"
  );
});

test("DLTV tournament storage identity is path-based and host-independent", () => {
  assert.deepEqual(
    buildDltvTournamentIdentity("https://www.dltv.org/events/qualifiers/europe/elite-league/?utm_source=x"),
    {
      sourceTitle: "dltv:qualifiers/europe/elite-league",
      sourceUrl: "https://ru.dltv.org/events/qualifiers/europe/elite-league",
    },
  );
  assert.notEqual(
    buildDltvTournamentIdentity("https://ru.dltv.org/events/qualifiers/europe/elite-league").sourceTitle,
    buildDltvTournamentIdentity("https://ru.dltv.org/events/qualifiers/americas/elite-league").sourceTitle,
  );
});

test("DLTV title fallback is restricted to DLTV-owned or explicit legacy rows", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    tournament: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        calls.push(where);
        if (where.sourceTitle === "dltv:qualifiers/europe/elite-league" && !("OR" in where)) {
          return { id: "foreign-provider" };
        }
        return null;
      },
    },
  };

  const found = await findExistingDltvTournament({
    disciplineSlug: "dota2",
    sourceTitle: "dltv:qualifiers/europe/elite-league",
    sourceUrl: "https://ru.dltv.org/events/qualifiers/europe/elite-league",
  }, client as never);

  assert.equal(found, null);
  assert.deepEqual(calls[1], {
    disciplineSlug: "dota2",
    sourceTitle: "dltv:qualifiers/europe/elite-league",
    OR: [
      { sourceUrl: { startsWith: "https://ru.dltv.org/events/" } },
      { sourceUrl: { startsWith: "https://www.dltv.org/events/" } },
      { sourceUrl: "" },
    ],
  });
});

test("DLTV event status is derived from the date range before textual hints", () => {
  const now = new Date("2026-05-20T12:00:00Z");
  assert.equal(
    deriveDltvEventStatus("2026-05-01 00:00:00 - 2026-05-10 00:00:00", "LIVE", now),
    "finished"
  );
  assert.equal(
    deriveDltvEventStatus("2026-06-01 00:00:00 - 2026-06-10 00:00:00", "ongoing__events", now),
    "upcoming"
  );
  assert.equal(
    deriveDltvEventStatus("2026-05-13 00:00:00 - 2026-05-24 00:00:00", "LIVE", now),
    "live"
  );
});

test("DLTV classifies published match placeholders separately from generic 404s", () => {
  assert.equal(classifyDltvHttpFailure(404, "match"), "upstream_placeholder_404");
  assert.equal(classifyDltvHttpFailure(404, "event"), "source_4xx");
  assert.equal(classifyDltvHttpFailure(503, "match"), "source_5xx");
});

test("DLTV outbound requests allow only explicit HTTPS DLTV origins", () => {
  assert.equal(
    validateDltvFetchUrl("https://ru.dltv.org/events/test#matches"),
    "https://ru.dltv.org/events/test",
  );
  assert.equal(
    validateDltvFetchUrl("https://www.dltv.org/matches/42"),
    "https://www.dltv.org/matches/42",
  );

  for (const value of [
    "http://ru.dltv.org/events/test",
    "https://evil.example/events/test",
    "https://attacker.dltv.org/events/test",
    "https://user:pass@ru.dltv.org/events/test",
    "https://ru.dltv.org:444/events/test",
  ]) {
    assert.throws(
      () => validateDltvFetchUrl(value),
      (error: unknown) => error instanceof Error
        && (error as Error & { errorClass?: string }).errorClass === "parse_failed",
    );
  }
});

test("DLTV redirects stay on the exact starting origin", () => {
  assert.equal(
    resolveDltvRedirectUrl("https://ru.dltv.org/events/test", "/events/canonical"),
    "https://ru.dltv.org/events/canonical",
  );
  assert.throws(
    () => resolveDltvRedirectUrl("https://ru.dltv.org/events/test", "https://www.dltv.org/events/test"),
    (error: unknown) => error instanceof Error
      && (error as Error & { errorClass?: string }).errorClass === "parse_failed",
  );
  assert.throws(
    () => resolveDltvRedirectUrl("https://ru.dltv.org/events/test", "//metadata.example/latest"),
    /same-origin HTTPS DLTV URL/u,
  );
});

test("DLTV fetch follows same-origin redirects manually and validates before the next request", async () => {
  const requests: Array<{ url: string; redirect: unknown }> = [];
  const responses = [
    {
      status: 302,
      url: "https://ru.dltv.org/events/test",
      headers: { get: (name: string) => name.toLowerCase() === "location" ? "/events/canonical" : null },
    },
    {
      status: 200,
      url: "https://ru.dltv.org/events/canonical",
      headers: { get: (_name: string) => null },
    },
  ];
  let index = 0;

  const response = await fetchDltvWithRedirects(
    "https://ru.dltv.org/events/test",
    async (url: string, options: Record<string, unknown>) => {
      requests.push({ url, redirect: options.redirect });
      return responses[index++];
    },
    { headers: { Accept: "text/html" } },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(requests, [
    { url: "https://ru.dltv.org/events/test", redirect: "manual" },
    { url: "https://ru.dltv.org/events/canonical", redirect: "manual" },
  ]);
});

test("DLTV fetch blocks a cross-origin redirect before issuing another request", async () => {
  const requestedUrls: string[] = [];

  await assert.rejects(
    fetchDltvWithRedirects(
      "https://ru.dltv.org/events/test",
      async (url: string, _options: Record<string, unknown>) => {
        requestedUrls.push(url);
        return {
          status: 302,
          url,
          headers: { get: () => "https://169.254.169.254/latest/meta-data" },
        };
      },
      {},
    ),
    (error: unknown) => error instanceof Error
      && (error as Error & { errorClass?: string }).errorClass === "parse_failed",
  );

  assert.deepEqual(requestedUrls, ["https://ru.dltv.org/events/test"]);
});

test("DLTV fetch rejects automatic off-origin responses and bounds redirect chains", async () => {
  await assert.rejects(
    fetchDltvWithRedirects(
      "https://ru.dltv.org/events/test",
      async (_url: string, _options: Record<string, unknown>) => ({
        status: 200,
        url: "https://metadata.example/latest",
        headers: { get: () => null },
      }),
      {},
    ),
    (error: unknown) => error instanceof Error
      && (error as Error & { errorClass?: string }).errorClass === "parse_failed",
  );

  let requestCount = 0;
  await assert.rejects(
    fetchDltvWithRedirects(
      "https://ru.dltv.org/events/test",
      async (url: string, _options: Record<string, unknown>) => {
        requestCount += 1;
        return {
          status: 302,
          url,
          headers: { get: () => `/events/redirect-${requestCount}` },
        };
      },
      {},
    ),
    (error: unknown) => error instanceof Error
      && /redirect limit exceeded/u.test(error.message)
      && (error as Error & { errorClass?: string }).errorClass === "parse_failed",
  );
  assert.equal(requestCount, 4);
});

test("filterDltvEventsByWindow keeps only current and next 60 day events", () => {
  const events = [
    { id: "current", title: "Current", url: "/events/current", dates: "2026-05-20 00:00:00 - 2026-06-02 00:00:00", status: "ongoing" as const },
    { id: "soon", title: "Soon", url: "/events/soon", dates: "2026-07-20 00:00:00 - 2026-07-25 00:00:00", status: "upcoming" as const },
    { id: "far", title: "Far", url: "/events/far", dates: "2026-07-31 00:00:00 - 2026-08-05 00:00:00", status: "upcoming" as const },
    { id: "old", title: "Old", url: "/events/old", dates: "2026-04-01 00:00:00 - 2026-04-05 00:00:00", status: "ongoing" as const },
  ];

  assert.deepEqual(
    filterDltvEventsByWindow(events, new Date("2026-05-27T12:00:00Z"), 60).map((event) => event.id),
    ["current", "soon"]
  );
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

test("parseDltvMatchPage reads fallback team selectors and timestamp attributes", () => {
  const html = `
    <title>Panda vs Yakult Brothers (01 июня 2026) счет без задержки - DLTV</title>
    <section class="match__page">
      <section class="event__title">DLTV Test <div class="event__title-dates">Group Stage</div></section>
      <div class="score" data-timestamp="1780309800">
        <div class="score__format">Best of 3</div>
        <div class="score__finished">Предстоящие</div>
      </div>
      <div class="match__team"><span class="team__name">Panda Gaming</span></div>
      <div class="match__team"><span class="team__name">Yakult Brothers</span></div>
    </section>
  `;

  const match = parseDltvMatchPage(html, "https://ru.dltv.org/matches/426700/panda-vs-yakult-brothers-test");
  assert.equal(match.team1, "Panda Gaming");
  assert.equal(match.team2, "Yakult Brothers");
  assert.equal(match.matchDate?.toISOString(), "2026-06-01T10:30:00.000Z");
  assert.equal(match.format, "Best of 3");
});

test("parseDltvMatchPage reads JSON-LD startDate", () => {
  const html = `
    <title>Panda vs Yakult Brothers (01 июня 2026) счет без задержки - DLTV</title>
    <script type="application/ld+json">{"@type":"SportsEvent","startDate":"2026-06-01T11:30:00Z"}</script>
    <section class="match__page">
      <div class="match__page-title">
        <span class="team__stats-name">Panda Gaming</span>
        <span class="team__stats-name">Yakult Brothers</span>
      </div>
    </section>
  `;

  const match = parseDltvMatchPage(html, "https://ru.dltv.org/matches/426701/panda-vs-yakult-brothers-test");
  assert.equal(match.matchDate?.toISOString(), "2026-06-01T11:30:00.000Z");
});

test("resolveDltvImportStatus marks partial imports when match pages fail or save nothing", () => {
  assert.equal(resolveDltvImportStatus({
    ok: true,
    matchUrlsFound: 12,
    matchPagesFailed: 1,
    savedMatchesCount: 11,
  }), "PARTIAL");
  assert.equal(resolveDltvImportStatus({
    ok: true,
    matchUrlsFound: 12,
    matchPagesFailed: 0,
    savedMatchesCount: 0,
  }), "PARTIAL");
  assert.equal(resolveDltvImportStatus({
    ok: true,
    matchUrlsFound: 12,
    matchPagesFailed: 0,
    savedMatchesCount: 12,
  }), "SUCCESS");
  assert.equal(resolveDltvImportStatus({
    ok: true,
    matchUrlsFound: 0,
    matchPagesFailed: 0,
    savedMatchesCount: 0,
  }), "PARTIAL");
});

test("DLTV force replacement is allowed only after a complete source fetch", () => {
  const complete = {
    ok: true,
    stale: false,
    warning: null,
    matchUrlsFound: 12,
    matchPagesFailed: 0,
    sourceMatchesCount: 12,
  };
  assert.equal(shouldReplaceDltvMatchesOnImport(complete), true);
  assert.equal(shouldReplaceDltvMatchesOnImport({ ...complete, stale: true }), false);
  assert.equal(shouldReplaceDltvMatchesOnImport({ ...complete, warning: "stale fallback" }), false);
  assert.equal(shouldReplaceDltvMatchesOnImport({
    ...complete,
    matchPagesFailed: 1,
    sourceMatchesCount: 11,
  }), false);
  assert.equal(shouldReplaceDltvMatchesOnImport({
    ...complete,
    matchUrlsFound: 0,
    sourceMatchesCount: 0,
  }), false);
  assert.equal(shouldReplaceDltvMatchesOnImport({
    ...complete,
    ok: false,
  }), false);
});

test("DLTV partial imports surface the typed upstream failure", () => {
  assert.equal(resolveDltvImportFailureClass({ stale: true }), "stale_cache");
  assert.equal(resolveDltvImportFailureClass({ errorClass: "cloudflare_block" }), "cloudflare_block");
  assert.equal(resolveDltvImportFailureClass({ matchPageFailures: [{ url: "x", error: "404", errorClass: "upstream_placeholder_404" }] }), "upstream_placeholder_404");
});
