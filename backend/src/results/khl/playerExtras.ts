import type {
  KhlTeamSide,
  NormalizedKhlMatch,
} from "@backend/sources/results/khl/normalize";

export const KHL_PLAYER_EXTRAS_VERSION = "khl-player-extras-v1" as const;

export const KHL_PLAYER_EXTRA_DEFINITIONS = [
  { code: "scores", label: "забьёт" },
  { code: "scores_and_assists", label: "забьёт и отдаст голевую передачу" },
  { code: "assists", label: "отдаст голевую передачу" },
  { code: "points_p1", label: "наберёт очки в 1-м периоде" },
  { code: "points_p2", label: "наберёт очки во 2-м периоде" },
  { code: "points_p3", label: "наберёт очки в 3-м периоде" },
  { code: "scores_p1", label: "забьёт в 1-м периоде" },
  { code: "scores_p2", label: "забьёт во 2-м периоде" },
  { code: "scores_p3", label: "забьёт в 3-м периоде" },
] as const;

export type KhlPlayerExtraCode = typeof KHL_PLAYER_EXTRA_DEFINITIONS[number]["code"];

export type KhlPlayerExtraValue = {
  code: KhlPlayerExtraCode;
  label: string;
  value: boolean | null;
};

export type KhlPlayerExtrasProjection = {
  version: typeof KHL_PLAYER_EXTRAS_VERSION;
  available: boolean;
  issues: string[];
  players: Array<{
    khlPlayerId: string | null;
    apiPlayerId: string;
    teamSide: KhlTeamSide;
    name: string;
    extras: KhlPlayerExtraValue[];
  }>;
};

type PeriodTotals = Record<"P1" | "P2" | "P3", { goals: number; assists: number }>;

const REGULATION_SEGMENTS = ["P1", "P2", "P3"] as const;

export function formatKhlPlayerExtraLabel(playerName: string, code: KhlPlayerExtraCode) {
  const definition = KHL_PLAYER_EXTRA_DEFINITIONS.find((candidate) => candidate.code === code);
  if (!definition) throw new Error(`Unknown KHL player extra code: ${code}`);
  return `${playerName} ${definition.label}`;
}

export function isKhlPlayerExtraCode(value: string): value is KhlPlayerExtraCode {
  return KHL_PLAYER_EXTRA_DEFINITIONS.some((definition) => definition.code === value);
}

export function projectKhlPlayerExtras(match: NormalizedKhlMatch): KhlPlayerExtrasProjection {
  const issues: string[] = [];
  const playerByKey = new Map<string, NormalizedKhlMatch["players"]>();
  const totalsByKey = new Map<string, PeriodTotals>();

  for (const player of match.players) {
    const key = playerKey(player.teamSide, player.apiPlayerId);
    const bucket = playerByKey.get(key) || [];
    playerByKey.set(key, [...bucket, player]);
    totalsByKey.set(key, emptyPeriodTotals());
  }

  for (const [key, candidates] of playerByKey) {
    if (candidates.length !== 1) {
      issues.push(`Участник ${key} встречается в составе ${candidates.length} раза.`);
    }
  }

  if (match.status !== "finished") {
    issues.push("Матч ещё не завершён: допы игроков нельзя рассчитывать окончательно.");
  }

  let eventScores = Object.fromEntries(REGULATION_SEGMENTS.map((segment) => [
    segment,
    { home: 0, away: 0 },
  ])) as Record<typeof REGULATION_SEGMENTS[number], Record<KhlTeamSide, number>>;

  for (const goal of match.goals) {
    if (!isRegulationSegment(goal.segment)) continue;
    eventScores = {
      ...eventScores,
      [goal.segment]: {
        ...eventScores[goal.segment],
        [goal.teamSide]: eventScores[goal.segment][goal.teamSide] + 1,
      },
    };

    const scorerKey = resolveActorKey(
      playerByKey,
      goal.teamSide,
      goal.scorer.apiPlayerId,
      `${goal.segment}: автор гола`,
      issues
    );
    if (scorerKey) incrementPeriodTotal(totalsByKey, scorerKey, goal.segment, "goals");

    if (goal.assistants.length > 2) {
      issues.push(`${goal.segment}: у гола указано больше двух ассистентов.`);
    }
    const seenActors = new Set<string>(scorerKey ? [scorerKey] : []);
    for (const assistant of goal.assistants) {
      const assistantKey = resolveActorKey(
        playerByKey,
        goal.teamSide,
        assistant.apiPlayerId,
        `${goal.segment}: ассистент`,
        issues
      );
      if (!assistantKey) continue;
      if (seenActors.has(assistantKey)) {
        issues.push(`${goal.segment}: участник гола повторён среди автора и ассистентов.`);
        continue;
      }
      seenActors.add(assistantKey);
      incrementPeriodTotal(totalsByKey, assistantKey, goal.segment, "assists");
    }
  }

  for (const segment of REGULATION_SEGMENTS) {
    const stored = match.scores.segments[segment];
    if (!stored) {
      issues.push(`${segment}: официальный счёт периода отсутствует.`);
      continue;
    }
    for (const side of ["home", "away"] as const) {
      if (!Number.isSafeInteger(stored[side]) || stored[side] < 0) {
        issues.push(`${segment}: официальный счёт команды ${side} некорректен.`);
      } else if (stored[side] !== eventScores[segment][side]) {
        issues.push(
          `${segment}: голы команды ${side} в событиях (${eventScores[segment][side]}) `
          + `не совпадают со счётом периода (${stored[side]}).`
        );
      }
    }
  }

  for (const player of match.players) {
    const totals = totalsByKey.get(playerKey(player.teamSide, player.apiPlayerId));
    if (!totals) continue;
    const calculated = sumTotals(totals);
    if (
      calculated.goals !== player.regulation.goals
      || calculated.assists !== player.regulation.assists
      || calculated.goals + calculated.assists !== player.regulation.points
    ) {
      issues.push(
        `Статистика участника ${player.name} (${player.teamSide}:${player.apiPlayerId}) `
        + "не совпадает со структурированными событиями голов."
      );
    }
  }

  const uniqueIssues = [...new Set(issues)];
  const available = uniqueIssues.length === 0;
  return {
    version: KHL_PLAYER_EXTRAS_VERSION,
    available,
    issues: uniqueIssues,
    players: match.players.map((player) => {
      const totals = totalsByKey.get(playerKey(player.teamSide, player.apiPlayerId))
        || emptyPeriodTotals();
      return {
        khlPlayerId: player.khlPlayerId,
        apiPlayerId: player.apiPlayerId,
        teamSide: player.teamSide,
        name: player.name,
        extras: buildValues(player.name, totals, available),
      };
    }),
  };
}

