import { getBestOfLabel } from "@/lib/matches/format";
import { hasExactMatchTime } from "@/lib/matches/time";
import { isPlaceholderTeam, isTbdPlaceholderTeam } from "@/lib/teams/teams";

export type EsportsParserSource = "liquipedia" | "dltv" | "fandom" | "vlr";

export type EsportsSkipReason =
  | "no_exact_time"
  | "missing_team"
  | "duplicate"
  | "finished_result"
  | "parse_failed"
  | "empty_slot";

export type EsportsDiagnosticIssue = {
  reason: EsportsSkipReason;
  message: string;
  teamAName?: string | null;
  teamBName?: string | null;
  matchDateTime?: string | null;
  stage?: string | null;
  sourceUrl?: string | null;
};

type MatchPageDiagnostics = {
  matchUrlsFound: number;
  matchPagesFetched: number;
  matchPagesFailed: number;
  cacheHit?: boolean;
  stale?: boolean;
};

export type EsportsParsingDiagnostics = {
  source: EsportsParserSource;
  generatedAt: string;
  rawCandidates: number;
  savedMatches: number;
  skippedMatches: number;
  duplicateMatches: number;
  coverage: {
    withExactTime: number;
    withoutExactTime: number;
    withFormat: number;
    withoutFormat: number;
    teamVsTbd: number;
    tbdVsTbd: number;
    missingTeams: number;
    finishedResults: number;
  };
  skipReasons: Record<EsportsSkipReason, number>;
  issues: EsportsDiagnosticIssue[];
  dltv?: MatchPageDiagnostics;
  vlr?: MatchPageDiagnostics;
  fandom?: {
    cargoRowsFound: number;
    cargoRowsUsed: number;
    cargoFailed: boolean;
    cacheHit?: boolean;
    stale?: boolean;
  };
};

export type EsportsDiagnosticMatchLike = {
  teamAName?: string | null;
  teamBName?: string | null;
  team1?: string | null;
  team2?: string | null;
  matchDate?: Date | string | number | null;
  matchDateTime?: string | null;
  format?: string | null;
  rawText?: string | null;
  status?: string | null;
  scoreA?: number | null;
  scoreB?: number | null;
  stage?: string | null;
  sourceUrl?: string | null;
  url?: string | null;
};

export type Dota2SkipReason = EsportsSkipReason;
export type Dota2DiagnosticIssue = EsportsDiagnosticIssue;
export type Dota2ParsingDiagnostics = EsportsParsingDiagnostics;

export type LeagueOfLegendsParsingDiagnostics = EsportsParsingDiagnostics;
export type ValorantParsingDiagnostics = EsportsParsingDiagnostics;

const SKIP_REASONS: EsportsSkipReason[] = [
  "no_exact_time",
  "missing_team",
  "duplicate",
  "finished_result",
  "parse_failed",
  "empty_slot",
];
const MAX_DIAGNOSTIC_ISSUES = 80;

export function createEmptyEsportsParsingDiagnostics(
  source: EsportsParserSource,
  overrides: Partial<EsportsParsingDiagnostics> = {},
): EsportsParsingDiagnostics {
  return {
    source,
    generatedAt: new Date().toISOString(),
    rawCandidates: 0,
    savedMatches: 0,
    skippedMatches: 0,
    duplicateMatches: 0,
    coverage: {
      withExactTime: 0,
      withoutExactTime: 0,
      withFormat: 0,
      withoutFormat: 0,
      teamVsTbd: 0,
      tbdVsTbd: 0,
      missingTeams: 0,
      finishedResults: 0,
    },
    skipReasons: createSkipReasonCounter(),
    issues: [],
    ...overrides,
  };
}

