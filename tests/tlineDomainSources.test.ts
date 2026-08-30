import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import type { OfficialSourceAdapter } from "../backend/src/tline/sources/contracts";
import { createOfficialSourceRegistry } from "../backend/src/tline/sources/registry";
import {
  createVolleyRuAdapter,
  parseVolleyRuChampionshipHtml,
  readVolleyRuHtmlResponse,
} from "../backend/src/tline/sources/volleyRu";
import {
  createNffrFloorballAdapter,
  NFFR_FLOORBALL_PROVIDER,
  parseNffrFloorballChampionshipHtml,
  readNffrFloorballHtmlResponse,
} from "../backend/src/tline/sources/nffrFloorball";
import { createDefaultOfficialSourceRegistry } from "../backend/src/tline/sources/registry";

const fixture = (name: string) => readFileSync(path.join(process.cwd(), "tests", "fixtures", "tline", name), "utf8");

test("official source registry resolves adapters and rejects duplicate providers", () => {
  const adapter = { provider: "test-provider" } as OfficialSourceAdapter;
  const registry = createOfficialSourceRegistry([adapter]);
  assert.equal(registry.get("test-provider"), adapter);
  assert.deepEqual(registry.providers, ["test-provider"]);
  assert.throws(() => registry.get("missing"), /Unknown TLine official source provider/);
  assert.throws(() => createOfficialSourceRegistry([adapter, adapter]), /Duplicate TLine official source provider/);
});

const nffrCurrentConfig = {
  id: "floorball-current",
  externalId: "200",
  name: "Флорбол. Россия. Высшая лига",
  sourceUrl: "https://xn--m1agla.xn--p1ai/sport/calendar/200",
  sourceTimezone: "Europe/Moscow",
} as const;

test("default official source registry includes volleyball and NFFR floorball", () => {
  const registry = createDefaultOfficialSourceRegistry();
  assert.deepEqual(registry.providers, ["volley-ru", NFFR_FLOORBALL_PROVIDER]);
  assert.equal(registry.get(NFFR_FLOORBALL_PROVIDER).provider, NFFR_FLOORBALL_PROVIDER);
});

test("NFFR floorball parser extracts all 56 undated matches and eight official teams", () => {
  const snapshot = parseNffrFloorballChampionshipHtml(
    fixture("nffr-floorball-current.html"),
    nffrCurrentConfig,
  );

  assert.equal(snapshot.matches.length, 56);
  assert.equal(snapshot.teams.length, 8);
  assert.equal(snapshot.matches[0].id, "4153");
  assert.equal(snapshot.matches[0].externalId, "4153");
  assert.equal(snapshot.matches[0].matchNumber, "1");
  assert.equal(snapshot.matches[0].home.sourceTeamId, "7609");
  assert.equal(snapshot.matches[0].home.name, "Барракуда");
  assert.equal(snapshot.matches[0].home.city, "Северодвинск");
  assert.equal(snapshot.matches[0].away.sourceTeamId, "122");
  assert.equal(snapshot.matches[0].sourceUrl, "https://xn--m1agla.xn--p1ai/sport/protocol/4153");
  assert.equal(snapshot.matches[0].startTimeRaw, "");
  assert.equal(snapshot.matches[0].startTimeUtc, null);
  assert.equal(snapshot.matches[0].timePrecision, "UNDEFINED");
  assert.equal(snapshot.matches[0].status, "TBD");
  assert.deepEqual(snapshot.matches[0].score, { home: null, away: null });
});

test("NFFR floorball parser converts Moscow time and retains finished scores", () => {
  const snapshot = parseNffrFloorballChampionshipHtml(
    fixture("nffr-floorball-historical.html"),
    { ...nffrCurrentConfig, id: "floorball-history", externalId: "140", sourceUrl: "https://xn--m1agla.xn--p1ai/sport/calendar/140" },
  );

  assert.equal(snapshot.matches[0].startTimeRaw, "09.10.2025 10:00");
  assert.equal(snapshot.matches[0].startTimeUtc, "2025-10-09T07:00:00.000Z");
  assert.equal(snapshot.matches[0].startTimeMoscow, "2025-10-09T10:00:00.000+03:00");
  assert.equal(snapshot.matches[0].timePrecision, "EXACT");
  assert.equal(snapshot.matches[0].status, "FINISHED");
  assert.deepEqual(snapshot.matches[0].score, { home: 6, away: 1 });
});

