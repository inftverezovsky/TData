import { booleanValue, enumValue, list, nullable, numberValue, objectValue, optional, textValue, type Decoder } from "@/services/responseSchema";
import type { AdminTeamSuggestion, AutoMappingPreview, AutoMappingPreviewItem, TeamMappingRecord } from "./types";

const maybeText = optional(nullable(textValue));
const maybeNumber = optional(nullable(numberValue));
const mapping: Decoder<TeamMappingRecord> = objectValue({
  id: textValue, liquipediaName: textValue, alias: nullable(textValue), canonicalName: nullable(textValue), platformId: nullable(textValue), logoUrl: maybeText,
  confidenceScore: nullable(numberValue), status: textValue, matchMethod: nullable(textValue), isManual: booleanValue, isLockedFromAutoMapping: booleanValue,
  displayAdminName: optional(textValue), adminTeamName: maybeText, nameSource: optional(enumValue(["admin", "manual", "missing"] as const)),
});
const previewItem: Decoder<AutoMappingPreviewItem> = objectValue({
  liquipediaName: textValue, platformId: maybeText, adminName: maybeText, matchedName: maybeText, score: maybeNumber,
  secondAdminName: maybeText, secondScore: maybeNumber, existingPlatformId: maybeText, reason: maybeText, matchMethod: maybeText,
});
export const decodeAutoMappingPreview: Decoder<AutoMappingPreview> = objectValue({
  adminTeamsCount: numberValue, liquipediaTeamsFound: numberValue, alreadyMappedCount: numberValue,
  auto: list(previewItem), suggested: list(previewItem), ambiguous: list(previewItem), unmapped: list(previewItem), invalid: list(previewItem), conflicts: list(previewItem),
});
export const decodeAutoMappingResponse = objectValue({
  success: booleanValue, error: optional(textValue), preview: optional(decodeAutoMappingPreview),
  result: optional(objectValue({ appliedCount: numberValue, preview: optional(decodeAutoMappingPreview) })),
});
export const decodeMappingSaveResponse = objectValue({ mapping });
const suggestion: Decoder<AdminTeamSuggestion> = objectValue({
  platformId: textValue, platformName: textValue, platformNameRu: maybeText, platformNameEn: maybeText, matchedName: maybeText,
  score: numberValue, matchType: enumValue(["exact", "starts_with", "contains", "fuzzy"] as const),
});
export const decodeTeamSuggestions = objectValue({ items: list(suggestion), adminTeamsCount: nullable(numberValue) });
