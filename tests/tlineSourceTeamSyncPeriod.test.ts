import assert from "node:assert/strict";
import test from "node:test";

import { buildTLineSourceTeamSyncPeriod } from "../backend/src/tline/pilot/period";

test("source-team sync requests exactly twelve calendar months in the source timezone", () => {
  const period = buildTLineSourceTeamSyncPeriod(
    new Date("2026-08-30T09:00:00.000Z"),
    "Europe/Minsk",
    "2026/27",
  );

  assert.equal(period.from.toISOString(), "2026-06-30T21:00:00.000Z");
  assert.equal(period.to.toISOString(), "2027-06-30T20:59:59.999Z");
});

test("source-team sync rejects an invalid source timezone", () => {
  assert.throws(
    () => buildTLineSourceTeamSyncPeriod(new Date("2026-08-30T09:00:00.000Z"), "Not/AZone"),
    /source timezone/i,
  );
});

test("source-team sync falls back to a rolling window when the season is not split-year", () => {
  const period = buildTLineSourceTeamSyncPeriod(
    new Date("2026-08-30T09:00:00.000Z"),
    "Europe/Moscow",
    "regular",
  );

  assert.equal(period.from.toISOString(), "2026-07-31T21:00:00.000Z");
  assert.equal(period.to.toISOString(), "2027-07-31T20:59:59.999Z");
});