test("NFFR floorball filter excludes undated matches by default but always synchronizes teams", async () => {
  const calls: Array<{ url: string; forceFresh: boolean }> = [];
  const adapter = createNffrFloorballAdapter({
    fetchHtml: async (url, options) => {
      calls.push({ url, forceFresh: options.forceFresh });
      return fixture("nffr-floorball-current.html");
    },
  });
  const baseInput = {
    championship: nffrCurrentConfig,
    from: new Date("2026-08-01T00:00:00.000Z"),
    to: new Date("2027-06-01T00:00:00.000Z"),
    forceFresh: true as const,
  };

  const excluded = await adapter.fetchChampionship({ ...baseInput, includeUndatedSourceMatches: false });
  assert.equal(excluded.matches.length, 0);
  assert.equal(excluded.teams.length, 8);
  const included = await adapter.fetchChampionship({ ...baseInput, includeUndatedSourceMatches: true });
  assert.equal(included.matches.length, 56);
  assert.equal(included.teams.length, 8);
  assert.deepEqual(calls, [
    { url: nffrCurrentConfig.sourceUrl, forceFresh: true },
    { url: nffrCurrentConfig.sourceUrl, forceFresh: true },
  ]);
});

test("NFFR floorball adapter rejects unsafe URLs and identity drift before accepting evidence", async () => {
  let called = false;
  const adapter = createNffrFloorballAdapter({ fetchHtml: async () => { called = true; return ""; } });
  for (const sourceUrl of [
    "http://xn--m1agla.xn--p1ai/sport/calendar/200",
    "https://xn--m1agla.xn--p1ai:444/sport/calendar/200",
    "https://user:pass@xn--m1agla.xn--p1ai/sport/calendar/200",
    "https://xn--m1agla.xn--p1ai/sport/calendar/200?other=1",
    "https://example.com/sport/calendar/200",
  ]) {
    await assert.rejects(adapter.testConnection({ ...nffrCurrentConfig, sourceUrl }), /NFFR floorball calendar URL/i);
  }
  assert.equal(called, false);

  assert.throws(
    () => parseNffrFloorballChampionshipHtml(
      fixture("nffr-floorball-current.html").replace("value='200' selected", "value='201' selected"),
      nffrCurrentConfig,
    ),
    /selected calendar does not match/i,
  );
  assert.throws(
    () => parseNffrFloorballChampionshipHtml(
      fixture("nffr-floorball-current.html").replace("/sport/team/122/73", "/sport/team/122/999"),
      nffrCurrentConfig,
    ),
    /competition ID/i,
  );
});

test("NFFR response reader enforces HTML content type and streaming size limit", async () => {
  await assert.rejects(
    readNffrFloorballHtmlResponse(new Response("{}", { headers: { "content-type": "application/json" } })),
    /HTML response/i,
  );
  const chunk = new Uint8Array(1024 * 1024);
  const oversized = new Response(new ReadableStream({
    start(controller) {
      for (let index = 0; index < 6; index += 1) controller.enqueue(chunk);
      controller.close();
    },
  }), { headers: { "content-type": "text/html; charset=utf-8" } });
  await assert.rejects(readNffrFloorballHtmlResponse(oversized), /size limit/i);
});

test("VolleyRu parser extracts stage, round, teams and a timezone-aware exact start", () => {
  const snapshot = parseVolleyRuChampionshipHtml(fixture("volley-ru-women.html"), {
    id: "women",
    externalId: "01KYPZAKJB0SMM0D6TGV3W0Y85",
    name: "Высшая лига А. Женщины",
    sourceUrl: "https://volley.ru/calendar/01KYPZAKJB0SMM0D6TGV3W0Y85/allgames",
    sourceTimezone: "Europe/Moscow",
  });

  assert.equal(snapshot.matches.length, 2);
  assert.equal(snapshot.matches[0].id, "01WOMENMATCH1");
  assert.equal(snapshot.matches[0].stage, "ПРЕДВАРИТЕЛЬНЫЙ");
  assert.equal(snapshot.matches[0].round, "1 Тур");
  assert.equal(snapshot.matches[0].home.name, "Динамо-Ак Барс");
  assert.equal(snapshot.matches[0].away.name, "Локомотив");
  assert.equal(snapshot.matches[0].startTimeRaw, "01.12.2026 14:00 МСК");
  assert.equal(snapshot.matches[0].startTimeUtc, "2026-12-01T11:00:00.000Z");
  assert.equal(snapshot.matches[0].startTimeMoscow, "2026-12-01T14:00:00.000+03:00");
  assert.equal(snapshot.matches[0].status, "SCHEDULED");
  assert.equal(snapshot.teams.length, 4);
});

