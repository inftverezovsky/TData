import test from "node:test";
import assert from "node:assert/strict";
import { filterHltvEventsByQuery } from "../backend/src/sources/tdata/hltv/searchFallback";

test("HLTV search fallback finds current events by title tokens", () => {
  const events = [
    { id: "9189", title: "CCT 2026 Europe Series 2", url: "https://www.hltv.org/events/9189/cct-2026-europe-series-2" },
    { id: "9201", title: "European Pro League Series 7 Closed Qualifier", url: "https://www.hltv.org/events/9201/european-pro-league-series-7-closed-qualifier" },
    { id: "9202", title: "European Pro League Series 7", url: "https://www.hltv.org/events/9202/european-pro-league-series-7" },
  ];

  assert.deepEqual(
    filterHltvEventsByQuery(events, "European Pro League").map((event) => event.id),
    ["9201", "9202"]
  );
});

test("HLTV search fallback dedupes by event id", () => {
  const events = [
    { id: "9202", title: "European Pro League Series 7", url: "https://www.hltv.org/events/9202/european-pro-league-series-7" },
    { id: "9202", title: "European Pro League Series 7", url: "https://www.hltv.org/events/9202/european-pro-league-series-7" },
  ];

  assert.equal(filterHltvEventsByQuery(events, "European Pro League").length, 1);
});
