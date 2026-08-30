import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  HOCKEY_BY_ENDPOINT,
  HOCKEY_BY_PROVIDER,
  createHockeyByAdapter,
  parseHockeyByCalendarResponse,
  readHockeyByJsonResponse,
  requestHockeyByCalendarPage,
  resolveHockeyByCalendarUrl,
} from "../backend/src/tline/sources/hockeyBy";

const fixture = (name: string) => readFileSync(path.join(process.cwd(), "tests", "fixtures", "tline", name), "utf8");
const currentFixture = fixture("hockey-by-current.html");
const [julyPageOne, afterJulyPageOne] = currentFixture.split("<!-- july-page-2 -->");
const [julyPageTwo, afterJulyPageTwo] = afterJulyPageOne.split("<!-- august-page-1 -->");
const [augustPageOne, septemberPageOne] = afterJulyPageTwo.split("<!-- september-page-1 -->");
const cardMarker = '<div class="future-game-game flex">';
const firstCurrentCard = `${cardMarker}${julyPageOne.split(cardMarker)[1]}`;
const firstAugustCard = `${cardMarker}${augustPageOne.split(cardMarker)[1]}`;
const historicalFixture = fixture("hockey-by-historical.html");
const [historicalSeptember, historicalJanuary] = historicalFixture.split("<!-- january-page-1 -->");

const currentConfig = Object.freeze({
  id: "hockey-belarus-vysshaya",
  externalId: "11:5",
  name: "Хоккей. Беларусь. Высшая лига",
  sourceUrl: "https://hockey.by/calendar/",
  sourceTimezone: "Europe/Minsk",
});

const listedTeams = Object.freeze([
  ["5645", "U17"],
  ["5600", "U18"],
  ["5612", "Белсталь"],
  ["5610", "Динамо-Олимпик", "ДНМ-Олимпик"],
  ["5844", "Динамо-Шинник", "ДНМ-Шинник"],
  ["5611", "Днепровские Львы", "Львы"],
  ["5609", "Зубры"],
  ["5617", "Локо"],
  ["5615", "Нефтехимик"],
  ["5602", "Прогресс"],
  ["5613", "Рыси"],
  ["5603", "Рыцари"],
  ["5643", "Тайфун"],
  ["5601", "Юниор"],
  ["5619", "Ястребы"],
].map(([ID, UF_NAME, UF_SHORT_NAME = UF_NAME]) => ({ ID, UF_NAME, UF_SHORT_NAME, selected: false })));

interface PayloadOptions {
  readonly seasonId?: string;
  readonly seasonName?: string;
  readonly leagueId?: string;
  readonly leagueName?: string;
  readonly divisionId?: string;
  readonly divisionName?: string;
  readonly html?: string;
  readonly nav?: string;
  readonly selectedDivision?: boolean;
}

function payload(options: PayloadOptions = {}) {
  const seasonId = options.seasonId ?? "11";
  const seasonName = options.seasonName ?? "2026-2027";
  const leagueId = options.leagueId ?? "5";
  const leagueName = options.leagueName ?? "Betera-Высшая лига";
  const divisionId = options.divisionId ?? "619";
  const divisionName = options.divisionName ?? "Товарищеские матчи";
  return {
    status: "success",
    data: {
      SEASONS: [{ ID: seasonId, UF_NAME: seasonName, selected: true }],
      LEAGUES: [{ ID: leagueId, UF_NAME: leagueName, selected: true }],
      DIVISIONS: [{ ID: divisionId, UF_NAME: divisionName, selected: options.selectedDivision ?? true }],
      TEAMS: [{ ID: "all", UF_NAME: "Все команды", selected: true }, ...listedTeams],
      FUTURE_GAMES: [{ HTML: options.html ?? "Матчей не найдено" }],
      CURRENT_GAMES: null,
      NAV: options.nav ?? "",
    },
  };
}

