import assert from "node:assert/strict";
import test from "node:test";

import {
  requestManualTLineRun,
  TLineRunAlreadyActiveError,
  TLineRunRequestError,
  type TLineRunRecord,
  type TLineRunStore,
} from "../backend/src/tline/application/runs";

const period = {
  sportId: "sport-volleyball",
  from: new Date("2026-10-01T00:00:00.000Z"),
  to: new Date("2026-10-02T00:00:00.000Z"),
  includeUndatedSourceMatches: false,
};

test("manual run returns the existing active run without creating another job", async () => {
  const activeRun = runRecord("active-run", "RUNNING");
  let createCalls = 0;
  const store: TLineRunStore = {
    findActiveRun: async () => activeRun,
    createRunWithJob: async () => {
      createCalls += 1;
      return runRecord("unexpected", "QUEUED");
    },
  };

  const result = await requestManualTLineRun(store, period);

  assert.equal(result.run, activeRun);
  assert.equal(result.deduplicated, true);
  assert.equal(createCalls, 0);
});

test("manual run creates one queued run and one idempotent job", async () => {
  const created = runRecord("new-run", "QUEUED");
  const calls: unknown[] = [];
  const store: TLineRunStore = {
    findActiveRun: async () => null,
    createRunWithJob: async (input) => {
      calls.push(input);
      return created;
    },
  };

  const result = await requestManualTLineRun(store, period);

  assert.deepEqual(result, { run: created, deduplicated: false });
  assert.deepEqual(calls, [{ ...period, trigger: "MANUAL" }]);
});

test("manual run resolves a concurrent active-run race as a deduplicated response", async () => {
  const winner = runRecord("winner", "QUEUED");
  let lookups = 0;
  const store: TLineRunStore = {
    findActiveRun: async () => (++lookups === 1 ? null : winner),
    createRunWithJob: async () => {
      throw new TLineRunAlreadyActiveError();
    },
  };

  assert.deepEqual(await requestManualTLineRun(store, period), {
    run: winner,
    deduplicated: true,
  });
});

test("manual run rejects missing sports and invalid periods at the application boundary", async () => {
  const store: TLineRunStore = {
    findActiveRun: async () => null,
    createRunWithJob: async () => runRecord("unused", "QUEUED"),
  };

  await assert.rejects(
    requestManualTLineRun(store, { ...period, sportId: " " }),
    (error: unknown) => error instanceof TLineRunRequestError && error.code === "SPORT_REQUIRED",
  );
  await assert.rejects(
    requestManualTLineRun(store, { ...period, to: period.from }),
    (error: unknown) => error instanceof TLineRunRequestError && error.code === "INVALID_PERIOD",
  );
});

function runRecord(id: string, status: TLineRunRecord["status"]): TLineRunRecord {
  return {
    id,
    sportConfigId: period.sportId,
    status,
    periodFrom: period.from,
    periodTo: period.to,
    includeUndatedSourceMatches: period.includeUndatedSourceMatches,
    createdAt: new Date("2026-08-30T12:00:00.000Z"),
  };
}
