/** Контракт результата дисциплины. Публичный entrypoint повторно экспортирует эти типы для совместимости. */
import type { ImportStatus } from "@prisma/client";
import type { Dota2ParsingDiagnostics } from "@backend/matches/parsingDiagnostics";

/* ───── Types ───── */

export type NormalizedParticipant = {
  name: string;
  seed?: string | null;
  region?: string | null;
  status?: string | null;
  logoUrl?: string | null;
  rawText?: string | null;
};

export type NormalizedMatch = {
  matchId?: string | null;
  lpNumericalId?: bigint | null;
  stage?: string | null;
  round?: string | null;
  matchDate?: Date | null;
  matchDateTime?: string | null;
  teamAId?: string | null;
  teamAName?: string | null;
  teamBId?: string | null;
  teamBName?: string | null;
  scoreA?: number | null;
  scoreB?: number | null;
  format?: string | null;
  status?: string | null;
  court?: string | null;
  sourceUrl?: string | null;
  rawText?: string | null;
};

export type NormalizedTournament = {
  sourcePageId?: number;
  sourceTitle: string;
  sourceUrl: string;
  name: string;
  startDate?: Date | null;
  endDate?: Date | null;
  location?: string | null;
  region?: string | null;
  organizer?: string | null;
  prizePool?: string | null;
  formatText?: string | null;
  tournamentStatus?: string | null;
  participants: NormalizedParticipant[];
  matches: NormalizedMatch[];
  subPages: string[];
  warnings: string[];
  status: ImportStatus;
  dota2Diagnostics?: Dota2ParsingDiagnostics;
};
