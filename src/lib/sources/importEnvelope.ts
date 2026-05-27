import type { ImportStatus } from "@prisma/client";
import type { NormalizedMatch, NormalizedParticipant, NormalizedTournament } from "@/lib/normalizers/types";
import type { TournamentSource } from "@/lib/utils/tournamentSource";

export type ImportEnvelopeRawKind = "api-response" | "html" | "json" | "text" | "wikitext";

export type ImportEnvelopeRawPayload = {
  kind: ImportEnvelopeRawKind;
  payload: unknown;
  sourceUrl?: string | null;
  fetchedAt?: Date | string | null;
  revisionId?: number | string | null;
  revisionTimestamp?: Date | string | null;
};

export type ImportEnvelopeSourceTournament = {
  id?: string | number | null;
  title: string;
  url: string;
};

export type ImportEnvelopeDiagnostics = {
  warnings: string[];
  errors: string[];
  status?: ImportStatus;
  cacheHit?: boolean;
  cacheLayer?: string | null;
  stale?: boolean;
  warning?: string | null;
  qualityScore?: number | null;
  requestStats?: unknown;
  sourceBreakdown?: unknown;
};

export type ImportEnvelopeNormalized = {
  tournament: NormalizedTournament;
  participants: NormalizedParticipant[];
  matches: NormalizedMatch[];
};

export type ImportEnvelope = {
  source: TournamentSource;
  disciplineSlug: string;
  sourceTournament: ImportEnvelopeSourceTournament;
  raw?: ImportEnvelopeRawPayload;
  normalized: ImportEnvelopeNormalized;
  diagnostics: ImportEnvelopeDiagnostics;
};

export function createImportEnvelope(input: {
  source: TournamentSource;
  disciplineSlug: string;
  sourceTournament: ImportEnvelopeSourceTournament;
  normalizedTournament: NormalizedTournament;
  raw?: ImportEnvelopeRawPayload;
  diagnostics?: Partial<ImportEnvelopeDiagnostics>;
}): ImportEnvelope {
  const normalizedTournament = input.normalizedTournament;

  return {
    source: input.source,
    disciplineSlug: input.disciplineSlug,
    sourceTournament: input.sourceTournament,
    raw: input.raw,
    normalized: {
      tournament: normalizedTournament,
      participants: normalizedTournament.participants,
      matches: normalizedTournament.matches,
    },
    diagnostics: {
      warnings: normalizedTournament.warnings,
      errors: [],
      status: normalizedTournament.status,
      cacheHit: normalizedTournament.cacheHit,
      cacheLayer: normalizedTournament.cacheLayer,
      stale: normalizedTournament.stale,
      warning: normalizedTournament.warning,
      qualityScore: normalizedTournament.qualityScore,
      requestStats: normalizedTournament.requestStats,
      sourceBreakdown: normalizedTournament.sourceBreakdown,
      ...input.diagnostics,
    },
  };
}
