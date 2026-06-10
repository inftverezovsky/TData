import assert from "node:assert/strict";
import test from "node:test";
import { formatMoscowDateTime } from "../src/lib/matches/scheduleOffset";
import {
  fetchWttSchedule,
  inferWttCategoryScope,
  normalizeWttSchedule,
  normalizeWttTournamentEvents,
  parseWttLocalDateTime,
  searchWttTournaments,
  summarizeWttMatchCategories,
} from "../src/lib/sources/tablet/WTT";

test("WTT event normalization excludes Youth and U-age tournaments", () => {
  const tournaments = normalizeWttTournamentEvents([
    {
      eventId: 3240,
      eventName: "WTT Contender Zagreb 2026",
      startDateTime: "2026-06-10T00:00:00",
      endDateTime: "2026-06-15T00:00:00",
      city: "Zagreb",
      countryName: "Croatia",
      timeZoneId: 49,
      tournamentCategoryId: 34,
      subEvents: JSON.stringify([{ subEventName: "Men's Singles", numberOfTotalMatches: 16 }]),
    },
    {
      eventId: 3312,
      eventName: "WTT Youth Contender Test",
      startDateTime: "2026-06-10T00:00:00",
      endDateTime: "2026-06-15T00:00:00",
      timeZoneId: 49,
      tournamentCategoryId: 69,
    },
    {
      eventId: 3313,
      eventName: "ITTF U19 Test",
      startDateTime: "2026-06-10T00:00:00",
      endDateTime: "2026-06-15T00:00:00",
      timeZoneId: 49,
      tournamentCategoryId: 34,
    },
  ]);

  assert.deepEqual(tournaments.map((event) => event.eventId), ["3240"]);
  assert.equal(tournaments[0].title, "WTT Contender Zagreb 2026");
  assert.equal(tournaments[0].location, "Zagreb, Croatia");
  assert.equal(tournaments[0].matchCount, 16);
});

