import { booleanValue, list, nullable, numberValue, objectValue, optional, textValue, type Decoder } from "@/services/responseSchema";

export const decodeAdminMapping = objectValue({ adminShapkaId: optional(nullable(textValue)), adminShapkaName: optional(nullable(textValue)) });
export const decodeSavedAdminMapping = objectValue({ adminShapkaId: textValue, adminShapkaName: optional(nullable(textValue)) });
const teamId: Decoder<number | ""> = (value, path) => value === "" ? "" : numberValue(value, path);
const payload = objectValue({ shapka: numberValue, sport: numberValue, max: numberValue, match: list(objectValue({ date: textValue, team1: numberValue, team2: teamId })) });
export const decodeAdminPreview = objectValue({
  ok: booleanValue, phpArray: nullable(list(payload)), serialized: textValue, postBody: textValue,
  readyMatchesCount: numberValue, skippedMatches: list(objectValue({ matchId: textValue, teams: textValue, reason: textValue })), warnings: list(textValue),
});
export const decodeAdminSend = objectValue({
  ok: booleanValue, error: optional(textValue), warnings: optional(list(textValue)), rawResponse: optional(textValue), markedMatchesCount: optional(numberValue),
  status: optional((value: unknown, path?: string) => typeof value === "number" ? String(numberValue(value, path)) : textValue(value, path)),
});
export const decodeMarkedMatches = objectValue({ ok: booleanValue, error: optional(textValue), markedMatchesCount: numberValue });