test("VolleyRu date-only event is retained with SOURCE_TIME_UNDEFINED evidence", () => {
  const snapshot = parseVolleyRuChampionshipHtml(fixture("volley-ru-men.html"), {
    id: "men",
    externalId: "01KZQZR5T3NETE0RT7VHND16VW",
    name: "Высшая лига А. Мужчины",
    sourceUrl: "https://volley.ru/calendar/01KZQZR5T3NETE0RT7VHND16VW/allgames",
    sourceTimezone: "Europe/Moscow",
  });

  assert.equal(snapshot.matches.length, 1);
  assert.equal(snapshot.matches[0].startTimeRaw, "09.10.2026 г. Нижневартовск");
  assert.equal(snapshot.matches[0].startTimeUtc, null);
  assert.equal(snapshot.matches[0].timePrecision, "DATE_ONLY");
  assert.equal(snapshot.matches[0].status, "SCHEDULED");
  assert.equal(snapshot.matches[0].home.sourceTeamId, "01SAMOTLOR");
  assert.equal(snapshot.matches[0].away.sourceTeamId, "01SKSO");
  assert.deepEqual(snapshot.teams.map((team) => team.externalId), ["01SAMOTLOR", "01SKSO"]);
});

test("VolleyRu parser rejects a calendar response for a different selected league", () => {
  assert.throws(
    () => parseVolleyRuChampionshipHtml(fixture("volley-ru-men.html"), {
      id: "wrong-league",
      externalId: "01NOTTHESELECTEDLEAGUE",
      name: "Wrong league",
      sourceUrl: "https://volley.ru/calendar/01NOTTHESELECTEDLEAGUE/allgames",
      sourceTimezone: "Europe/Moscow",
    }),
    /selected league does not match/i,
  );
});

test("VolleyRu parser fails closed when league or official identity markers disappear", () => {
  const config = {
    id: "men",
    externalId: "01KZQZR5T3NETE0RT7VHND16VW",
    name: "Высшая лига Б. Мужчины",
    sourceUrl: "https://volley.ru/calendar/01KZQZR5T3NETE0RT7VHND16VW/allgames",
    sourceTimezone: "Europe/Moscow",
  } as const;
  const html = fixture("volley-ru-men.html");
  assert.throws(
    () => parseVolleyRuChampionshipHtml(html.replace(/<select id="league"[\s\S]*?<\/select>/u, ""), config),
    /selected league marker is missing/i,
  );
  assert.throws(
    () => parseVolleyRuChampionshipHtml(html.replace(/<select id="team"[\s\S]*?<\/select>/u, ""), config),
    /official team ID is missing/i,
  );
  assert.throws(
    () => parseVolleyRuChampionshipHtml(
      html.replace('data-id="01MENMATCH1"', "").replace("https://volley.ru/games/01MENMATCH1", "https://volley.ru/games/"),
      config,
    ),
    /official match ID is missing/i,
  );
  assert.throws(
    () => parseVolleyRuChampionshipHtml(html.replace("https://volley.ru/games/01MENMATCH1", "https://example.com/games/01MENMATCH1"), config),
    /invalid match URL/i,
  );
});

test("VolleyRu parser treats the explicit Moscow time as authoritative when a venue time follows", () => {
  const html = fixture("volley-ru-men.html").replace(
    "09.10.2026 г. Нижневартовск",
    "24.01.2027 18:00 (МСК), 17:00 г. Калининград",
  );
  const snapshot = parseVolleyRuChampionshipHtml(html, {
    id: "men",
    externalId: "01KZQZR5T3NETE0RT7VHND16VW",
    name: "Высшая лига Б. Мужчины",
    sourceUrl: "https://volley.ru/calendar/01KZQZR5T3NETE0RT7VHND16VW/allgames",
    sourceTimezone: "Europe/Moscow",
  });

  assert.equal(snapshot.matches[0].startTimeUtc, "2027-01-24T15:00:00.000Z");
  assert.equal(snapshot.matches[0].startTimeMoscow, "2027-01-24T18:00:00.000+03:00");
  assert.equal(snapshot.matches[0].timePrecision, "EXACT");
});

