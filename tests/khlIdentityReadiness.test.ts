import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { buildKhlMatchProtocolView } from "../backend/src/results/khl/matchProtocol";
import { assertKhlRosterIdentities, normalizeKhlEventDetail } from "../backend/src/sources/results/khl/normalize";
import { aggregateKhlGameDay, getKhlRevisionPresentation } from "../frontend/src/components/results/khl/khlResultsViewModel";
import { KhlResultMatchCard } from "../frontend/src/components/results/khl/KhlResultsWorkspace";
import { KhlMatchProtocol } from "../frontend/src/components/results/khl/KhlMatchProtocol";
import type { StoredMatch } from "../frontend/src/components/results/khl/types";

const raw = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/khl/missing-player-ids-901981.json"), "utf8")).event;

function diagnostic(): StoredMatch {
  const normalized = normalizeKhlEventDetail(raw);
  const protocol = buildKhlMatchProtocolView(normalized);
  const revision = {
    id: "diagnostic-revision", revisionNumber: 1, state: "REJECTED",
    normalizedHash: "a".repeat(64), validationIssues: [...protocol.validation.issues],
    createdAt: "2026-09-05T19:00:00.000Z",
  };
  return {
    id: "diagnostic-match", khlGameId: "901981", stageId: "407", season: "2026/2027",
    startsAt: protocol.startsAt, status: "FINISHED", adminMatchId: null, adminBindingStatus: "UNMAPPED",
    officialHomeScore: 4, officialAwayScore: 3, regulationHomeScore: 3, regulationAwayScore: 3,
    homeTeam: { ...protocol.teams.home, adminTeamId: null, adminBindingStatus: "UNMAPPED" },
    awayTeam: { ...protocol.teams.away, adminTeamId: null, adminBindingStatus: "UNMAPPED" },
    activeRevision: null, latestRevision: revision,
    displayRevision: { ...revision, source: "LATEST_REJECTED" }, protocol,
    _count: { revisions: 1, participants: 0 },
  };
}

function withIssues(match: StoredMatch, issues: string[]): StoredMatch {
  return {
    ...match, protocol: { ...match.protocol!, validation: { ok: false, issues } },
    latestRevision: { ...match.latestRevision!, validationIssues: issues },
    displayRevision: { ...match.displayRevision!, validationIssues: issues },
  };
}

test("901981 identity-only diagnostics enter daily totals with all 47 rows, preserving regulation and staging guards", () => {
  const match = diagnostic();
  const before = structuredClone(match);
  const summary = aggregateKhlGameDay([match]);
  assert.equal(summary.includedMatches, 1);
  assert.equal(summary.skippedMatches, 0);
  assert.equal(summary.warningMatches, 1);
  assert.equal(summary.players.length, 47);
  assert.equal(summary.players.filter((player) => player.khlPlayerId === null).length, 5);
  for (const side of ["home", "away"] as const) {
    const team = summary.teams.find((entry) => entry.khlTeamId === match.protocol!.teams[side].khlTeamId)!;
    assert.equal(team.regulationGoals, 3);
    for (const metric of match.protocol!.teams[side].metrics) {
      assert.equal(team.metrics.find((entry) => entry.code === metric.code)?.regulationTotal, metric.regulationTotal);
    }
  }
  assert.equal(summary.players.reduce((sum, player) => sum + player.goals, 0), 6);
  assert.ok(summary.players.some((player) => player.points === 0));
  assert.deepEqual(match, before);
  assert.equal(match.activeRevision, null);
  assert.equal(match.latestRevision?.state, "REJECTED");
  assert.throws(() => assertKhlRosterIdentities(normalizeKhlEventDetail(raw)), /missing KHL player id/);
});

test("identity warning is amber and human-readable without claiming active validation or hiding daily statistics", () => {
  const match = diagnostic();
  const presentation = getKhlRevisionPresentation(match);
  assert.equal(presentation.badgeTone, "warning");
  assert.equal(presentation.excludeFromDaily, false);
  assert.match(presentation.badgeLabel, /Статистика доступна/);
  assert.match(presentation.warning?.description || "", /staging.*заблокирован/);
  const card = renderToStaticMarkup(createElement(KhlResultMatchCard, { match }));
  assert.match(card, /Статистика доступна · нет ID КХЛ/);
  assert.match(card, /Учтён в статистике дня/);
  assert.match(card, /Belousov Maxim/);
  assert.doesNotMatch(card, /Не входит в статистику дня|missing KHL player id|Непроверенная ревизия/);
  const protocol = renderToStaticMarkup(createElement(KhlMatchProtocol, { protocol: match.protocol }));
  assert.match(protocol, /Статистика доступна · нет ID КХЛ/);
  assert.doesNotMatch(protocol, /missing KHL player id|Протокол проверен/);
});

