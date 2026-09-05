import assert from "node:assert/strict";
import test from "node:test";

import type { KhlMatchProtocolView } from "../backend/src/results/khl/matchProtocol";
import {
  aggregateKhlGameDay,
  getKhlMoscowDateKey,
  getKhlMoscowDayBounds,
  getKhlRevisionPresentation,
  partitionKhlResultsMatches,
} from "../frontend/src/components/results/khl/khlResultsViewModel";

test("KHL result dates use explicit Europe/Moscow calendar boundaries", () => {
  assert.equal(getKhlMoscowDateKey("2026-04-30T20:59:59.999Z"), "2026-04-30");
  assert.equal(getKhlMoscowDateKey("2026-04-30T21:00:00.000Z"), "2026-05-01");
  assert.equal(getKhlMoscowDateKey("2026-05-01T20:59:59.999Z"), "2026-05-01");
  assert.equal(getKhlMoscowDateKey("2026-05-01T21:00:00.000Z"), "2026-05-02");

  assert.deepEqual(getKhlMoscowDayBounds("2026-05-01"), {
    gte: "2026-04-30T21:00:00.000Z",
    lt: "2026-05-01T21:00:00.000Z",
  });
  assert.throws(
    () => getKhlMoscowDateKey("2026-05-01T00:00:00"),
    /Invalid KHL result date/
  );
});

test("partition includes only finished non-future matches from the cutoff without mutating input", () => {
  const matches = [
    { id: "today-late", status: "FINISHED", startsAt: "2026-05-03T10:00:00.000Z" },
    { id: "archive-new", status: "FINISHED", startsAt: "2026-05-02T18:00:00.000Z" },
    { id: "today-early", status: "FINISHED", startsAt: "2026-05-03T07:00:00.000Z" },
    { id: "cutoff-boundary", status: "FINISHED", startsAt: "2026-04-30T21:00:00.000Z" },
    { id: "before-cutoff", status: "FINISHED", startsAt: "2026-04-30T20:59:59.999Z" },
    { id: "future-same-day", status: "FINISHED", startsAt: "2026-05-03T13:00:00.000Z" },
    { id: "future-day", status: "FINISHED", startsAt: "2026-05-03T21:00:00.000Z" },
    { id: "not-finished", status: "LIVE", startsAt: "2026-05-03T06:00:00.000Z" },
    { id: "invalid-date", status: "FINISHED", startsAt: "not-a-date" },
  ] as const;
  const before = structuredClone(matches);

  const partition = partitionKhlResultsMatches(
    matches,
    new Date("2026-05-03T12:00:00.000Z")
  );

  assert.deepEqual(partition.today.map((match) => match.id), ["today-early", "today-late"]);
  assert.deepEqual(partition.archive.map((match) => match.id), ["archive-new", "cutoff-boundary"]);
  assert.deepEqual(matches, before);
});