function currentPage(month: number, page: number, divisionId: string | null) {
  if (divisionId === null) return payload({ html: "Матчей не найдено" });
  if (month === 7 && page === 1) {
    return payload({ html: julyPageOne, nav: '<a class="pgn-next" data-page="2"></a>' });
  }
  if (month === 7 && page === 2) return payload({ html: julyPageTwo });
  if (month === 8 && page === 1) return payload({ html: augustPageOne });
  if (month === 9 && page === 1) return payload({ html: septemberPageOne });
  return payload({ html: "Матчей не найдено" });
}

test("hockey.by calendar response extracts stable evidence and never uses seasonal roster IDs", () => {
  const parsed = parseHockeyByCalendarResponse(
    payload({ html: julyPageOne, nav: '<a class="pgn-next" data-page="2"></a>' }),
    {
      championship: currentConfig,
      divisionId: "619",
      divisionName: "Товарищеские матчи",
      month: 7,
      page: 1,
      seasonStartYear: 2026,
      now: new Date("2026-08-30T12:00:00.000Z"),
    },
  );

  assert.equal(parsed.matches.length, 12);
  assert.equal(parsed.cardCount, 12);
  assert.equal(parsed.listedTeamCount, 15);
  assert.equal(parsed.hasNextPage, true);
  assert.equal(parsed.matches[0].id, "436187");
  assert.equal(parsed.matches[0].externalId, "436187");
  assert.equal(parsed.matches[0].home.sourceTeamId, "13");
  assert.equal(parsed.matches[0].home.name, "ДНМ-Олимпик");
  assert.equal(parsed.matches[0].away.sourceTeamId, "11");
  assert.equal(parsed.matches[0].sourceUrl, "https://hockey.by/gamecenter/436187/");
  assert.equal(parsed.matches[0].venue, "Олимпик Арена");
  assert.equal(parsed.matches[0].stage, "Товарищеские матчи");
  assert.equal(parsed.matches[0].startTimeRaw, "10 Июль 15:45 (Пятница)");
  assert.equal(parsed.matches[0].startTimeUtc, "2026-07-10T12:45:00.000Z");
  assert.equal(parsed.matches[0].startTimeMoscow, "2026-07-10T15:45:00.000+03:00");
  assert.equal(parsed.matches[0].status, "UNKNOWN");
  assert.ok(parsed.teams.every((team) => !team.id.startsWith("56") && !team.id.startsWith("58")));
  assert.deepEqual(parsed.teams.find((team) => team.id === "13"), {
    id: "13",
    championshipId: currentConfig.id,
    externalId: "13",
    nameRu: "Динамо-Олимпик",
    nameEn: null,
    aliases: ["ДНМ-Олимпик"],
  });
});

test("hockey.by parser retains finished scores, OT/Bul evidence and infers the season year", () => {
  const historicalConfig = { ...currentConfig, externalId: "10:5" };
  const september = parseHockeyByCalendarResponse(
    payload({
      seasonId: "10",
      seasonName: "2025-2026",
      divisionId: "497",
      divisionName: "1 этап",
      html: historicalSeptember,
    }),
    {
      championship: historicalConfig,
      divisionId: "497",
      divisionName: "1 этап",
      month: 9,
      page: 1,
      seasonStartYear: 2025,
      now: new Date("2026-08-30T12:00:00.000Z"),
    },
  );
  const january = parseHockeyByCalendarResponse(
    payload({
      seasonId: "10",
      seasonName: "2025-2026",
      divisionId: "497",
      divisionName: "1 этап",
      html: historicalJanuary,
    }),
    {
      championship: historicalConfig,
      divisionId: "497",
      divisionName: "1 этап",
      month: 1,
      page: 1,
      seasonStartYear: 2025,
      now: new Date("2026-08-30T12:00:00.000Z"),
    },
  );

  assert.equal(september.matches[0].startTimeUtc, "2025-09-02T11:00:00.000Z");
  assert.equal(september.matches[0].status, "FINISHED");
  assert.deepEqual(september.matches[0].score, { home: 2, away: 3 });
  assert.equal(september.matches[0].scoreNote, "ОТ");
  assert.deepEqual(september.matches[1].score, { home: 7, away: 8 });
  assert.equal(september.matches[1].scoreNote, "Бул");
  assert.equal(january.matches[0].startTimeUtc, "2026-01-19T15:00:00.000Z");
  assert.equal(january.matches[0].startTimeMoscow, "2026-01-19T18:00:00.000+03:00");
});

