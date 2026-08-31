import test from "node:test";
import assert from "node:assert/strict";
import {
  clearVolleyballWorldScheduleCache,
  fetchVolleyballWorldBeachSchedule,
  VolleyballWorldRequestError,
} from "../backend/src/sources/tbvolley/VolleyballWorld";
import { GET as getVolleyballWorldMatches } from "../frontend/src/app/api/tbvolley/volleyballworld/matches/route";
import { GET as getVolleyballWorldTournaments } from "../frontend/src/app/api/tbvolley/volleyballworld/tournaments/route";
import { shouldReplaceVolleyballWorldMatchesOnImport } from "../backend/src/sources/tbvolley/VolleyballWorld/importTournament";

const originalFetch = globalThis.fetch;
const originalTimeout = process.env.VOLLEYBALL_WORLD_TIMEOUT_MS;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalTimeout === undefined) {
    delete process.env.VOLLEYBALL_WORLD_TIMEOUT_MS;
  } else {
    process.env.VOLLEYBALL_WORLD_TIMEOUT_MS = originalTimeout;
  }
  clearVolleyballWorldScheduleCache();
});

test("Volleyball World import never replaces persisted data with an unexplained empty snapshot", () => {
  assert.equal(shouldReplaceVolleyballWorldMatchesOnImport({ incomingMatches: 0, sourceValidated: true, force: true }), false);
  assert.equal(shouldReplaceVolleyballWorldMatchesOnImport({ incomingMatches: 2, sourceValidated: true }), true);
  assert.equal(shouldReplaceVolleyballWorldMatchesOnImport({ incomingMatches: 2, sourceValidated: false, force: true }), false);
});

test("Volleyball World shares one browser-compatible upstream request across genders and caches it", async () => {
  let calls = 0;
  let observedHeaders: Headers | null = null;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    observedHeaders = new Headers(init?.headers);
    return jsonResponse(validPayload());
  };

  const [men, women] = await Promise.all([
    fetchVolleyballWorldBeachSchedule({ gender: "men", fromDate: "2091-01-01", days: 7 }),
    fetchVolleyballWorldBeachSchedule({ gender: "women", fromDate: "2091-01-01", days: 7 }),
  ]);
  const cached = await fetchVolleyballWorldBeachSchedule({ gender: "men", fromDate: "2091-01-01", days: 7 });

  assert.equal(calls, 1);
  assert.match((observedHeaders as Headers | null)?.get("user-agent") || "", /^Mozilla\/5\.0/);
  assert.equal((observedHeaders as Headers | null)?.get("referer"), "https://en.volleyballworld.com/global-schedule");
  assert.equal(men.summary.total, 1);
  assert.equal(women.summary.total, 1);
  assert.equal(cached.upstream.cacheStatus, "fresh");
});

test("Volleyball World bounds concurrent unique upstream requests", async () => {
  const releases: Array<() => void> = [];
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    await new Promise<void>((resolve) => releases.push(resolve));
    return jsonResponse(validPayload());
  };

  const pending = ["2091-06-01", "2091-06-02", "2091-06-03"].map((fromDate) => (
    fetchVolleyballWorldBeachSchedule({ fromDate, days: 1 })
  ));
  while (calls < 3) await Promise.resolve();

  await assert.rejects(
    fetchVolleyballWorldBeachSchedule({ fromDate: "2091-06-04", days: 1 }),
    (error: unknown) => error instanceof VolleyballWorldRequestError
      && error.code === "request_limit"
      && error.statusCode === 429,
  );
  releases.forEach((release) => release());
  await Promise.all(pending);
  assert.equal(calls, 3);
});