test("unresolved API IDs never merge across matches or sides and never become invented KHL IDs", () => {
  const first = diagnostic();
  const nullPlayer = first.protocol!.players.find((player) => player.khlPlayerId === null)!;
  const extra = { ...nullPlayer, teamSide: "home" as const, khlTeamId: first.homeTeam.khlTeamId };
  const issues = [...first.protocol!.validation.issues, `KHL home API player ${extra.apiPlayerId}: missing KHL player id.`];
  const twoSides = withIssues({ ...first, protocol: { ...first.protocol!, players: [...first.protocol!.players, extra] } }, issues);
  const second = { ...first, id: "second-match", khlGameId: "901982" };
  const summary = aggregateKhlGameDay([twoSides, second]);
  assert.equal(summary.includedMatches, 2);
  const unresolved = summary.players.filter((player) => player.khlPlayerId === null);
  assert.equal(unresolved.length, 11);
  assert.equal(new Set(unresolved.map((player) => player.rowKey)).size, 11);
  assert.ok(unresolved.every((player) => player.matchCount === 1 && player.apiPlayerId && player.sourceMatchId));
  assert.equal(unresolved.filter((player) => player.apiPlayerId === nullPlayer.apiPlayerId).length, 3);
});

test("duplicate match input does not inflate daily totals", () => {
  const match = diagnostic();
  const summary = aggregateKhlGameDay([match, structuredClone(match)]);
  assert.equal(summary.includedMatches, 1);
  assert.equal(summary.players.length, 47);
  assert.ok(summary.teams.every((team) => team.matchCount === 1));
});

test("latest displayed identity diagnostic replaces older active data, but stale active display stays excluded", () => {
  const match = diagnostic();
  const older = { ...match.latestRevision!, id: "old-active", revisionNumber: 1, state: "VALIDATED", validationIssues: [] };
  const latest = { ...match.latestRevision!, revisionNumber: 2 };
  const updated: StoredMatch = { ...match, activeRevision: older, latestRevision: latest,
    displayRevision: { ...latest, source: "LATEST_REJECTED" } };
  assert.equal(aggregateKhlGameDay([updated]).includedMatches, 1);
  assert.equal(getKhlRevisionPresentation(updated).excludeFromDaily, false);
  const stale: StoredMatch = { ...updated, displayRevision: { ...older, source: "ACTIVE_VALIDATED" } };
  assert.equal(aggregateKhlGameDay([stale]).includedMatches, 0);
  assert.equal(getKhlRevisionPresentation(stale).excludeFromDaily, true);
});

test("unknown, mixed, incomplete and mismatched diagnostic evidence remains blocked", () => {
  const match = diagnostic();
  const issues = match.protocol!.validation.issues;
  const variants = [
    withIssues(match, [...issues, "away faceoffs source=26 vs segments=25"]),
    withIssues(match, [...issues, "Unresolved scorer"]),
    withIssues(match, ["missing KHL ID"]),
    withIssues(match, []),
    withIssues(match, issues.slice(1)),
    withIssues(match, [...issues, issues[0]]),
    withIssues(match, [...issues.slice(1), "KHL home API player 24617: missing KHL player id."]),
    { ...match, latestRevision: { ...match.latestRevision!, validationIssues: [...issues, "extra metadata issue"] } },
    { ...match, displayRevision: { ...match.displayRevision!, revisionNumber: 2 } },
    { ...match, khlGameId: "" },
    { ...match, protocol: { ...match.protocol!, validation: { ok: true, issues } } },
  ];
  for (const variant of variants) {
    assert.equal(aggregateKhlGameDay([variant]).includedMatches, 0);
    assert.equal(getKhlRevisionPresentation(variant).excludeFromDaily, true);
  }
});

test("duplicate roster identities and invalid points never become a harmless identity warning", () => {
  const match = diagnostic();
  const players = match.protocol!.players;
  const nullPlayer = players.find((player) => player.khlPlayerId === null)!;
  const known = players.find((player) => player.khlPlayerId !== null)!;
  const variants = [
    [...players, nullPlayer],
    [...players, { ...known, apiPlayerId: "999999999" }],
    players.map((player) => player === nullPlayer ? { ...player, apiPlayerId: "" } : player),
    players.map((player) => player === nullPlayer ? { ...player, khlPlayerId: "" } : player),
    players.map((player) => player === nullPlayer ? { ...player, regulation: { goals: 1, assists: 0, points: 99 } } : player),
  ];
  for (const roster of variants) {
    const variant = { ...match, protocol: { ...match.protocol!, players: roster } };
    assert.equal(aggregateKhlGameDay([variant]).includedMatches, 0);
    assert.equal(getKhlRevisionPresentation(variant).excludeFromDaily, true);
  }
});

test("later corrected source identity replaces warning rows without mutating the diagnostic revision", () => {
  const match = diagnostic();
  const before = structuredClone(match);
  const corrected = {
    ...match, protocol: { ...match.protocol!, validation: { ok: true, issues: [] },
      players: match.protocol!.players.map((player, index) => ({ ...player, khlPlayerId: player.khlPlayerId || `900000${index}` })) },
    activeRevision: { ...match.latestRevision!, state: "VALIDATED", revisionNumber: 2, validationIssues: [] },
    latestRevision: { ...match.latestRevision!, state: "VALIDATED", revisionNumber: 2, validationIssues: [] },
    displayRevision: { ...match.displayRevision!, source: "ACTIVE_VALIDATED" as const, state: "VALIDATED", revisionNumber: 2, validationIssues: [] },
  };
  const summary = aggregateKhlGameDay([corrected]);
  assert.equal(summary.includedMatches, 1);
  assert.equal(summary.warningMatches, 0);
  assert.equal(summary.players.length, 47);
  assert.equal(summary.players.filter((player) => player.khlPlayerId === null).length, 0);
  assert.deepEqual(match, before);
});