test("hockey.by keeps an official 00:00 as exact time and validates the published weekday", () => {
  const parsed = parseHockeyByCalendarResponse(payload({ html: septemberPageOne }), {
    championship: currentConfig,
    divisionId: "619",
    divisionName: "Товарищеские матчи",
    month: 9,
    page: 1,
    seasonStartYear: 2026,
    now: new Date("2026-08-30T12:00:00.000Z"),
  });
  assert.equal(parsed.matches[0].startTimeUtc, "2026-09-01T21:00:00.000Z");
  assert.equal(parsed.matches[0].startTimeMoscow, "2026-09-02T00:00:00.000+03:00");
  assert.equal(parsed.matches[0].timePrecision, "EXACT");
  assert.equal(parsed.matches[0].status, "SCHEDULED");

  assert.throws(
    () => parseHockeyByCalendarResponse(payload({ html: septemberPageOne.replace("(Среда)", "(Вторник)") }), {
      championship: currentConfig,
      divisionId: "619",
      divisionName: "Товарищеские матчи",
      month: 9,
      page: 1,
      seasonStartYear: 2026,
      now: new Date("2026-08-30T12:00:00.000Z"),
    }),
    /weekday/i,
  );
});

test("hockey.by adapter paginates requested months, excludes friendlies, and reports honest diagnostics", async () => {
  const calls: Array<{ month: number; page: number; divisionId: string | null; forceFresh: true }> = [];
  const delays: number[] = [];
  const adapter = createHockeyByAdapter({
    fetchPage: async (request) => {
      calls.push({
        month: request.month,
        page: request.page,
        divisionId: request.divisionId,
        forceFresh: request.forceFresh,
      });
      return currentPage(request.month, request.page, request.divisionId);
    },
    delay: async (milliseconds) => { delays.push(milliseconds); },
    now: () => new Date("2026-08-30T12:00:00.000Z"),
  });

  const connection = await adapter.testConnection(currentConfig);
  assert.equal(connection.provider, HOCKEY_BY_PROVIDER);
  assert.equal(connection.teamCount, 15);
  assert.equal(connection.matchCount, 20);
  assert.equal(connection.exactTimeCount, 20);
  assert.equal(connection.eligibleMatchCount, 0);
  assert.equal(connection.excludedMatchCount, 20);
  assert.deepEqual(connection.diagnostics.reasonCodes, ["SOURCE_STAGE_NOT_PUBLISHED"]);
  assert.deepEqual(connection.diagnostics.excludedStageNames, ["Товарищеские матчи"]);
  assert.equal(calls.length, 17);
  assert.ok(calls.every((call) => call.forceFresh));
  assert.deepEqual(calls.slice(0, 4), [
    { month: 7, page: 1, divisionId: null, forceFresh: true },
    { month: 7, page: 1, divisionId: "619", forceFresh: true },
    { month: 7, page: 2, divisionId: "619", forceFresh: true },
    { month: 7, page: 3, divisionId: "619", forceFresh: true },
  ]);
  assert.equal(delays.length, 16);
  assert.ok(delays.every((delay) => delay === 250));

  const snapshot = await adapter.fetchChampionship({
    championship: currentConfig,
    from: new Date("2026-07-01T00:00:00.000Z"),
    to: new Date("2026-09-30T20:59:59.999Z"),
    forceFresh: true,
    includeUndatedSourceMatches: false,
  });
  assert.equal(snapshot.matches.length, 0);
  assert.equal(snapshot.teams.length, 14);
  assert.deepEqual(snapshot.diagnostics?.reasonCodes, ["SOURCE_STAGE_NOT_PUBLISHED"]);
  assert.equal(snapshot.diagnostics?.excludedMatchCount, 20);
});

