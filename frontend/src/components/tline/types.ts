export type ApiResult<T> =
  | { ok: true; data: T; meta?: Record<string, unknown> }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

export type TLineRunState =
  | "QUEUED"
  | "RUNNING"
  | "SUCCEEDED"
  | "PARTIAL"
  | "CANCELLED"
  | "FAILED";

export type TLineStatus =
  | "AUTO_OK"
  | "MANUAL_OK"
  | "TIME_WARNING"
  | "TIME_ERROR"
  | "TIME_CRITICAL"
  | "SOURCE_ONLY"
  | "ADMIN_ONLY"
  | "MATCH_AMBIGUOUS"
  | "TEAM_UNMAPPED"
  | "DUPLICATE"
  | "SOURCE_TIME_UNDEFINED"
  | "PARSER_FAILED"
  | "CANCELLED"
  | "UNPROCESSED"
  | string;

export type TLineSport = {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  autoEnabled: boolean;
  adminSportId?: string | null;
  autoPeriodFromOffsetMinutes?: number | null;
  autoPeriodToOffsetMinutes?: number | null;
  candidateMatchWindowMinutes?: number | null;
  defaultAllowedTimeDriftMinutes?: number | null;
};

export type TLineMatchSide = {
  externalId: string | null;
  sourceUrl: string | null;
  startsAt: string | null;
  sourceTimeText: string | null;
  teamHome: string;
  teamAway: string;
  status: string | null;
};

export type TLineComparison = {
  id: string;
  automaticStatus: TLineStatus;
  effectiveStatus: TLineStatus;
  manual: boolean;
  swappedSides: boolean;
  timeDeltaMinutes: number | null;
  reasons: string[];
  source: TLineMatchSide | null;
  admin: TLineMatchSide | null;
};

export type TLineChampionshipResult = {
  id: string;
  name: string;
  state?: string;
  status: string;
  severity: string;
  reasons: string[];
  comparisons: TLineComparison[];
};

export type TLineRun = {
  id: string;
  state: TLineRunState;
  progress: number;
  startedAt: string | null;
  finishedAt: string | null;
  includeUndatedSourceMatches: boolean;
  championships: TLineChampionshipResult[];
};

export type TLineSchedule = {
  enabled: boolean;
  slots: string[];
  nextRunAt: string | null;
};

export type TLineChampionship = {
  id: string;
  name: string;
  sportId: string;
  sourceUrl: string;
  sourceProvider?: string;
  sourceTimezone?: string;
  season?: string | null;
  globalHeaderId?: string | null;
  globalHeader?: {
    id: string;
    adminShapkaId: string;
    name: string | null;
    active: boolean;
  } | null;
  active: boolean;
  autoEnabled: boolean;
  allowedTimeDriftMinutes: number | null;
  candidateMatchWindowMinutes?: number | null;
  adminChampionshipId?: string | null;
  adminChampionshipName?: string | null;
};

export type TLineGlobalHeader = {
  id: string;
  sportId: string;
  sportName: string;
  adminShapkaId: string;
  name: string | null;
  active: boolean;
  teamCount: number;
  championships: Array<{ id: string; name: string; active: boolean }>;
};

export type TLineTeamMapping = {
  id: string;
  sourceTeamId: string;
  sourceTeamExternalId: string | null;
  sourceTeamName: string;
  adminTeamId: string | null;
  adminTeamName: string | null;
  adminTeamPlatformId: string | null;
  status: string;
  matchMethod: string | null;
  inDirectory: boolean;
  locked: boolean;
  confidence: number | null;
};