test("daily aggregation sums validated regulation values, preserves zero players, and skips rejected protocols", () => {
  const alpha = { khlTeamId: "team-alpha", name: "Альфа" };
  const beta = { khlTeamId: "team-beta", name: "Бета" };
  const matches = [
    {
      id: "valid-one",
      activeRevision: { state: "VALIDATED" },
      protocol: makeProtocol({
        home: alpha,
        away: beta,
        homeGoals: 2,
        awayGoals: 1,
        homeShots: 10,
        awayShots: 8,
        homePim: 4,
        awayPim: 2,
        players: [
          makePlayer("player-one", alpha.khlTeamId, "home", "Первый", 1, 1, 2),
          makePlayer("player-zero", alpha.khlTeamId, "home", "Нулевой", 0, 0, 0),
          makePlayer("player-two", beta.khlTeamId, "away", "Второй", 1, 0, 1),
        ],
      }),
    },
    {
      id: "valid-two",
      activeRevision: { state: "VALIDATED" },
      protocol: makeProtocol({
        home: beta,
        away: alpha,
        homeGoals: 3,
        awayGoals: 2,
        homeShots: 12,
        awayShots: 9,
        homePim: 4,
        awayPim: 2,
        players: [
          makePlayer("player-two", beta.khlTeamId, "home", "Второй", 2, 0, 2),
          makePlayer("player-one", alpha.khlTeamId, "away", "Первый", 0, 1, 1),
        ],
      }),
    },
    {
      id: "invalid-protocol",
      activeRevision: { state: "VALIDATED" },
      protocol: makeProtocol({
        home: alpha,
        away: beta,
        homeGoals: 99,
        awayGoals: 99,
        homeShots: 99,
        awayShots: 99,
        homePim: 99,
        awayPim: 99,
        players: [],
        valid: false,
      }),
    },
    { id: "no-protocol", activeRevision: { state: "VALIDATED" }, protocol: null },
    {
      id: "rejected-fallback",
      activeRevision: { state: "REJECTED" },
      protocol: makeProtocol({
        home: alpha,
        away: beta,
        homeGoals: 50,
        awayGoals: 50,
        homeShots: 50,
        awayShots: 50,
        homePim: 50,
        awayPim: 50,
        players: [],
      }),
    },
  ];
  const before = structuredClone(matches);

  const summary = aggregateKhlGameDay(matches);

  assert.equal(summary.includedMatches, 2);
  assert.equal(summary.skippedMatches, 3);

  const alphaSummary = summary.teams.find((team) => team.khlTeamId === alpha.khlTeamId);
  assert.deepEqual(alphaSummary, {
    khlTeamId: alpha.khlTeamId,
    name: alpha.name,
    matchCount: 2,
    regulationGoals: 4,
    metrics: [
      { code: "penalty_minutes_2_4", label: "Штрафные минуты", regulationTotal: 6 },
      { code: "shots_on_goal", label: "Броски в створ", regulationTotal: 19 },
    ],
  });

  const betaSummary = summary.teams.find((team) => team.khlTeamId === beta.khlTeamId);
  assert.deepEqual(betaSummary, {
    khlTeamId: beta.khlTeamId,
    name: beta.name,
    matchCount: 2,
    regulationGoals: 4,
    metrics: [
      { code: "penalty_minutes_2_4", label: "Штрафные минуты", regulationTotal: 6 },
      { code: "shots_on_goal", label: "Броски в створ", regulationTotal: 20 },
    ],
  });

  assert.deepEqual(
    summary.players.find((player) => player.khlPlayerId === "player-one"),
    {
      rowKey: JSON.stringify(["khl", alpha.khlTeamId, "player-one"]),
      khlPlayerId: "player-one",
      khlTeamId: alpha.khlTeamId,
      name: "Первый",
      matchCount: 2,
      goals: 1,
      assists: 2,
      points: 3,
    }
  );
  assert.deepEqual(
    summary.players.find((player) => player.khlPlayerId === "player-zero"),
    {
      rowKey: JSON.stringify(["khl", alpha.khlTeamId, "player-zero"]),
      khlPlayerId: "player-zero",
      khlTeamId: alpha.khlTeamId,
      name: "Нулевой",
      matchCount: 1,
      goals: 0,
      assists: 0,
      points: 0,
    }
  );
  assert.deepEqual(matches, before);
});

test("revision presentation identifies rejected-first and newer rejected diagnostics", () => {
  const rejectedFirst = getKhlRevisionPresentation({
    activeRevision: null,
    latestRevision: {
      revisionNumber: 1,
      state: "REJECTED",
      validationIssues: ["source/segment mismatch"],
    },
    displayRevision: { revisionNumber: 1, state: "REJECTED", source: "LATEST_REJECTED" },
  });
  assert.deepEqual(rejectedFirst, {
    badgeLabel: "Непроверенная ревизия #1",
    badgeTone: "rejected",
    excludeFromDaily: true,
    warning: {
      title: "Непроверенная ревизия #1 · REJECTED",
      description: "Показан диагностический normalized-протокол только для просмотра. Он исключён из статистики дня и доставки.",
      issues: ["source/segment mismatch"],
    },
  });

  const newerRejected = getKhlRevisionPresentation({
    activeRevision: { revisionNumber: 1, state: "VALIDATED" },
    latestRevision: {
      revisionNumber: 2,
      state: "REJECTED",
      validationIssues: ["new source/segment mismatch"],
    },
    displayRevision: { revisionNumber: 1, state: "VALIDATED", source: "ACTIVE_VALIDATED" },
  });
  assert.deepEqual(newerRejected, {
    badgeLabel: "Протокол #1 · last-known-good",
    badgeTone: "validated",
    excludeFromDaily: true,
    warning: {
      title: "Непроверенная ревизия #2 · REJECTED",
      description: "Показан последний проверенный протокол #1. Более новая ревизия исключена из статистики дня и доставки.",
      issues: ["new source/segment mismatch"],
    },
  });
});