test("hockey.by adapter discovers new competitive divisions and requests only months in the run period", async () => {
  const calls: Array<{ month: number; divisionId: string | null }> = [];
  const discovery = payload();
  discovery.data.DIVISIONS = [
    { ID: "619", UF_NAME: "Товарищеские матчи", selected: true },
    { ID: "620", UF_NAME: "1 этап", selected: false },
  ];
  const adapter = createHockeyByAdapter({
    fetchPage: async (request) => {
      calls.push({ month: request.month, divisionId: request.divisionId });
      if (request.divisionId === null) return discovery;
      if (request.page > 1) {
        return payload({
          divisionId: request.divisionId,
          divisionName: request.divisionId === "619" ? "Товарищеские матчи" : "1 этап",
          html: "Матчей не найдено",
        });
      }
      if (request.divisionId === "619") return payload({ html: firstAugustCard });
      return payload({ divisionId: "620", divisionName: "1 этап", html: firstAugustCard.replaceAll("437784", "537784") });
    },
    delay: async () => undefined,
    now: () => new Date("2026-08-01T00:00:00.000Z"),
  });

  const snapshot = await adapter.fetchChampionship({
    championship: currentConfig,
    from: new Date("2026-08-01T00:00:00.000Z"),
    to: new Date("2026-08-31T20:59:59.999Z"),
    forceFresh: true,
    includeUndatedSourceMatches: false,
  });
  assert.deepEqual(calls, [
    { month: 8, divisionId: null },
    { month: 8, divisionId: "619" },
    { month: 8, divisionId: "619" },
    { month: 8, divisionId: "620" },
    { month: 8, divisionId: "620" },
  ]);
  assert.equal(snapshot.matches.length, 1);
  assert.equal(snapshot.matches[0].id, "537784");
  assert.equal(snapshot.matches[0].stage, "1 этап");
  assert.deepEqual(snapshot.diagnostics, {
    reasonCodes: [],
    excludedStageNames: ["Товарищеские матчи"],
    excludedMatchCount: 1,
    eligibleMatchCount: 1,
  });
});

test("hockey.by makes independent fresh runs and never serves stale evidence after failure", async () => {
  let run = 0;
  const adapter = createHockeyByAdapter({
    fetchPage: async (request) => {
      if (run === 2) throw new Error("fresh source unavailable");
      return currentPage(request.month, request.page, request.divisionId);
    },
    delay: async () => undefined,
    now: () => new Date("2026-08-30T12:00:00.000Z"),
  });
  const input = {
    championship: currentConfig,
    from: new Date("2026-07-01T00:00:00.000Z"),
    to: new Date("2026-07-31T20:59:59.999Z"),
    forceFresh: true,
    includeUndatedSourceMatches: false,
  } as const;

  run = 1;
  await adapter.fetchChampionship(input);
  run = 2;
  await assert.rejects(adapter.fetchChampionship(input), /fresh source unavailable/);
});

test("hockey.by bounds a complete operation and propagates caller cancellation", async () => {
  const cancelled = new AbortController();
  cancelled.abort(new Error("client cancelled"));
  const cancelledAdapter = createHockeyByAdapter({
    fetchPage: async (request) => {
      if (!request.signal) throw new Error("operation signal missing");
      request.signal.throwIfAborted();
      return payload();
    },
    delay: async () => undefined,
  });
  await assert.rejects(
    cancelledAdapter.testConnection(currentConfig, { signal: cancelled.signal }),
    /client cancelled/,
  );

  const timeoutAdapter = createHockeyByAdapter({
    operationTimeoutMs: 5,
    fetchPage: async (request) => new Promise((_resolve, reject) => {
      if (!request.signal) {
        reject(new Error("operation signal missing"));
        return;
      }
      request.signal.addEventListener("abort", () => reject(request.signal?.reason), { once: true });
    }),
    delay: async () => undefined,
  });
  await assert.rejects(timeoutAdapter.testConnection(currentConfig), /timeout|aborted/i);
});

