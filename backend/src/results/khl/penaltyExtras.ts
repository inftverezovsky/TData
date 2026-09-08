import type { KhlTeamSide, NormalizedKhlMatch, NormalizedKhlPenalty } from "@backend/sources/results/khl/normalize";
import { classifyKhlPenaltyReason, formatKhlPenaltyReason, isKhlGameMisconductReason } from "./penaltyReasons";

export { KHL_PENALTY_REASON_DEFINITIONS, type KhlPenaltyReasonCode } from "./penaltyReasons";

export const KHL_PENALTY_EXTRAS_VERSION = "khl-penalty-extras-v1" as const;

export const KHL_PENALTY_EXTRA_DEFINITIONS = [
  { code: "first_penalty_team", label: "Первое удаление (команда)", kind: "team" },
  { code: "last_penalty_team", label: "Последнее удаление (команда)", kind: "team" },
  { code: "has_five_minute_penalty", label: "5-ти минутное удаление (да/нет)", kind: "boolean" },
  { code: "has_ten_minute_penalty", label: "10-ти минутное удаление (да/нет)", kind: "boolean" },
  { code: "has_game_misconduct", label: "Дисциплинарный штраф до конца игры (да/нет)", kind: "boolean" },
  { code: "first_two_minute_penalty_type", label: "Первое 2-х минутное удаление (вид удаления)", kind: "penalty_type" },
  { code: "first_penalty_first_five_minutes", label: "Первое удаление с 1 по 5 мин (да/нет)", kind: "boolean" },
] as const;

export type KhlPenaltyExtraCode = typeof KHL_PENALTY_EXTRA_DEFINITIONS[number]["code"];
export type KhlPenaltyExtraKind = typeof KHL_PENALTY_EXTRA_DEFINITIONS[number]["kind"];
export type KhlPenaltyExtraEvidence = Pick<NormalizedKhlPenalty, "elapsedSeconds" | "teamSide" | "reason" | "durationMinutes">;
export type KhlPenaltyExtraValue = {
  code: KhlPenaltyExtraCode;
  label: string;
  kind: KhlPenaltyExtraKind;
  value: string | boolean | null;
  displayValue: string;
  issues: string[];
  evidence: KhlPenaltyExtraEvidence[];
};
export type KhlPenaltyExtrasProjection = {
  version: typeof KHL_PENALTY_EXTRAS_VERSION;
  scope: "regulation";
  available: boolean;
  issues: string[];
  extras: KhlPenaltyExtraValue[];
};
type Outcome = Pick<KhlPenaltyExtraValue, "value" | "displayValue" | "issues" | "evidence">;

export function isKhlPenaltyExtraCode(value: string): value is KhlPenaltyExtraCode {
  return KHL_PENALTY_EXTRA_DEFINITIONS.some((definition) => definition.code === value);
}

export function projectKhlPenaltyExtras(match: NormalizedKhlMatch): KhlPenaltyExtrasProjection {
  const baseIssues = getAvailabilityIssues(match);
  const penalties = match.penalties.filter((penalty) => /^P[123]$/.test(penalty.segment) && penalty.durationMinutes > 0)
    .sort(comparePenalties);
  const extras = KHL_PENALTY_EXTRA_DEFINITIONS.map((definition) => ({
    ...definition,
    ...(baseIssues.length ? unavailable(baseIssues) : projectOutcome(definition.code, penalties, match)),
  }));
  return {
    version: KHL_PENALTY_EXTRAS_VERSION,
    scope: "regulation",
    available: baseIssues.length === 0,
    issues: [...new Set([...baseIssues, ...extras.flatMap((extra) => extra.issues)])],
    extras,
  };
}

function getAvailabilityIssues(match: NormalizedKhlMatch): string[] {
  const evidence = (match as NormalizedKhlMatch & { penaltyEvidence?: { complete: boolean } }).penaltyEvidence;
  return [
    ...(match.status !== "finished" ? ["Матч ещё не завершён: допы штрафного времени нельзя рассчитывать окончательно."] : []),
    ...(!match.validation.ok ? ["Проверка статистики матча не пройдена: допы штрафного времени недоступны."] : []),
    ...(!(evidence?.complete ?? (match.penalties.length > 0)) ? ["Нет подтверждённого полного списка удалений."] : []),
    ...(match.penalties.some((penalty) => !Number.isFinite(penalty.elapsedSeconds) || penalty.elapsedSeconds < 0
      || !Number.isFinite(penalty.durationMinutes) || penalty.durationMinutes < 0)
      ? ["Некорректное время или длительность удаления в протоколе."] : []),
  ];
}

