import { normalizeTeamName } from "@backend/teams/teams";
import type { ManualImportRawMatch } from "./buildManualFixtPayload";

export const MANUAL_IMPORT_MAX_IMAGES = 20;
export const MANUAL_IMPORT_IMAGE_BATCH_CONCURRENCY = 3;

export type ImageRecognitionStatus = "queued" | "preparing" | "ai" | "success" | "empty" | "error" | "ocr";

export type ManualImportBatchItemLike = {
  status: ImageRecognitionStatus;
  rawMatches?: ManualImportRawMatch[];
};

export type BatchRecognitionSummary = {
  total: number;
  success: number;
  empty: number;
  error: number;
  matches: number;
  duplicatesRemoved: number;
};

export function selectManualImportImageHashes(
  currentHashes: Iterable<string>,
  incomingHashes: Iterable<string>,
  maxImages = MANUAL_IMPORT_MAX_IMAGES
) {
  const usedHashes = new Set(Array.from(currentHashes).filter(Boolean));
  const acceptedHashes: string[] = [];
  let duplicateCount = 0;
  let overflowCount = 0;

  for (const hash of incomingHashes) {
    if (!hash) continue;
    if (usedHashes.has(hash)) {
      duplicateCount++;
      continue;
    }
    // usedHashes уже включает принятые в этом проходе изображения: каждое занимает ровно одно место.
    if (usedHashes.size >= maxImages) {
      overflowCount++;
      continue;
    }
    usedHashes.add(hash);
    acceptedHashes.push(hash);
  }

  return { acceptedHashes, duplicateCount, overflowCount };
}

export function dedupeManualImportBatchMatches(matches: ManualImportRawMatch[]) {
  const seen = new Set<string>();
  const deduped: ManualImportRawMatch[] = [];
  let duplicatesRemoved = 0;

  for (const match of matches) {
    const key = getManualImportMatchDedupeKey(match);
    if (key && seen.has(key)) {
      duplicatesRemoved++;
      continue;
    }
    if (key) seen.add(key);
    deduped.push(match);
  }

  return { matches: deduped, duplicatesRemoved };
}

export function buildManualImportBatchSummary(
  items: ManualImportBatchItemLike[],
  matchesCount: number,
  duplicatesRemoved = 0
): BatchRecognitionSummary {
  return {
    total: items.length,
    success: items.filter((item) => item.status === "success" || item.status === "ocr").length,
    empty: items.filter((item) => item.status === "empty").length,
    error: items.filter((item) => item.status === "error").length,
    matches: matchesCount,
    duplicatesRemoved,
  };
}

function getManualImportMatchDedupeKey(match: ManualImportRawMatch) {
  const date = readString(match.date);
  const team1 = readTeamName(match.team1);
  const team2 = readTeamName(match.team2);
  if (!date || !team1 || !team2) return "";

  const normalizedTeams = [normalizeTeamName(team1), normalizeTeamName(team2)].sort();
  return `${date.trim()}::${normalizedTeams[0]}::${normalizedTeams[1]}`;
}

function readTeamName(value: unknown) {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (value && typeof value === "object") {
    const record = value as { name?: unknown };
    return readString(record.name);
  }
  return "";
}

function readString(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}
