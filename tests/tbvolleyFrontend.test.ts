import test from "node:test";
import assert from "node:assert/strict";
import { searchDecoders } from "../frontend/src/components/tbvolley/searchResponse";

for (const [source, decode] of Object.entries(searchDecoders)) {
  test(`${source}: rejects successful-looking but malformed tournament responses`, () => {
    assert.throws(() => decode({ ok: true, source, tournaments: "invalid" }), /ответ/);
    assert.throws(() => decode({ ok: false, source, tournaments: [] }), /ok/);
  });
}

test("CBV validates card fields and preserves the source URL and import identifiers", () => {
  const tournament = {
    id: "1",
    etapaId: "2",
    campeonatoId: "3",
    temporadaId: "4",
    title: "Open",
    sourceTitle: "Open",
    pageUrl: "https://example.test/event",
    gender: "men",
    championship: "Adulto",
    category: "Open",
    season: "2026",
    venue: "Beach",
    city: "City",
    region: "Region",
    location: "City",
    dates: "September",
    startDate: "2026-09-07",
    endDate: null,
    status: "upcoming",
    courts: "1",
    matchCount: 10,
  };
  const payload = {
    ok: true,
    source: "cbv",
    sourceUrl: "https://example.test",
    year: 2026,
    gender: "men",
    query: "",
    tournaments: [tournament],
    summary: { total: 1, matches: 10 },
  };
  const result = searchDecoders.cbv(payload);
  assert.equal(result.tournaments[0].etapaId, "2");
  assert.equal(result.tournaments[0].pageUrl, tournament.pageUrl);
  assert.throws(() => searchDecoders.cbv({ ...payload, tournaments: [{ ...tournament, title: {} }] }), /title/);
  assert.throws(() => searchDecoders.cbv({ ...payload, summary: { total: 1, matches: "ten" } }), /matches/);
});

test("VolleyballWorld accepts one combined search while preserving upstream freshness evidence", () => {
  const upstream = {
    cacheStatus: "stale",
    fetchedAt: "2026-09-07T08:00:00Z",
    ageMs: 60_000,
    fallbackErrorCode: "upstream_timeout",
  };
  const tournament = {
    id: "event:men",
    title: "Open",
    pageUrl: "https://example.test/event",
    gender: "men",
    city: "City",
    country: "Country",
    location: "City",
    dates: "September",
    startDate: "2026-09-07",
    endDate: null,
    status: "upcoming",
    matchCount: 2,
    firstMatchTimeMoscow: null,
    tournamentNo: "1",
    competitionSlug: "open",
    subCompetitionType: "Challenge",
  };
  const payload = {
    ok: true,
    source: "volleyballworld",
    gender: "all",
    query: "",
    fromDate: "2026-09-07",
    toDate: "2026-09-21",
    upstream,
    tournaments: [tournament, { ...tournament, id: "event:women", gender: "women" }],
    summary: { total: 1, matches: 4 },
  };
  const result = searchDecoders.volleyballworld(payload);
  assert.equal(result.gender, "all");
  assert.deepEqual(
    result.tournaments.map((item) => item.gender),
    ["men", "women"],
  );
  assert.deepEqual(result.upstream, upstream);
  assert.throws(
    () => searchDecoders.volleyballworld({ ...payload, upstream: { ...upstream, ageMs: "unknown" } }),
    /ageMs/,
  );
  assert.throws(
    () => searchDecoders.volleyballworld({ ...payload, tournaments: [{ ...tournament, gender: "all" }] }),
    /gender/,
  );
});
