export type AdminMatchCandidate = {
  adminMatchId: string;
  startsAt: string;
  homeAdminTeamId: string;
  awayAdminTeamId: string;
  displayName?: string | null;
  season?: string | null;
  stageId?: string | null;
};

export type KhlMatchResolutionInput = {
  khlGameId: string;
  season: string;
  stageId: string;
  startsAt: string;
  homeAdminTeamId: string | null;
  awayAdminTeamId: string | null;
  confirmedAdminMatchId?: string | null;
};

type ResolutionDiagnostics = {
  inputCandidates: number;
  compatibleCandidates: number;
};

export type AdminMatchResolution =
  | {
      status: "blocked";
      reason:
        | "invalid_match_identity"
        | "unmapped_team"
        | "candidate_identity_conflict"
        | "no_compatible_match"
        | "ambiguous_match"
        | "manual_match_not_compatible";
      diagnostics: ResolutionDiagnostics;
    }
  | {
      status: "ready";
      mode: "AUTO" | "MANUAL";
      candidate: AdminMatchCandidate;
      matchKey: {
        khlGameId: string;
        season: string;
        stageId: string;
        homeAdminTeamId: string;
        awayAdminTeamId: string;
        adminMatchId: string;
      };
      diagnostics: ResolutionDiagnostics;
    };

type ResolverOptions = {
  startTimeToleranceMinutes?: number;
};

const DEFAULT_START_TIME_TOLERANCE_MINUTES = 360;
const MAX_START_TIME_TOLERANCE_MINUTES = 24 * 60;

export function resolveAdminMatch(
  input: KhlMatchResolutionInput,
  candidates: AdminMatchCandidate[],
  options: ResolverOptions = {}
): AdminMatchResolution {
  const diagnostics: ResolutionDiagnostics = {
    inputCandidates: Array.isArray(candidates) ? candidates.length : 0,
    compatibleCandidates: 0,
  };
  if (!validInputIdentity(input) || !Array.isArray(candidates)) {
    return blocked("invalid_match_identity", diagnostics);
  }
  if (!nonEmpty(input.homeAdminTeamId) || !nonEmpty(input.awayAdminTeamId)) {
    return blocked("unmapped_team", diagnostics);
  }

  const toleranceMinutes = options.startTimeToleranceMinutes
    ?? DEFAULT_START_TIME_TOLERANCE_MINUTES;
  if (
    !Number.isInteger(toleranceMinutes)
    || toleranceMinutes < 0
    || toleranceMinutes > MAX_START_TIME_TOLERANCE_MINUTES
  ) {
    return blocked("invalid_match_identity", diagnostics);
  }

  const grouped = new Map<string, AdminMatchCandidate[]>();
  for (const candidate of candidates) {
    if (!validCandidateIdentity(candidate)) continue;
    const id = candidate.adminMatchId.trim();
    const group = grouped.get(id) || [];
    group.push(candidate);
    grouped.set(id, group);
  }
  for (const group of grouped.values()) {
    if (new Set(group.map(candidateIdentitySignature)).size > 1) {
      return blocked("candidate_identity_conflict", diagnostics);
    }
  }

  const startsAt = Date.parse(input.startsAt);
  const toleranceMs = toleranceMinutes * 60_000;
  const compatible = [...grouped.values()]
    .map((group) => group[0])
    .filter((candidate) => (
      candidate.homeAdminTeamId.trim() === input.homeAdminTeamId
      && candidate.awayAdminTeamId.trim() === input.awayAdminTeamId
      && (!candidate.season || candidate.season.trim() === input.season.trim())
      && (!candidate.stageId || candidate.stageId.trim() === input.stageId.trim())
      && Math.abs(Date.parse(candidate.startsAt) - startsAt) <= toleranceMs
    ));
  diagnostics.compatibleCandidates = compatible.length;

  if (compatible.length === 0) return blocked("no_compatible_match", diagnostics);
  if (compatible.length > 1) return blocked("ambiguous_match", diagnostics);

  const confirmedAdminMatchId = input.confirmedAdminMatchId?.trim();
  if (confirmedAdminMatchId) {
    const selected = compatible.find(
      (candidate) => candidate.adminMatchId.trim() === confirmedAdminMatchId
    );
    if (!selected) return blocked("manual_match_not_compatible", diagnostics);
    return ready(input, selected, "MANUAL", diagnostics);
  }
  return ready(input, compatible[0], "AUTO", diagnostics);
}

function ready(
  input: KhlMatchResolutionInput,
  candidate: AdminMatchCandidate,
  mode: "AUTO" | "MANUAL",
  diagnostics: ResolutionDiagnostics
): AdminMatchResolution {
  return {
    status: "ready",
    mode,
    candidate,
    matchKey: {
      khlGameId: input.khlGameId.trim(),
      season: input.season.trim(),
      stageId: input.stageId.trim(),
      homeAdminTeamId: input.homeAdminTeamId!.trim(),
      awayAdminTeamId: input.awayAdminTeamId!.trim(),
      adminMatchId: candidate.adminMatchId.trim(),
    },
    diagnostics,
  };
}

function blocked(
  reason: Extract<AdminMatchResolution, { status: "blocked" }>["reason"],
  diagnostics: ResolutionDiagnostics
): AdminMatchResolution {
  return { status: "blocked", reason, diagnostics };
}

function validInputIdentity(input: KhlMatchResolutionInput) {
  return Boolean(
    input
    && nonEmpty(input.khlGameId)
    && nonEmpty(input.season)
    && positiveDecimalId(input.stageId)
    && Number.isFinite(Date.parse(input.startsAt))
  );
}

function validCandidateIdentity(candidate: AdminMatchCandidate) {
  return Boolean(
    candidate
    && nonEmpty(candidate.adminMatchId)
    && nonEmpty(candidate.homeAdminTeamId)
    && nonEmpty(candidate.awayAdminTeamId)
    && (candidate.stageId === null || candidate.stageId === undefined || positiveDecimalId(candidate.stageId))
    && Number.isFinite(Date.parse(candidate.startsAt))
  );
}

function candidateIdentitySignature(candidate: AdminMatchCandidate) {
  return [
    candidate.adminMatchId.trim(),
    candidate.homeAdminTeamId.trim(),
    candidate.awayAdminTeamId.trim(),
    new Date(candidate.startsAt).toISOString(),
    candidate.season?.trim() || "",
    candidate.stageId ?? "",
  ].join("\u0000");
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function positiveDecimalId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,127}$/.test(value.trim());
}