test("hockey.by resolver rejects unsafe or drifting source identities before network access", async () => {
  assert.deepEqual(resolveHockeyByCalendarUrl(currentConfig.sourceUrl), {
    sourceUrl: "https://hockey.by/calendar/",
    seasonId: "11",
    leagueId: "5",
    seasonStartYear: 2026,
  });
  for (const sourceUrl of [
    "http://hockey.by/calendar/",
    "https://hockey.by:444/calendar/",
    "https://user:pass@hockey.by/calendar/",
    "https://hockey.by/calendar",
    "https://hockey.by/calendar/?season=11",
    "https://hockey.by/calendar/#games",
    "https://www.hockey.by/calendar/",
    "https://example.com/calendar/",
  ]) {
    assert.throws(() => resolveHockeyByCalendarUrl(sourceUrl), /hockey\.by calendar URL/i);
  }

  let called = false;
  const adapter = createHockeyByAdapter({ fetchPage: async () => { called = true; return payload(); } });
  await assert.rejects(adapter.testConnection({ ...currentConfig, externalId: "11:1" }), /11:5/);
  assert.equal(called, false);
  assert.throws(
    () => parseHockeyByCalendarResponse(payload({ seasonId: "10", seasonName: "2025-2026" }), {
      championship: currentConfig,
      divisionId: "619",
      divisionName: "Товарищеские матчи",
      month: 7,
      page: 1,
      seasonStartYear: 2026,
      now: new Date(),
    }),
    /season identity/i,
  );
  assert.throws(
    () => parseHockeyByCalendarResponse(payload({ leagueName: "Кубок" }), {
      championship: currentConfig,
      divisionId: "619",
      divisionName: "Товарищеские матчи",
      month: 7,
      page: 1,
      seasonStartYear: 2026,
      now: new Date(),
    }),
    /league identity/i,
  );

  const multipleSeasons = payload({ html: julyPageOne });
  multipleSeasons.data.SEASONS.push({ ID: "10", UF_NAME: "2025-2026", selected: true });
  assert.throws(
    () => parseHockeyByCalendarResponse(multipleSeasons, {
      championship: currentConfig,
      divisionId: "619",
      divisionName: "Товарищеские матчи",
      month: 7,
      page: 1,
      seasonStartYear: 2026,
      now: new Date(),
    }),
    /season identity/i,
  );

  const multipleLeagues = payload({ html: julyPageOne });
  multipleLeagues.data.LEAGUES.push({ ID: "4", UF_NAME: "Betera-Экстралига", selected: true });
  assert.throws(
    () => parseHockeyByCalendarResponse(multipleLeagues, {
      championship: currentConfig,
      divisionId: "619",
      divisionName: "Товарищеские матчи",
      month: 7,
      page: 1,
      seasonStartYear: 2026,
      now: new Date(),
    }),
    /league identity/i,
  );

  const multipleDivisions = payload({ html: julyPageOne });
  multipleDivisions.data.DIVISIONS.push({ ID: "620", UF_NAME: "1 этап", selected: true });
  assert.throws(
    () => parseHockeyByCalendarResponse(multipleDivisions, {
      championship: currentConfig,
      divisionId: "619",
      divisionName: "Товарищеские матчи",
      month: 7,
      page: 1,
      seasonStartYear: 2026,
      now: new Date(),
    }),
    /division identity/i,
  );
});

