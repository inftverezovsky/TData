import fs from "fs";
import path from "path";
import { prisma } from "../src/lib/db/db";
import { getOrCreateDiscipline, KNOWN_DISCIPLINE_SLUGS, type KnownDisciplineSlug } from "../src/lib/config/disciplines";
import { makeLiquipediaPageUrl } from "../src/lib/liquipedia/client";
import { importTournamentRecursive } from "../src/lib/liquipedia/importer";
import { getNormalizer } from "../src/lib/normalizers/registry";
import { importHltvTournament } from "../src/lib/importSources/hltv";
import { importVlrTournament } from "../src/lib/importSources/vlr";
import { importDltvTournament } from "../src/lib/importSources/dltv";
import { importFandomTournament } from "../src/lib/importSources/fandom";
import { runHltvScript } from "../src/lib/hltv/scraper";
import { parseHltvDate } from "../src/lib/hltv/parse";
import { runVlrScraper } from "../src/lib/vlr/scraper";
import { runDltv } from "../src/lib/dltv/queue";
import { fetchFandomTournamentCargoEvents, makeFandomPageUrl } from "../src/lib/fandom/client";
import { dedupeTournamentMatches } from "../src/lib/matches/dedupe";
import { expandScheduleAnnouncementsForDiscipline, isDisplayableScheduleMatch, isUploadReadyScheduleMatch } from "../src/lib/matches/scheduleView";
import { detectTournamentSource, type TournamentSource } from "../src/lib/utils/tournamentSource";
import { buildEsportsParsingDiagnostics, type EsportsParsingDiagnostics } from "../src/lib/matches/parsingDiagnostics";

type AuditSource = TournamentSource;
type AuditSeverity = "critical" | "warning" | "info";

type AuditCandidate = {
  key: string;
  disciplineSlug: KnownDisciplineSlug;
  source: AuditSource;
  title: string;
  url: string;
  pageId?: number;
  externalId?: string;
  dates?: string | null;
  status?: string | null;
  parsedStart?: string | null;
  parsedEnd?: string | null;
};

type SourceExpectation = {
  rawCandidates: number;
  parsedSourceMatches: number;
  sourceMatchUrlsFound: number;
  sourceMatchPagesFetched: number;
  sourceMatchPagesFailed: number;
  rawScheduleSignals: RawScheduleSignals;
  diagnostics: EsportsParsingDiagnostics | null;
  warnings: string[];
  error: string | null;
  samples: MatchSample[];
};

type PlatformState = {
  tournamentId: string | null;
  platformUrl: string | null;
  sourceUrl: string | null;
  extractionStatus: string | null;
  totalSavedMatches: number;
  uploadReadyMatches: number;
  displayableMatches: number;
  announcementEntries: number;
  scheduleEntries: number;
  placeholderMatches: number;
  lastImportStatus: string | null;
  lastImportError: string | null;
  normalizationWarnings: string[];
};

type RawScheduleSignals = {
  matchTemplateCount: number;
  matchLinkCount: number;
  scheduleKeywordCount: number;
  placeholderKeywordCount: number;
  snapshotCount: number;
};

type MatchSample = {
  date?: string | null;
  teamA?: string | null;
  teamB?: string | null;
  stage?: string | null;
  round?: string | null;
  format?: string | null;
  sourceUrl?: string | null;
};

type AuditIssue = {
  severity: AuditSeverity;
  code: string;
  message: string;
};

type AuditTournamentResult = {
  candidate: AuditCandidate;
  ok: boolean;
  issues: AuditIssue[];
  sourceExpectation: SourceExpectation;
  platform: PlatformState;
  importError: string | null;
  durationMs: number;
};

type AuditReport = {
  generatedAt: string;
  window: {
    now: string;
    days: number;
    until: string;
  };
  options: AuditOptions;
  summary: {
    candidates: number;
    checked: number;
    ok: number;
    withIssues: number;
    critical: number;
    warnings: number;
    importErrors: number;
  };
  sourceCollection: {
    errors: Array<{ source: AuditSource; disciplineSlug: KnownDisciplineSlug; error: string }>;
    skippedUnknownDate: AuditCandidate[];
  };
  results: AuditTournamentResult[];
};

type AuditOptions = {
  days: number;
  forceEvents: boolean;
  forceImport: boolean;
  includeUnknownDates: boolean;
  discipline?: KnownDisciplineSlug;
  source?: AuditSource;
  reportDir: string;
  maxPerSource?: number;
  dryRun: boolean;
};

const SOURCE_DISCIPLINES: Record<AuditSource, KnownDisciplineSlug[]> = {
  liquipedia: ["dota2", "counterstrike", "leagueoflegends", "valorant"],
  hltv: ["counterstrike"],
  vlr: ["valorant"],
  dltv: ["dota2"],
  fandom: ["leagueoflegends"],
};

