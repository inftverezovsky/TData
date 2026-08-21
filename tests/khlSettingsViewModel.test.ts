import assert from "node:assert/strict";
import test from "node:test";

import {
  filterKhlSettingsTeamPlayerGroups,
  groupKhlSettingsPlayersByTeam,
} from "../frontend/src/components/results/khl/khlSettingsViewModel";
import type { SettingsPlayer, SettingsTeam } from "../frontend/src/components/results/khl/types";

test("settings players are grouped by their latest KHL team with stable counts", () => {
  const players = [
    player("3", "Третий Игрок", "team-lokomotiv", "Локомотив", "UNMAPPED"),
    player("1", "Первый Игрок", "team-avangard", "Авангард", "CONFIRMED"),
    player("2", "Второй Игрок", "team-lokomotiv", "Локомотив", "CONFIRMED"),
    player("4", "Без Команды", null, null, "UNMAPPED"),
  ];

  const groups = groupKhlSettingsPlayersByTeam(players);

  assert.deepEqual(groups.map((group) => ({
    key: group.key,
    teamName: group.teamName,
    khlTeamId: group.khlTeamId,
    playerCount: group.players.length,
    confirmedCount: group.confirmedCount,
    playerNames: group.players.map((candidate) => candidate.name),
  })), [
    {
      key: "team-avangard",
      teamName: "Авангард",
      khlTeamId: "team-avangard",
      playerCount: 1,
      confirmedCount: 1,
      playerNames: ["Первый Игрок"],
    },
    {
      key: "team-lokomotiv",
      teamName: "Локомотив",
      khlTeamId: "team-lokomotiv",
      playerCount: 2,
      confirmedCount: 1,
      playerNames: ["Второй Игрок", "Третий Игрок"],
    },
    {
      key: "unassigned",
      teamName: "Без команды",
      khlTeamId: null,
      playerCount: 1,
      confirmedCount: 0,
      playerNames: ["Без Команды"],
    },
  ]);
  assert.deepEqual(players.map((candidate) => candidate.khlPlayerId), ["3", "1", "2", "4"]);
});

test("settings team groups expose players only after the team binding is confirmed", () => {
  const teams = [
    team("team-avangard", "Авангард", "CONFIRMED"),
    team("team-lokomotiv", "Локомотив", "UNMAPPED"),
    team("team-empty", "Северсталь", "UNMAPPED"),
  ];
  const players = [
    player("1", "Первый Игрок", "team-avangard", "Авангард", "UNMAPPED"),
    player("2", "Второй Игрок", "team-lokomotiv", "Локомотив", "UNMAPPED"),
  ];

  const groups = groupKhlSettingsPlayersByTeam(players, teams);

  assert.deepEqual(groups.map((group) => ({
    khlTeamId: group.khlTeamId,
    teamBindingStatus: group.team?.adminBindingStatus || null,
    playersUnlocked: group.playersUnlocked,
    playerCount: group.players.length,
  })), [
    {
      khlTeamId: "team-avangard",
      teamBindingStatus: "CONFIRMED",
      playersUnlocked: true,
      playerCount: 1,
    },
    {
      khlTeamId: "team-lokomotiv",
      teamBindingStatus: "UNMAPPED",
      playersUnlocked: false,
      playerCount: 1,
    },
    {
      khlTeamId: "team-empty",
      teamBindingStatus: "UNMAPPED",
      playersUnlocked: false,
      playerCount: 0,
    },
  ]);
});

test("settings search and status filters narrow players inside their team group", () => {
  const teams = [team("team-avangard", "Авангард", "CONFIRMED")];
  const players = [
    player("1", "Первый Игрок", "team-avangard", "Авангард", "CONFIRMED"),
    player("2", "Второй Игрок", "team-avangard", "Авангард", "UNMAPPED"),
  ];
  const groups = groupKhlSettingsPlayersByTeam(players, teams);

  const searched = filterKhlSettingsTeamPlayerGroups(groups, "Второй", "ALL");
  assert.deepEqual(searched[0]?.players.map((candidate) => candidate.name), ["Второй Игрок"]);

  const confirmed = filterKhlSettingsTeamPlayerGroups(groups, "", "CONFIRMED");
  assert.deepEqual(confirmed[0]?.players.map((candidate) => candidate.name), ["Первый Игрок"]);
  assert.equal(confirmed[0]?.confirmedCount, 1);

  const unmapped = filterKhlSettingsTeamPlayerGroups(groups, "", "UNMAPPED");
  assert.deepEqual(unmapped[0]?.players.map((candidate) => candidate.name), ["Второй Игрок"]);
  assert.equal(unmapped[0]?.confirmedCount, 0);
});

function player(
  khlPlayerId: string,
  name: string,
  khlTeamId: string | null,
  teamName: string | null,
  adminBindingStatus: string
): SettingsPlayer {
  return {
    khlPlayerId,
    name,
    role: "F",
    adminPlayerId: adminBindingStatus === "CONFIRMED" ? `admin-${khlPlayerId}` : null,
    adminBindingStatus,
    matchCount: 1,
    recentAppearance: khlTeamId && teamName ? {
      khlGameId: "901973",
      startsAt: "2026-05-21T16:30:00.000Z",
      team: { khlTeamId, name: teamName },
      adminMatchPlayerId: null,
      adminBindingStatus: "UNMAPPED",
    } : null,
  };
}

function team(
  khlTeamId: string,
  name: string,
  adminBindingStatus: string
): SettingsTeam {
  return {
    khlTeamId,
    name,
    location: null,
    adminTeamId: adminBindingStatus === "CONFIRMED" ? `admin-${khlTeamId}` : null,
    adminBindingStatus,
    matchCount: 1,
  };
}
