import { booleanValue, enumValue, list, nullable, numberValue, objectValue, optional, recordValue, textValue, withDefault, type Decoder } from "@/services/responseSchema";
import type { ManualMatch, MappedMatch, ManualMappingConflict, ParseSource, PreviewData, TeamImportResult } from "./types";

export const decodeManualMatch: Decoder<ManualMatch> = objectValue({
  id: optional(textValue), tournament: optional(textValue), team1: textValue, team2: textValue, date: textValue,
  team1PlatformId: optional(textValue), team2PlatformId: optional(textValue),
});
const decodeTeam = objectValue({
  name: textValue, platformId: nullable(textValue),
  source: optional(enumValue(["explicit", "manual", "team_mapping", "admin_team", "embedded", null] as const)),
});
export const decodeMappedMatch: Decoder<MappedMatch> = objectValue({
  id: textValue, tournament: textValue, team1: decodeTeam, team2: decodeTeam, date: textValue, isReady: booleanValue,
});
const decodeConflict: Decoder<ManualMappingConflict> = objectValue({
  teamName: textValue, normalizedTeamName: textValue, existingPlatformId: textValue, incomingPlatformId: textValue,
});
const decodeParseSource: Decoder<ParseSource> = enumValue(["local-text", "local-ocr", "ocr-cache", "ai", "fallback", ""] as const);
const decodeTimings: Decoder<Record<string, number>> = (value, path = "timings") => Object.fromEntries(
  Object.entries(recordValue(value, path)).map(([key, duration]) => [key, numberValue(duration, `${path}.${key}`)]),
);

/** Декодируем фактические API-поля до обновления состояния; неизвестные объекты никогда не становятся JSX-значениями. */
export const decodeManualResponse = objectValue({
  ok: booleanValue, error: optional(textValue),
  rawMatches: optional(list(decodeManualMatch)), mappedMatches: optional(list(decodeMappedMatch)),
  normalizedText: optional(textValue), ocrText: optional(textValue), ocrConfidence: optional(nullable(numberValue)),
  parseSource: optional(decodeParseSource), warnings: optional(list(textValue)), timings: optional(decodeTimings), cached: optional(booleanValue),
  conflicts: optional(list(decodeConflict)),
  savedMappings: optional(list(objectValue({ teamName: optional(textValue), normalizedTeamName: optional(textValue), platformId: optional(textValue) }))),
  savedCount: optional(numberValue), skippedCount: optional(numberValue), conflictCount: optional(numberValue), overwrittenCount: optional(numberValue), readyMatchesCount: optional(numberValue),
  jsonUrl: optional(textValue), serviceUrl: optional(textValue), rawResponse: optional(textValue),
  status: optional((value: unknown, path?: string) => typeof value === "number" ? String(numberValue(value, path)) : textValue(value, path)),
});
export type ManualResponse = ReturnType<typeof decodeManualResponse>;
export type ManualParsedData = Partial<Pick<ManualResponse, "rawMatches" | "mappedMatches" | "normalizedText" | "parseSource" | "warnings" | "ocrText" | "ocrConfidence">>;

export const decodeManualPreview: Decoder<PreviewData> = objectValue({
  phpArray: nullable(list(objectValue({ shapka: numberValue, sport: numberValue, max: numberValue, match: list(objectValue({ date: textValue, team1: numberValue, team2: numberValue })) }))),
  phpArrayText: textValue, serialized: textValue, postBody: textValue, readyMatchesCount: numberValue,
  skippedMatches: list(objectValue({ matchId: textValue, teams: textValue, reason: textValue })),
  warnings: list(textValue), mappedMatches: list(decodeMappedMatch),
});

export const decodeTeamImportResult: Decoder<TeamImportResult> = objectValue({
  success: withDefault(booleanValue, true), importedCount: numberValue, skippedCount: optional(numberValue),
  detectedLayout: optional(objectValue({ headerRowIndex: numberValue, dataStartRow: numberValue, idCol: numberValue, nameCol: numberValue, source: enumValue(["header", "data"] as const) })),
  mappingResult: optional(objectValue({
    adminTeamsCount: numberValue, liquipediaTeamsFound: numberValue, autoMappedCount: numberValue,
    ambiguousCount: numberValue, unmappedCount: numberValue, newlyMappedNames: optional(list(textValue)),
  })),
});
