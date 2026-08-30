import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";

import {
  TLINE_FLOORBALL_PILOT_CHAMPIONSHIPS,
  TLINE_VOLLEYBALL_PILOT_CHAMPIONSHIPS,
  bootstrapTLinePilots,
  bootstrapTLineVolleyballPilot,
} from "../backend/src/tline/pilot/bootstrap";
import { parseTLinePeriodBoundary } from "../backend/src/tline/pilot/period";

test("volleyball pilot contains the exact two approved championships", () => {
  assert.deepEqual(
    TLINE_VOLLEYBALL_PILOT_CHAMPIONSHIPS.map((championship) => ({
      name: championship.name,
      sourceChampionshipId: championship.sourceChampionshipId,
      sourceUrl: championship.sourceUrl,
      season: championship.season,
    })),
    [
      {
        name: "Волейбол. Россия. Высшая лига А. Женщины",
        sourceChampionshipId: "01KYPZAKJB0SMM0D6TGV3W0Y85",
        sourceUrl: "https://volley.ru/calendar/01KYPZAKJB0SMM0D6TGV3W0Y85/allgames",
        season: "2026/27",
      },
      {
        name: "Волейбол. Россия. Высшая лига Б. Мужчины",
        sourceChampionshipId: "01KZQZR5T3NETE0RT7VHND16VW",
        sourceUrl: "https://volley.ru/calendar/01KZQZR5T3NETE0RT7VHND16VW/allgames",
        season: "2026/27",
      },
    ],
  );
});

test("floorball pilot contains the approved NFFR championship with automation disabled", () => {
  assert.deepEqual(TLINE_FLOORBALL_PILOT_CHAMPIONSHIPS, [{
    name: "Флорбол. Россия. Высшая лига",
    season: "2026/27",
    sourceProvider: "nffr-floorball",
    sourceChampionshipId: "200",
    sourceUrl: "https://xn--m1agla.xn--p1ai/sport/calendar/200",
    sourceTimezone: "Europe/Moscow",
  }]);
});

test("combined pilot bootstrap creates volleyball and floorball without enabling Admin or automation", async () => {
  const calls: Array<{ delegate: string; input: Record<string, unknown> }> = [];
  const client = {
    discipline: { upsert: async (input: Record<string, unknown>) => { calls.push({ delegate: "discipline", input }); return { id: `discipline-${calls.length}` }; } },
    tLineSportConfig: { upsert: async (input: Record<string, unknown>) => { calls.push({ delegate: "sport", input }); return { id: `sport-${calls.length}` }; } },
    tLineChampionship: { upsert: async (input: Record<string, unknown>) => { calls.push({ delegate: "championship", input }); return { id: `championship-${calls.length}` }; } },
    tLineScheduleState: { upsert: async (input: Record<string, unknown>) => { calls.push({ delegate: "schedule", input }); return { id: "global" }; } },
  } as unknown as PrismaClient;

  const result = await bootstrapTLinePilots(client);
  assert.equal(result.sports.length, 2);
  assert.deepEqual(calls.filter((item) => item.delegate === "championship").map((item) => {
    const create = item.input.create as Record<string, unknown>;
    return { provider: create.sourceProvider, active: create.active, autoEnabled: create.autoEnabled, adminId: create.adminChampionshipId };
  }), [
    { provider: "volley-ru", active: true, autoEnabled: false, adminId: null },
    { provider: "volley-ru", active: true, autoEnabled: false, adminId: null },
    { provider: "nffr-floorball", active: true, autoEnabled: false, adminId: null },
  ]);
});

test("volleyball pilot bootstrap is implemented with idempotent upserts and safe disabled automation", async () => {
  const calls: Array<{ delegate: string; input: Record<string, unknown> }> = [];
  const client = {
    discipline: {
      upsert: async (input: Record<string, unknown>) => {
        calls.push({ delegate: "discipline", input });
        return { id: "discipline-volleyball" };
      },
    },
    tLineSportConfig: {
      upsert: async (input: Record<string, unknown>) => {
        calls.push({ delegate: "sport", input });
        return { id: "sport-volleyball" };
      },
    },
    tLineChampionship: {
      upsert: async (input: Record<string, unknown>) => {
        calls.push({ delegate: "championship", input });
        return { id: `championship-${calls.length}` };
      },
    },
    tLineScheduleState: {
      upsert: async (input: Record<string, unknown>) => {
        calls.push({ delegate: "schedule", input });
        return { id: "global" };
      },
    },
  } as unknown as PrismaClient;

  const result = await bootstrapTLineVolleyballPilot(client);

  assert.equal(result.disciplineId, "discipline-volleyball");
  assert.equal(result.sportConfigId, "sport-volleyball");
  assert.equal(result.championshipIds.length, 2);
  assert.deepEqual(calls.map((call) => call.delegate), [
    "discipline",
    "sport",
    "championship",
    "championship",
    "schedule",
  ]);

  const sportCreate = calls[1].input.create as Record<string, unknown>;
  assert.equal(sportCreate.autoEnabled, false);
  assert.equal(sportCreate.adminSportId, null);
  assert.equal(sportCreate.candidateMatchWindowMinutes, null);
  assert.equal(sportCreate.defaultAllowedTimeDriftMinutes, null);
  assert.deepEqual(calls[0].input.update, {});
  assert.deepEqual(calls[1].input.update, {});

  for (const call of calls.filter((entry) => entry.delegate === "championship")) {
    const input = call.input;
    const create = input.create as Record<string, unknown>;
    assert.equal(create.active, true);
    assert.equal(create.autoEnabled, false);
    assert.equal(create.adminChampionshipId, null);
    assert.equal(create.allowedTimeDriftMinutes, null);
    assert.equal(create.candidateMatchWindowMinutes, null);
    assert.deepEqual(Object.keys(input.where as Record<string, unknown>), [
      "sportConfigId_sourceProvider_sourceUrl",
    ]);
    const update = input.update as Record<string, unknown>;
    assert.equal("active" in update, false);
    assert.equal("autoEnabled" in update, false);
    assert.equal("deletedAt" in update, false);
  }

  const scheduleCreate = calls.at(-1)?.input.create as Record<string, unknown>;
  assert.equal(scheduleCreate.enabled, false);
  assert.deepEqual(scheduleCreate.slotHours, [8, 12, 16, 22]);
});

test("the additive TLine migration creates the two pilot rows with automation disabled", () => {
  const sql = readFileSync(
    path.join(process.cwd(), "backend", "prisma", "migrations", "20260830190000_tline_mvp", "migration.sql"),
    "utf8",
  );
  assert.match(sql, /Волейбол\. Россия\. Высшая лига А\. Женщины/u);
  assert.match(sql, /Волейбол\. Россия\. Высшая лига Б\. Мужчины/u);
  assert.match(sql, /01KYPZAKJB0SMM0D6TGV3W0Y85/u);
  assert.match(sql, /01KZQZR5T3NETE0RT7VHND16VW/u);
  assert.match(sql, /INSERT INTO "TLineScheduleState"[\s\S]*false/u);
});

test("source-check datetimes without an offset use Europe/Moscow consistently", () => {
  assert.equal(
    parseTLinePeriodBoundary("2026-10-09T12:00:00", "start").toISOString(),
    "2026-10-09T09:00:00.000Z",
  );
  assert.equal(
    parseTLinePeriodBoundary("2026-10-09T12:00:00+05:00", "start").toISOString(),
    "2026-10-09T07:00:00.000Z",
  );
});