export function buildEsportsParsingDiagnostics(params: {
  source: EsportsParserSource;
  rawCandidates: number;
  candidates: EsportsDiagnosticMatchLike[];
  savedMatches: number;
  duplicateMatches?: number;
  extraIssues?: EsportsDiagnosticIssue[];
  dltv?: EsportsParsingDiagnostics["dltv"];
  vlr?: EsportsParsingDiagnostics["vlr"];
  fandom?: EsportsParsingDiagnostics["fandom"];
}): EsportsParsingDiagnostics {
  const diagnostics = createEmptyEsportsParsingDiagnostics(params.source);
  diagnostics.rawCandidates = Math.max(0, params.rawCandidates);
  diagnostics.savedMatches = Math.max(0, params.savedMatches);
  diagnostics.duplicateMatches = Math.max(0, params.duplicateMatches ?? Math.max(0, params.candidates.length - params.savedMatches));
  diagnostics.dltv = params.dltv;
  diagnostics.vlr = params.vlr;
  diagnostics.fandom = params.fandom;

  const issues: EsportsDiagnosticIssue[] = [];

  for (const candidate of params.candidates) {
    const teamAName = getTeamA(candidate);
    const teamBName = getTeamB(candidate);
    const hasTeamA = Boolean(teamAName);
    const hasTeamB = Boolean(teamBName);
    const teamAPlaceholder = isPlaceholderTeam(teamAName);
    const teamBPlaceholder = isPlaceholderTeam(teamBName);
    const teamATbd = isTbdPlaceholderTeam(teamAName);
    const teamBTbd = isTbdPlaceholderTeam(teamBName);
    const hasExactTime = hasExactMatchTime(candidate);
    const hasFormat = Boolean(getBestOfLabel(candidate.format) || getBestOfLabel(candidate.rawText));
    const finished = isFinishedCandidate(candidate);

    if (hasExactTime) diagnostics.coverage.withExactTime += 1;
    else diagnostics.coverage.withoutExactTime += 1;

    if (hasFormat) diagnostics.coverage.withFormat += 1;
    else diagnostics.coverage.withoutFormat += 1;

    if (!hasTeamA || !hasTeamB) diagnostics.coverage.missingTeams += 1;
    if (finished) diagnostics.coverage.finishedResults += 1;
    if ((teamATbd || teamAPlaceholder) && (teamBTbd || teamBPlaceholder)) diagnostics.coverage.tbdVsTbd += 1;
    else if (teamATbd || teamBTbd || teamAPlaceholder || teamBPlaceholder) diagnostics.coverage.teamVsTbd += 1;

    const reason = getPrimarySkipReason({ hasTeamA, hasTeamB, hasExactTime, finished });
    if (!reason) continue;

    diagnostics.skipReasons[reason] += 1;
    issues.push({
      reason,
      message: getIssueMessage(reason),
      teamAName,
      teamBName,
      matchDateTime: candidate.matchDateTime ?? null,
      stage: candidate.stage ?? null,
      sourceUrl: candidate.sourceUrl ?? candidate.url ?? null,
    });
  }

  if (diagnostics.duplicateMatches > 0) {
    diagnostics.skipReasons.duplicate += diagnostics.duplicateMatches;
    issues.push({
      reason: "duplicate",
      message: `Удалено дублей: ${diagnostics.duplicateMatches}.`,
    });
  }

  for (const issue of params.extraIssues ?? []) {
    diagnostics.skipReasons[issue.reason] += 1;
    issues.push(issue);
  }

  diagnostics.skippedMatches = getSkippedMatchCount(diagnostics);
  diagnostics.issues = limitIssues(issues);

  return diagnostics;
}

export function finalizeEsportsParsingDiagnostics(
  diagnostics: EsportsParsingDiagnostics | null | undefined,
  params: {
    savedMatches?: number;
    duplicateMatches?: number;
    extraIssues?: EsportsDiagnosticIssue[];
    fandom?: Partial<NonNullable<EsportsParsingDiagnostics["fandom"]>>;
    dltv?: Partial<NonNullable<EsportsParsingDiagnostics["dltv"]>>;
    vlr?: Partial<NonNullable<EsportsParsingDiagnostics["vlr"]>>;
  },
) {
  if (!diagnostics) return diagnostics;
  const next: EsportsParsingDiagnostics = {
    ...diagnostics,
    coverage: { ...diagnostics.coverage },
    skipReasons: { ...diagnostics.skipReasons },
    issues: [...diagnostics.issues],
    dltv: diagnostics.dltv ? { ...diagnostics.dltv } : undefined,
    vlr: diagnostics.vlr ? { ...diagnostics.vlr } : undefined,
    fandom: diagnostics.fandom ? { ...diagnostics.fandom } : undefined,
  };

  if (params.savedMatches !== undefined) next.savedMatches = Math.max(0, params.savedMatches);
  if (params.duplicateMatches !== undefined) {
    const duplicateMatches = Math.max(0, params.duplicateMatches);
    if (duplicateMatches > next.duplicateMatches) {
      next.skipReasons.duplicate += duplicateMatches - next.duplicateMatches;
    }
    next.duplicateMatches = duplicateMatches;
  }
  if (params.dltv) next.dltv = withMatchPageDefaults(next.dltv, params.dltv);
  if (params.vlr) next.vlr = withMatchPageDefaults(next.vlr, params.vlr);
  if (params.fandom) next.fandom = { ...(next.fandom ?? { cargoRowsFound: 0, cargoRowsUsed: 0, cargoFailed: false }), ...params.fandom };

  for (const issue of params.extraIssues ?? []) {
    next.skipReasons[issue.reason] += 1;
    next.issues.push(issue);
  }

  next.skippedMatches = getSkippedMatchCount(next);
  next.issues = limitIssues(next.issues);
  return next;
}