test("Volleyball World success cache is LRU-bounded", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse(validPayload());
  };

  const dates = Array.from({ length: 17 }, (_, index) => `2091-07-${String(index + 1).padStart(2, "0")}`);
  for (const fromDate of dates) {
    await fetchVolleyballWorldBeachSchedule({ fromDate, days: 1 });
  }
  await fetchVolleyballWorldBeachSchedule({ fromDate: dates[0], days: 1 });
  const callsAfterEvictedReload = calls;
  await fetchVolleyballWorldBeachSchedule({ fromDate: dates.at(-1), days: 1 });

  assert.equal(callsAfterEvictedReload, 18);
  assert.equal(calls, callsAfterEvictedReload);
});

test("Volleyball World limits new unique upstream keys per minute", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse(validPayload());
  };

  for (let day = 1; day <= 20; day += 1) {
    await fetchVolleyballWorldBeachSchedule({ fromDate: `2091-08-${String(day).padStart(2, "0")}`, days: 1 });
  }
  await assert.rejects(
    fetchVolleyballWorldBeachSchedule({ fromDate: "2091-08-21", days: 1 }),
    (error: unknown) => error instanceof VolleyballWorldRequestError && error.code === "request_limit",
  );
  assert.equal(calls, 20);
});

test("Volleyball World all-genders endpoint performs one shared upstream request", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse(validPayload());
  };

  const response = await getVolleyballWorldTournaments(new Request(
    "http://localhost/api/tbvolley/volleyballworld/tournaments?gender=all&fromDate=2091-01-01&days=7",
  ));
  const payload = await response.json() as {
    ok: boolean;
    gender: string;
    tournaments: Array<{ gender: string }>;
  };

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.gender, "all");
  assert.deepEqual(new Set(payload.tournaments.map((tournament) => tournament.gender)), new Set(["men", "women"]));
  assert.equal(calls, 1);
});

test("Volleyball World retries one timeout or retryable HTTP response", async () => {
  let apiCalls = 0;
  let warmupCalls = 0;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/global-schedule")) {
      warmupCalls += 1;
      return new Response("<html>schedule</html>", { status: 200, headers: { "Content-Type": "text/html" } });
    }
    apiCalls += 1;
    if (apiCalls === 1) return new Response("busy", { status: 503 });
    return jsonResponse(validPayload());
  };

  const schedule = await fetchVolleyballWorldBeachSchedule({
    gender: "men",
    fromDate: "2091-02-01",
    days: 7,
  });

  assert.equal(apiCalls, 2);
  assert.equal(warmupCalls, 1);
  assert.equal(schedule.summary.total, 1);
  assert.equal(schedule.upstream.cacheStatus, "miss");
});

test("Volleyball World forceFresh bypasses a valid success-cache entry", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse(validPayload());
  };

  await fetchVolleyballWorldBeachSchedule({ gender: "men", fromDate: "2091-02-10", days: 7 });
  const refreshed = await fetchVolleyballWorldBeachSchedule({
    gender: "women",
    fromDate: "2091-02-10",
    days: 7,
    forceFresh: true,
  });

  assert.equal(calls, 2);
  assert.equal(refreshed.upstream.cacheStatus, "miss");
});

test("Volleyball World serves a marked stale-positive value when refresh fails", async () => {
  const originalNow = Date.now;
  let now = Date.UTC(2091, 2, 1);
  let calls = 0;
  Date.now = () => now;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/global-schedule")) {
      calls += 1;
      return new Response("<html>schedule</html>", { status: 200, headers: { "Content-Type": "text/html" } });
    }
    calls += 1;
    if (calls === 1) return jsonResponse(validPayload());
    return new Response("temporarily unavailable", { status: 503 });
  };

  try {
    const initial = await fetchVolleyballWorldBeachSchedule({ gender: "men", fromDate: "2091-03-01", days: 7 });
    now += 5 * 60_000 + 1;
    const fallback = await fetchVolleyballWorldBeachSchedule({ gender: "women", fromDate: "2091-03-01", days: 7 });

    assert.equal(initial.upstream.cacheStatus, "miss");
    assert.equal(fallback.upstream.cacheStatus, "stale");
    assert.equal(fallback.summary.total, 1);
    assert.equal(calls, 4);
  } finally {
    Date.now = originalNow;
  }
});

