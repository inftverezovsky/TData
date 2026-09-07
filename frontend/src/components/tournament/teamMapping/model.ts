import { buildTeamMappingLookup, findTeamMapping } from "@backend/teams/mappingLookup";
import type { TeamMappingRecord, AutoMappingPreviewItem, AdminTeamSuggestion } from "./types";

/** Чистая модель сопоставлений и подписи статусов; исходные записи сервера не изменяются. */
export function buildMappingState(teamNames: string[], initialMappings: TeamMappingRecord[]) {
  const map: Record<string, Partial<TeamMappingRecord> & { saved: boolean }> = {};
  const mappingLookup = buildTeamMappingLookup(initialMappings);

  for (const name of teamNames) {
    const existing = findTeamMapping(mappingLookup, name);
    map[name] = {
      ...existing,
      saved: Boolean(existing?.platformId)
    };
  }
  return map;
}

export function getPreviewSelectionKey(item: AutoMappingPreviewItem) {
  return `${item.liquipediaName.trim().toLowerCase()}\u0000${String(item.platformId || "").trim()}`;
}

export function isValidPlatformId(value: string | null | undefined) {
  return /^[1-9]\d*$/.test(String(value || "").trim());
}

export function formatScore(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value).toFixed(1) : "0.0";
}

export function formatMappingStatus(status: string | null | undefined) {
  switch (status) {
    case "auto_mapped":
      return "Авто";
    case "manual_mapped":
      return "Ручное";
    case "manual_unmapped":
      return "Очищено";
    case "ambiguous":
      return "Спорно";
    case "unmapped":
    case undefined:
    case null:
    case "":
      return "Без ID";
    default:
      return status.replace(/_/g, " ");
  }
}

export function formatPreviewReason(reason: string | null | undefined) {
  switch (reason) {
    case "score_below_threshold":
      return "сходство ниже порога";
    case "parser_artifact":
      return "мусор парсинга";
    case "locked_manual_conflict":
      return "конфликт с ручным ID";
    case "no_admin_teams":
      return "справочник админ-команд не импортирован";
    case "no_candidates":
      return "нет кандидатов";
    case "already_mapped":
      return "уже привязано";
    default:
      return reason ? reason.replace(/_/g, " ") : "";
  }
}

export function formatSuggestionAlternateName(item: AdminTeamSuggestion) {
  const matched = item.matchedName?.trim();
  const names = [item.platformNameRu, item.platformNameEn, item.platformName]
    .map((name) => String(name || "").trim())
    .filter((name) => name && name !== matched);
  return Array.from(new Set(names))[0] || "";
}

export function formatSuggestionMatchType(matchType: AdminTeamSuggestion["matchType"]) {
  switch (matchType) {
    case "exact":
      return "точно";
    case "starts_with":
      return "начало";
    case "contains":
      return "внутри";
    case "fuzzy":
      return "похоже";
    default:
      return "найдено";
  }
}

export function formatMatchMethod(method: string | null | undefined) {
  switch (method) {
    case "exact":
      return "точное совпадение";
    case "alias_exact":
      return "точное совпадение по алиасу";
    case "pair_exact":
      return "точное совпадение пары";
    case "pair_fuzzy":
      return "похожая пара";
    case "initials_fuzzy":
      return "совпадение по инициалам";
    case "translit_fuzzy":
      return "совпадение через транслитерацию";
    case "normalized_exact":
      return "точное совпадение после нормализации";
    case "token_fuzzy":
      return "похожее название";
    case "levenshtein":
      return "похожее написание";
    case "manual":
    case "manual_save":
    case "manual_bulk":
    case "manual_suggest":
      return "ручной ввод";
    case "manual_conflict_replace":
      return "замена конфликта вручную";
    case "auto_apply":
      return "авто-применение";
    default:
      return method ? method.replace(/_/g, " ") : "не указан";
  }
}
/** Стрелки перебирают варианты по кругу; пустой список не получает активного элемента. */
export function nextSuggestionIndex(current: number, direction: -1 | 1, count: number) {
  if (count <= 0) return -1;
  if (current < 0) return direction === 1 ? 0 : count - 1;
  return (current + direction + count) % count;
}
