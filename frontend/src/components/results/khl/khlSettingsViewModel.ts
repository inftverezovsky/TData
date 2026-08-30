import type {
  SettingsDirectory,
  SettingsPlayer,
  SettingsTeam,
} from "@/components/results/khl/types";

export type KhlSettingsPlayerTeamGroup = {
  key: string;
  khlTeamId: string | null;
  teamName: string;
  team: SettingsTeam | null;
  playersUnlocked: boolean;
  confirmedCount: number;
  players: SettingsPlayer[];
};

const UNASSIGNED_GROUP_KEY = "unassigned";
const TEAM_STAT_CODES = [
  "shots_on_goal",
  "faceoffs_won",
  "power_play_goals",
  "penalty_minutes_2_4",
] as const;
const PLAYER_STAT_CODES = ["goals", "assists", "points"] as const;
const playerCollator = new Intl.Collator("ru-RU", { sensitivity: "base", numeric: true });

export function groupKhlSettingsPlayersByTeam(
  players: readonly SettingsPlayer[],
  teams: readonly SettingsTeam[] = []
): KhlSettingsPlayerTeamGroup[] {
  const grouped = new Map<string, KhlSettingsPlayerTeamGroup>();

  for (const team of teams) {
    grouped.set(team.khlTeamId, {
      key: team.khlTeamId,
      khlTeamId: team.khlTeamId,
      teamName: team.name,
      team,
      playersUnlocked: team.adminBindingStatus === "CONFIRMED",
      confirmedCount: 0,
      players: [],
    });
  }

  for (const player of players) {
    const team = player.recentAppearance?.team || null;
    const key = team?.khlTeamId || UNASSIGNED_GROUP_KEY;
    const current = grouped.get(key);
    grouped.set(key, {
      key,
      khlTeamId: team?.khlTeamId || null,
      teamName: current?.teamName || team?.name || "Без команды",
      team: current?.team || null,
      playersUnlocked: current?.playersUnlocked || false,
      confirmedCount: (current?.confirmedCount || 0)
        + (player.adminBindingStatus === "CONFIRMED" ? 1 : 0),
      players: [...(current?.players || []), player],
    });
  }

  return [...grouped.values()]
    .map((group) => ({
      ...group,
      players: [...group.players].sort((left, right) => playerCollator.compare(left.name, right.name)),
    }))
    .sort((left, right) => {
      if (left.khlTeamId === null) return 1;
      if (right.khlTeamId === null) return -1;
      return playerCollator.compare(left.teamName, right.teamName);
    });
}

export function filterKhlSettingsTeamPlayerGroups(
  groups: readonly KhlSettingsPlayerTeamGroup[],
  query: string,
  status: string
): KhlSettingsPlayerTeamGroup[] {
  const normalized = query.trim().toLocaleLowerCase("ru-RU");

  return groups.flatMap((group) => {
    const teamMatchesQuery = !normalized || [
      group.teamName,
      group.khlTeamId || "",
      group.team?.location || "",
      group.team?.adminTeamId || "",
    ].some((value) => value.toLocaleLowerCase("ru-RU").includes(normalized));
    const teamComplete = group.team ? hasCompleteTeamBindings(group.team) : false;
    const teamMatchesStatus = status === "ALL"
      || (status === "CONFIRMED" ? teamComplete : !teamComplete);
    const players = group.players.filter((player) => {
      const playerMatchesStatus = status === "ALL" || player.adminBindingStatus === status;
      const playerMatchesQuery = !normalized || teamMatchesQuery || [
        player.name,
        player.khlPlayerId,
        player.adminPlayerId || "",
      ].some((value) => value.toLocaleLowerCase("ru-RU").includes(normalized));
      return playerMatchesStatus && playerMatchesQuery;
    });

    if (status === "CONFIRMED" && group.team && !teamComplete) return [];
    if (!(teamMatchesQuery && teamMatchesStatus) && players.length === 0) return [];
    return [{
      ...group,
      confirmedCount: players.filter((player) => player.adminBindingStatus === "CONFIRMED").length,
      players,
    }];
  });
}

export function areKhlTargetBindingPrerequisitesReady(
  match: {
    adminBindingStatus: string;
    homeTeam: { khlTeamId: string; adminBindingStatus: string };
    awayTeam: { khlTeamId: string; adminBindingStatus: string };
  },
  directory: SettingsDirectory | null
) {
  if (
    !directory
    || match.adminBindingStatus !== "CONFIRMED"
    || match.homeTeam.adminBindingStatus !== "CONFIRMED"
    || match.awayTeam.adminBindingStatus !== "CONFIRMED"
  ) {
    return false;
  }

  const typesComplete = [
    ...TEAM_STAT_CODES.map((semanticCode) => `TEAM:${semanticCode}`),
    ...PLAYER_STAT_CODES.map((semanticCode) => `PLAYER:${semanticCode}`),
  ].every((key) => directory.statMappings.some((mapping) => (
    `${mapping.scope}:${mapping.semanticCode}` === key
    && mapping.adminBindingStatus === "CONFIRMED"
    && Boolean(mapping.adminStatTypeId)
  )));
  if (!typesComplete) return false;

  return [match.homeTeam.khlTeamId, match.awayTeam.khlTeamId].every((khlTeamId) => {
    const team = directory.teams.find((candidate) => candidate.khlTeamId === khlTeamId);
    return Boolean(team && hasCompleteTeamBindings(team));
  });
}

function hasCompleteTeamBindings(team: SettingsTeam) {
  return team.adminBindingStatus === "CONFIRMED" && TEAM_STAT_CODES.every((semanticCode) => {
    const binding = team.statBindings.find((candidate) => candidate.semanticCode === semanticCode);
    return binding?.adminBindingStatus === "CONFIRMED" && Boolean(binding.adminTeamStatId);
  });
}