test("Volleyball World does not cache invalid empty payloads", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse({ matches: [], allTeams: [], allTournaments: [] });
  };

  await assert.rejects(
    fetchVolleyballWorldBeachSchedule({ gender: "men", fromDate: "2091-04-01", days: 7 }),
    (error: unknown) => error instanceof VolleyballWorldRequestError && error.code === "invalid_payload",
  );
  await assert.rejects(
    fetchVolleyballWorldBeachSchedule({ gender: "women", fromDate: "2091-04-01", days: 7 }),
    (error: unknown) => error instanceof VolleyballWorldRequestError && error.code === "invalid_payload",
  );

  assert.equal(calls, 2);
});

test("Volleyball World rejects an unconfirmed empty match array even when lookup arrays are populated", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse({
      matches: [],
      allTeams: [{ no: 1, name: "Old Team" }],
      allTournaments: [{ no: 99, name: "Historical Tournament" }],
    });
  };

  await assert.rejects(
    fetchVolleyballWorldBeachSchedule({ gender: "men", fromDate: "2091-04-15", days: 7 }),
    (error: unknown) => error instanceof VolleyballWorldRequestError && error.code === "unconfirmed_empty",
  );
  await assert.rejects(
    fetchVolleyballWorldBeachSchedule({ gender: "women", fromDate: "2091-04-15", days: 7 }),
    (error: unknown) => error instanceof VolleyballWorldRequestError && error.code === "unconfirmed_empty",
  );

  assert.equal(calls, 2);
});

test("Volleyball World timeout is typed and the API maps it to HTTP 504", async () => {
  process.env.VOLLEYBALL_WORLD_TIMEOUT_MS = "5";
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls += 1;
    if (String(input).endsWith("/global-schedule")) {
      return new Response("<html>schedule</html>", { status: 200, headers: { "Content-Type": "text/html" } });
    }
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
  };
  const originalConsoleError = console.error;
  console.error = () => undefined;

  try {
    const response = await getVolleyballWorldMatches(new Request(
      "http://localhost/api/tbvolley/volleyballworld/matches?gender=men&fromDate=2091-05-01&days=7",
    ));
    const body = await response.json() as { ok: boolean; errorCode?: string };

    assert.equal(response.status, 504);
    assert.equal(body.ok, false);
    assert.equal(body.errorCode, "upstream_timeout");
    assert.equal(calls, 3);
  } finally {
    console.error = originalConsoleError;
  }
});

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function validPayload() {
  return {
    allTeams: [
      { no: 1, code: "USA", country: "United States", name: "Alpha/Beta" },
      { no: 2, code: "BRA", country: "Brazil", name: "Gamma/Delta" },
      { no: 3, code: "ITA", country: "Italy", name: "Echo/Foxtrot" },
      { no: 4, code: "GER", country: "Germany", name: "Golf/Hotel" },
    ],
    allTournaments: [
      { no: 901, name: "Future Test", discipline: "beach", gender: "Men" },
      { no: 902, name: "Future Test", discipline: "beach", gender: "Women" },
    ],
    matches: [
      {
        matchNo: 1001,
        tournamentNo: 901,
        competitionSlug: "future-test-men",
        competitionShortName: "Future Test",
        discipline: "beach",
        gender: "Men",
        matchDateUtc: "2091-01-03T08:00:00",
        matchStatus: 0,
        teamANo: 1,
        teamBNo: 2,
      },
      {
        matchNo: 1002,
        tournamentNo: 902,
        competitionSlug: "future-test-women",
        competitionShortName: "Future Test",
        discipline: "beach",
        gender: "Women",
        matchDateUtc: "2091-01-03T10:00:00",
        matchStatus: 0,
        teamANo: 3,
        teamBNo: 4,
      },
    ],
  };
}
