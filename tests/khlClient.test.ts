import assert from "node:assert/strict";
import test from "node:test";

import {
  KhlApiClient,
  KhlApiError,
  parseKhlScheduleResponse,
  parseKhlStagesResponse,
} from "../backend/src/sources/results/khl/client";

function scheduleEvent(id: number) {
  return {
    event: {
      id,
      khl_id: 900000 + id,
      match_id: String(900000 + id),
      stage_id: 407,
      outer_stage_id: 1436,
      stage_name: "Регулярный чемпионат 2026/2027",
      name: "Локомотив - Трактор",
      start_at: 1788602400000 + id,
      event_start_at: 1788601800000 + id,
      game_state_key: "not_yet_started",
      score: "0:0",
      scores: {
        first_period: null,
        second_period: null,
        third_period: null,
        overtime: null,
        bullitt: null,
      },
      team_a: { id: 26, khl_id: 1, name: "Локомотив", location: "Ярославль" },
      team_b: { id: 28, khl_id: 25, name: "Трактор", location: "Челябинск" },
    },
  };
}

function scheduleEventAt(id: number, startsAt: number) {
  const wrapper = scheduleEvent(id);
  wrapper.event.start_at = startsAt;
  wrapper.event.event_start_at = startsAt;
  return wrapper;
}

test("parses KHL stages and preserves API and web identity namespaces", () => {
  const stages = parseKhlStagesResponse({
    current_stage_id: 407,
    stages_v2: [
      {
        id: 407,
        khl_id: 1436,
        title: "Регулярный чемпионат",
        type: "regular",
        season: "2026/2027",
      },
    ],
  });

  assert.deepEqual(stages, [
    {
      stageId: "407",
      khlStageId: "1436",
      title: "Регулярный чемпионат",
      type: "regular",
      season: "2026/2027",
      current: true,
    },
  ]);
});

test("unwraps KHL schedule events and normalizes millisecond timestamps", () => {
  const [event] = parseKhlScheduleResponse([scheduleEvent(51)]);

  assert.deepEqual(event, {
    apiEventId: "51",
    khlGameId: "900051",
    matchId: "900051",
    stageId: "407",
    khlStageId: "1436",
    stageName: "Регулярный чемпионат 2026/2027",
    name: "Локомотив - Трактор",
    startsAt: new Date(1788602400051).toISOString(),
    eventStartsAt: new Date(1788601800051).toISOString(),
    status: "scheduled",
    score: { home: 0, away: 0 },
    periodScores: {
      P1: null,
      P2: null,
      P3: null,
      OT: null,
      SO: null,
    },
    teams: {
      home: { apiTeamId: "26", khlTeamId: "1", name: "Локомотив", location: "Ярославль" },
      away: { apiTeamId: "28", khlTeamId: "25", name: "Трактор", location: "Челябинск" },
    },
  });
});

test("rejects schema drift instead of treating malformed responses as no matches", () => {
  assert.throws(
    () => parseKhlScheduleResponse({ events: [] }),
    /schedule response must be an array/i
  );
  assert.throws(
    () => parseKhlScheduleResponse([{ id: 1 }]),
    /wrapper/i
  );
});

test("paginates bounded KHL schedule queries with unix seconds", async () => {
  const urls: string[] = [];
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    const page = new URL(url).searchParams.get("page");
    const payload = page === "1"
      ? Array.from({ length: 16 }, (_, index) => scheduleEvent(index + 1))
      : [scheduleEvent(17)];
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const client = new KhlApiClient({ fetchImpl: fakeFetch });

  const events = await client.listEvents({
    stageId: "407",
    from: new Date("2026-09-01T00:00:00.000Z"),
    to: new Date("2026-09-08T00:00:00.000Z"),
  });

  assert.equal(events.length, 17);
  assert.equal(urls.length, 2);
  for (const [index, value] of urls.entries()) {
    const url = new URL(value);
    assert.equal(url.origin + url.pathname, "https://khl.api.webcaster.pro/api/khl_mobile/events_v2.json");
    assert.equal(url.searchParams.get("stage_id"), "407");
    assert.equal(url.searchParams.get("q[start_at_gt_time_from_unixtime]"), "1788220799");
    assert.equal(url.searchParams.get("q[start_at_lt_time_from_unixtime]"), "1788825601");
    assert.equal(url.searchParams.get("order_direction"), "asc");
    assert.equal(url.searchParams.get("page"), String(index + 1));
  }
});

