import test from "node:test";
import assert from "node:assert/strict";
import {
  adjustMoscowDateTimeStringForDiscipline,
  applyDisciplineScheduleLead,
  formatMoscowDateTime,
  getDisciplineScheduleLeadMinutes,
} from "../src/lib/matches/scheduleOffset";

test("schedule lead minutes are discipline-specific", () => {
  assert.equal(getDisciplineScheduleLeadMinutes("counterstrike"), 5);
  assert.equal(getDisciplineScheduleLeadMinutes("cs2"), 5);
  assert.equal(getDisciplineScheduleLeadMinutes("leagueoflegends"), 10);
  assert.equal(getDisciplineScheduleLeadMinutes("lol"), 10);
  assert.equal(getDisciplineScheduleLeadMinutes("dota2"), 0);
});

test("counterstrike match dates are shifted five minutes earlier", () => {
  const sourceDate = new Date("2026-06-11T10:00:00.000Z");
  assert.equal(applyDisciplineScheduleLead(sourceDate, "counterstrike").toISOString(), "2026-06-11T09:55:00.000Z");
});

test("league of legends Moscow date strings are shifted ten minutes earlier", () => {
  assert.equal(
    adjustMoscowDateTimeStringForDiscipline("11.06.2026 16:00:00", "leagueoflegends"),
    "11.06.2026 15:50:00"
  );
});

test("UTC dates are formatted as Moscow time", () => {
  assert.equal(formatMoscowDateTime(new Date("2026-05-31T17:00:00.000Z")), "31.05.2026 20:00:00");
});

test("counterstrike lead is applied after source time is converted to UTC", () => {
  const sourceDate = new Date("2026-05-31T17:00:00.000Z");
  assert.equal(formatMoscowDateTime(applyDisciplineScheduleLead(sourceDate, "counterstrike")), "31.05.2026 19:55:00");
});