function parseArgs(argv: string[]): AuditOptions {
  const options: AuditOptions = {
    days: 10,
    forceEvents: false,
    forceImport: false,
    includeUnknownDates: false,
    reportDir: path.join(process.cwd(), ".codex-logs", "tournament-audit"),
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--days" && next) {
      options.days = Math.max(1, Number(next) || options.days);
      i += 1;
    } else if (arg === "--force-events") {
      options.forceEvents = true;
    } else if (arg === "--force-import") {
      options.forceImport = true;
    } else if (arg === "--include-unknown-dates") {
      options.includeUnknownDates = true;
    } else if (arg === "--discipline" && next) {
      options.discipline = parseDiscipline(next);
      i += 1;
    } else if (arg === "--source" && next) {
      options.source = parseSource(next);
      i += 1;
    } else if (arg === "--report-dir" && next) {
      options.reportDir = path.resolve(next);
      i += 1;
    } else if (arg === "--max-per-source" && next) {
      options.maxPerSource = Math.max(1, Number(next) || 0) || undefined;
      i += 1;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function parseDiscipline(value: string): KnownDisciplineSlug {
  const slug = value.trim().toLowerCase();
  if ((KNOWN_DISCIPLINE_SLUGS as readonly string[]).includes(slug)) return slug as KnownDisciplineSlug;
  throw new Error(`Unsupported discipline: ${value}`);
}

function parseSource(value: string): AuditSource {
  const source = value.trim().toLowerCase();
  if (source === "liquipedia" || source === "hltv" || source === "vlr" || source === "dltv" || source === "fandom") {
    return source;
  }
  throw new Error(`Unsupported source: ${value}`);
}

function printHelp() {
  console.log(`
Tournament audit agent

Usage:
  npm run audit:tournaments -- --days 10

Options:
  --days N                  Upcoming window, default 10.
  --force-events            Refresh source event lists.
  --force-import            Force-refresh each import. Use carefully.
  --include-unknown-dates   Also audit events whose dates cannot be parsed.
  --discipline SLUG         One of: ${KNOWN_DISCIPLINE_SLUGS.join(", ")}.
  --source SOURCE           One of: liquipedia, hltv, vlr, dltv, fandom.
  --max-per-source N        Limit checked tournaments per source.
  --dry-run                 Collect candidates without importing.
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  process.env.LIQUIPEDIA_PORTAL_UPCOMING_WINDOW_DAYS = String(options.days);
  process.env.LIQUIPEDIA_PORTAL_MAX_TOURNAMENTS = process.env.LIQUIPEDIA_PORTAL_MAX_TOURNAMENTS || "100";

  const now = new Date();
  const until = new Date(now.getTime() + options.days * 24 * 60 * 60 * 1000);

  console.log(`[TournamentAuditAgent] Window: ${formatIso(now)} -> ${formatIso(until)} (${options.days} days)`);
  console.log(`[TournamentAuditAgent] forceEvents=${options.forceEvents} forceImport=${options.forceImport} dryRun=${options.dryRun}`);

  const collectionErrors: AuditReport["sourceCollection"]["errors"] = [];
  const skippedUnknownDate: AuditCandidate[] = [];
  const candidates = await collectCandidates(options, now, until, collectionErrors, skippedUnknownDate);
  const results: AuditTournamentResult[] = [];
  const reportPaths = createReportPaths(options.reportDir);

  console.log(`[TournamentAuditAgent] Candidates selected: ${candidates.length}`);
  writeReportFiles(buildReport(options, now, until, candidates.length, collectionErrors, skippedUnknownDate, results), reportPaths);

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const label = `${candidate.disciplineSlug}/${candidate.source}: ${candidate.title}`;
    console.log(`[TournamentAuditAgent] (${index + 1}/${candidates.length}) Checking ${label}`);
    const result = await auditCandidate(candidate, options);
    results.push(result);
    writeReportFiles(buildReport(options, now, until, candidates.length, collectionErrors, skippedUnknownDate, results), reportPaths);
    const issueText = result.issues.length ? `${result.issues.length} issue(s)` : "ok";
    console.log(`[TournamentAuditAgent] Done ${label}: ${issueText} in ${result.durationMs}ms`);
  }

  const report = buildReport(options, now, until, candidates.length, collectionErrors, skippedUnknownDate, results);
  writeReportFiles(report, reportPaths);
  console.log(`[TournamentAuditAgent] JSON report: ${reportPaths.jsonPath}`);
  console.log(`[TournamentAuditAgent] Markdown report: ${reportPaths.markdownPath}`);
  console.log(`[TournamentAuditAgent] Summary: ${JSON.stringify(report.summary)}`);
}

async function collectCandidates(
  options: AuditOptions,
  now: Date,
  until: Date,
  errors: AuditReport["sourceCollection"]["errors"],
  skippedUnknownDate: AuditCandidate[],
) {
  const candidates: AuditCandidate[] = [];
  const sources = (Object.keys(SOURCE_DISCIPLINES) as AuditSource[])
    .filter((source) => !options.source || source === options.source);

  for (const source of sources) {
    const disciplines = SOURCE_DISCIPLINES[source].filter((slug) => !options.discipline || slug === options.discipline);
    for (const disciplineSlug of disciplines) {
      try {
        const sourceCandidates = await collectSourceCandidates(source, disciplineSlug, options);
        const filtered = filterCandidatesByWindow(sourceCandidates, now, until, options, skippedUnknownDate);
        candidates.push(...filtered.slice(0, options.maxPerSource ?? filtered.length));
        console.log(`[TournamentAuditAgent] ${disciplineSlug}/${source}: ${filtered.length} in window (${sourceCandidates.length} collected)`);
      } catch (error) {
        errors.push({
          source,
          disciplineSlug,
          error: error instanceof Error ? error.message : String(error),
        });
        console.error(`[TournamentAuditAgent] Failed collecting ${disciplineSlug}/${source}:`, error);
      }
    }
  }

  return dedupeCandidates(candidates);
}

async function collectSourceCandidates(
  source: AuditSource,
  disciplineSlug: KnownDisciplineSlug,
  options: AuditOptions,
): Promise<AuditCandidate[]> {
  if (source === "liquipedia") return collectLiquipediaCandidates(disciplineSlug, options);
  if (source === "hltv") return collectHltvCandidates(options);
  if (source === "vlr") return collectVlrCandidates(options);
  if (source === "dltv") return collectDltvCandidates(options);
  return collectFandomCandidates();
}

async function collectLiquipediaCandidates(
  disciplineSlug: KnownDisciplineSlug,
  options: AuditOptions,
): Promise<AuditCandidate[]> {
  const { fetchDisciplinePortal } = await import("../src/lib/liquipedia/portal");
  const data = await fetchDisciplinePortal(disciplineSlug, options.forceEvents);
  return data.tournaments.map((tournament) => ({
    key: `${disciplineSlug}:liquipedia:${tournament.url}`,
    disciplineSlug,
    source: "liquipedia",
    title: tournament.title,
    url: tournament.url,
    dates: tournament.dates,
    status: tournament.status,
  }));
}

async function collectHltvCandidates(options: AuditOptions): Promise<AuditCandidate[]> {
  const data = await runHltvScript("events", undefined, { noCache: options.forceEvents });
  const events = Array.isArray(data.events) ? data.events : [];
  return events.map((event: any) => ({
    key: `counterstrike:hltv:${event.url || event.href || event.id}`,
    disciplineSlug: "counterstrike",
    source: "hltv",
    title: String(event.title || event.name || "HLTV event"),
    url: normalizeHltvUrl(event.url || event.href || ""),
    externalId: String(event.id || extractHltvEventId(event.url || event.href || "")),
    dates: event.dates || event.date || null,
    status: event.status || null,
  }));
}

async function collectVlrCandidates(options: AuditOptions): Promise<AuditCandidate[]> {
  const data = await runVlrScraper("events", undefined, { noCache: options.forceEvents });
  const events = Array.isArray(data.events) ? data.events : [];
  return events.map((event: any) => ({
    key: `valorant:vlr:${event.url || event.id}`,
    disciplineSlug: "valorant",
    source: "vlr",
    title: String(event.title || "VLR event"),
    url: String(event.url || ""),
    externalId: String(event.id || ""),
    dates: event.dates || null,
    status: event.status || null,
  }));
}

async function collectDltvCandidates(options: AuditOptions): Promise<AuditCandidate[]> {
  const data = await runDltv("events", undefined, { noCache: options.forceEvents });
  const events = Array.isArray(data.events) ? data.events : [];
  return events.map((event: any) => ({
    key: `dota2:dltv:${event.url || event.id}`,
    disciplineSlug: "dota2",
    source: "dltv",
    title: String(event.title || "DLTV event"),
    url: String(event.url || ""),
    externalId: String(event.id || ""),
    dates: event.dates || null,
    status: event.status || null,
  }));
}

async function collectFandomCandidates(): Promise<AuditCandidate[]> {
  const cargo = await fetchFandomTournamentCargoEvents();
  return cargo
    .map((item: any) => {
      const title = String(item?.title?.Name || item?.title?.OverviewPage || "");
      const overviewPage = String(item?.title?.OverviewPage || title);
      const dateStart = String(item?.title?.DateStart || "");
      const dateEnd = String(item?.title?.Date || "");
      return {
        key: `leagueoflegends:fandom:${overviewPage || title}`,
        disciplineSlug: "leagueoflegends" as const,
        source: "fandom" as const,
        title,
        url: makeFandomPageUrl(overviewPage || title),
        externalId: overviewPage || title,
        dates: [dateStart, dateEnd].filter(Boolean).join(" - ") || null,
        status: "upcoming",
      };
    })
    .filter((event: AuditCandidate) => event.title);
}

function filterCandidatesByWindow(
  candidates: AuditCandidate[],
  now: Date,
  until: Date,
  options: AuditOptions,
  skippedUnknownDate: AuditCandidate[],
) {
  return candidates
    .map((candidate) => {
      const range = parseCandidateDateRange(candidate);
      return {
        ...candidate,
        parsedStart: range?.start ? range.start.toISOString() : null,
        parsedEnd: range?.end ? range.end.toISOString() : null,
      };
    })
    .filter((candidate) => {
      const range = parseCandidateDateRange(candidate);
      if (!range) {
        if (options.includeUnknownDates || isKnownActiveStatus(candidate.status)) return true;
        skippedUnknownDate.push(candidate);
        return false;
      }
      return intersectsWindow(range.start, range.end, now, until);
    });
}

function parseCandidateDateRange(candidate: Pick<AuditCandidate, "source" | "dates" | "status" | "title" | "url">) {
  const dates = String(candidate.dates || "").trim();
  if (!dates) return null;
  let parsed: { start: Date; end: Date } | null = null;

  if (candidate.source === "hltv") {
    parsed = parseHltvDate(dates);
    if (parsed) return alignRangeWithTitleYear(parsed, candidate);
  }

  parsed = parseFlexibleDateRange(dates);
  return parsed ? alignRangeWithTitleYear(parsed, candidate) : null;
}

function alignRangeWithTitleYear(
  range: { start: Date; end: Date },
  candidate: Pick<AuditCandidate, "dates" | "title" | "url">,
) {
  if (/\b(19\d{2}|20\d{2})\b/.test(String(candidate.dates || ""))) return range;
  const titleYear = extractYear(`${candidate.title} ${candidate.url}`);
  if (!titleYear) return range;

  const start = new Date(range.start);
  const end = new Date(range.end);
  const delta = titleYear - start.getFullYear();
  start.setFullYear(titleYear);
  end.setFullYear(end.getFullYear() + delta);
  if (end.getTime() < start.getTime()) end.setFullYear(end.getFullYear() + 1);
  return { start, end };
}

function parseFlexibleDateRange(value: string, today = new Date()): { start: Date; end: Date } | null {
  const text = value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  if (!text || /^(tbd|date tbd)$/i.test(text)) return null;

  const isoMatches = Array.from(text.matchAll(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/g));
  if (isoMatches.length > 0) {
    const dates = isoMatches.map((match) => new Date(Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4] || 0),
      Number(match[5] || 0),
      Number(match[6] || 0),
    ))).filter(isValidDate);
    if (dates.length > 0) return { start: dates[0], end: dates[dates.length - 1] };
  }

  const monthPattern = "(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*";
  const monthRange = text.match(new RegExp(`\\b${monthPattern}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*[-–—]\\s*(?:${monthPattern}\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(20\\d{2}))?`, "i"));
  if (monthRange) {
    const startMonth = parseMonth(monthRange[1]);
    const endMonth = parseMonth(monthRange[3] || monthRange[1]);
    const startDay = Number(monthRange[2]);
    const endDay = Number(monthRange[4]);
    const year = Number(monthRange[5] || inferYear(startMonth, startDay, today));
    if (startMonth !== null && endMonth !== null) {
      const start = new Date(year, startMonth, startDay);
      const end = new Date(year + (endMonth < startMonth ? 1 : 0), endMonth, endDay, 23, 59, 59);
      if (isValidDate(start) && isValidDate(end)) return { start, end };
    }
  }

  const monthSingle = text.match(new RegExp(`\\b${monthPattern}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(20\\d{2}))?`, "i"));
  if (monthSingle) {
    const month = parseMonth(monthSingle[1]);
    const day = Number(monthSingle[2]);
    const year = Number(monthSingle[3] || inferYear(month, day, today));
    if (month !== null) {
      const start = new Date(year, month, day);
      const end = new Date(year, month, day, 23, 59, 59);
      if (isValidDate(start) && isValidDate(end)) return { start, end };
    }
  }

  const parsed = new Date(text);
  if (isValidDate(parsed)) return { start: parsed, end: parsed };
  return null;
}

function parseMonth(value: string | null | undefined) {
  if (!value) return null;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const index = months.indexOf(value.trim().toLowerCase().slice(0, 3));
  return index >= 0 ? index : null;
}

function inferYear(month: number | null, day: number, today: Date) {
  if (month === null) return today.getFullYear();
  const candidate = new Date(today.getFullYear(), month, day);
  if (candidate.getTime() < today.getTime() - 30 * 24 * 60 * 60 * 1000 && month < today.getMonth()) {
    return today.getFullYear() + 1;
  }
  return today.getFullYear();
}

function isValidDate(date: Date) {
  return date instanceof Date && Number.isFinite(date.getTime());
}

function intersectsWindow(start: Date, end: Date, now: Date, until: Date) {
  const normalizedEnd = end.getTime() < start.getTime() ? start : end;
  return start.getTime() <= until.getTime() && normalizedEnd.getTime() >= startOfDay(now).getTime();
}

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function isKnownActiveStatus(status: string | null | undefined) {
  return /^(ongoing|live|current)$/i.test(String(status || ""));
}

function dedupeCandidates(candidates: AuditCandidate[]) {
  const seen = new Map<string, AuditCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.disciplineSlug}:${candidate.source}:${normalizeCandidateUrl(candidate.url) || candidate.title.toLowerCase()}`;
    if (!seen.has(key)) seen.set(key, candidate);
  }
  return Array.from(seen.values());
}

async function auditCandidate(candidate: AuditCandidate, options: AuditOptions): Promise<AuditTournamentResult> {
  const startedAt = Date.now();
  let importError: string | null = null;
  let importResult: any = null;

  try {
    if (!options.dryRun) {
      importResult = await importCandidate(candidate, options);
    }
  } catch (error) {
    importError = error instanceof Error ? error.message : String(error);
    console.error(`[TournamentAuditAgent] Import failed for ${candidate.title}:`, error);
  }

  const tournamentId = importResult?.tournament?.id || await findTournamentId(candidate);
  const sourceExpectation = await buildSourceExpectation(candidate, importResult, tournamentId);
  const platform = await buildPlatformState(candidate, tournamentId);
  const issues = classifyIssues(sourceExpectation, platform, importError);

  return {
    candidate,
    ok: issues.filter((issue) => issue.severity !== "info").length === 0,
    issues,
    sourceExpectation,
    platform,
    importError,
    durationMs: Date.now() - startedAt,
  };
}

async function importCandidate(candidate: AuditCandidate, options: AuditOptions) {
  if (candidate.source === "liquipedia") {
    return importLiquipediaCandidate(candidate, options);
  }
  if (candidate.source === "hltv") {
    return importHltvTournament({
      slug: candidate.disciplineSlug,
      title: candidate.title,
      pageUrl: candidate.url,
      force: options.forceImport,
    });
  }
  if (candidate.source === "vlr") {
    return importVlrTournament({
      slug: candidate.disciplineSlug,
      title: candidate.title,
      pageUrl: candidate.url,
      force: options.forceImport,
    });
  }
  if (candidate.source === "dltv") {
    return importDltvTournament({
      slug: candidate.disciplineSlug,
      title: candidate.title,
      pageUrl: candidate.url,
      force: options.forceImport,
    });
  }

  const discipline = await getOrCreateDiscipline(candidate.disciplineSlug);
  return importFandomTournament({
    slug: candidate.disciplineSlug,
    disciplineId: discipline.id,
    pageId: candidate.pageId,
    title: candidate.title,
    pageUrl: candidate.url,
    force: options.forceImport,
  });
}

async function importLiquipediaCandidate(candidate: AuditCandidate, options: AuditOptions) {
  const discipline = await getOrCreateDiscipline(candidate.disciplineSlug);
  const normalizer = getNormalizer(candidate.disciplineSlug);
  const pageUrl = candidate.url || makeLiquipediaPageUrl(candidate.title, candidate.disciplineSlug);
  const tournamentImport = await prisma.tournamentImport.create({
    data: {
      disciplineId: discipline.id,
      pageTitle: candidate.title,
      pageUrl,
      status: "PENDING",
    },
  });

  try {
    const importResult = await importTournamentRecursive({
      disciplineId: discipline.id,
      disciplineSlug: candidate.disciplineSlug,
      apiUrl: discipline.baseApiUrl ?? `https://liquipedia.net/${candidate.disciplineSlug}/api.php`,
      pageId: candidate.pageId,
      title: candidate.title,
      pageUrl,
      normalizer,
      importRecordId: tournamentImport.id,
      force: options.forceImport,
    });

    await prisma.tournamentImport.update({
      where: { id: tournamentImport.id },
      data: {
        status: importResult.normalized.status,
        finishedAt: new Date(),
      },
    });

    const fullTournament = await prisma.tournament.findUnique({
      where: { id: importResult.tournament.id },
      include: { participants: true, matches: true, lastImport: true },
    });

    return {
      ...importResult,
      tournament: fullTournament ? { ...fullTournament, matches: dedupeTournamentMatches(fullTournament.matches) } : importResult.tournament,
    };
  } catch (error) {
    await prisma.tournamentImport.update({
      where: { id: tournamentImport.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}

async function findTournamentId(candidate: AuditCandidate) {
  const sourceUrl = normalizeCandidateUrl(candidate.url);
  const tournament = await prisma.tournament.findFirst({
    where: {
      disciplineSlug: candidate.disciplineSlug,
      OR: [
        { sourceTitle: candidate.title },
        { name: candidate.title },
        ...(sourceUrl ? [{ sourceUrl }] : []),
      ],
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  return tournament?.id ?? null;
}

async function buildSourceExpectation(
  candidate: AuditCandidate,
  importResult: any,
  tournamentId: string | null,
): Promise<SourceExpectation> {
  const diagnostics = await getDiagnostics(candidate, importResult, tournamentId);
  const rawSignals = await getRawScheduleSignals(tournamentId);
  const samples = getImportMatchSamples(importResult);
  const warnings = getWarnings(importResult, diagnostics);
  const error = getImportResultError(importResult);
  const parsedSourceMatches = getParsedSourceMatches(candidate, importResult, diagnostics);
  const rawCandidates = diagnostics?.rawCandidates ?? parsedSourceMatches;
  const sourceMatchUrlsFound = diagnostics?.dltv?.matchUrlsFound ?? diagnostics?.vlr?.matchUrlsFound ?? parsedSourceMatches;
  const sourceMatchPagesFetched = diagnostics?.dltv?.matchPagesFetched ?? diagnostics?.vlr?.matchPagesFetched ?? 0;
  const sourceMatchPagesFailed = diagnostics?.dltv?.matchPagesFailed ?? diagnostics?.vlr?.matchPagesFailed ?? 0;

  return {
    rawCandidates,
    parsedSourceMatches,
    sourceMatchUrlsFound,
    sourceMatchPagesFetched,
    sourceMatchPagesFailed,
    rawScheduleSignals: rawSignals,
    diagnostics,
    warnings,
    error,
    samples,
  };
}

async function getDiagnostics(
  candidate: AuditCandidate,
  importResult: any,
  tournamentId: string | null,
): Promise<EsportsParsingDiagnostics | null> {
  const fromImport = extractDiagnosticsFromObject(importResult?.normalized)
    || extractDiagnosticsFromObject(importResult?.tournament?.normalization);
  if (fromImport) return fromImport;

  const inferredFromImport = inferDiagnosticsFromImportResult(candidate, importResult);
  if (inferredFromImport) return inferredFromImport;

  if (tournamentId) {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { normalization: true },
    });
    const fromDb = extractDiagnosticsFromObject(tournament?.normalization);
    if (fromDb) return fromDb;
  }

  if (candidate.source === "hltv") {
    try {
      const eventId = candidate.externalId || extractHltvEventId(candidate.url);
      const hltvData = eventId ? await runHltvScript("event", eventId) : null;
      const matches = Array.isArray(hltvData?.matches) ? hltvData.matches : [];
      return {
        source: "liquipedia",
        generatedAt: new Date().toISOString(),
        rawCandidates: matches.length,
        savedMatches: matches.length,
        skippedMatches: 0,
        duplicateMatches: 0,
        coverage: {
          withExactTime: matches.filter((match: any) => match.unix_time || match.date || match.time).length,
          withoutExactTime: matches.filter((match: any) => !(match.unix_time || match.date || match.time)).length,
          withFormat: matches.filter((match: any) => match.format || match.matchFormat || match.bestOf).length,
          withoutFormat: matches.filter((match: any) => !(match.format || match.matchFormat || match.bestOf)).length,
          teamVsTbd: 0,
          tbdVsTbd: 0,
          missingTeams: matches.filter((match: any) => !match.team1 || !match.team2).length,
          finishedResults: 0,
        },
        skipReasons: {
          no_exact_time: 0,
          missing_team: 0,
          duplicate: 0,
          finished_result: 0,
          parse_failed: 0,
          empty_slot: 0,
        },
        issues: [],
      };
    } catch {
      return null;
    }
  }

  return null;
}

function inferDiagnosticsFromImportResult(candidate: AuditCandidate, importResult: any): EsportsParsingDiagnostics | null {
  if (candidate.source === "hltv") return null;
  const matches = Array.isArray(importResult?.normalized?.matches) ? importResult.normalized.matches : [];
  if (matches.length === 0) return null;

  const savedMatches = Array.isArray(importResult?.matches)
    ? importResult.matches.length
    : Array.isArray(importResult?.tournament?.matches)
      ? importResult.tournament.matches.length
      : 0;

  return buildEsportsParsingDiagnostics({
    source: candidate.source,
    rawCandidates: matches.length,
    candidates: matches,
    savedMatches,
  });
}

function extractDiagnosticsFromObject(value: unknown): EsportsParsingDiagnostics | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = ["dota2Diagnostics", "leagueOfLegendsDiagnostics", "valorantDiagnostics"];
  for (const key of keys) {
    const diagnostics = record[key];
    if (diagnostics && typeof diagnostics === "object" && "rawCandidates" in diagnostics) {
      return diagnostics as EsportsParsingDiagnostics;
    }
  }
  if ("rawCandidates" in record && "savedMatches" in record) return record as EsportsParsingDiagnostics;
  return null;
}

async function getRawScheduleSignals(tournamentId: string | null): Promise<RawScheduleSignals> {
  if (!tournamentId) {
    return emptyRawScheduleSignals();
  }

  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { lastImportId: true, sourceTitle: true, disciplineSlug: true },
  });
  if (!tournament?.lastImportId) return emptyRawScheduleSignals();

  const snapshots = await prisma.rawSnapshot.findMany({
    where: { tournamentImportId: tournament.lastImportId },
    select: { rawWikitext: true, rawHtml: true },
  });

  const signals = emptyRawScheduleSignals();
  signals.snapshotCount = snapshots.length;
  for (const snapshot of snapshots) {
    const text = `${snapshot.rawWikitext || ""}\n${snapshot.rawHtml || ""}`;
    signals.matchTemplateCount += countMatches(text, /\{\{\s*(?:match|matchschedule|matchlist|bracketmatch|match2)\b/gi);
    signals.matchLinkCount += countMatches(text, /\bMatch:[A-Za-z0-9_/-]+/g) + countMatches(text, /\/match(?:es)?\//gi);
    signals.scheduleKeywordCount += countMatches(text, /\b(?:upcoming|scheduled|match schedule|matches|fixtures)\b/gi);
    signals.placeholderKeywordCount += countMatches(text, /\b(?:TBD|TBA|to be decided|to be announced)\b/gi);
  }

  return signals;
}

function emptyRawScheduleSignals(): RawScheduleSignals {
  return {
    matchTemplateCount: 0,
    matchLinkCount: 0,
    scheduleKeywordCount: 0,
    placeholderKeywordCount: 0,
    snapshotCount: 0,
  };
}

function countMatches(value: string, pattern: RegExp) {
  return Array.from(value.matchAll(pattern)).length;
}

function getParsedSourceMatches(candidate: AuditCandidate, importResult: any, diagnostics: EsportsParsingDiagnostics | null) {
  if (candidate.source === "dltv") return diagnostics?.dltv?.matchPagesFetched ?? diagnostics?.savedMatches ?? importResult?.tournament?.matches?.length ?? 0;
  if (candidate.source === "vlr") return diagnostics?.vlr?.matchPagesFetched ?? diagnostics?.savedMatches ?? importResult?.tournament?.matches?.length ?? 0;
  if (candidate.source === "fandom") return diagnostics?.savedMatches ?? importResult?.normalized?.matches?.length ?? importResult?.tournament?.matches?.length ?? 0;
  if (candidate.source === "hltv") return diagnostics?.rawCandidates ?? importResult?.tournament?.matches?.length ?? 0;
  return diagnostics?.savedMatches ?? importResult?.processedMatchIds?.length ?? importResult?.normalized?.matches?.length ?? importResult?.tournament?.matches?.length ?? 0;
}

function getImportMatchSamples(importResult: any): MatchSample[] {
  const matches = Array.isArray(importResult?.tournament?.matches)
    ? importResult.tournament.matches
    : Array.isArray(importResult?.normalized?.matches)
      ? importResult.normalized.matches
      : [];
  return matches.slice(0, 8).map((match: any) => ({
    date: match.matchDate ? new Date(match.matchDate).toISOString() : match.matchDateTime || null,
    teamA: match.teamAName || match.team1 || null,
    teamB: match.teamBName || match.team2 || null,
    stage: match.stage || null,
    round: match.round || null,
    format: match.format || null,
    sourceUrl: match.sourceUrl || match.url || null,
  }));
}

function getWarnings(importResult: any, diagnostics: EsportsParsingDiagnostics | null) {
  const warnings = new Set<string>();
  for (const value of [
    importResult?.warning,
    importResult?.normalized?.warning,
    ...(Array.isArray(importResult?.normalized?.warnings) ? importResult.normalized.warnings : []),
    ...(Array.isArray(importResult?.tournament?.normalization?.warnings) ? importResult.tournament.normalization.warnings : []),
  ]) {
    if (typeof value === "string" && value.trim()) warnings.add(value.trim());
  }
  for (const issue of diagnostics?.issues ?? []) {
    if (issue.reason === "parse_failed" && issue.message) warnings.add(issue.message);
  }
  return Array.from(warnings);
}

function getImportResultError(importResult: any) {
  const error = importResult?.normalized?.error || importResult?.error || null;
  return typeof error === "string" && error.trim() ? error.trim() : null;
}

async function buildPlatformState(candidate: AuditCandidate, tournamentId: string | null): Promise<PlatformState> {
  if (!tournamentId) {
    return {
      tournamentId: null,
      platformUrl: null,
      sourceUrl: candidate.url,
      extractionStatus: null,
      totalSavedMatches: 0,
      uploadReadyMatches: 0,
      displayableMatches: 0,
      announcementEntries: 0,
      scheduleEntries: 0,
      placeholderMatches: 0,
      lastImportStatus: null,
      lastImportError: null,
      normalizationWarnings: [],
    };
  }

  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      matches: true,
      lastImport: {
        select: { status: true, errorMessage: true },
      },
    },
  });

  if (!tournament) {
    return {
      tournamentId,
      platformUrl: platformTournamentUrl(candidate.disciplineSlug, tournamentId),
      sourceUrl: candidate.url,
      extractionStatus: null,
      totalSavedMatches: 0,
      uploadReadyMatches: 0,
      displayableMatches: 0,
      announcementEntries: 0,
      scheduleEntries: 0,
      placeholderMatches: 0,
      lastImportStatus: null,
      lastImportError: null,
      normalizationWarnings: [],
    };
  }

  const source = detectTournamentSource(tournament.sourceUrl || candidate.url);
  const matches = dedupeTournamentMatches(tournament.matches);
  const uploadReadyMatches = matches.filter(isUploadReadyScheduleMatch);
  const displayableMatches = matches.filter(isDisplayableScheduleMatch);
  const displayableOnlyMatches = displayableMatches.filter((match) => !isUploadReadyScheduleMatch(match));
  const announcements = expandScheduleAnnouncementsForDiscipline(matches, candidate.disciplineSlug, source);
  const normalization = tournament.normalization && typeof tournament.normalization === "object" && !Array.isArray(tournament.normalization)
    ? tournament.normalization as Record<string, unknown>
    : {};
  const normalizationWarnings = Array.isArray(normalization.warnings)
    ? normalization.warnings.filter((item): item is string => typeof item === "string")
    : [];

  return {
    tournamentId: tournament.id,
    platformUrl: platformTournamentUrl(candidate.disciplineSlug, tournament.id),
    sourceUrl: tournament.sourceUrl || candidate.url,
    extractionStatus: tournament.extractionStatus,
    totalSavedMatches: matches.length,
    uploadReadyMatches: uploadReadyMatches.length,
    displayableMatches: displayableMatches.length,
    announcementEntries: announcements.length,
    scheduleEntries: uploadReadyMatches.length + displayableOnlyMatches.length + announcements.length,
    placeholderMatches: matches.filter((match) => match.hasPlaceholderTeams).length,
    lastImportStatus: tournament.lastImport?.status || null,
    lastImportError: tournament.lastImport?.errorMessage || null,
    normalizationWarnings,
  };
}

function classifyIssues(expectation: SourceExpectation, platform: PlatformState, importError: string | null): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const rawSignals = expectation.rawScheduleSignals;
  const hasRawScheduleSignal = rawSignals.matchTemplateCount > 0 || rawSignals.matchLinkCount > 0;
  const actionableSourceCandidates = getActionableSourceCandidateCount(expectation);
  const actionableParsedMatches = Math.min(expectation.parsedSourceMatches, actionableSourceCandidates);
  const hasUnparsedRawScheduleSignal = hasRawScheduleSignal && (!expectation.diagnostics || expectation.diagnostics.rawCandidates === 0);
  const sourceHasSchedule =
    actionableSourceCandidates > 0 ||
    expectation.sourceMatchUrlsFound > 0 ||
    actionableParsedMatches > 0 ||
    hasUnparsedRawScheduleSignal;

  if (importError) {
    issues.push({
      severity: "critical",
      code: "import_failed",
      message: `Import failed: ${importError}`,
    });
  }

  if (sourceHasSchedule && platform.scheduleEntries === 0) {
    issues.push({
      severity: "critical",
      code: "source_schedule_platform_empty",
      message: "Source has match/announcement evidence, but the platform schedule is empty.",
    });
  }

  if ((actionableParsedMatches > 0 || expectation.sourceMatchUrlsFound > 0) && platform.totalSavedMatches === 0) {
    issues.push({
      severity: "critical",
      code: "source_matches_not_saved",
      message: "Source scraper/parser found matches, but no matches were saved in the platform.",
    });
  }

  if (hasRawScheduleSignal && expectation.rawCandidates === 0 && platform.totalSavedMatches === 0) {
    issues.push({
      severity: "critical",
      code: "raw_source_signals_not_parsed",
      message: "Raw source snapshot contains match-like markers, but parser diagnostics and platform saved zero matches.",
    });
  }

  if (expectation.sourceMatchPagesFailed > 0) {
    issues.push({
      severity: "warning",
      code: "source_match_pages_failed",
      message: `Some source match pages failed to load/parse: ${expectation.sourceMatchPagesFailed}.`,
    });
  }

  if (expectation.diagnostics && expectation.diagnostics.rawCandidates > expectation.diagnostics.savedMatches) {
    issues.push({
      severity: "warning",
      code: "source_candidates_skipped",
      message: `Parser saw ${expectation.diagnostics.rawCandidates} candidate(s), saved ${expectation.diagnostics.savedMatches}.`,
    });
  }

  if (platform.lastImportError) {
    issues.push({
      severity: "warning",
      code: "last_import_error",
      message: platform.lastImportError,
    });
  }

  if (expectation.warnings.length > 0) {
    issues.push({
      severity: "info",
      code: "parser_warnings",
      message: expectation.warnings.slice(0, 3).join("; "),
    });
  }

  return dedupeIssues(issues);
}

function getActionableSourceCandidateCount(expectation: SourceExpectation) {
  const diagnostics = expectation.diagnostics;
  if (!diagnostics) return expectation.rawCandidates;

  const skippedFinished = expectation.diagnostics?.skipReasons?.finished_result ?? 0;
  const skippedEmpty = expectation.diagnostics?.skipReasons?.empty_slot ?? 0;
  const skippedNoExact = expectation.diagnostics?.skipReasons?.no_exact_time ?? 0;
  const actionableNoExact = getActionableNoExactCandidateCount(diagnostics);
  const nonActionableNoExact = Math.max(0, skippedNoExact - actionableNoExact);
  const rawCandidates = diagnostics.rawCandidates ?? expectation.rawCandidates;
  return Math.max(0, rawCandidates - skippedFinished - skippedEmpty - nonActionableNoExact);
}

function getActionableNoExactCandidateCount(diagnostics: EsportsParsingDiagnostics) {
  return diagnostics.issues.filter((issue) => {
    if (issue.reason !== "no_exact_time") return false;
    if (!hasAuditPlaceholderTeam(issue.teamAName) || !hasAuditPlaceholderTeam(issue.teamBName)) return false;
    return /\b(?:slot|round|group|swiss|playoffs?|bracket|quarter[-\s]?finals?|semi[-\s]?finals?|finals?|grand\s+final|winner|loser)\b/i.test(issue.stage || "");
  }).length;
}

function hasAuditPlaceholderTeam(value?: string | null) {
  return /^(?:tbd|tba|to be (?:decided|announced)|winner|loser|[ab]\d+|#\d+|group\b|seed\b)/i.test(String(value || "").trim());
}

function dedupeIssues(issues: AuditIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.severity}:${issue.code}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildSummary(results: AuditTournamentResult[], candidates: number): AuditReport["summary"] {
  const critical = results.reduce((sum, result) => sum + result.issues.filter((issue) => issue.severity === "critical").length, 0);
  const warnings = results.reduce((sum, result) => sum + result.issues.filter((issue) => issue.severity === "warning").length, 0);
  const withIssues = results.filter((result) => result.issues.some((issue) => issue.severity !== "info")).length;
  return {
    candidates,
    checked: results.length,
    ok: results.length - withIssues,
    withIssues,
    critical,
    warnings,
    importErrors: results.filter((result) => result.importError).length,
  };
}

function buildReport(
  options: AuditOptions,
  now: Date,
  until: Date,
  candidatesCount: number,
  collectionErrors: AuditReport["sourceCollection"]["errors"],
  skippedUnknownDate: AuditCandidate[],
  results: AuditTournamentResult[],
): AuditReport {
  return {
    generatedAt: new Date().toISOString(),
    window: {
      now: now.toISOString(),
      days: options.days,
      until: until.toISOString(),
    },
    options,
    summary: buildSummary(results, candidatesCount),
    sourceCollection: {
      errors: collectionErrors,
      skippedUnknownDate,
    },
    results,
  };
}

function createReportPaths(reportDir: string) {
  fs.mkdirSync(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(reportDir, `tournament-audit-${stamp}.json`);
  const markdownPath = path.join(reportDir, `tournament-audit-${stamp}.md`);
  return { jsonPath, markdownPath };
}

function writeReportFiles(report: AuditReport, paths: { jsonPath: string; markdownPath: string }) {
  const partialReport = {
    ...report,
    partial: report.summary.checked < report.summary.candidates,
  };
  fs.writeFileSync(paths.jsonPath, JSON.stringify(partialReport, null, 2));
  fs.writeFileSync(paths.markdownPath, renderMarkdownReport(partialReport));
}

function renderMarkdownReport(report: AuditReport) {
  const lines: string[] = [];
  lines.push("# Tournament Audit Report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Window: ${report.window.now} -> ${report.window.until} (${report.window.days} days)`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Candidates: ${report.summary.candidates}`);
  lines.push(`- Checked: ${report.summary.checked}`);
  lines.push(`- OK: ${report.summary.ok}`);
  lines.push(`- With issues: ${report.summary.withIssues}`);
  lines.push(`- Critical issues: ${report.summary.critical}`);
  lines.push(`- Warnings: ${report.summary.warnings}`);
  lines.push(`- Import errors: ${report.summary.importErrors}`);
  lines.push("");

  if (report.sourceCollection.errors.length > 0) {
    lines.push("## Source Collection Errors");
    lines.push("");
    for (const error of report.sourceCollection.errors) {
      lines.push(`- ${error.disciplineSlug}/${error.source}: ${error.error}`);
    }
    lines.push("");
  }

  const issueResults = report.results.filter((result) => result.issues.length > 0);
  lines.push("## Findings");
  lines.push("");
  if (issueResults.length === 0) {
    lines.push("No issues found.");
    lines.push("");
  } else {
    for (const result of issueResults) {
      const c = result.candidate;
      lines.push(`### ${c.disciplineSlug} / ${c.source} / ${c.title}`);
      lines.push("");
      lines.push(`- Source: ${c.url}`);
      if (result.platform.platformUrl) lines.push(`- Platform: ${result.platform.platformUrl}`);
      lines.push(`- Dates: ${c.dates || "unknown"} (${c.parsedStart || "?"} -> ${c.parsedEnd || "?"})`);
      lines.push(`- Import status: ${result.platform.lastImportStatus || result.platform.extractionStatus || "unknown"}`);
      lines.push(`- Source candidates: raw=${result.sourceExpectation.rawCandidates}, parsed=${result.sourceExpectation.parsedSourceMatches}, urls=${result.sourceExpectation.sourceMatchUrlsFound}, failedPages=${result.sourceExpectation.sourceMatchPagesFailed}`);
      lines.push(`- Platform schedule: saved=${result.platform.totalSavedMatches}, uploadReady=${result.platform.uploadReadyMatches}, displayable=${result.platform.displayableMatches}, announcements=${result.platform.announcementEntries}, placeholders=${result.platform.placeholderMatches}`);
      lines.push(`- Raw signals: templates=${result.sourceExpectation.rawScheduleSignals.matchTemplateCount}, links=${result.sourceExpectation.rawScheduleSignals.matchLinkCount}, keywords=${result.sourceExpectation.rawScheduleSignals.scheduleKeywordCount}, snapshots=${result.sourceExpectation.rawScheduleSignals.snapshotCount}`);
      lines.push("- Issues:");
      for (const issue of result.issues) {
        lines.push(`  - [${issue.severity}] ${issue.code}: ${issue.message}`);
      }
      if (result.sourceExpectation.diagnostics?.issues?.length) {
        lines.push("- Diagnostic samples:");
        for (const issue of result.sourceExpectation.diagnostics.issues.slice(0, 5)) {
          lines.push(`  - ${issue.reason}: ${issue.message}${issue.sourceUrl ? ` (${issue.sourceUrl})` : ""}`);
        }
      }
      if (result.sourceExpectation.samples.length > 0) {
        lines.push("- Match samples:");
        for (const sample of result.sourceExpectation.samples.slice(0, 5)) {
          lines.push(`  - ${sample.date || "no date"} | ${sample.teamA || "?"} vs ${sample.teamB || "?"} | ${sample.stage || sample.round || ""} | ${sample.sourceUrl || ""}`);
        }
      }
      lines.push("");
    }
  }

  lines.push("## Checked Tournaments");
  lines.push("");
  for (const result of report.results) {
    const status = result.issues.some((issue) => issue.severity === "critical")
      ? "CRITICAL"
      : result.issues.some((issue) => issue.severity === "warning")
        ? "WARN"
        : "OK";
    lines.push(`- [${status}] ${result.candidate.disciplineSlug}/${result.candidate.source}: ${result.candidate.title} | saved=${result.platform.totalSavedMatches}, announcements=${result.platform.announcementEntries} | ${result.candidate.url}`);
  }

  return `${lines.join("\n")}\n`;
}

function normalizeHltvUrl(value: string) {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `https://www.hltv.org${value.startsWith("/") ? "" : "/"}${value}`;
}

function extractHltvEventId(value: string) {
  const match = String(value || "").match(/\/events\/(\d+)/);
  return match?.[1] || "";
}

function extractYear(value: string) {
  const match = value.match(/\b(19\d{2}|20\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function normalizeCandidateUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return value;
  }
}

function platformTournamentUrl(disciplineSlug: string, tournamentId: string) {
  const origin = process.env.NEXT_PUBLIC_APP_URL || process.env.PUBLIC_ORIGIN || "http://localhost:3010";
  return `${origin.replace(/\/+$/, "")}/${disciplineSlug}/tournament/${tournamentId}`;
}

function formatIso(date: Date) {
  return date.toISOString();
}

main()
  .catch((error) => {
    console.error("[TournamentAuditAgent] Fatal error:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
