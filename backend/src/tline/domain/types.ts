export const TLINE_AUTOMATIC_STATUSES = Object.freeze([
  "PENDING",
  "PROCESSING",
  "AUTO_OK",
  "TIME_WARNING",
  "TIME_ERROR",
  "TIME_CRITICAL",
  "SOURCE_ONLY",
  "ADMIN_ONLY",
  "TEAM_UNMAPPED",
  "MATCH_AMBIGUOUS",
  "DUPLICATE_SOURCE",
  "DUPLICATE_ADMIN",
  "SOURCE_TIME_UNDEFINED",
  "STATUS_MISMATCH",
  "PARSER_FAILED",
  "CANCELLED",
] as const);

export type TLineAutomaticStatus = (typeof TLINE_AUTOMATIC_STATUSES)[number];

export type TLineMatchStatus = "SCHEDULED" | "TBD" | "POSTPONED" | "CANCELLED" | "FINISHED" | "UNKNOWN";
export type TLineTimePrecision = "EXACT" | "DATE_ONLY" | "UNDEFINED";

export interface OfficialSourceTeamRef {
  readonly sourceTeamId: string;
  readonly name: string;
  readonly adminTeamId: string | null;
}

export interface AdminTeamRef {
  readonly adminTeamId: string;
  readonly name: string;
}

export interface OfficialSourceMatch {
  readonly id: string;
  readonly championshipId: string;
  readonly externalId: string | null;
  readonly home: OfficialSourceTeamRef;
  readonly away: OfficialSourceTeamRef;
  readonly startTimeRaw: string;
  readonly sourceTimezone: string;
  readonly startTimeUtc: string | null;
  readonly startTimeMoscow?: string | null;
  readonly timePrecision?: TLineTimePrecision;
  readonly status: TLineMatchStatus;
  readonly stage?: string | null;
  readonly round?: string | null;
  readonly sourceUrl?: string | null;
}

export interface AdminLineMatch {
  readonly id: string;
  readonly championshipId: string;
  readonly externalId: string | null;
  readonly home: AdminTeamRef;
  readonly away: AdminTeamRef;
  readonly startTimeUtc: string | null;
  readonly status: TLineMatchStatus;
}

export interface TLineComparisonResult {
  readonly sourceMatchId: string | null;
  readonly adminMatchId: string | null;
  readonly candidateAdminMatchIds: readonly string[];
  readonly automaticStatus: TLineAutomaticStatus;
  readonly reasons: readonly TLineAutomaticStatus[];
  readonly swappedSides: boolean;
  readonly timeDeltaMinutes: number | null;
  readonly manualLinked?: boolean;
}

export type TLineManualDecision =
  | { readonly kind: "MANUAL_OK"; readonly decidedAt: string }
  | { readonly kind: "MANUAL_ERROR"; readonly decidedAt: string }
  | { readonly kind: "EXCLUDE"; readonly decidedAt: string }
  | { readonly kind: "IGNORE_UNTIL"; readonly decidedAt: string; readonly expiresAt: string }
  | { readonly kind: "RESET"; readonly decidedAt: string };

export type TLineEffectiveStatus = TLineAutomaticStatus | "MANUAL_OK" | "MANUAL_ERROR" | "IGNORED";

export interface TLineSourceTeam {
  readonly id: string;
  readonly championshipId: string;
  readonly externalId: string | null;
  readonly nameRu: string | null;
  readonly nameEn: string | null;
  readonly aliases: readonly string[];
}

export interface TLineAdminTeamCandidate {
  readonly id: string;
  readonly platformId: string | null;
  readonly nameRu: string | null;
  readonly nameEn: string | null;
  readonly aliases: readonly string[];
}

export interface TLineExistingTeamMapping {
  readonly championshipId: string;
  readonly sourceTeamId: string;
  readonly adminTeamId: string;
  readonly locked: boolean;
  readonly status?: string;
}
