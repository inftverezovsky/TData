import assert from "node:assert/strict";
import test from "node:test";

import { groupKhlSettingsPlayersByTeam } from "../frontend/src/components/results/khl/khlSettingsViewModel";
import type { SettingsPlayer } from "../frontend/src/components/results/khl/types";

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
