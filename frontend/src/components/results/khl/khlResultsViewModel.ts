import { DateTime } from "luxon";

import type { KhlMatchProtocolView } from "@backend/results/khl/matchProtocol";
import { getKhlMatchReadiness, hasNewerRejectedRevision, khlMissingIdentityLabels, type KhlReadinessMatch } from "./khlProtocolReadiness";

export const KHL_RESULTS_TIME_ZONE = "Europe/Moscow";
export const KHL_RESULTS_CUTOFF_DATE_KEY = "2026-05-01";

export type KhlDatedResultMatch = {
  status: string;
  startsAt: string;
};

export type KhlProtocolResultMatch = KhlReadinessMatch & {
  id?: string;
  protocol: KhlMatchProtocolView | null;
};

type KhlRevisionPresentationInput = {
  khlGameId?: string;
  protocol?: KhlMatchProtocolView | null;
  activeRevision: { state: string; revisionNumber: number } | null;
  latestRevision: {
    state: string;
    revisionNumber: number;
    validationIssues?: unknown;
  } | null;
  displayRevision: {
    state: string;
    revisionNumber: number;
    source: string;
    validationIssues?: unknown;
  } | null;
};

export type KhlRevisionPresentation = {
  badgeLabel: string;
  badgeTone: "validated" | "warning" | "rejected" | "empty";
  excludeFromDaily: boolean;
  warning: null | {
    title: string;
    description: string;
    issues: string[];
  };
};

export type KhlTeamDaySummary = {
  khlTeamId: string;
  name: string;
  matchCount: number;
  regulationGoals: number;
  metrics: Array<{
    code: string;
    label: string;
    regulationTotal: number;
  }>;
};

export type KhlPlayerDaySummary = {
  rowKey: string;
  khlPlayerId: string | null;
  apiPlayerId?: string;
  sourceMatchId?: string;
  khlTeamId: string;
  name: string;
  matchCount: number;
  goals: number;
  assists: number;
  points: number;
};

export type KhlGameDayAggregation = {
  includedMatches: number;
  warningMatches: number;
  skippedMatches: number;
  teams: KhlTeamDaySummary[];
  players: KhlPlayerDaySummary[];
};

export function getKhlMoscowDateKey(value: Date | string) {
  const instant = parseInstant(value);
  if (!instant.isValid) {
    throw new RangeError("Invalid KHL result date");
  }
  return instant.setZone(KHL_RESULTS_TIME_ZONE).toISODate() as string;
}

export function getKhlMoscowDayBounds(dateKey: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new RangeError("Invalid KHL result date key");
  }

  const start = DateTime.fromISO(dateKey, { zone: KHL_RESULTS_TIME_ZONE });
  if (!start.isValid || start.toISODate() !== dateKey) {
    throw new RangeError("Invalid KHL result date key");
  }

  return {
    gte: start.toUTC().toISO({ suppressMilliseconds: false }) as string,
    lt: start.plus({ days: 1 }).toUTC().toISO({ suppressMilliseconds: false }) as string,
  };
}

export function partitionKhlResultsMatches<T extends KhlDatedResultMatch>(
  matches: readonly T[],
  now: Date | string = new Date()
) {
  const current = parseInstant(now);
  if (!current.isValid) {
    throw new RangeError("Invalid current date");
  }

  const todayKey = current.setZone(KHL_RESULTS_TIME_ZONE).toISODate() as string;
  const currentMillis = current.toMillis();
  const today: Array<{ match: T; startsAtMillis: number }> = [];
  const archive: Array<{ match: T; startsAtMillis: number }> = [];

  for (const match of matches) {
    if (match.status !== "FINISHED") continue;

    const startsAt = parseInstant(match.startsAt);
    if (!startsAt.isValid || startsAt.toMillis() > currentMillis) continue;

    const dateKey = startsAt.setZone(KHL_RESULTS_TIME_ZONE).toISODate() as string;
    if (dateKey < KHL_RESULTS_CUTOFF_DATE_KEY || dateKey > todayKey) continue;

    const item = { match, startsAtMillis: startsAt.toMillis() };
    if (dateKey === todayKey) today.push(item);
    else archive.push(item);
  }

  return {
    today: today
      .sort((left, right) => left.startsAtMillis - right.startsAtMillis)
      .map(({ match }) => match),
    archive: archive
      .sort((left, right) => right.startsAtMillis - left.startsAtMillis)
      .map(({ match }) => match),
  };
}

