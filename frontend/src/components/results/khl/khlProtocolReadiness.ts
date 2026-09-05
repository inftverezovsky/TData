import type { KhlMatchProtocolView } from "@backend/results/khl/matchProtocol";

/** Display policy only. Never use this exception for activation, mappings or delivery. */
export type KhlReadiness = "VALIDATED" | "IDENTITY_WARNING" | "BLOCKED";

export type KhlReadinessMatch = {
  khlGameId?: string;
  activeRevision: { state: string; revisionNumber?: number } | null;
  latestRevision?: { state: string; revisionNumber: number; validationIssues?: unknown } | null;
  displayRevision?: { state: string; revisionNumber: number; source: string; validationIssues?: unknown } | null;
  protocol?: KhlMatchProtocolView | null;
};

export function getKhlProtocolReadiness(protocol: KhlMatchProtocolView | null | undefined): KhlReadiness {
  if (!protocol || protocol.status !== "finished" || !validRoster(protocol)) return "BLOCKED";
  const missing = protocol.players.filter((player) => player.khlPlayerId === null);
  if (protocol.validation.ok) {
    return missing.length === 0 && protocol.validation.issues.length === 0 ? "VALIDATED" : "BLOCKED";
  }
  if (!missing.length || !validRegulationNumbers(protocol)) return "BLOCKED";
  const expected = missing.map((player) => `KHL ${player.teamSide} API player ${player.apiPlayerId}: missing KHL player id.`);
  if (missing.some((player) => !/^[1-9]\d*$/.test(player.apiPlayerId))) return "BLOCKED";
  return sameIssues(protocol.validation.issues, expected) ? "IDENTITY_WARNING" : "BLOCKED";
}

export function getKhlMatchReadiness(match: KhlReadinessMatch): KhlReadiness {
  const readiness = getKhlProtocolReadiness(match.protocol);
  if (readiness === "BLOCKED") return readiness;
  const latestRejected = hasNewerRejectedRevision(match);
  const display = match.displayRevision;
  if (readiness === "VALIDATED") {
    if (match.activeRevision?.state !== "VALIDATED" || latestRejected) return "BLOCKED";
    if (display && (display.source !== "ACTIVE_VALIDATED" || display.state !== "VALIDATED"
      || display.revisionNumber !== match.activeRevision.revisionNumber)) return "BLOCKED";
    return "VALIDATED";
  }
  // Never apply latest warnings to an older active protocol or inconsistent metadata.
  if (!match.khlGameId || !/^[1-9]\d*$/.test(match.khlGameId) || !latestRejected
    || display?.source !== "LATEST_REJECTED" || display.state !== "REJECTED"
    || display.revisionNumber !== match.latestRevision?.revisionNumber
    || !sameIssues(match.latestRevision.validationIssues, match.protocol!.validation.issues)
    || !sameIssues(display.validationIssues, match.protocol!.validation.issues)) return "BLOCKED";
  return "IDENTITY_WARNING";
}

export function hasNewerRejectedRevision(match: Pick<KhlReadinessMatch, "activeRevision" | "latestRevision">) {
  const latest = match.latestRevision;
  if (latest?.state !== "REJECTED") return false;
  if (!match.activeRevision) return true;
  return latest.revisionNumber > (match.activeRevision.revisionNumber ?? latest.revisionNumber);
}

export function khlMissingIdentityLabels(protocol: KhlMatchProtocolView) {
  return protocol.players.filter((player) => player.khlPlayerId === null).map((player) =>
    `${protocol.teams[player.teamSide].name} · №${player.shirtNumber} ${player.name}: КХЛ не передала ID игрока.`);
}

function sameIssues(value: unknown, expected: readonly string[]) {
  if (!Array.isArray(value) || value.length !== expected.length
    || value.some((issue) => typeof issue !== "string") || new Set(value).size !== value.length) return false;
  const allowed = new Set(expected);
  return allowed.size === expected.length && value.every((issue) => allowed.has(issue));
}

function validRoster(protocol: KhlMatchProtocolView) {
  const apiKeys = new Set<string>();
  const khlKeys = new Set<string>();
  for (const player of protocol.players) {
    if ((player.teamSide !== "home" && player.teamSide !== "away") || !player.apiPlayerId
      || player.khlTeamId !== protocol.teams[player.teamSide].khlTeamId
      || (player.khlPlayerId !== null && !player.khlPlayerId)
      || !validPoints(player.regulation) || !validPoints(player.fullMatch)) return false;
    const apiKey = JSON.stringify([player.teamSide, player.apiPlayerId]);
    if (apiKeys.has(apiKey) || (player.khlPlayerId !== null && khlKeys.has(player.khlPlayerId))) return false;
    apiKeys.add(apiKey);
    if (player.khlPlayerId !== null) khlKeys.add(player.khlPlayerId);
  }
  return true;
}

function validPoints(points: { goals: number; assists: number; points: number }) {
  return [points.goals, points.assists, points.points].every(nonnegativeInteger)
    && points.points === points.goals + points.assists;
}

function validRegulationNumbers(protocol: KhlMatchProtocolView) {
  const metricCodes = ["shots_on_goal", "faceoffs_won", "power_play_goals", "penalty_minutes_2_4"] as const;
  if (new Set(protocol.scores.segments.map((score) => score.segment)).size !== protocol.scores.segments.length) return false;
  for (const side of ["home", "away"] as const) {
    const scores = ["P1", "P2", "P3"].map((segment) => protocol.scores.segments.find((score) => score.segment === segment)?.[side]);
    if (!scores.every((score) => score !== undefined && nonnegativeInteger(score))
      || scores.reduce<number>((sum, score) => sum + score!, 0) !== protocol.scores.regulation[side]) return false;
    const metrics = protocol.teams[side].metrics;
    const codes = new Set(metrics.map((metric) => metric.code));
    if (codes.size !== 4 || metrics.length !== 4 || metricCodes.some((code) => !codes.has(code))) return false;
    for (const metric of metrics) {
      const values = ["P1", "P2", "P3"].map((segment) => metric.segments[segment]);
      if (!values.every(nonnegativeInteger) || !nonnegativeInteger(metric.fullMatchTotal)
        || values.reduce((sum, value) => sum + value, 0) !== metric.regulationTotal) return false;
    }
  }
  return true;
}

function nonnegativeInteger(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}