test("daily aggregation excludes last-known-good data when a newer revision is rejected", () => {
  const alpha = { khlTeamId: "team-alpha", name: "Альфа" };
  const beta = { khlTeamId: "team-beta", name: "Бета" };
  const summary = aggregateKhlGameDay([{
    activeRevision: { revisionNumber: 1, state: "VALIDATED" },
    latestRevision: { revisionNumber: 2, state: "REJECTED" },
    protocol: makeProtocol({
      home: alpha,
      away: beta,
      homeGoals: 2,
      awayGoals: 1,
      homeShots: 10,
      awayShots: 8,
      homePim: 4,
      awayPim: 2,
      players: [makePlayer("player-one", alpha.khlTeamId, "home", "Первый", 1, 0, 1)],
    }),
  }]);

  assert.equal(summary.includedMatches, 0);
  assert.equal(summary.skippedMatches, 1);
  assert.deepEqual(summary.teams, []);
  assert.deepEqual(summary.players, []);
});

test("latest diagnostic presentation does not label its displayed protocol as active validated", () => {
  const presentation = getKhlRevisionPresentation({
    activeRevision: { revisionNumber: 1, state: "VALIDATED" },
    latestRevision: { revisionNumber: 2, state: "REJECTED", validationIssues: ["missing KHL ID"] },
    displayRevision: { revisionNumber: 2, state: "REJECTED", source: "LATEST_REJECTED" },
  });
  assert.equal(presentation.badgeLabel, "Непроверенная ревизия #2");
  assert.equal(presentation.badgeTone, "rejected");
  assert.equal(presentation.excludeFromDaily, true);
  assert.match(presentation.warning?.description || "", /Показан диагностический/);
  assert.doesNotMatch(presentation.warning?.description || "", /Показан последний проверенный/);
});

type ProtocolOptions = {
  home: { khlTeamId: string; name: string };
  away: { khlTeamId: string; name: string };
  homeGoals: number;
  awayGoals: number;
  homeShots: number;
  awayShots: number;
  homePim: number;
  awayPim: number;
  players: KhlMatchProtocolView["players"];
  valid?: boolean;
};

function makeProtocol(options: ProtocolOptions): KhlMatchProtocolView {
  return {
    status: "finished",
    startsAt: "2026-05-03T09:00:00.000Z",
    segments: ["P1", "P2", "P3"],
    scores: {
      segments: [],
      regulation: { home: options.homeGoals, away: options.awayGoals },
      official: { home: options.homeGoals, away: options.awayGoals },
    },
    teams: {
      home: makeTeam(options.home, options.homeShots, options.homePim),
      away: makeTeam(options.away, options.awayShots, options.awayPim),
    },
    players: options.players,
    goals: [],
    penalties: [],
    validation: {
      ok: options.valid ?? true,
      issues: options.valid === false ? ["fixture invalid"] : [],
    },
  };
}

function makeTeam(
  team: { khlTeamId: string; name: string },
  shots: number,
  pim: number
): KhlMatchProtocolView["teams"]["home"] {
  return {
    ...team,
    location: null,
    metrics: [
      {
        code: "shots_on_goal",
        label: "Броски в створ",
        segments: {},
        regulationTotal: shots,
        fullMatchTotal: shots + 1,
      },
      {
        code: "penalty_minutes_2_4",
        label: "Штрафные минуты",
        segments: {},
        regulationTotal: pim,
        fullMatchTotal: pim + 2,
      },
    ],
  };
}

function makePlayer(
  khlPlayerId: string,
  khlTeamId: string,
  teamSide: "home" | "away",
  name: string,
  goals: number,
  assists: number,
  points: number
): KhlMatchProtocolView["players"][number] {
  return {
    khlPlayerId,
    apiPlayerId: `test-api-${khlPlayerId}`,
    khlTeamId,
    teamSide,
    shirtNumber: 1,
    name,
    role: "forward",
    regulation: { goals, assists, points },
    fullMatch: { goals: goals + 1, assists: assists + 1, points: points + 2 },
  };
}
