export type TeamMappingRecord = {
  id: string;
  liquipediaName: string;
  alias: string | null;
  canonicalName: string | null;
  platformId: string | null;
  logoUrl?: string | null;
  confidenceScore: number | null;
  status: string;
  matchMethod: string | null;
  isManual: boolean;
  isLockedFromAutoMapping: boolean;
  displayAdminName?: string;
  adminTeamName?: string | null;
  nameSource?: "admin" | "manual" | "missing";
};

export type MappingNotice = {
  type: "error" | "info" | "success";
  text: string;
};

export type AutoMappingPreviewItem = {
  liquipediaName: string;
  platformId?: string | null;
  adminName?: string | null;
  matchedName?: string | null;
  score?: number | null;
  secondAdminName?: string | null;
  secondScore?: number | null;
  existingPlatformId?: string | null;
  reason?: string | null;
  matchMethod?: string | null;
};

export type AutoMappingPreview = {
  adminTeamsCount: number;
  liquipediaTeamsFound: number;
  alreadyMappedCount: number;
  auto: AutoMappingPreviewItem[];
  suggested: AutoMappingPreviewItem[];
  ambiguous: AutoMappingPreviewItem[];
  unmapped: AutoMappingPreviewItem[];
  invalid: AutoMappingPreviewItem[];
  conflicts: AutoMappingPreviewItem[];
};

export type AdminTeamSuggestion = {
  platformId: string;
  platformName: string;
  platformNameRu?: string | null;
  platformNameEn?: string | null;
  matchedName?: string | null;
  score: number;
  matchType: "exact" | "starts_with" | "contains" | "fuzzy";
};
