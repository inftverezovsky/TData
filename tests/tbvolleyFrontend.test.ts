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
    id: "1", etapaId: "2", campeonatoId: "3", temporadaId: "4", title: "Open", sourceTitle: "Open", pageUrl: "https://example.test/event",
    gender: "men", championship: "Adulto", category: "Open", season: "2026", venue: "Beach", city: "City", region: "Region", location: "City",
    dates: "September", startDate: "2026-09-07", endDate: null, status: "upcoming", courts: "1", matchCount: 10,
  };
  const payload = { ok: true, source: "cbv", sourceUrl: "https://example.test", year: 2026, gender: "men", query: "", tournaments: [tournament], summary: { total: 1, matches: 10 } };
  const result = searchDecoders.cbv(payload);
  assert.equal(result.tournaments[0].etapaId, "2");
  assert.equal(result.tournaments[0].pageUrl, tournament.pageUrl);
  assert.throws(() => searchDecoders.cbv({ ...payload, tournaments: [{ ...tournament, title: {} }] }), /title/);
  assert.throws(() => searchDecoders.cbv({ ...payload, summary: { total: 1, matches: "ten" } }), /matches/);
});