test("VolleyRu parser fails explicitly on DOM drift and normalizes special statuses", () => {
  const config = {
    id: "men",
    externalId: "01KZQZR5T3NETE0RT7VHND16VW",
    name: "Высшая лига А. Мужчины",
    sourceUrl: "https://volley.ru/calendar/01KZQZR5T3NETE0RT7VHND16VW/allgames",
    sourceTimezone: "Europe/Moscow",
  } as const;
  assert.throws(() => parseVolleyRuChampionshipHtml("<html><body>changed</body></html>", config), /found no match cards/);

  const cancelledHtml = fixture("volley-ru-men.html").replace('data-status="scheduled"', 'data-status="cancelled"');
  assert.equal(parseVolleyRuChampionshipHtml(cancelledHtml, config).matches[0].status, "CANCELLED");
});

test("VolleyRu parser recognizes a completed match from its official final score", () => {
  const html = fixture("volley-ru-men.html").replace(
    '<div class="ginfo__datetime">09.10.2026 г. Нижневартовск</div>',
    '<div class="ginfo__datetime">09.10.2026 15:30 г. Нижневартовск</div><div class="ginfo-data__score">3</div><div class="ginfo-data__score">0</div>',
  );
  const snapshot = parseVolleyRuChampionshipHtml(html, {
    id: "men",
    externalId: "01KZQZR5T3NETE0RT7VHND16VW",
    name: "Высшая лига Б. Мужчины",
    sourceUrl: "https://volley.ru/calendar/01KZQZR5T3NETE0RT7VHND16VW/allgames",
    sourceTimezone: "Europe/Moscow",
  });
  assert.equal(snapshot.matches[0].status, "FINISHED");
});

test("VolleyRu adapter forces a fresh fetch and never falls back after a fetch failure", async () => {
  const calls: Array<{ url: string; forceFresh: boolean }> = [];
  const adapter = createVolleyRuAdapter({
    fetchHtml: async (url, options) => {
      calls.push({ url, forceFresh: options.forceFresh });
      return fixture("volley-ru-men.html");
    },
  });
  const championship = {
    id: "men",
    externalId: "01KZQZR5T3NETE0RT7VHND16VW",
    name: "Высшая лига А. Мужчины",
    sourceUrl: "https://volley.ru/calendar/01KZQZR5T3NETE0RT7VHND16VW/allgames",
    sourceTimezone: "Europe/Moscow",
  } as const;

  const snapshot = await adapter.fetchChampionship({
    championship,
    from: new Date("2026-10-01T00:00:00.000Z"),
    to: new Date("2026-11-01T00:00:00.000Z"),
    forceFresh: true,
    includeUndatedSourceMatches: false,
  });
  assert.equal(snapshot.matches.length, 1);
  assert.deepEqual(calls, [{ url: championship.sourceUrl, forceFresh: true }]);

  const failing = createVolleyRuAdapter({ fetchHtml: async () => { throw new Error("source unavailable"); } });
  await assert.rejects(
    failing.fetchChampionship({
      championship,
      from: new Date("2026-10-01T00:00:00.000Z"),
      to: new Date("2026-11-01T00:00:00.000Z"),
      forceFresh: true,
      includeUndatedSourceMatches: false,
    }),
    /source unavailable/,
  );
});

test("VolleyRu adapter rejects non-volley and non-calendar URLs before network access", async () => {
  let called = false;
  const adapter = createVolleyRuAdapter({ fetchHtml: async () => { called = true; return ""; } });
  await assert.rejects(
    adapter.testConnection({
      id: "bad",
      externalId: "bad",
      name: "Bad",
      sourceUrl: "https://example.com/calendar/bad/allgames",
      sourceTimezone: "Europe/Moscow",
    }),
    /volley\.ru calendar URL/,
  );
  assert.equal(called, false);

  await assert.rejects(
    adapter.testConnection({
      id: "query",
      externalId: "query",
      name: "Bad query",
      sourceUrl: "https://volley.ru/calendar/query/allgames?other=1",
      sourceTimezone: "Europe/Moscow",
    }),
    /volley\.ru calendar URL/,
  );
  assert.equal(called, false);
});

test("VolleyRu response reader enforces content type and the decoded streaming size cap", async () => {
  await assert.rejects(
    readVolleyRuHtmlResponse(new Response("{}", { headers: { "content-type": "application/json" } })),
    /HTML response/i,
  );

  const chunk = new Uint8Array(1024 * 1024);
  const oversized = new Response(new ReadableStream({
    start(controller) {
      for (let index = 0; index < 6; index += 1) controller.enqueue(chunk);
      controller.close();
    },
  }), { headers: { "content-type": "text/html; charset=utf-8" } });
  await assert.rejects(readVolleyRuHtmlResponse(oversized), /size limit/i);
});
