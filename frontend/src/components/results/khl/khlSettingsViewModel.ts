import type { SettingsPlayer } from "@/components/results/khl/types";

export type KhlSettingsPlayerTeamGroup = {
  key: string;
  khlTeamId: string | null;
  teamName: string;
  confirmedCount: number;
  players: SettingsPlayer[];
};

const UNASSIGNED_GROUP_KEY = "unassigned";
const playerCollator = new Intl.Collator("ru-RU", { sensitivity: "base", numeric: true });

export function groupKhlSettingsPlayersByTeam(
  players: readonly SettingsPlayer[]
): KhlSettingsPlayerTeamGroup[] {
  const grouped = new Map<string, KhlSettingsPlayerTeamGroup>();

  for (const player of players) {
    const team = player.recentAppearance?.team || null;
    const key = team?.khlTeamId || UNASSIGNED_GROUP_KEY;
    const current = grouped.get(key);
    grouped.set(key, {
      key,
      khlTeamId: team?.khlTeamId || null,
      teamName: team?.name || "Без команды",
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