function projectOutcome(code: KhlPenaltyExtraCode, penalties: NormalizedKhlPenalty[], match: NormalizedKhlMatch): Outcome {
  switch (code) {
    case "first_penalty_team": return teamOutcome(atBoundary(penalties, "first"), match.teams);
    case "last_penalty_team": return teamOutcome(atBoundary(penalties, "last"), match.teams);
    case "has_five_minute_penalty": return occurrence(penalties.filter((penalty) => penalty.durationMinutes === 5));
    case "has_ten_minute_penalty": return occurrence(penalties.filter((penalty) => penalty.durationMinutes === 10));
    case "has_game_misconduct": return occurrence(penalties.filter((penalty) => penalty.durationMinutes === 20 && isKhlGameMisconductReason(penalty.reason)));
    case "first_two_minute_penalty_type": return reasonOutcome(atBoundary(penalties.filter((penalty) => penalty.durationMinutes === 2), "first"));
    case "first_penalty_first_five_minutes": return firstFiveMinutesOutcome(atBoundary(penalties, "first"));
  }
}

function comparePenalties(a: NormalizedKhlPenalty, b: NormalizedKhlPenalty) {
  return a.elapsedSeconds - b.elapsedSeconds || a.teamSide.localeCompare(b.teamSide)
    || a.durationMinutes - b.durationMinutes || a.reason.localeCompare(b.reason);
}

function atBoundary(penalties: NormalizedKhlPenalty[], boundary: "first" | "last") {
  const elapsedSeconds = boundary === "first" ? penalties[0]?.elapsedSeconds : penalties.at(-1)?.elapsedSeconds;
  return penalties.filter((penalty) => penalty.elapsedSeconds === elapsedSeconds);
}

function copyEvidence(penalties: NormalizedKhlPenalty[]): KhlPenaltyExtraEvidence[] {
  return penalties.map(({ elapsedSeconds, teamSide, durationMinutes, reason }) => ({ elapsedSeconds, teamSide, durationMinutes, reason }));
}

function unavailable(issues: string[], penalties: NormalizedKhlPenalty[] = [], displayValue = "Недоступно"): Outcome {
  return { value: null, displayValue, issues: [...issues], evidence: copyEvidence(penalties) };
}

function occurrence(penalties: NormalizedKhlPenalty[]): Outcome {
  const value = penalties.length > 0;
  return { value, displayValue: value ? "Да" : "Нет", issues: [], evidence: copyEvidence(penalties) };
}

function firstFiveMinutesOutcome(penalties: NormalizedKhlPenalty[]): Outcome {
  // The first through fifth game minutes are 00:00 inclusive to 05:00 exclusive.
  const value = penalties.some((penalty) => penalty.elapsedSeconds >= 0 && penalty.elapsedSeconds < 300);
  return { value, displayValue: value ? "Да" : "Нет", issues: [], evidence: copyEvidence(penalties) };
}

function teamOutcome(penalties: NormalizedKhlPenalty[], teams: NormalizedKhlMatch["teams"]): Outcome {
  const sides = [...new Set<KhlTeamSide>(penalties.map((penalty) => penalty.teamSide))];
  if (sides.length > 1) {
    return unavailable(["В это игровое время удалены обе команды; однозначную команду определить нельзя."], penalties, "Обе команды одновременно");
  }
  return { value: sides[0] ?? "none", displayValue: sides[0] ? teams[sides[0]].name : "Нет удаления", issues: [], evidence: copyEvidence(penalties) };
}

function reasonOutcome(penalties: NormalizedKhlPenalty[]): Outcome {
  const reasons = [...new Set(penalties.map((penalty) => classifyKhlPenaltyReason(penalty.reason)))];
  if (reasons.includes(null)) return unavailable(["В первом двухминутном удалении не указана причина."], penalties);
  if (reasons.length > 1) return unavailable(["Первые двухминутные удаления произошли одновременно и имеют разные виды."], penalties, "Несколько видов одновременно");
  const value = reasons[0] ?? "other_or_none";
  return { value, displayValue: formatKhlPenaltyReason(value), issues: [], evidence: copyEvidence(penalties) };
}
