import assert from "node:assert/strict";
import test from "node:test";

import {
  createAdminLineAdapter,
  FixtureAdminLineAdapter,
  TLineAdminConfigurationError,
} from "../backend/src/tline/admin";
import { createOptionalConfiguredAdminLineAdapter } from "../backend/src/tline/admin/configuration";

const fixture = {
  championships: [
    {
      sportId: "73",
      shapkaId: "833524",
      championshipId: "admin-champ-1",
      championshipName: "Высшая лига А. Женщины",
      matches: [
        {
          id: "admin-match-1",
          championshipId: "admin-champ-1",
          team1Id: "101",
          team1Name: "Динамо-Ак Барс",
          team2Id: "102",
          team2Name: "Локомотив",
          startsAtUtc: "2026-10-02T14:00:00.000Z",
          status: "scheduled",
        },
      ],
    },
  ],
} as const;

test("fixture AdminLineAdapter returns a fresh bounded snapshot", async () => {
  const adapter = new FixtureAdminLineAdapter(fixture);
  const first = await adapter.fetchMatches({
    scope: { sportId: "73", shapkaId: "833524", championshipId: "admin-champ-1" },
    from: new Date("2026-10-01T00:00:00.000Z"),
    to: new Date("2026-10-03T00:00:00.000Z"),
  });

  assert.equal(first.length, 1);
  assert.equal(first[0]?.matches.length, 1);
  first[0]!.matches[0]!.team1Name = "mutated";

  const second = await adapter.fetchMatches({
    scope: { sportId: "73", shapkaId: "833524", championshipId: "admin-champ-1" },
    from: new Date("2026-10-01T00:00:00.000Z"),
    to: new Date("2026-10-03T00:00:00.000Z"),
  });
  assert.equal(second[0]?.matches[0]?.team1Name, "Динамо-Ак Барс");
});

test("fixture AdminLineAdapter filters championships and period", async () => {
  const adapter = new FixtureAdminLineAdapter(fixture);
  const missingChampionship = await adapter.fetchMatches({
    scope: { sportId: "73", shapkaId: "833524", championshipId: "missing" },
    from: new Date("2026-10-01T00:00:00.000Z"),
    to: new Date("2026-10-03T00:00:00.000Z"),
  });
  assert.deepEqual(missingChampionship, []);

  const outsidePeriod = await adapter.fetchMatches({
    scope: { sportId: "73", shapkaId: "833524", championshipId: "admin-champ-1" },
    from: new Date("2026-11-01T00:00:00.000Z"),
    to: new Date("2026-11-03T00:00:00.000Z"),
  });
  assert.deepEqual(outsidePeriod[0]?.matches, []);

  const wrongHeader = await adapter.fetchMatches({
    scope: { sportId: "73", shapkaId: "999999", championshipId: "admin-champ-1" },
    from: new Date("2026-10-01T00:00:00.000Z"),
    to: new Date("2026-10-03T00:00:00.000Z"),
  });
  assert.deepEqual(wrongHeader, []);
});

test("factory refuses fixture Admin data in production", () => {
  assert.throws(
    () => createAdminLineAdapter({ mode: "fixture", environment: "production", fixture }),
    (error: unknown) => error instanceof TLineAdminConfigurationError
      && error.code === "FIXTURE_FORBIDDEN"
  );
});

test("factory fails closed while the real Admin contract is not configured", () => {
  assert.throws(
    () => createAdminLineAdapter({ mode: "http", environment: "production" }),
    (error: unknown) => error instanceof TLineAdminConfigurationError
      && error.code === "ADMIN_LINE_NOT_CONFIGURED"
  );
});

test("worker may collect source-only evidence when Admin HTTP is not configured", { concurrency: false }, () => {
  withEnvironment({ NODE_ENV: "production", TLINE_ADMIN_MODE: "http" }, () => {
    assert.equal(createOptionalConfiguredAdminLineAdapter(), null);
  });
});

test("optional worker configuration still refuses production fixtures", { concurrency: false }, () => {
  withEnvironment({ NODE_ENV: "production", TLINE_ADMIN_MODE: "fixture" }, () => {
    assert.throws(
      () => createOptionalConfiguredAdminLineAdapter(fixture),
      (error: unknown) => error instanceof TLineAdminConfigurationError
        && error.code === "FIXTURE_FORBIDDEN",
    );
  });
});

function withEnvironment(values: Record<string, string>, callback: () => void) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) process.env[key] = value;
    callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
