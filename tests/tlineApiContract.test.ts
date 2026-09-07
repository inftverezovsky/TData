import assert from "node:assert/strict";
import test from "node:test";

import {
  parseManualRunRequest,
  serializeTLineJson,
  TLineInputError,
} from "../backend/src/tline/api/contracts";

test("TLine JSON serialization converts BigInt and Date without mutating input", () => {
  const input = {
    id: 42n,
    createdAt: new Date("2026-08-30T10:00:00.000Z"),
    nested: [{ teamId: 101n }],
  };

  assert.deepEqual(serializeTLineJson(input), {
    id: "42",
    createdAt: "2026-08-30T10:00:00.000Z",
    nested: [{ teamId: "101" }],
  });
  assert.equal(input.id, 42n);
  assert.equal(input.nested[0]?.teamId, 101n);
});

test("manual run input accepts one valid UTC interval", () => {
  assert.deepEqual(
    parseManualRunRequest({
      sportId: "cm123sport",
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-02T00:00:00.000Z",
    }),
    {
      sportId: "cm123sport",
      from: new Date("2026-10-01T00:00:00.000Z"),
      to: new Date("2026-10-02T00:00:00.000Z"),
      includeUndatedSourceMatches: false,
    }
  );

  assert.equal(parseManualRunRequest({
    sportId: "cm123sport",
    from: "2026-10-01T00:00:00.000Z",
    to: "2026-10-02T00:00:00.000Z",
    includeUndatedSourceMatches: true,
  }).includeUndatedSourceMatches, true);
});

test("manual run input rejects invalid or reversed intervals", () => {
  assert.throws(
    () => parseManualRunRequest({ sportId: "", from: "bad", to: "also-bad" }),
    (error: unknown) => error instanceof TLineInputError && error.code === "INVALID_MANUAL_RUN"
  );
  assert.throws(
    () => parseManualRunRequest({
      sportId: "cm123sport",
      from: "2026-10-02T00:00:00.000Z",
      to: "2026-10-01T00:00:00.000Z",
    }),
    (error: unknown) => error instanceof TLineInputError && error.code === "INVALID_PERIOD"
  );
  assert.throws(
    () => parseManualRunRequest({
      sportId: "cm123sport",
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-02T00:00:00.000Z",
      includeUndatedSourceMatches: "yes",
    }),
    (error: unknown) => error instanceof TLineInputError && error.code === "INVALID_MANUAL_RUN"
  );
});
