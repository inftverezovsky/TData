import type { ImageRecognitionStatus } from "@backend/manualImport/imageBatch";
import type { ManualFixtPayload } from "@backend/manualImport/buildManualFixtPayload";

/** Контракты экрана: исходные матчи → сопоставленные команды → предпросмотр отправки. */
export type ManualMatch = {
  id?: string;
  tournament?: string;
  team1: string;
  team2: string;
  team1PlatformId?: string;
  team2PlatformId?: string;
  date: string;
};

export type MappedMatch = {
  id: string;
  tournament: string;
  team1: { name: string; platformId: string | null; source?: TeamPlatformIdSource };
  team2: { name: string; platformId: string | null; source?: TeamPlatformIdSource };
  date: string;
  isReady: boolean;
};

export type TeamSide = "team1" | "team2";
export type TeamPlatformIdSource = "explicit" | "manual" | "team_mapping" | "admin_team" | "embedded" | null;

export type PreviewData = {
  phpArray: ManualFixtPayload[] | null;
  phpArrayText: string;
  serialized: string;
  postBody: string;
  readyMatchesCount: number;
  skippedMatches: Array<{ matchId: string; teams: string; reason: string }>;
  warnings: string[];
  mappedMatches: MappedMatch[];
};

export type ResultMessage = {
  type: "success" | "error" | "info";
  text: string;
  raw?: string;
};

export type ParseSource = "local-text" | "local-ocr" | "ocr-cache" | "ai" | "fallback" | "";
export type ParseMode = "auto" | "text" | "ai";
export type RecognitionStage = "idle" | "preparing" | "ocr" | "local-parser" | "ai-fallback" | "mapping" | "done";

export type TeamImportResult = {
  success: boolean;
  importedCount: number;
  skippedCount?: number;
  detectedLayout?: {
    headerRowIndex: number;
    dataStartRow: number;
    idCol: number;
    nameCol: number;
    source: "header" | "data";
  };
  mappingResult?: {
    adminTeamsCount: number;
    liquipediaTeamsFound: number;
    autoMappedCount: number;
    ambiguousCount: number;
    unmappedCount: number;
    newlyMappedNames?: string[];
  };
};

export type ManualMappingConflict = {
  teamName: string;
  normalizedTeamName: string;
  existingPlatformId: string;
  incomingPlatformId: string;
};

export type ManualMappingSaveSummary = {
  savedCount: number;
  skippedCount: number;
  conflictCount: number;
  overwrittenCount: number;
};

export type ClientAiImageCacheEntry = {
  rawMatches: ManualMatch[];
  normalizedText: string;
  expiresAt: number;
};

export type ManualImportImageItem = {
  id: string;
  name: string;
  file: File;
  previewUrl: string;
  hash: string;
  status: ImageRecognitionStatus;
  error?: string;
  rawMatches?: ManualMatch[];
  normalizedText?: string;
  parseSource?: ParseSource;
  timings?: Record<string, number>;
  ocrText?: string;
  ocrConfidence?: number | null;
  warnings?: string[];
};