test("WTT search range excludes undated legacy rows", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([
    {
      eventId: 3240,
      eventName: "WTT Contender Zagreb 2026",
      startDateTime: "2026-06-10T00:00:00",
      endDateTime: "2026-06-15T00:00:00",
      timeZoneId: 58,
      tournamentCategoryId: 34,
    },
    {
      eventId: 2000,
      eventName: "Tokyo 2020 Olympic Games",
      timeZoneId: 91,
    },
  ]), { status: 200, headers: { "content-type": "application/json" } });

  try {
    const { searchWttTournaments } = await import("../src/lib/sources/tablet/WTT");
    const search = await searchWttTournaments({ fromDate: "2026-06-10", days: 14 });

    assert.deepEqual(search.tournaments.map((event) => event.eventId), ["3240"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WTT schedule fetch merges filtered current day and full future days", async () => {
  const originalFetch = globalThis.fetch;
  const fetchedUrls: string[] = [];
  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    fetchedUrls.push(requestUrl);

    if (requestUrl.includes("schedule_filtered.json")) {
      return new Response(JSON.stringify([
        {
          Competition: {
            Unit: [
              {
                Code: "D10",
                StartDate: "2026-06-10T10:00:00",
                ScheduleStatus: "Scheduled",
                SubEvent: "Men's Singles",
                Round: "R32",
                VenueDescription: { LocationName: "Table 1" },
              },
            ],
          },
        },
      ]), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (requestUrl.includes("schedule.json")) {
      return new Response(JSON.stringify([
        {
          Competition: {
            Unit: [
              {
                Code: "D11",
                StartDate: "2026-06-11T10:00:00",
                ScheduleStatus: "Scheduled",
                SubEvent: "Men's Singles",
                Round: "R16",
                VenueDescription: { LocationName: "Table 2" },
              },
            ],
          },
        },
      ]), { status: 200, headers: { "content-type": "application/json" } });
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const payload = await fetchWttSchedule(3240);
    const schedule = normalizeWttSchedule(payload, { eventId: 3240, timeZoneId: 49 });

    assert.deepEqual(schedule.matches.map((match) => match.code), ["D10", "D11"]);
    assert.deepEqual(schedule.matches.map((match) => match.dateKey), ["2026-06-10", "2026-06-11"]);
    assert.ok(fetchedUrls.some((url) => url.includes("schedule_filtered.json")));
    assert.ok(fetchedUrls.some((url) => url.includes("schedule.json")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WTT tournament search uses API fallback for future schedule days", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const requestUrl = String(url);

    if (requestUrl.includes("wtt_upcoming_only_events_list.json")) {
      return new Response(JSON.stringify([
        {
          eventId: 9999,
          eventName: "WTT Contender Test 2099",
          startDateTime: "2099-06-10T00:00:00",
          endDateTime: "2099-06-12T00:00:00",
          city: "Zagreb",
          countryName: "Croatia",
          timeZoneId: 49,
          tournamentCategoryId: 34,
        },
      ]), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (requestUrl.includes("schedule_filtered.json") || requestUrl.includes("schedule.json")) {
      return new Response(JSON.stringify([
        {
          Competition: {
            Unit: [
              {
                Code: "D10",
                StartDate: "2099-06-10T10:00:00",
                ScheduleStatus: "Scheduled",
                SubEvent: "Men's Singles",
                Round: "R32",
                VenueDescription: { LocationName: "Table 1" },
              },
            ],
          },
        },
      ]), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (requestUrl.includes("GetEventSchedule/9999")) {
      return new Response(JSON.stringify([
        {
          Competition: {
            Unit: [
              {
                Code: "D11",
                StartDate: "2099-06-11T10:00:00",
                ScheduleStatus: "Scheduled",
                SubEvent: "Women's Singles",
                Round: "R16",
                VenueDescription: { LocationName: "Table 2" },
              },
            ],
          },
        },
      ]), { status: 200, headers: { "content-type": "application/json" } });
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const search = await searchWttTournaments({ fromDate: "2099-06-10", days: 7 });
    const tournament = search.tournaments[0];

    assert.equal(tournament.eventId, "9999");
    assert.equal(tournament.matchCount, 2);
    assert.deepEqual(tournament.categories.map((category) => [category.scope, category.matchCount]), [
      ["men", 1],
      ["women", 1],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WTT schedule normalization extracts teams, stage, court and placeholders", () => {
  const schedule = normalizeWttSchedule(
    [
      {
        Competition: {
          Unit: [
            {
              Code: "U001",
              StartDate: "2026-06-10T18:20:00",
              ScheduleStatus: "Scheduled",
              SubEvent: "Men's Singles",
              Round: "R32",
              Draw: "Main Draw",
              ItemDescription: [{ Language: "ENG", Value: "Round of 32" }],
              VenueDescription: { LocationName: "Table 1", VenueName: "Arena Zagreb" },
              StartList: {
                Start: [
                  {
                    SortOrder: 2,
                    Competitor: {
                      Code: "B",
                      Organization: "JPN",
                      Seed: 7,
                      Description: { TeamName: "Harimoto Tomokazu", IfId: "123" },
                    },
                  },
                  {
                    SortOrder: 1,
                    Competitor: {
                      Code: "A",
                      Organization: "SWE",
                      Seed: 1,
                      Description: { TeamName: "Truls Moregard", IfId: "456" },
                    },
                  },
                ],
              },
            },
            {
              Code: "U002",
              StartDate: "2026-06-10T19:00:00",
              ScheduleStatus: "Scheduled",
              SubEvent: "Women's Singles",
              Round: "R16",
              VenueDescription: { LocationName: "Table 2" },
              StartList: { Start: [{ SortOrder: 1, Competitor: { Code: "TBD" } }] },
            },
            {
              Code: "U003",
              StartDate: "2026-06-10T20:00:00",
              ScheduleStatus: "Official",
              Result: { home: 3, away: 1 },
              SubEvent: "Men's Singles",
              StartList: {
                Start: [
                  { SortOrder: 1, Competitor: { Description: { TeamName: "Winner" } } },
                  { SortOrder: 2, Competitor: { Description: { TeamName: "Loser" } } },
                ],
              },
            },
          ],
        },
      },
    ],
    { eventId: 3240, timeZoneId: 49 },
  );

  assert.equal(schedule.matches.length, 3);
  assert.equal(schedule.matches[0].id, "wtt-3240-U001");
  assert.equal(schedule.matches[0].teamA.name, "Truls Moregard");
  assert.equal(schedule.matches[0].teamB.name, "Harimoto Tomokazu");
  assert.equal(schedule.matches[0].categoryScope, "men");
  assert.equal(schedule.matches[0].round, "Round of 32");
  assert.equal(schedule.matches[0].stage, "Men's Singles · Main Draw R32");
  assert.equal(schedule.matches[0].court, "Table 1");
  assert.equal(schedule.matches[1].teamA.name, "TBD");
  assert.equal(schedule.matches[1].teamB.name, "TBD");
  assert.equal(schedule.matches[1].categoryScope, "women");
  assert.equal(schedule.matches[2].status, "finished");
  assert.equal(schedule.summary.upcoming, 2);
  assert.equal(schedule.summary.finished, 1);
});

test("WTT scheduled rows stay upcoming even when actual timestamps are present", () => {
  const schedule = normalizeWttSchedule(
    [
      {
        Competition: {
          Unit: [
            {
              Code: "FUTURE001",
              StartDate: "2026-06-11T11:00:00",
              ScheduleStatus: "Scheduled",
              ActualStartDate: "2026-06-11T16:45:00",
              ActualEndDate: "2026-06-11T17:20:00",
              SubEvent: "Mixed Doubles",
              Round: "8FNL",
              Draw: "MAIN",
              VenueDescription: { LocationName: "Table 1", VenueName: "Arena Zagreb" },
              StartList: {
                Start: [
                  { SortOrder: 1, Competitor: { Description: { TeamName: "Alpha/Beta" } } },
                  { SortOrder: 2, Competitor: { Description: { TeamName: "Gamma/Delta" } } },
                ],
              },
            },
          ],
        },
      },
    ],
    { eventId: 3240, timeZoneId: 49 },
  );

  assert.equal(schedule.matches[0].status, "upcoming");
  assert.equal(schedule.matches[0].dateKey, "2026-06-11");
  assert.equal(schedule.summary.upcoming, 1);
  assert.equal(schedule.summary.finished, 0);
});

test("WTT local tournament time converts to Moscow time", () => {
  const date = parseWttLocalDateTime("2026-06-10T18:20:00", 49);

  assert.ok(date);
  assert.equal(date.toISOString(), "2026-06-10T16:20:00.000Z");
  assert.equal(formatMoscowDateTime(date), "10.06.2026 19:20:00");
});

test("WTT schedule fails on unknown time zone id", () => {
  assert.throws(
    () => normalizeWttSchedule([{ Competition: { Unit: [] } }], { eventId: 3240, timeZoneId: "9999" }),
    /Неизвестный часовой пояс WTT/,
  );
});

test("WTT category normalization splits singles, doubles and mixed", () => {
  assert.equal(inferWttCategoryScope("MSINGLES"), "men");
  assert.equal(inferWttCategoryScope("Women's Singles"), "women");
  assert.equal(inferWttCategoryScope("MDOUBLES"), "men-doubles");
  assert.equal(inferWttCategoryScope("Women's Doubles"), "women-doubles");
  assert.equal(inferWttCategoryScope("XDOUBLES"), "mixed");

  const categories = summarizeWttMatchCategories([
    {
      categoryScope: "men",
      subEvent: "Men's Singles",
      eventCategory: "",
      startTimeUtc: "2026-06-10T08:00:00.000Z",
      startTimeMoscow: "10.06.2026 11:00:00",
    },
    {
      categoryScope: "men-doubles",
      subEvent: "Men's Doubles",
      eventCategory: "",
      startTimeUtc: "2026-06-10T09:00:00.000Z",
      startTimeMoscow: "10.06.2026 12:00:00",
    },
    {
      categoryScope: "mixed",
      subEvent: "Mixed Doubles",
      eventCategory: "",
      startTimeUtc: "2026-06-10T07:00:00.000Z",
      startTimeMoscow: "10.06.2026 10:00:00",
    },
  ]);

  assert.deepEqual(categories.map((category) => category.scope), ["men", "men-doubles", "mixed"]);
  assert.deepEqual(categories.map((category) => category.label), ["Мужчины", "Муж. пары", "Микст"]);
});