test("hockey.by parser fails closed on malformed cards, unsafe evidence links, and conflicting duplicates", async () => {
  const context = {
    championship: currentConfig,
    divisionId: "619",
    divisionName: "Товарищеские матчи",
    month: 7,
    page: 1,
    seasonStartYear: 2026,
    now: new Date("2026-08-30T12:00:00.000Z"),
  } as const;
  assert.throws(
    () => parseHockeyByCalendarResponse(payload({ html: julyPageOne.replace('/new-admin/clubs/13/', '/clubs/13/') }), context),
    /official team ID/i,
  );
  assert.throws(
    () => parseHockeyByCalendarResponse(payload({ html: julyPageOne.replace('/gamecenter/436187/', 'https://example.com/gamecenter/436187/') }), context),
    /invalid gamecenter URL/i,
  );
  assert.throws(
    () => parseHockeyByCalendarResponse({ status: "success", data: {} }, context),
    /response structure/i,
  );
  const missingGamesFields = payload();
  delete (missingGamesFields.data as Partial<typeof missingGamesFields.data>).FUTURE_GAMES;
  delete (missingGamesFields.data as Partial<typeof missingGamesFields.data>).CURRENT_GAMES;
  assert.throws(
    () => parseHockeyByCalendarResponse(missingGamesFields, context),
    /response structure/i,
  );

  const duplicateAdapter = createHockeyByAdapter({
    fetchPage: async (request) => request.divisionId === null
      ? payload()
      : payload({
        html: firstCurrentCard,
        nav: `<a class="pgn-next" data-page="${request.page + 1}"></a>`,
      }),
    delay: async () => undefined,
    now: () => new Date("2026-08-30T12:00:00.000Z"),
  });
  const deduplicated = await duplicateAdapter.fetchChampionship({
    championship: currentConfig,
    from: new Date("2026-07-01T00:00:00.000Z"),
    to: new Date("2026-07-31T20:59:59.999Z"),
    forceFresh: true,
    includeUndatedSourceMatches: false,
  });
  assert.equal(deduplicated.diagnostics?.excludedMatchCount, 1);

  const conflictingAdapter = createHockeyByAdapter({
    fetchPage: async (request) => request.divisionId === null
      ? payload()
      : payload({
        html: request.page === 1 ? firstCurrentCard : firstCurrentCard.replace("Зубры", "Другая команда"),
        nav: request.page === 1 ? '<a class="pgn-next" data-page="2"></a>' : "",
      }),
    delay: async () => undefined,
    now: () => new Date("2026-08-30T12:00:00.000Z"),
  });
  await assert.rejects(
    conflictingAdapter.fetchChampionship({
      championship: currentConfig,
      from: new Date("2026-07-01T00:00:00.000Z"),
      to: new Date("2026-07-31T20:59:59.999Z"),
      forceFresh: true,
      includeUndatedSourceMatches: false,
    }),
    /conflicting duplicate/i,
  );
});

test("hockey.by adapter enforces month, page, and card limits", async () => {
  const adapter = createHockeyByAdapter({ fetchPage: async () => payload(), delay: async () => undefined });
  await assert.rejects(
    adapter.fetchChampionship({
      championship: currentConfig,
      from: new Date("2026-01-01T00:00:00.000Z"),
      to: new Date("2027-02-01T00:00:00.000Z"),
      forceFresh: true,
      includeUndatedSourceMatches: false,
    }),
    /12 months/i,
  );

  let pageCalls = 0;
  const endless = createHockeyByAdapter({
    fetchPage: async (request) => {
      pageCalls += 1;
      if (request.divisionId === null) return payload();
      const html = firstCurrentCard.replaceAll("436187", String(900000 + request.page));
      return payload({
        html,
        nav: `<a class="pgn-next" data-page="${request.page + 1}"></a>`,
      });
    },
    delay: async () => undefined,
    now: () => new Date("2026-08-30T12:00:00.000Z"),
  });
  await assert.rejects(
    endless.fetchChampionship({
      championship: currentConfig,
      from: new Date("2026-07-01T00:00:00.000Z"),
      to: new Date("2026-07-31T20:59:59.999Z"),
      forceFresh: true,
      includeUndatedSourceMatches: false,
    }),
    /50 page/i,
  );
  assert.equal(pageCalls, 50);

  const oversizedCards = Array.from({ length: 601 }, (_value, index) => (
    firstCurrentCard.replaceAll("436187", String(700000 + index))
  )).join("");
  const tooManyCards = createHockeyByAdapter({
    fetchPage: async (request) => request.divisionId === null ? payload() : payload({ html: oversizedCards }),
    delay: async () => undefined,
    now: () => new Date("2026-08-30T12:00:00.000Z"),
  });
  await assert.rejects(
    tooManyCards.fetchChampionship({
      championship: currentConfig,
      from: new Date("2026-07-01T00:00:00.000Z"),
      to: new Date("2026-07-31T20:59:59.999Z"),
      forceFresh: true,
      includeUndatedSourceMatches: false,
    }),
    /600 match/i,
  );

  const repeatedCards = Array.from({ length: 601 }, () => firstCurrentCard).join("");
  const repeatedCardFlood = createHockeyByAdapter({
    fetchPage: async (request) => request.divisionId === null ? payload() : payload({ html: repeatedCards }),
    delay: async () => undefined,
    now: () => new Date("2026-08-30T12:00:00.000Z"),
  });
  await assert.rejects(
    repeatedCardFlood.fetchChampionship({
      championship: currentConfig,
      from: new Date("2026-07-01T00:00:00.000Z"),
      to: new Date("2026-07-31T20:59:59.999Z"),
      forceFresh: true,
      includeUndatedSourceMatches: false,
    }),
    /600 match/i,
  );
});

