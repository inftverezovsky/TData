export type DltvMatchPageFailure = {
  url: string;
  error: string;
};

export type DltvEventStatus = "live" | "ongoing" | "upcoming";

export type DltvEvent = {
  id: string;
  title: string;
  url: string;
  dates?: string;
  status?: DltvEventStatus;
};

export type DltvParticipant = {
  name: string;
  url?: string;
};

export type DltvEventPage = {
  id: string;
  title: string;
  url: string;
  dates?: string;
  status?: DltvEventStatus;
  location?: string | null;
  prizePool?: string | null;
  formatText?: string | null;
  participants: DltvParticipant[];
  matchUrls: string[];
};

export type DltvMatch = {
  id: string;
  url: string;
  tournament?: string;
  stage?: string | null;
  team1: string;
  team2: string;
  scoreA?: number | null;
  scoreB?: number | null;
  matchDate?: Date | null;
  matchDateTime?: string | null;
  format?: string | null;
  status?: string | null;
  rawText?: string | null;
};

export type DltvRunResult = {
  ok: boolean;
  events?: DltvEvent[];
  event?: DltvEventPage;
  matches?: DltvMatch[];
  matchPageFailures?: DltvMatchPageFailure[];
  cacheHit?: boolean;
  cacheLayer?: string | null;
  stale?: boolean;
  warning?: string | null;
  error?: string | null;
  errorClass?: string | null;
};
