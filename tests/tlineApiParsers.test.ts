import assert from "node:assert/strict";
import test from "node:test";

import { parseManualDecisionInput } from "../backend/src/tline/api/decisionInput";
import { optionalInteger, parseIanaTimezone, parseSlug } from "../backend/src/tline/api/parsers";
import { TLineValidationError } from "../backend/src/tline/api/validation";
import { parseScheduleSlots } from "../backend/src/tline/application/scheduleState";

test("TLine settings parsers normalize safe values", () => {
  assert.equal(parseSlug("Volley-Ball"), "volley-ball");
  assert.equal(parseIanaTimezone("Europe/Moscow"), "Europe/Moscow");
  assert.equal(optionalInteger({ tolerance: 5 }, "tolerance", { min: 0, max: 30 }), 5);
  assert.deepEqual(parseScheduleSlots(["22:00", "08:00", "08:00"]), [8, 22]);
});

test("TLine settings parsers reject invalid values", () => {
  assert.throws(() => parseSlug("../volleyball"), TLineValidationError);
  assert.throws(() => parseIanaTimezone("Not/AZone"), TLineValidationError);
  assert.throws(() => optionalInteger({ tolerance: 31 }, "tolerance", { min: 0, max: 30 }), TLineValidationError);
  assert.throws(() => parseScheduleSlots(["08:30"]), TLineValidationError);
});

test("manual decision parsing requires supported types and a future ignore expiry", () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  assert.deepEqual(parseManualDecisionInput({
    decision: "IGNORE_UNTIL",
    expiresAt: future,
    note: "до уточнения",
    persistent: true,
  }), {
    decisionType: "IGNORE_UNTIL",
    expiresAt: new Date(future),
    note: "до уточнения",
    persistent: true,
  });
  assert.throws(() => parseManualDecisionInput({ decision: "IGNORE_UNTIL" }), TLineValidationError);
  assert.throws(() => parseManualDecisionInput({ decision: "DROP_DATABASE" }), TLineValidationError);
  assert.deepEqual(parseManualDecisionInput({ decision: "MANUAL_LINK", adminMatchId: "admin-match-42", persistent: true }), {
    decisionType: "MANUAL_LINK",
    adminMatchId: "admin-match-42",
    expiresAt: null,
    note: null,
    persistent: true,
  });
  assert.throws(() => parseManualDecisionInput({ decision: "MANUAL_LINK" }), TLineValidationError);
});