function buildValues(playerName: string, totals: PeriodTotals, available: boolean) {
  const regulation = sumTotals(totals);
  const values: Record<KhlPlayerExtraCode, boolean> = {
    scores: regulation.goals > 0,
    scores_and_assists: regulation.goals > 0 && regulation.assists > 0,
    assists: regulation.assists > 0,
    points_p1: totals.P1.goals + totals.P1.assists > 0,
    points_p2: totals.P2.goals + totals.P2.assists > 0,
    points_p3: totals.P3.goals + totals.P3.assists > 0,
    scores_p1: totals.P1.goals > 0,
    scores_p2: totals.P2.goals > 0,
    scores_p3: totals.P3.goals > 0,
  };
  return KHL_PLAYER_EXTRA_DEFINITIONS.map((definition) => ({
    code: definition.code,
    label: formatKhlPlayerExtraLabel(playerName, definition.code),
    value: available ? values[definition.code] : null,
  }));
}

function resolveActorKey(
  players: Map<string, NormalizedKhlMatch["players"]>,
  side: KhlTeamSide,
  apiPlayerId: string | null,
  context: string,
  issues: string[]
) {
  if (!apiPlayerId) {
    issues.push(`${context}: у участника отсутствует API ID.`);
    return null;
  }
  const key = playerKey(side, apiPlayerId);
  const matches = players.get(key) || [];
  if (matches.length !== 1) {
    issues.push(`${context}: участник ${side}:${apiPlayerId} не найден однозначно в составе.`);
    return null;
  }
  return key;
}

function playerKey(side: KhlTeamSide, apiPlayerId: string) {
  return `${side}:${apiPlayerId}`;
}

function isRegulationSegment(value: string): value is typeof REGULATION_SEGMENTS[number] {
  return value === "P1" || value === "P2" || value === "P3";
}

function emptyPeriodTotals(): PeriodTotals {
  return {
    P1: { goals: 0, assists: 0 },
    P2: { goals: 0, assists: 0 },
    P3: { goals: 0, assists: 0 },
  };
}

function incrementPeriodTotal(
  totalsByKey: Map<string, PeriodTotals>,
  key: string,
  segment: keyof PeriodTotals,
  field: "goals" | "assists"
) {
  const current = totalsByKey.get(key) || emptyPeriodTotals();
  totalsByKey.set(key, {
    ...current,
    [segment]: {
      ...current[segment],
      [field]: current[segment][field] + 1,
    },
  });
}

function sumTotals(totals: PeriodTotals) {
  return REGULATION_SEGMENTS.reduce((sum, segment) => ({
    goals: sum.goals + totals[segment].goals,
    assists: sum.assists + totals[segment].assists,
  }), { goals: 0, assists: 0 });
}
