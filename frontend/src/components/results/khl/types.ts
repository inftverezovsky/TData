import type { KhlMatchProtocolView } from "@backend/results/khl/matchProtocol";

export type ApiError = { error?: string; code?: string };

export type Stage = {
  stageId: string;
  khlStageId: string;
  title: string;
  type: string;
  season: string;
  current: boolean;
};

export type ScheduleEvent = {
  apiEventId: string;
  khlGameId: string;
  stageId: string;
  name: string;
  startsAt: string;
  status: string;
  score: { home: number; away: number };
  teams: {
    home: { khlTeamId: string; name: string };
    away: { khlTeamId: string; name: string };
  };
};

export type StoredTeam = {
  khlTeamId: string;
  name: string;
  adminTeamId: string | null;
  adminBindingStatus: string;
};

export type KhlRevisionMetadata = {
  id: string;
  revisionNumber: number;
  state: string;
  normalizedHash: string;
  validationIssues: unknown;
  createdAt: string;
};

export type KhlDisplayRevision = KhlRevisionMetadata & {
  source: "ACTIVE_VALIDATED" | "LATEST_REJECTED" | "LATEST_REVISION";
};

export type StoredMatch = {
  id: string;
  khlGameId: string;
  stageId: string;
  season: string;
  startsAt: string;
  status: string;
  officialHomeScore: number | null;
  officialAwayScore: number | null;
  regulationHomeScore: number | null;
  regulationAwayScore: number | null;
  adminMatchId: string | null;
  adminBindingStatus: string;
  homeTeam: StoredTeam;
  awayTeam: StoredTeam;
  activeRevision: KhlRevisionMetadata | null;
  latestRevision: KhlRevisionMetadata | null;
  displayRevision: KhlDisplayRevision | null;
  protocol: KhlMatchProtocolView | null;
  _count: { revisions: number; participants: number };
};

export type AutomationStatus = {
  configured: boolean;
  paused: boolean;
  enabled: boolean;
  cutoff: string;
  intervalMinutes: number;
  lastFetchedAt: string | null;
};

export type MatchesResponse = {
  matches: StoredMatch[];
  automation: AutomationStatus;
  pagination: { offset: number; limit: number; total: number; hasMore: boolean };
};

export type PreviewState = {
  ready: boolean;
  issues: string[];
  revisionId?: string;
  payloadHash?: string;
  payload?: unknown;
};

export type DiffState = {
  status: "BLOCKED" | "NEW" | "UNCHANGED" | "CHANGED";
  issues: string[];
  currentPayloadHash: string | null;
  baseline: null | {
    deliveryId: string;
    payloadHash: string;
    endpointVersion: string;
    state: string;
    createdAt: string;
  };
  changes: Array<{ path: string; before: unknown; after: unknown }>;
  truncated: boolean;
};

export type SettingsTeam = {
  khlTeamId: string;
  name: string;
  location: string | null;
  adminTeamId: string | null;
  adminBindingStatus: string;
  matchCount: number;
};

export type SettingsPlayer = {
  khlPlayerId: string;
  name: string;
  role: string | null;
  adminPlayerId: string | null;
  adminBindingStatus: string;
  matchCount: number;
  recentAppearance: null | {
    khlGameId: string;
    startsAt: string;
    team: { khlTeamId: string; name: string };
    adminMatchPlayerId: string | null;
    adminBindingStatus: string;
  };
};

export type SettingsStatMapping = {
  scope: "TEAM" | "PLAYER";
  semanticCode: string;
  adminStatTypeId: string | null;
  adminBindingStatus: string;
};

export type SettingsDirectory = {
  teams: SettingsTeam[];
  players: SettingsPlayer[];
  statMappings: SettingsStatMapping[];
};