export function aggregateKhlGameDay(
  matches: readonly KhlProtocolResultMatch[]
): KhlGameDayAggregation {
  const teamAccumulators = new Map<string, TeamAccumulator>();
  const playerAccumulators = new Map<string, KhlPlayerDaySummary>();
  const seenMatches = new Set<string>();
  let includedMatches = 0;
  let warningMatches = 0;
  let skippedMatches = 0;

  for (const match of matches) {
    const matchKey = match.khlGameId || match.id;
    if (matchKey && seenMatches.has(matchKey)) continue;
    if (matchKey) seenMatches.add(matchKey);
    const protocol = match.protocol;
    const readiness = getKhlMatchReadiness(match);
    if (!protocol || readiness === "BLOCKED") {
      skippedMatches += 1;
      continue;
    }

    includedMatches += 1;
    if (readiness === "IDENTITY_WARNING") warningMatches += 1;
    accumulateTeam(teamAccumulators, protocol, "home");
    accumulateTeam(teamAccumulators, protocol, "away");

    for (const player of protocol.players) {
      // This is a UI row key, never a fabricated KHL identity or an Admin mapping.
      const rowKey = player.khlPlayerId === null
        ? JSON.stringify(["source", match.khlGameId, player.teamSide, player.apiPlayerId])
        : JSON.stringify(["khl", player.khlTeamId, player.khlPlayerId]);
      const existing = playerAccumulators.get(rowKey);
      playerAccumulators.set(rowKey, {
        rowKey,
        khlPlayerId: player.khlPlayerId,
        ...(player.khlPlayerId === null ? { apiPlayerId: player.apiPlayerId, sourceMatchId: match.khlGameId } : {}),
        khlTeamId: existing?.khlTeamId ?? player.khlTeamId,
        name: existing?.name ?? player.name,
        matchCount: (existing?.matchCount ?? 0) + 1,
        goals: (existing?.goals ?? 0) + player.regulation.goals,
        assists: (existing?.assists ?? 0) + player.regulation.assists,
        points: (existing?.points ?? 0) + player.regulation.points,
      });
    }
  }

  return {
    includedMatches,
    warningMatches,
    skippedMatches,
    teams: [...teamAccumulators.values()]
      .map(toTeamDaySummary)
      .sort(compareTeams),
    players: [...playerAccumulators.values()].sort(comparePlayers),
  };
}