test("listEvents exposes an exact half-open interval over strict second API bounds", async () => {
  const from = new Date("2026-09-05T12:00:00.500Z");
  const to = new Date("2026-09-05T13:00:00.250Z");
  const requestedUrls: string[] = [];
  const atFrom = scheduleEventAt(102, from.getTime());
  const fakeFetch: typeof fetch = async (input) => {
    requestedUrls.push(String(input));
    return new Response(JSON.stringify([
      scheduleEventAt(101, from.getTime() - 1),
      atFrom,
      scheduleEventAt(103, to.getTime() - 1),
      scheduleEventAt(104, to.getTime()),
      scheduleEventAt(105, to.getTime() + 1),
      atFrom,
    ]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const client = new KhlApiClient({ fetchImpl: fakeFetch });

  const events = await client.listEvents({ stageId: "407", from, to });

  assert.deepEqual(events.map((event) => event.apiEventId), ["102", "103"]);
  assert.equal(requestedUrls.length, 1);
  const query = new URL(requestedUrls[0]);
  assert.equal(
    query.searchParams.get("q[start_at_gt_time_from_unixtime]"),
    String(Math.floor(from.getTime() / 1_000) - 1)
  );
  assert.equal(
    query.searchParams.get("q[start_at_lt_time_from_unixtime]"),
    String(Math.ceil(to.getTime() / 1_000) + 1)
  );
});

test("detail lookup preserves the exact raw response for audit ingestion", async () => {
  let requestedUrl = "";
  const rawBody = '{\n  "event": { "id": 2986031 }\n}\n';
  const fakeFetch: typeof fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(rawBody, {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  };
  const client = new KhlApiClient({ fetchImpl: fakeFetch });

  const detail = await client.getEventDetail({ apiEventId: "2986031", stageId: "395" });
  assert.deepEqual(detail, { id: 2986031 });
  const envelope = await client.getEventDetailEnvelope({ apiEventId: "2986031", stageId: "395" });
  assert.deepEqual(envelope.event, { id: 2986031 });
  assert.equal(envelope.rawBody, rawBody);
  assert.equal(envelope.contentType, "application/json; charset=utf-8");
  assert.match(envelope.sourceUrl, /event_v2\.json/);
  assert.ok(envelope.fetchedAt instanceof Date);

  const url = new URL(requestedUrl);
  assert.equal(url.pathname, "/api/khl_mobile/event_v2.json");
  assert.equal(url.searchParams.get("id"), "2986031");
  assert.equal(url.searchParams.get("stage_id"), "395");
});

test("client rejects unapproved API hosts", () => {
  assert.throws(
    () => new KhlApiClient({ baseUrl: "https://example.com/api/khl_mobile" }),
    (error: unknown) => error instanceof KhlApiError && /host/i.test(error.message)
  );
});

test("preserves decimal KHL ids as strings and rejects unsafe numeric ids", () => {
  const large = scheduleEvent(1) as { event: Record<string, unknown> };
  large.event.id = "900719925474099312345";
  large.event.khl_id = "900719925474099312346";
  large.event.stage_id = "900719925474099312347";
  large.event.outer_stage_id = "900719925474099312348";
  large.event.team_a = {
    id: "900719925474099312349",
    khl_id: "900719925474099312350",
    name: "Локомотив",
  };

  const [parsed] = parseKhlScheduleResponse([large]);
  assert.equal(parsed.apiEventId, "900719925474099312345");
  assert.equal(parsed.khlGameId, "900719925474099312346");
  assert.equal(parsed.stageId, "900719925474099312347");
  assert.equal(parsed.khlStageId, "900719925474099312348");
  assert.equal(parsed.teams.home.apiTeamId, "900719925474099312349");
  assert.equal(parsed.teams.home.khlTeamId, "900719925474099312350");

  const unsafe = scheduleEvent(1) as { event: Record<string, unknown> };
  unsafe.event.id = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => parseKhlScheduleResponse([unsafe]), /safe integer|string/i);
});

test("refuses redirects from the allowlisted KHL endpoint", async () => {
  let redirectPolicy: RequestRedirect | undefined;
  const client = new KhlApiClient({
    fetchImpl: async (_input, init) => {
      redirectPolicy = init?.redirect;
      return new Response(JSON.stringify({
        current_stage_id: 395,
        stages_v2: [{
          id: 395,
          khl_id: 1300,
          title: "Плей-офф",
          type: "playoff",
          season: "2025/2026",
        }],
      }), { status: 200 });
    },
  });

  await client.listStages();
  assert.equal(redirectPolicy, "error");
});

test("cancels a streamed KHL response as soon as the byte cap is exceeded", async () => {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      if (pulls === 1) {
        controller.enqueue(new TextEncoder().encode('{"oversized":true}'));
        return;
      }
      controller.error(new Error("response reader pulled past the configured limit"));
    },
    cancel() {
      cancelled = true;
    },
  }, { highWaterMark: 0 });
  const client = new KhlApiClient({
    maxResponseBytes: 8,
    fetchImpl: async () => new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });

  await assert.rejects(client.listStages(), /exceeds the configured size limit/i);
  assert.equal(pulls, 1);
  assert.equal(cancelled, true);
});