export function mergeEsportsParsingDiagnostics(items: Array<EsportsParsingDiagnostics | null | undefined>) {
  const diagnostics = items.filter((item): item is EsportsParsingDiagnostics => Boolean(item));
  if (diagnostics.length === 0) return null;

  const merged = createEmptyEsportsParsingDiagnostics(diagnostics[0].source);
  merged.generatedAt = new Date().toISOString();

  for (const item of diagnostics) {
    merged.rawCandidates += item.rawCandidates;
    merged.savedMatches += item.savedMatches;
    merged.skippedMatches += item.skippedMatches;
    merged.duplicateMatches += item.duplicateMatches;
    for (const key of Object.keys(merged.coverage) as Array<keyof EsportsParsingDiagnostics["coverage"]>) {
      merged.coverage[key] += item.coverage[key];
    }
    for (const reason of SKIP_REASONS) {
      merged.skipReasons[reason] += item.skipReasons[reason] ?? 0;
    }
    merged.issues.push(...item.issues);
    if (item.dltv) merged.dltv = mergeMatchPageDiagnostics(merged.dltv, item.dltv);
    if (item.vlr) merged.vlr = mergeMatchPageDiagnostics(merged.vlr, item.vlr);
    if (item.fandom) {
      merged.fandom = {
        cargoRowsFound: (merged.fandom?.cargoRowsFound ?? 0) + item.fandom.cargoRowsFound,
        cargoRowsUsed: (merged.fandom?.cargoRowsUsed ?? 0) + item.fandom.cargoRowsUsed,
        cargoFailed: Boolean(merged.fandom?.cargoFailed || item.fandom.cargoFailed),
        cacheHit: Boolean(merged.fandom?.cacheHit || item.fandom.cacheHit),
        stale: Boolean(merged.fandom?.stale || item.fandom.stale),
      };
    }
  }

  merged.issues = limitIssues(merged.issues);
  return merged;
}

export const buildDota2Diagnostics = buildEsportsParsingDiagnostics;
export const finalizeDota2Diagnostics = finalizeEsportsParsingDiagnostics;
export const mergeDota2Diagnostics = mergeEsportsParsingDiagnostics;

function emptyMatchPageDiagnostics(): MatchPageDiagnostics {
  return {
    matchUrlsFound: 0,
    matchPagesFetched: 0,
    matchPagesFailed: 0,
  };
}

function withMatchPageDefaults(
  current: MatchPageDiagnostics | undefined,
  patch: Partial<MatchPageDiagnostics>,
): MatchPageDiagnostics {
  return { ...(current ?? emptyMatchPageDiagnostics()), ...patch };
}

function mergeMatchPageDiagnostics(
  current: MatchPageDiagnostics | undefined,
  next: MatchPageDiagnostics,
): MatchPageDiagnostics {
  return {
    matchUrlsFound: (current?.matchUrlsFound ?? 0) + next.matchUrlsFound,
    matchPagesFetched: (current?.matchPagesFetched ?? 0) + next.matchPagesFetched,
    matchPagesFailed: (current?.matchPagesFailed ?? 0) + next.matchPagesFailed,
    cacheHit: Boolean(current?.cacheHit || next.cacheHit),
    stale: Boolean(current?.stale || next.stale),
  };
}

function createSkipReasonCounter(): Record<EsportsSkipReason, number> {
  return {
    no_exact_time: 0,
    missing_team: 0,
    duplicate: 0,
    finished_result: 0,
    parse_failed: 0,
    empty_slot: 0,
  };
}

function getSkippedMatchCount(diagnostics: EsportsParsingDiagnostics) {
  const reasonTotal = SKIP_REASONS.reduce((sum, reason) => sum + (diagnostics.skipReasons[reason] ?? 0), 0);
  return Math.max(0, diagnostics.rawCandidates - diagnostics.savedMatches, reasonTotal);
}

function limitIssues(issues: EsportsDiagnosticIssue[]) {
  return issues.slice(0, MAX_DIAGNOSTIC_ISSUES);
}

function getTeamA(candidate: EsportsDiagnosticMatchLike) {
  return candidate.teamAName ?? candidate.team1 ?? null;
}

function getTeamB(candidate: EsportsDiagnosticMatchLike) {
  return candidate.teamBName ?? candidate.team2 ?? null;
}

function getPrimarySkipReason(params: {
  hasTeamA: boolean;
  hasTeamB: boolean;
  hasExactTime: boolean;
  finished: boolean;
}): EsportsSkipReason | null {
  if (!params.hasTeamA && !params.hasTeamB) return "empty_slot";
  if (!params.hasTeamA || !params.hasTeamB) return "missing_team";
  if (params.finished) return "finished_result";
  if (!params.hasExactTime) return "no_exact_time";
  return null;
}

function isFinishedCandidate(candidate: EsportsDiagnosticMatchLike) {
  const status = String(candidate.status ?? "").toLowerCase();
  if (/finished|complete|result|итог|заверш|done/.test(status)) return true;
  return candidate.scoreA != null || candidate.scoreB != null;
}

function getIssueMessage(reason: EsportsSkipReason) {
  switch (reason) {
    case "no_exact_time":
      return "Нет точного времени матча.";
    case "missing_team":
      return "Не найдена одна из команд.";
    case "duplicate":
      return "Дубликат матча.";
    case "finished_result":
      return "Матч уже завершён или содержит результат.";
    case "parse_failed":
      return "Страница или строка не распарсилась.";
    case "empty_slot":
      return "Пустой слот без команд.";
  }
}