test("hockey.by request uses only the fixed fresh POST endpoint and fixed form fields", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const result = await requestHockeyByCalendarPage({
    seasonId: "11",
    leagueId: "5",
    divisionId: "619",
    month: 9,
    page: 2,
    forceFresh: true,
  }, async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(JSON.stringify(payload()), { headers: { "content-type": "application/json; charset=UTF-8" } });
  });
  assert.equal((result as { status: string }).status, "success");
  assert.equal(capturedUrl, HOCKEY_BY_ENDPOINT);
  assert.equal(capturedInit?.method, "POST");
  assert.equal(capturedInit?.cache, "no-store");
  assert.equal(capturedInit?.redirect, "error");
  const form = new URLSearchParams(String(capturedInit?.body));
  assert.deepEqual(Array.from(form.entries()), [
    ["arFilter[0][name]", "SEASON"],
    ["arFilter[0][value]", "11"],
    ["arFilter[1][name]", "LEAGUE"],
    ["arFilter[1][value]", "5"],
    ["arFilter[2][name]", "DIVISION"],
    ["arFilter[2][value]", "619"],
    ["arFilter[3][name]", "TEAM"],
    ["arFilter[3][value]", "all"],
    ["arFilter[4][name]", "MONTH"],
    ["arFilter[4][value]", "9"],
    ["status", "all"],
    ["place", "all"],
    ["view", "list"],
    ["page", "2"],
    ["month", "9"],
  ]);

  for (const status of [403, 429]) {
    await assert.rejects(
      requestHockeyByCalendarPage({
        seasonId: "11",
        leagueId: "5",
        divisionId: null,
        month: 7,
        page: 1,
        forceFresh: true,
      }, async () => new Response("denied", { status, headers: { "content-type": "text/plain" } })),
      new RegExp(`HTTP ${status}`),
    );
  }
});

test("hockey.by JSON reader enforces content type, JSON validity, and streaming size cap", async () => {
  await assert.rejects(
    readHockeyByJsonResponse(new Response("<html></html>", { headers: { "content-type": "text/html" } })),
    /JSON response/i,
  );
  await assert.rejects(
    readHockeyByJsonResponse(new Response("not-json", { headers: { "content-type": "application/json" } })),
    /valid JSON/i,
  );
  const chunk = new Uint8Array(1024 * 1024);
  const oversized = new Response(new ReadableStream({
    start(controller) {
      for (let index = 0; index < 6; index += 1) controller.enqueue(chunk);
      controller.close();
    },
  }), { headers: { "content-type": "application/json" } });
  await assert.rejects(readHockeyByJsonResponse(oversized), /size limit/i);
});
