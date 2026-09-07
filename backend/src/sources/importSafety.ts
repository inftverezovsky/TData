export type TournamentSnapshotWriteReason =
  | "validated_non_empty"
  | "authoritative_empty"
  | "unconfirmed_empty"
  | "source_not_validated";

export type TournamentSnapshotWriteDecision = {
  allowed: boolean;
  reason: TournamentSnapshotWriteReason;
};

export class TournamentSnapshotRejectedError extends Error {
  readonly statusCode: number;
  readonly errorClass: string;

  constructor(message: string, errorClass = "parse_failed", statusCode?: number) {
    super(message);
    this.name = "TournamentSnapshotRejectedError";
    this.errorClass = errorClass;
    this.statusCode = statusCode ?? (errorClass === "timeout" || errorClass === "upstream_timeout" ? 504 : 502);
  }
}

/**
 * Decides whether a freshly parsed match snapshot is authoritative enough to
 * replace persisted tournament data. A user-requested force refresh only
 * bypasses caches; it never bypasses source validation or empty-state safety.
 */
export function decideTournamentSnapshotWrite(input: {
  incomingMatches: number;
  sourceValidated: boolean;
  explicitAuthoritativeEmpty?: boolean;
  force?: boolean;
}): TournamentSnapshotWriteDecision {
  if (!input.sourceValidated) {
    return { allowed: false, reason: "source_not_validated" };
  }

  if (input.incomingMatches > 0) {
    return { allowed: true, reason: "validated_non_empty" };
  }

  if (input.explicitAuthoritativeEmpty) {
    return { allowed: true, reason: "authoritative_empty" };
  }

  return { allowed: false, reason: "unconfirmed_empty" };
}