export function getKhlRevisionPresentation(
  match: KhlRevisionPresentationInput
): KhlRevisionPresentation {
  if (getKhlMatchReadiness(match) === "IDENTITY_WARNING") {
    return {
      badgeLabel: "Статистика доступна · нет ID КХЛ",
      badgeTone: "warning",
      excludeFromDaily: false,
      warning: {
        title: "КХЛ не передала ID некоторых игроков",
        description: "Счёт и статистика учтены в итогах дня. Все игроки сохранены; игроки без ID не объединяются между матчами. Активация и staging заблокированы до подтверждения идентичности.",
        issues: khlMissingIdentityLabels(match.protocol!),
      },
    };
  }
  const latestRejected = hasNewerRejectedRevision(match);
  const issues = latestRejected
    ? validationIssueStrings(match.latestRevision?.validationIssues)
    : [];

  if (latestRejected && match.latestRevision
    && (!match.activeRevision || match.displayRevision?.source === "LATEST_REJECTED")) {
    const revisionNumber = match.latestRevision.revisionNumber;
    return {
      badgeLabel: `Непроверенная ревизия #${revisionNumber}`,
      badgeTone: "rejected",
      excludeFromDaily: true,
      warning: {
        title: `Непроверенная ревизия #${revisionNumber} · REJECTED`,
        description: "Показан диагностический normalized-протокол только для просмотра. Он исключён из статистики дня и доставки.",
        issues,
      },
    };
  }

  if (match.activeRevision?.state === "VALIDATED") {
    const revisionNumber = match.activeRevision.revisionNumber;
    return {
      badgeLabel: latestRejected
        ? `Протокол #${revisionNumber} · last-known-good`
        : `Протокол #${revisionNumber}`,
      badgeTone: "validated",
      excludeFromDaily: latestRejected,
      warning: latestRejected && match.latestRevision ? {
        title: `Непроверенная ревизия #${match.latestRevision.revisionNumber} · REJECTED`,
        description: `Показан последний проверенный протокол #${revisionNumber}. Более новая ревизия исключена из статистики дня и доставки.`,
        issues,
      } : null,
    };
  }

  const displayRevisionNumber = match.displayRevision?.revisionNumber;
  return {
    badgeLabel: displayRevisionNumber
      ? `Непроверенная ревизия #${displayRevisionNumber}`
      : "Нет сохранённой ревизии",
    badgeTone: displayRevisionNumber ? "rejected" : "empty",
    excludeFromDaily: true,
    warning: null,
  };
}

type TeamSide = "home" | "away";

type TeamAccumulator = Omit<KhlTeamDaySummary, "metrics"> & {
  metrics: Map<string, {
    code: string;
    label: string;
    regulationTotal: number;
  }>;
};

function parseInstant(value: Date | string) {
  if (value instanceof Date) return DateTime.fromJSDate(value);
  if (!/(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(value)) {
    return DateTime.invalid("KHL result timestamps require an explicit UTC offset");
  }
  return DateTime.fromISO(value, { setZone: true, zone: "UTC" });
}

function validationIssueStrings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((issue): issue is string => typeof issue === "string")
    : [];
}

function accumulateTeam(
  accumulators: Map<string, TeamAccumulator>,
  protocol: KhlMatchProtocolView,
  side: TeamSide
) {
  const team = protocol.teams[side];
  const existing = accumulators.get(team.khlTeamId);
  const metrics = new Map(existing?.metrics ?? []);

  for (const metric of team.metrics) {
    const accumulatedMetric = metrics.get(metric.code);
    metrics.set(metric.code, {
      code: metric.code,
      label: accumulatedMetric?.label ?? metric.label,
      regulationTotal:
        (accumulatedMetric?.regulationTotal ?? 0) + metric.regulationTotal,
    });
  }

  accumulators.set(team.khlTeamId, {
    khlTeamId: team.khlTeamId,
    name: existing?.name ?? team.name,
    matchCount: (existing?.matchCount ?? 0) + 1,
    regulationGoals:
      (existing?.regulationGoals ?? 0) + protocol.scores.regulation[side],
    metrics,
  });
}

function toTeamDaySummary(team: TeamAccumulator): KhlTeamDaySummary {
  return {
    khlTeamId: team.khlTeamId,
    name: team.name,
    matchCount: team.matchCount,
    regulationGoals: team.regulationGoals,
    metrics: [...team.metrics.values()].sort((left, right) =>
      left.code.localeCompare(right.code)
    ),
  };
}

function compareTeams(left: KhlTeamDaySummary, right: KhlTeamDaySummary) {
  return left.name.localeCompare(right.name, "ru") || left.khlTeamId.localeCompare(right.khlTeamId);
}

function comparePlayers(left: KhlPlayerDaySummary, right: KhlPlayerDaySummary) {
  return (
    right.points - left.points ||
    right.goals - left.goals ||
    right.assists - left.assists ||
    left.name.localeCompare(right.name, "ru") ||
    left.rowKey.localeCompare(right.rowKey)
  );
}
