import { sourceProviders } from "@backend/sources/providerRegistry";
import type { ParserProbe, ProbeObservation } from "./parserMonitorCore";
import { MonitorProbeError } from "./parserMonitorCore";
import type { ParserProbeErrorClass } from "./parserMonitorTypes";

const LIQUIPEDIA_SCOPES = ["dota2", "counterstrike", "leagueoflegends", "valorant"] as const;
const TLINE_BUILTIN_PROVIDERS = ["volley-ru", "nffr-floorball", "hockey-by"] as const;
const MAX_SEMANTIC_CANARY_CANDIDATES = 5;
const HLTV_SEMANTIC_CANARY_CANDIDATES = 2;
const HLTV_FALLBACK_EVENT_URL = "https://www.hltv.org/events/8249/blast-open-porto-2026";
const DLTV_HISTORICAL_CANARY_URL = "https://dltv.org/events/the-international-2026";
const WTT_PRIMARY_HOSTNAME = "wtt-web-frontdoor-cthahjeqhbh6aqe3.a01.azurefd.net";

type LiquipediaScope = typeof LIQUIPEDIA_SCOPES[number];

export type LiquipediaCanaryCandidate = {
  title: string;
  url: string;
};

type LiquipediaCanaryPage = {
  pageId?: number;
  title: string;
  fullUrl: string;
  wikitext: string;
};

type LiquipediaCanaryNormalized = {
  sourceTitle?: unknown;
  sourceUrl?: unknown;
  name?: unknown;
  participants?: unknown;
  matches?: unknown;
  subPages?: unknown;
  warnings?: unknown;
  dota2Diagnostics?: { rawCandidates?: unknown } | null;
  leagueOfLegendsDiagnostics?: { rawCandidates?: unknown } | null;
  valorantDiagnostics?: { rawCandidates?: unknown } | null;
};

type LiquipediaSemanticCanaryInput = {
  scope: LiquipediaScope;
  tournaments: readonly unknown[];
  signal: AbortSignal;
  maxCandidates?: number;
  requireParsedHtml?: boolean;
  fetchWikitext(candidate: LiquipediaCanaryCandidate, signal: AbortSignal): Promise<LiquipediaCanaryPage>;
  fetchParsedHtml(page: LiquipediaCanaryPage, signal: AbortSignal): Promise<string>;
  normalize(input: {
    pageId?: number;
    title: string;
    pageUrl: string;
    wikitext: string;
    parsedHtml?: string;
  }): LiquipediaCanaryNormalized;
};

type ParserMonitorModuleLoader = () => Promise<any>;

export type StaticParserProbeDependencies = Partial<{
  loadLiquipediaPortal: ParserMonitorModuleLoader;
  loadLiquipediaClient: ParserMonitorModuleLoader;
  loadNormalizers: ParserMonitorModuleLoader;
  loadEnv: ParserMonitorModuleLoader;
  loadHltv: ParserMonitorModuleLoader;
  loadVlr: ParserMonitorModuleLoader;
  loadDltv: ParserMonitorModuleLoader;
  loadFandom: ParserMonitorModuleLoader;
  loadVolleyballWorld: ParserMonitorModuleLoader;
  loadBeachVolleyRu: ParserMonitorModuleLoader;
  loadGermanBeachTour: ParserMonitorModuleLoader;
  loadTwelveNdr: ParserMonitorModuleLoader;
  loadCbv: ParserMonitorModuleLoader;
  loadFedervolley: ParserMonitorModuleLoader;
  loadWtt: ParserMonitorModuleLoader;
  loadKhl: ParserMonitorModuleLoader;
  loadKhlNormalizer: ParserMonitorModuleLoader;
}>;

export function createStaticParserProbes(): ParserProbe[] {
  return createStaticParserProbesWithDependencies();
}

export function createStaticParserProbesWithDependencies(
  dependencies: StaticParserProbeDependencies = {},
): ParserProbe[] {
  const probes: ParserProbe[] = [
    ...LIQUIPEDIA_SCOPES.map((scope) => createLiquipediaProbe(scope, dependencies)),
    createHltvProbe(dependencies),
    createVlrProbe(dependencies),
    createDltvProbe(dependencies),
    createFandomProbe(dependencies),
    createVolleyballWorldProbe(dependencies),
    createBeachVolleyRuProbe(dependencies),
    createGermanBeachTourProbe(dependencies),
    createTwelveNdrProbe("twelvendrcsvp", "csvp", dependencies),
    createTwelveNdrProbe("twelvendroevv", "oevv", dependencies),
    createCbvProbe(dependencies),
    createFedervolleyProbe(dependencies),
    createWttProbe(dependencies),
    createKhlProbe(dependencies),
  ];
  const covered = new Set(probes.map((probe) => probe.source));
  for (const provider of sourceProviders) {
    if (!covered.has(provider.id)) probes.push(createUncoveredProviderProbe(provider.id));
  }
  return probes;
}

export async function createProductionParserProbes(): Promise<ParserProbe[]> {
  return [...createStaticParserProbes(), ...await createActiveTLineProbes()];
}

export function findUncoveredTLineProviders(
  activeProviders: readonly string[],
  supportedProviders: readonly string[] = TLINE_BUILTIN_PROVIDERS,
) {
  const supported = new Set<string>(supportedProviders);
  return Array.from(new Set(activeProviders.filter((provider) => !supported.has(provider)))).sort();
}

export function getTournamentMonitorCoverage() {
  const covered = new Set(
    createStaticParserProbes()
      .filter((probe) => !probe.id.startsWith("uncovered:tournament:"))
      .map((probe) => probe.source),
  );
  return sourceProviders.map((provider) => ({ provider: provider.id, covered: covered.has(provider.id) }));
}

function createUncoveredProviderProbe(providerId: string): ParserProbe {
  return {
    id: `uncovered:tournament:${providerId}`,
    source: providerId,
    hostname: "monitor.local",
    required: true,
    async run(_attempt, signal) {
      signal.throwIfAborted();
      throw new MonitorProbeError("uncovered_provider", `No parser monitor adapter for tournament provider ${providerId}`);
    },
  };
}

function createLiquipediaProbe(
  scope: LiquipediaScope,
  dependencies: StaticParserProbeDependencies,
): ParserProbe {
  return {
    id: `liquipedia:${scope}`,
    source: "liquipedia",
    scope,
    hostname: "liquipedia.net",
    required: true,
    timeoutMs: 3 * 60_000,
    async run(_attempt, signal) {
      signal.throwIfAborted();
      const { fetchDisciplinePortal } = await (dependencies.loadLiquipediaPortal?.()
        ?? import("@backend/sources/tdata/liquipedia/portal"));
      const portal = await fetchDisciplinePortal(scope, { force: true, readOnly: true, failClosed: true, signal });
      signal.throwIfAborted();
      if (!portal || portal.slug !== scope || !Array.isArray(portal.tournaments)) {
        throw new MonitorProbeError("schema_drift", `Liquipedia ${scope} portal returned an unexpected discovery schema`);
      }

      const [client, normalizers, config] = await Promise.all([
        dependencies.loadLiquipediaClient?.() ?? import("@backend/sources/tdata/liquipedia/client/fetching"),
        dependencies.loadNormalizers?.() ?? import("@backend/normalizers/registry"),
        dependencies.loadEnv?.() ?? import("@backend/config/env"),
      ]);
      const apiUrl = `https://liquipedia.net/${scope}/api.php`;
      const normalizer = normalizers.getNormalizer(scope);
      return runLiquipediaSemanticCanary({
        scope,
        tournaments: portal.tournaments,
        signal,
        maxCandidates: 4,
        requireParsedHtml: config.shouldFetchParsedHtmlForDiscipline(scope),
        async fetchWikitext(candidate, requestSignal) {
          return client.fetchPageWikitext(apiUrl, scope, { title: candidate.title }, {
            mode: "parser-monitor",
            timeoutMs: 12_000,
            maxRetries: 0,
            signal: requestSignal,
          });
        },
        async fetchParsedHtml(page, requestSignal) {
          return client.fetchPageParsed(apiUrl, page.title, {
            mode: "parser-monitor",
            timeoutMs: 12_000,
            maxRetries: 0,
            signal: requestSignal,
          });
        },
        normalize: normalizer,
      });
    },
  };
}

export function buildLiquipediaCanaryCandidates(
  scope: LiquipediaScope,
  tournaments: readonly unknown[],
): LiquipediaCanaryCandidate[] {
  const candidates: LiquipediaCanaryCandidate[] = [];
  const seen = new Set<string>();
  const expectedPrefix = `/${scope}/`;

  for (const item of tournaments) {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const rawUrl = clean(record.url);
    if (!rawUrl) continue;
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== "https:" || !["liquipedia.net", "www.liquipedia.net"].includes(url.hostname.toLowerCase())) continue;
      if (!url.pathname.startsWith(expectedPrefix) || url.pathname.length <= expectedPrefix.length) continue;
      const encodedTitle = url.pathname.slice(expectedPrefix.length).replace(/\/+$/u, "");
      if (!encodedTitle) continue;
      const title = decodeURIComponent(encodedTitle).replace(/_/g, " ").trim();
      if (!title) continue;
      url.hostname = "liquipedia.net";
      url.search = "";
      url.hash = "";
      url.pathname = `${expectedPrefix}${encodedTitle}`;
      const canonicalUrl = url.toString().replace(/\/$/u, "");
      if (seen.has(canonicalUrl)) continue;
      seen.add(canonicalUrl);
      candidates.push({ title, url: canonicalUrl });
    } catch {
      // Discovery rows with malformed or cross-source URLs are rejected below
      // if no structurally valid canary candidates remain.
    }
  }

  return candidates;
}

export async function runLiquipediaSemanticCanary(
  input: LiquipediaSemanticCanaryInput,
): Promise<ProbeObservation> {
  input.signal.throwIfAborted();
  const portalCandidateCount = input.tournaments.length;
  if (portalCandidateCount === 0) {
    throw new MonitorProbeError(
      "schema_drift",
      `Liquipedia ${input.scope} fresh portal discovery returned no tournament candidates`,
    );
  }

  const candidates = buildLiquipediaCanaryCandidates(input.scope, input.tournaments);
  if (candidates.length === 0) {
    throw new MonitorProbeError(
      "schema_drift",
      `Liquipedia ${input.scope} returned ${portalCandidateCount} portal rows without canonical tournament URLs`,
    );
  }

  const canary = await findSemanticCanary({
    candidates,
    maxCandidates: input.maxCandidates ?? MAX_SEMANTIC_CANARY_CANDIDATES,
    signal: input.signal,
    async load(candidate) {
      const page = await input.fetchWikitext(candidate, input.signal);
      input.signal.throwIfAborted();
      assertLiquipediaPage(page, input.scope);

      let parsedHtml: string | undefined;
      if (input.requireParsedHtml) {
        parsedHtml = await input.fetchParsedHtml(page, input.signal);
        input.signal.throwIfAborted();
        assertLiquipediaParsedHtml(parsedHtml, input.scope, page.title);
      }

      let normalized: LiquipediaCanaryNormalized;
      try {
        normalized = input.normalize({
          pageId: page.pageId,
          title: page.title,
          pageUrl: page.fullUrl,
          wikitext: page.wikitext,
          parsedHtml,
        });
      } catch (error) {
        throw new MonitorProbeError(
          "parse_failed",
          `Liquipedia ${input.scope} normalizer failed for ${page.title}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      assertLiquipediaNormalized(normalized, input.scope, page.title);
      const normalizedMatches = arrayOf(normalized.matches);
      const rawMatchCount = getLiquipediaRawMatchCount(normalized, normalizedMatches, page.wikitext, parsedHtml);
      const semanticMatches = normalizedMatches.filter(isSemanticLiquipediaMatch);
      return { page, rawMatchCount, semanticMatches };
    },
    isSemantic: (detail) => detail.semanticMatches.length > 0,
  });
  throwIfAllCandidateLoadsFailed(canary, `Liquipedia ${input.scope} detail candidates failed`);
  if (!canary.detail) {
    throw new MonitorProbeError(
      "schema_drift",
      `Liquipedia ${input.scope}: ${portalCandidateCount} portal candidates discovered, but ${canary.attempted} fresh detail pages yielded no semantic matches`,
    );
  }

  return observation(
    canary.detail.rawMatchCount,
    canary.detail.semanticMatches.length,
    true,
    false,
    `Liquipedia ${input.scope}: ${portalCandidateCount} portal candidates, ${candidates.length} canonical; ${canary.attempted} candidates checked; ${canary.detail.rawMatchCount} raw matches, ${canary.detail.semanticMatches.length} semantic matches on ${canary.detail.page.title}`,
  );
}

function assertLiquipediaPage(page: LiquipediaCanaryPage, scope: LiquipediaScope) {
  const pageIdValid = Number.isInteger(page?.pageId) && Number(page.pageId) > 0;
  const pageTitle = clean(page?.title);
  const fullUrl = clean(page?.fullUrl);
  const wikitext = clean(page?.wikitext);
  if (!pageIdValid || !pageTitle || !fullUrl || !wikitext) {
    throw new MonitorProbeError("schema_drift", `Liquipedia ${scope} detail returned incomplete page metadata or wikitext`);
  }
  const canonical = buildLiquipediaCanaryCandidates(scope, [{ url: fullUrl }]);
  if (canonical.length !== 1) {
    throw new MonitorProbeError("schema_drift", `Liquipedia ${scope} detail returned a non-canonical page URL`);
  }
  if (!/\{\{\s*(?:Infobox\s+(?:league|tournament)|LeagueInfobox|TournamentInfobox)\b/iu.test(wikitext)) {
    throw new MonitorProbeError("schema_drift", `Liquipedia ${scope} detail ${pageTitle} has no tournament infobox`);
  }
}

function assertLiquipediaParsedHtml(parsedHtml: string, scope: LiquipediaScope, title: string) {
  const value = clean(parsedHtml);
  if (!value) {
    throw new MonitorProbeError("schema_drift", `Liquipedia ${scope} parsed HTML is empty for ${title}`);
  }
  if (/challenge-platform|just a moment|cf-chl-|cloudflare ray id/iu.test(value)) {
    throw new MonitorProbeError("cloudflare_block", `Liquipedia ${scope} parsed HTML was replaced by a Cloudflare challenge`);
  }
}

function assertLiquipediaNormalized(
  normalized: LiquipediaCanaryNormalized,
  scope: LiquipediaScope,
  title: string,
) {
  if (!normalized || typeof normalized !== "object"
    || !clean(normalized.sourceTitle)
    || !clean(normalized.sourceUrl)
    || !clean(normalized.name)
    || !Array.isArray(normalized.participants)
    || !Array.isArray(normalized.matches)
    || !Array.isArray(normalized.subPages)
    || !Array.isArray(normalized.warnings)) {
    throw new MonitorProbeError("schema_drift", `Liquipedia ${scope} normalizer returned an invalid schema for ${title}`);
  }
}

function isSemanticLiquipediaMatch(item: unknown) {
  const match = item && typeof item === "object" ? item as Record<string, unknown> : {};
  const hasIdentity = Boolean(clean(match.matchId) || clean(match.sourceUrl));
  const hasTeam = Boolean(clean(match.teamAName) || clean(match.teamBName));
  const hasSchedule = Boolean(
    clean(match.matchDate)
    || clean(match.matchDateTime)
    || clean(match.stage)
    || clean(match.round),
  );
  return (hasIdentity && (hasTeam || hasSchedule)) || (hasTeam && hasSchedule);
}

function getLiquipediaRawMatchCount(
  normalized: LiquipediaCanaryNormalized,
  normalizedMatches: readonly unknown[],
  wikitext: string,
  parsedHtml?: string,
) {
  const diagnosticCounts = [
    normalized.dota2Diagnostics?.rawCandidates,
    normalized.leagueOfLegendsDiagnostics?.rawCandidates,
    normalized.valorantDiagnostics?.rawCandidates,
  ].map((value) => numberOr(value, 0));
  const wikiSignals = wikitext.match(/\{\{\s*(?:match|bracketmatch|matchsummary|matchschedule)\b/giu)?.length ?? 0;
  const htmlSignals = parsedHtml?.match(/class=["'][^"']*\bbrkts-match\b[^"']*["']/giu)?.length ?? 0;
  return Math.max(normalizedMatches.length, wikiSignals, htmlSignals, ...diagnosticCounts);
}

function createHltvProbe(dependencies: StaticParserProbeDependencies): ParserProbe {
  return {
    id: "hltv",
    source: "hltv",
    hostname: "hltv.org",
    required: true,
    timeoutMs: 180_000,
    async run(_attempt, signal) {
      const { runHltvScript } = await (dependencies.loadHltv?.()
        ?? import("@backend/sources/tdata/hltv/scraper"));
      let listing: any;
      try {
        listing = await runHltvScript("events", undefined, { noCache: true, signal });
        assertFreshResult(listing, "HLTV events");
      } catch (error) {
        signal.throwIfAborted();
        const discoveryErrorClass = classifyProbeError(error);
        if (discoveryErrorClass === "cloudflare_block") {
          throw new MonitorProbeError(
            "cloudflare_block",
            `HLTV discovery was blocked by Cloudflare: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        const fallback: any = await runHltvScript("event", HLTV_FALLBACK_EVENT_URL, { noCache: true, signal });
        assertFreshResult(fallback, "HLTV fallback event detail");
        if (!hltvDetailChecked(fallback)) {
          throw new MonitorProbeError("schema_drift", "HLTV discovery and fallback event detail were both unavailable");
        }
        return buildHltvFallbackObservation(fallback, discoveryErrorClass);
      }

      const events = arrayOf(listing?.events);
      if (events.length === 0) return observation(0, 0, false, false, "HLTV returned no fresh events");

      const candidates = buildHltvCanaryCandidates(events);
      if (candidates.length === 0) {
        throw new MonitorProbeError("schema_drift", `HLTV returned ${events.length} events without canonical event IDs or URLs`);
      }
      const canary = await findSemanticCanary({
        candidates,
        maxCandidates: HLTV_SEMANTIC_CANARY_CANDIDATES,
        signal,
        async load(candidate) {
          const detail: any = await runHltvScript("event", candidate, { noCache: true, signal });
          assertFreshResult(detail, "HLTV event detail");
          return detail;
        },
        isSemantic: (detail) => hltvDetailChecked(detail) && hasSemanticMatchRows(arrayOf((detail as any)?.matches)),
      });
      throwIfAllCandidateLoadsFailed(canary, "HLTV event detail candidates failed");
      const matches = arrayOf((canary.detail as any)?.matches);
      return observation(
        events.length,
        matches.length,
        Boolean(canary.detail),
        false,
        `HLTV: ${events.length} discovered events; ${canary.attempted} candidates checked; ${matches.length} semantic matches`,
      );
    },
  };
}

export function buildHltvCanaryCandidates(events: readonly unknown[]) {
  const candidates: string[] = [];
  for (const item of events) {
    const event = item as { id?: unknown; url?: unknown } | null;
    const rawUrl = clean(event?.url);
    const canonicalUrl = normalizeHltvCanaryUrl(rawUrl);
    const id = clean(event?.id);
    const candidate = canonicalUrl || (/^[1-9]\d{0,15}$/.test(id) ? `https://www.hltv.org/events/${id}` : "");
    if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
  }
  return candidates;
}

export function buildHltvFallbackObservation(
  detail: unknown,
  discoveryErrorClass: ParserProbeErrorClass,
): ProbeObservation {
  const matches = arrayOf((detail as { matches?: unknown } | null)?.matches);
  return {
    rawCandidates: 1,
    normalizedItems: matches.length,
    detailChecked: hltvDetailChecked(detail),
    explicitEmpty: matches.length === 0 && Boolean((detail as { validEmpty?: unknown } | null)?.validEmpty),
    status: "warning",
    errorClass: discoveryErrorClass,
    summary: `HLTV discovery unavailable; fallback event 8249 verified with ${matches.length} match${matches.length === 1 ? "" : "es"}`,
  };
}

export function hltvDetailChecked(detail: unknown) {
  const value = detail as { ok?: unknown; matches?: unknown; validEmpty?: unknown } | null;
  return Boolean(
    value?.ok === true
    && (arrayOf(value.matches).length > 0 || value.validEmpty === true),
  );
}

function createVlrProbe(dependencies: StaticParserProbeDependencies): ParserProbe {
  return {
    id: "vlr",
    source: "vlr",
    hostname: "vlr.gg",
    required: true,
    async run(_attempt, signal) {
      const { runVlrScraper } = await (dependencies.loadVlr?.()
        ?? import("@backend/sources/tdata/vlr/scraper"));
      const listing: any = await runVlrScraper("events", undefined, { noCache: true, signal });
      assertFreshResult(listing, "VLR events");
      const events = arrayOf(listing?.events);
      if (events.length === 0) return observation(0, 0, false, false, "VLR returned no fresh events");
      const candidates = uniqueCandidateValues(events, ["id", "url"]);
      if (candidates.length === 0) throw new MonitorProbeError("schema_drift", "VLR events are missing IDs and URLs");
      const canary = await findSemanticCanary({
        candidates,
        maxCandidates: MAX_SEMANTIC_CANARY_CANDIDATES,
        signal,
        async load(candidate) {
          const detail: any = await runVlrScraper("event", candidate, { noCache: true, signal, monitorMode: true });
          assertFreshResult(detail, "VLR event detail");
          const warning = clean(detail?.warning);
          if (warning) {
            throw new MonitorProbeError(
              classifySourceError(warning),
              `VLR event detail was incomplete: ${warning}`,
            );
          }
          return detail;
        },
        isSemantic: (detail) => Boolean(clean((detail as any)?.title))
          && hasSemanticMatchRows(arrayOf((detail as any)?.matches))
          && numberOr((detail as any)?.diagnostics?.vlr?.matchPagesFetched, 0) > 0,
      });
      throwIfAllCandidateLoadsFailed(canary, "VLR event detail candidates failed");
      const matches = arrayOf((canary.detail as any)?.matches);
      return observation(events.length, matches.length, Boolean(canary.detail), false, `VLR: ${events.length} events; ${canary.attempted} candidates checked; ${matches.length} semantic matches`);
    },
  };
}

function createDltvProbe(dependencies: StaticParserProbeDependencies): ParserProbe {
  return {
    id: "dltv",
    source: "dltv",
    hostname: "dltv.org",
    required: true,
    async run(_attempt, signal) {
      const { runDltv } = await (dependencies.loadDltv?.()
        ?? import("@backend/sources/tdata/dltv/queue"));
      const listing: any = await runDltv("events", undefined, { noCache: true, signal });
      assertFreshResult(listing, "DLTV events");
      const events = arrayOf(listing?.events);
      if (events.length === 0) return observation(0, 0, false, false, "DLTV returned no fresh events");
      const candidates = uniqueCandidateValues(events, ["url", "id"]);
      if (candidates.length === 0) throw new MonitorProbeError("schema_drift", "DLTV events are missing URLs and IDs");
      const canary = await findSemanticCanary({
        candidates,
        maxCandidates: MAX_SEMANTIC_CANARY_CANDIDATES,
        signal,
        async load(candidate) {
          const detail: any = await runDltv("event", candidate, { noCache: true, signal, monitorMode: true });
          assertFreshResult(detail, "DLTV event detail");
          const matchPageFailure = buildDltvProbeFailure(arrayOf(detail?.matchPageFailures));
          if (matchPageFailure) throw new MonitorProbeError(matchPageFailure.errorClass, matchPageFailure.summary);
          return detail;
        },
        isSemantic: (detail) => arrayOf((detail as any)?.matches).some((match) => (
          Boolean(clean(match?.id)) && Boolean(clean(match?.team1)) && Boolean(clean(match?.team2))
        )),
      });
      throwIfAllCandidateLoadsFailed(canary, "DLTV event detail candidates failed");
      const matches = arrayOf((canary.detail as any)?.matches);
      if (!canary.detail && canary.failures.length === 0 && isExplicitDltvEmptyDetail(canary.lastDetail)) {
        const historical: any = await runDltv("event", DLTV_HISTORICAL_CANARY_URL, {
          noCache: true,
          signal,
          monitorMode: true,
        });
        assertFreshResult(historical, "DLTV historical event detail");
        const historicalFailure = buildDltvProbeFailure(arrayOf(historical?.matchPageFailures));
        if (historicalFailure) throw new MonitorProbeError(historicalFailure.errorClass, historicalFailure.summary);
        const historicalMatches = arrayOf(historical?.matches);
        if (!historicalMatches.some((match) => Boolean(clean(match?.id)) && Boolean(clean(match?.team1)) && Boolean(clean(match?.team2)))) {
          throw new MonitorProbeError("schema_drift", "DLTV current events are empty and the historical canary yielded no semantic matches");
        }
        return observation(
          events.length,
          0,
          true,
          true,
          `DLTV: ${events.length} current events explicitly publish 0 teams/matches; historical canary verified ${historicalMatches.length} semantic matches`,
        );
      }
      return observation(events.length, matches.length, Boolean(canary.detail), false, `DLTV: ${events.length} events; ${canary.attempted} candidates checked; ${matches.length} semantic matches`);
    },
  };
}

function isExplicitDltvEmptyDetail(detail: unknown) {
  const record = detail && typeof detail === "object" ? detail as Record<string, any> : null;
  return Boolean(
    record
    && arrayOf(record.matches).length === 0
    && arrayOf(record.matchPageFailures).length === 0
    && record.event
    && arrayOf(record.event.participants).length === 0
    && arrayOf(record.event.matchUrls).length === 0,
  );
}

export function buildDltvProbeFailure(failures: readonly unknown[]): {
  errorClass: "placeholder_404" | "parse_failed";
  summary: string;
} | null {
  if (failures.length === 0) return null;
  const placeholderCount = failures.filter((failure) => {
    const value = failure as { error?: unknown; errorClass?: unknown } | null;
    return clean(value?.errorClass) === "upstream_placeholder_404"
      || /(?:^|\D)404(?:\D|$)/u.test(clean(value?.error));
  }).length;
  return {
    errorClass: placeholderCount > 0 ? "placeholder_404" : "parse_failed",
    summary: `DLTV: ${failures.length} match page${failures.length === 1 ? "" : "s"} failed${placeholderCount > 0 ? ` (${placeholderCount} upstream placeholder 404)` : ""}`,
  };
}

function createFandomProbe(dependencies: StaticParserProbeDependencies): ParserProbe {
  return {
    id: "fandom",
    source: "fandom",
    hostname: "lol.fandom.com",
    required: true,
    async run(_attempt, signal) {
      signal.throwIfAborted();
      const { fetchFandomMatchScheduleCargo, fetchFandomTournamentCargoEvents } = await (dependencies.loadFandom?.()
        ?? import("@backend/sources/tdata/fandom/client"));
      const events: any[] = await fetchFandomTournamentCargoEvents(undefined, { signal });
      signal.throwIfAborted();
      if (events.length === 0) return observation(0, 0, false, false, "Fandom returned no tournament rows");
      const candidates = Array.from(new Set(events
        .map((event) => clean(event?.title?.OverviewPage) || clean(event?.title?.Name))
        .filter(Boolean)));
      if (candidates.length === 0) throw new MonitorProbeError("schema_drift", "Fandom tournament rows are missing OverviewPage");
      const canary = await findSemanticCanary({
        candidates,
        maxCandidates: MAX_SEMANTIC_CANARY_CANDIDATES,
        signal,
        async load(overviewPage) {
          const matches = await fetchFandomMatchScheduleCargo({ overviewPage, limit: 50, signal });
          signal.throwIfAborted();
          return matches;
        },
        isSemantic: (matches) => arrayOf(matches).some(isSemanticFandomScheduleRow),
      });
      throwIfAllCandidateLoadsFailed(canary, "Fandom schedule candidates failed");
      const matches = arrayOf(canary.detail);
      return observation(events.length, matches.length, Boolean(canary.detail), false, `Fandom: ${events.length} events; ${canary.attempted} candidates checked; ${matches.length} semantic schedule rows`);
    },
  };
}

function createVolleyballWorldProbe(dependencies: StaticParserProbeDependencies): ParserProbe {
  return {
    id: "volleyballworld",
    source: "volleyballworld",
    hostname: "en.volleyballworld.com",
    required: true,
    timeoutMs: 270_000,
    async run(_attempt, signal) {
      signal.throwIfAborted();
      const { searchAllVolleyballWorldBeachTournaments } = await (dependencies.loadVolleyballWorld?.()
        ?? import("@backend/sources/tbvolley/VolleyballWorld"));
      const result = await searchAllVolleyballWorldBeachTournaments({ days: 60, forceFresh: true, signal });
      signal.throwIfAborted();
      if (result.upstream.cacheStatus !== "miss") {
        throw new MonitorProbeError("stale_cache", `VolleyballWorld fresh probe returned ${result.upstream.cacheStatus} cache data${result.upstream.fallbackErrorCode ? ` after ${result.upstream.fallbackErrorCode}` : ""}`);
      }
      assertVolleyballWorldGenderSummary(result);
      return runTournamentMatchCanary({
        result,
        label: "VolleyballWorld",
        signal,
        async loadDetail(candidate, requestSignal) {
          requestSignal.throwIfAborted();
          return candidate;
        },
      });
    },
  };
}

function assertVolleyballWorldGenderSummary(result: unknown) {
  const record = result && typeof result === "object" ? result as Record<string, any> : null;
  const summary = record?.summary;
  const byGender = summary?.byGender;
  if (!byGender || typeof byGender !== "object") {
    throw new MonitorProbeError("schema_drift", "VolleyballWorld shared range omitted gender split counters");
  }
  for (const gender of ["men", "women"] as const) {
    const split = byGender[gender];
    if (!split || !isMonitorCount(split.rawTotal) || !isMonitorCount(split.total) || !isMonitorCount(split.matches)) {
      throw new MonitorProbeError("schema_drift", `VolleyballWorld shared range returned invalid ${gender} counters`);
    }
    const tournaments = arrayOf(record?.tournaments).filter((tournament) => clean(tournament?.gender) === gender);
    const matches = tournaments.reduce((sum, tournament) => sum + numberOr(tournament?.matchCount, 0), 0);
    if (tournaments.length !== split.total || matches !== split.matches) {
      throw new MonitorProbeError("schema_drift", `VolleyballWorld shared range ${gender} split does not match tournament rows`);
    }
  }
  if (byGender.men.rawTotal + byGender.women.rawTotal !== summary.rawTotal
    || byGender.men.total + byGender.women.total !== summary.total
    || byGender.men.matches + byGender.women.matches !== summary.matches) {
    throw new MonitorProbeError("schema_drift", "VolleyballWorld shared range gender counters are inconsistent");
  }
}

function createBeachVolleyRuProbe(dependencies: StaticParserProbeDependencies): ParserProbe {
  return {
    id: "beachvolleyru",
    source: "beachvolleyru",
    hostname: "beach.volley.ru",
    required: true,
    async run(_attempt, signal) {
      signal.throwIfAborted();
      const source = await (dependencies.loadBeachVolleyRu?.()
        ?? import("@backend/sources/tbvolley/beach.volley.ru"));
      const result = await source.searchBeachVolleyRuTournaments({ gender: "men", signal, monitorMode: true });
      signal.throwIfAborted();
      return runTournamentMatchCanary({
        result,
        label: "beach.volley.ru",
        signal,
        historicalCandidates: arrayOf(result.monitorCanaries),
        async loadDetail(candidate, requestSignal) {
          return source.fetchBeachVolleyRuTournament({
            ...(candidate as (typeof result.tournaments)[number]),
            signal: requestSignal,
          });
        },
      });
    },
  };
}

function createGermanBeachTourProbe(dependencies: StaticParserProbeDependencies): ParserProbe {
  return {
    id: "germanbeachtour",
    source: "germanbeachtour",
    hostname: "beach.volleyball-verband.de",
    required: true,
    async run(_attempt, signal) {
      signal.throwIfAborted();
      const source = await (dependencies.loadGermanBeachTour?.()
        ?? import("@backend/sources/tbvolley/GermanBeachTour"));
      const result = await source.searchGermanBeachTourTournaments({ gender: "men", signal });
      signal.throwIfAborted();
      return runTournamentMatchCanary({
        result,
        label: "German Beach Tour",
        signal,
        async loadDetail(candidate, requestSignal) {
          return source.fetchGermanBeachTourTournament({
            ...(candidate as (typeof result.tournaments)[number]),
            signal: requestSignal,
          });
        },
      });
    },
  };
}

function createTwelveNdrProbe(
  sourceId: "twelvendrcsvp" | "twelvendroevv",
  calendarMode: "csvp" | "oevv",
  dependencies: StaticParserProbeDependencies,
): ParserProbe {
  return {
    id: sourceId,
    source: sourceId,
    hostname: "fivb.12ndr.at",
    required: true,
    async run(_attempt, signal) {
      signal.throwIfAborted();
      const source = await (dependencies.loadTwelveNdr?.()
        ?? import("@backend/sources/tbvolley/TwelveNdr"));
      const result = await source.searchTwelveNdrTournaments({ source: sourceId, calendarMode, gender: "men", signal, monitorMode: true });
      signal.throwIfAborted();
      return runTournamentMatchCanary({
        result,
        label: sourceId,
        signal,
        historicalCandidates: arrayOf(result.monitorCanaries),
        async loadDetail(candidate, requestSignal) {
          return source.fetchTwelveNdrTournament({
            ...(candidate as (typeof result.tournaments)[number]),
            source: sourceId,
            calendarMode,
            signal: requestSignal,
          });
        },
      });
    },
  };
}

function createCbvProbe(dependencies: StaticParserProbeDependencies): ParserProbe {
  return {
    id: "cbv",
    source: "cbv",
    hostname: "evolleyball.cbv.com.br",
    required: true,
    async run(_attempt, signal) {
      signal.throwIfAborted();
      const source = await (dependencies.loadCbv?.()
        ?? import("@backend/sources/tbvolley/CBV"));
      const result = await source.searchCBVTournaments({ gender: "men", signal });
      signal.throwIfAborted();
      return runTournamentMatchCanary({
        result,
        label: "CBV",
        signal,
        async loadDetail(candidate, requestSignal) {
          return source.fetchCBVTournament({
            ...(candidate as (typeof result.tournaments)[number]),
            signal: requestSignal,
          });
        },
      });
    },
  };
}

function createFedervolleyProbe(dependencies: StaticParserProbeDependencies): ParserProbe {
  return {
    id: "federvolley",
    source: "federvolley",
    hostname: "pub-8394085fb0ca451eaa42bc05b01c416f.r2.dev",
    required: true,
    async run(_attempt, signal) {
      signal.throwIfAborted();
      const source = await (dependencies.loadFedervolley?.()
        ?? import("@backend/sources/tbvolley/Federvolley"));
      const result = await source.searchFedervolleyTournaments({ gender: "men", category: "all", signal });
      signal.throwIfAborted();
      return runTournamentMatchCanary({
        result,
        label: "Federvolley",
        signal,
        async loadDetail(candidate, requestSignal) {
          return source.fetchFedervolleyTournament({
            ...(candidate as (typeof result.tournaments)[number]),
            signal: requestSignal,
          });
        },
      });
    },
  };
}

function createWttProbe(dependencies: StaticParserProbeDependencies): ParserProbe {
  return {
    id: "wtt",
    source: "wtt",
    hostname: WTT_PRIMARY_HOSTNAME,
    required: true,
    async run(_attempt, signal) {
      signal.throwIfAborted();
      const source = await (dependencies.loadWtt?.()
        ?? import("@backend/sources/tablet/WTT"));
      const raw = await source.fetchWttEvents({ signal });
      signal.throwIfAborted();
      const normalized = source.normalizeWttTournamentEvents(raw);
      const range = source.resolveWttDateRange({ days: 90 });
      const inWindow = sortWttCanaryCandidates(
        normalized.filter((event: any) => source.isWttTournamentInRange(event, range.fromDate, range.toDate)),
        range.fromDate,
      );
      let detailChecked = false;
      if (inWindow.length > 0) {
        const canary = await findSemanticCanary({
          candidates: inWindow,
          maxCandidates: MAX_SEMANTIC_CANARY_CANDIDATES,
          signal,
          async load(event: any) {
            const schedule = await source.fetchWttSchedule(event.eventId, { allowApiFallback: true, signal });
            try {
              return source.normalizeWttSchedule(schedule, {
                eventId: event.eventId,
                timeZoneId: event.timeZoneId,
              });
            } catch (error) {
              throw new MonitorProbeError(
                "schema_drift",
                `WTT schedule normalization failed: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          },
          isSemantic: (schedule: any) => hasSemanticMatchRows(arrayOf(schedule?.matches)),
        });
        throwIfAllCandidateLoadsFailed(canary, "WTT schedule candidates failed");
        detailChecked = Boolean(canary.detail);
      }
      signal.throwIfAborted();
      return buildWttMonitorObservation({
        rawSourceRows: raw.length,
        normalizedSourceRows: normalized.length,
        inWindowRows: inWindow.length,
        detailChecked,
        sourceStructureChecked: true,
      });
    },
  };
}

function createKhlProbe(dependencies: StaticParserProbeDependencies): ParserProbe {
  return {
    id: "khl",
    source: "khl",
    hostname: "khl.api.webcaster.pro",
    required: true,
    async run(_attempt, signal) {
      signal.throwIfAborted();
      const { KhlApiClient } = await (dependencies.loadKhl?.()
        ?? import("@backend/sources/results/khl/client"));
      const client = new KhlApiClient({ signal });
      const stages = await client.listStages();
      signal.throwIfAborted();
      const current = stages.find((stage: any) => stage.current) || stages[0];
      if (!current) return observation(0, 0, false, false, "KHL returned no stages");
      const now = Date.now();
      const localFrom = new Date(now - 7 * 24 * 60 * 60 * 1000);
      const localTo = new Date(now + 30 * 24 * 60 * 60 * 1000);
      const wideFrom = new Date(now - 365 * 24 * 60 * 60 * 1000);
      const wideTo = new Date(now + 60 * 24 * 60 * 60 * 1000);
      const rawEvents = await client.listEvents({ stageId: current.stageId, from: wideFrom, to: wideTo });
      signal.throwIfAborted();
      const events = rawEvents.filter((event: any) => {
        const startsAt = new Date(clean(event?.startsAt) || clean(event?.eventStartsAt)).getTime();
        return Number.isFinite(startsAt) && startsAt >= localFrom.getTime() && startsAt <= localTo.getTime();
      });
      let detailChecked = false;
      if (rawEvents.length > 0 || stages.length > 1) {
        const { normalizeKhlEventDetail } = await (dependencies.loadKhlNormalizer?.()
          ?? import("@backend/sources/results/khl/normalize"));
        const preferredCandidates = [
          ...events,
          ...rawEvents.filter((event: any) => !events.some((localEvent: any) => localEvent.apiEventId === event.apiEventId)),
        ].filter(isKhlDetailCandidate);
        let canary = await runKhlDetailCanary({
          candidates: preferredCandidates,
          fallbackStageId: current.stageId,
          client,
          normalizeKhlEventDetail,
          signal,
        });

        if (!canary.detail) {
          for (const historicalStage of stages.filter((stage: any) => stage.stageId !== current.stageId).slice(0, 3)) {
            signal.throwIfAborted();
            const historicalEvents = await client.listEvents({
              stageId: historicalStage.stageId,
              from: wideFrom,
              to: new Date(now),
              orderDirection: "desc",
            });
            const historicalCandidates = historicalEvents.filter(isKhlDetailCandidate);
            if (historicalCandidates.length === 0) continue;
            canary = await runKhlDetailCanary({
              candidates: historicalCandidates,
              fallbackStageId: historicalStage.stageId,
              client,
              normalizeKhlEventDetail,
              signal,
            });
            if (canary.detail) break;
          }
        }
        detailChecked = Boolean(canary.detail);
      }
      signal.throwIfAborted();
      return buildKhlProbeObservation(stages.length, events.length, detailChecked, rawEvents.length);
    },
  };
}

function isKhlDetailCandidate(event: any) {
  const status = clean(event?.status).toLowerCase();
  return !status || status === "finished" || status === "unknown";
}

async function runKhlDetailCanary(input: {
  candidates: readonly any[];
  fallbackStageId: string;
  client: any;
  normalizeKhlEventDetail(detail: unknown): any;
  signal: AbortSignal;
}) {
  const canary = await findSemanticCanary({
    candidates: input.candidates,
    maxCandidates: MAX_SEMANTIC_CANARY_CANDIDATES,
    signal: input.signal,
    async load(event: any) {
      const detail = await input.client.getEventDetail({
        apiEventId: event.apiEventId,
        stageId: clean(event.stageId) || input.fallbackStageId,
      });
      try {
        return input.normalizeKhlEventDetail(detail);
      } catch (error) {
        throw new MonitorProbeError(
          "schema_drift",
          `KHL event detail normalization failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    isSemantic: (normalized: any) => Boolean(
      clean(normalized?.identity?.apiEventId)
      && clean(normalized?.identity?.matchId)
    ),
  });
  throwIfAllCandidateLoadsFailed(canary, "KHL event detail candidates failed");
  return canary;
}

export function buildKhlProbeObservation(
  stagesCount: number,
  eventsCount: number,
  eventDetailChecked: boolean,
  rawEventsCount = eventsCount,
): ProbeObservation {
  const explainedLocalEmpty = stagesCount > 0
    && rawEventsCount > 0
    && eventsCount === 0
    && eventDetailChecked;
  return observation(
    rawEventsCount,
    eventsCount,
    eventDetailChecked,
    explainedLocalEmpty,
    `KHL: ${stagesCount} stages, ${rawEventsCount} raw events, ${eventsCount} in local canary window`,
  );
}

async function createActiveTLineProbes(): Promise<ParserProbe[]> {
  const [{ prisma }, { createDefaultOfficialSourceRegistry }] = await Promise.all([
    import("@backend/db/db"),
    import("@backend/tline/sources/registry"),
  ]);
  const championships = await prisma.tLineChampionship.findMany({
    where: { active: true, deletedAt: null },
    select: {
      id: true,
      name: true,
      sourceProvider: true,
      sourceUrl: true,
      sourceChampionshipId: true,
      sourceTimezone: true,
    },
  });
  const registry = createDefaultOfficialSourceRegistry();
  return championships.map((championship) => {
    const uncovered = findUncoveredTLineProviders([championship.sourceProvider], registry.providers).length > 0;
    return {
      id: `tline:${championship.sourceProvider}:${championship.id}`,
      source: `tline:${championship.sourceProvider}`,
      scope: championship.name,
      hostname: safeHostname(championship.sourceUrl),
      required: true,
      async run(_attempt, signal) {
        signal.throwIfAborted();
        if (uncovered) throw new MonitorProbeError("uncovered_provider", `No monitor adapter for active TLine provider ${championship.sourceProvider}`);
        const adapter = registry.get(championship.sourceProvider);
        const result = await adapter.testConnection({
          id: championship.id,
          externalId: championship.sourceChampionshipId || championship.id,
          name: championship.name,
          sourceUrl: championship.sourceUrl,
          sourceTimezone: championship.sourceTimezone,
        }, { signal });
        signal.throwIfAborted();
        return observation(result.matchCount, result.matchCount, result.matchCount > 0, false, `${championship.name}: ${result.matchCount} matches`);
      },
    } satisfies ParserProbe;
  });
}

export function buildTournamentSearchObservation(
  result: {
    tournaments?: unknown[];
    summary?: {
      total?: number;
      matches?: number;
      rawTotal?: number;
      filteredOut?: number;
      emptyReason?: string | null;
    };
  },
  label: string,
  detailChecked?: boolean,
): ProbeObservation {
  const tournaments = arrayOf(result.tournaments);
  const rawCandidates = numberOr(result.summary?.rawTotal, tournaments.length);
  const filteredOut = numberOr(result.summary?.filteredOut, Math.max(0, rawCandidates - tournaments.length));
  const emptyReason = clean(result.summary?.emptyReason);
  const explainedEmpty = tournaments.length === 0
    && rawCandidates > 0
    && filteredOut >= rawCandidates
    && Boolean(emptyReason);
  return {
    rawCandidates,
    normalizedItems: tournaments.length,
    detailChecked: tournaments.length > 0 ? Boolean(detailChecked) : explainedEmpty,
    explicitEmpty: explainedEmpty,
    summary: `${label}: ${rawCandidates} raw tournaments, ${tournaments.length} after filters, ${numberOr(result.summary?.matches, 0)} matches${emptyReason ? `; empty_reason=${emptyReason}` : ""}`,
  };
}

export async function runTournamentMatchCanary(input: {
  result: unknown;
  label: string;
  signal: AbortSignal;
  maxCandidates?: number;
  requireRawSummary?: boolean;
  historicalCandidates?: readonly unknown[];
  loadDetail(candidate: unknown, signal: AbortSignal): Promise<unknown>;
}): Promise<ProbeObservation> {
  input.signal.throwIfAborted();
  const discovery = assertTournamentSearchSchema(
    input.result,
    input.label,
    input.requireRawSummary !== false,
  );

  if (discovery.tournaments.length === 0) {
    const seasonalEmpty = discovery.rawCandidates > 0
      && discovery.filteredOut === discovery.rawCandidates
      && (discovery.emptyReason === "date_window" || discovery.emptyReason === "category_filter");
    if (!seasonalEmpty) {
      throw new MonitorProbeError(
        "schema_drift",
        `${input.label}: fresh discovery returned an unconfirmed empty tournament window`,
      );
    }
    return observation(
      discovery.rawCandidates,
      0,
      true,
      true,
      `${input.label}: ${discovery.rawCandidates} raw tournaments, 0 after filters; empty_reason=${discovery.emptyReason}`,
    );
  }

  const candidates = discovery.tournaments.filter(isSemanticTournamentCandidate);
  if (candidates.length === 0) {
    throw new MonitorProbeError(
      "schema_drift",
      `${input.label}: ${discovery.tournaments.length} discovered tournaments have no usable identity/title`,
    );
  }

  const canary = await findSemanticCanary({
    candidates,
    maxCandidates: input.maxCandidates ?? MAX_SEMANTIC_CANARY_CANDIDATES,
    signal: input.signal,
    async load(candidate) {
      const detail = await input.loadDetail(candidate, input.signal);
      input.signal.throwIfAborted();
      const parsed = assertTournamentDetailSchema(detail, input.label);
      return {
        detail,
        rawMatchCount: parsed.matches.length,
        semanticMatches: parsed.matches.filter(isSemanticTournamentMatch),
      };
    },
    isSemantic: (detail) => detail.semanticMatches.length > 0,
  });
  throwIfAllCandidateLoadsFailed(canary, `${input.label} detail candidates failed`);
  if (!canary.detail) {
    const futureScheduleEmpty = discovery.tournaments.every(isFutureTournamentWithoutPublishedSchedule);
    if (futureScheduleEmpty && input.historicalCandidates?.length) {
      const historical = await findSemanticCanary({
        candidates: input.historicalCandidates.filter(isSemanticTournamentCandidate),
        maxCandidates: input.maxCandidates ?? MAX_SEMANTIC_CANARY_CANDIDATES,
        signal: input.signal,
        async load(candidate) {
          const detail = await input.loadDetail(candidate, input.signal);
          input.signal.throwIfAborted();
          const parsed = assertTournamentDetailSchema(detail, `${input.label} historical canary`);
          return {
            detail,
            rawMatchCount: parsed.matches.length,
            semanticMatches: parsed.matches.filter(isSemanticTournamentMatch),
          };
        },
        isSemantic: (detail) => detail.semanticMatches.length > 0,
      });
      throwIfAllCandidateLoadsFailed(historical, `${input.label} historical detail candidates failed`);
      if (historical.detail) {
        return observation(
          discovery.rawCandidates,
          0,
          true,
          true,
          `${input.label}: ${discovery.tournaments.length} future tournament schedules are not published yet; historical canary verified ${historical.detail.semanticMatches.length} semantic matches`,
        );
      }
    }
    throw new MonitorProbeError(
      "schema_drift",
      `${input.label}: ${discovery.tournaments.length} active tournaments discovered, but ${canary.attempted} fresh details yielded no semantic match schedule`,
    );
  }

  return observation(
    discovery.rawCandidates,
    discovery.tournaments.length,
    true,
    false,
    `${input.label}: ${discovery.rawCandidates} raw tournaments, ${discovery.tournaments.length} after filters; ${canary.attempted} candidates checked; ${canary.detail.rawMatchCount} raw detail matches, ${canary.detail.semanticMatches.length} semantic`,
  );
}

function isFutureTournamentWithoutPublishedSchedule(value: unknown) {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const startDate = clean(record.startDate);
  const today = new Date().toISOString().slice(0, 10);
  return clean(record.status) === "upcoming" && /^\d{4}-\d{2}-\d{2}$/u.test(startDate) && startDate > today;
}

function assertTournamentSearchSchema(result: unknown, label: string, requireRawSummary: boolean) {
  const record = result && typeof result === "object" ? result as Record<string, unknown> : null;
  const summary = record?.summary && typeof record.summary === "object"
    ? record.summary as Record<string, unknown>
    : null;
  if (!record || record.ok !== true || !Array.isArray(record.tournaments) || !summary) {
    throw new MonitorProbeError("schema_drift", `${label}: discovery returned an unexpected schema`);
  }

  const tournaments = record.tournaments;
  if (!isMonitorCount(summary.total) || summary.total !== tournaments.length) {
    throw new MonitorProbeError("schema_drift", `${label}: discovery total does not match tournament rows`);
  }
  if (summary.matches !== undefined && !isMonitorCount(summary.matches)) {
    throw new MonitorProbeError("schema_drift", `${label}: discovery returned an invalid match counter`);
  }

  const hasRawTotal = summary.rawTotal !== undefined;
  const hasFilteredOut = summary.filteredOut !== undefined;
  if (requireRawSummary && (!hasRawTotal || !hasFilteredOut)) {
    throw new MonitorProbeError("schema_drift", `${label}: discovery omitted raw-before-filter counters`);
  }
  if ((hasRawTotal && !isMonitorCount(summary.rawTotal))
    || (hasFilteredOut && !isMonitorCount(summary.filteredOut))) {
    throw new MonitorProbeError("schema_drift", `${label}: discovery returned invalid raw-before-filter counters`);
  }

  const rawCandidates = hasRawTotal ? Number(summary.rawTotal) : tournaments.length;
  const filteredOut = hasFilteredOut ? Number(summary.filteredOut) : rawCandidates - tournaments.length;
  if (rawCandidates < tournaments.length || filteredOut !== rawCandidates - tournaments.length) {
    throw new MonitorProbeError("schema_drift", `${label}: discovery raw/filter counters are inconsistent`);
  }

  const emptyReason = clean(summary.emptyReason);
  if (emptyReason && emptyReason !== "date_window" && emptyReason !== "category_filter") {
    throw new MonitorProbeError("schema_drift", `${label}: discovery returned an unknown empty reason`);
  }
  if (tournaments.length > 0 && emptyReason) {
    throw new MonitorProbeError("schema_drift", `${label}: non-empty discovery unexpectedly declared an empty reason`);
  }

  return { tournaments, rawCandidates, filteredOut, emptyReason };
}

function assertTournamentDetailSchema(detail: unknown, label: string) {
  const record = detail && typeof detail === "object" ? detail as Record<string, unknown> : null;
  if (!record || !isSemanticTournamentCandidate(record) || !Array.isArray(record.matches)) {
    throw new MonitorProbeError("schema_drift", `${label}: tournament detail returned an unexpected schema`);
  }
  if (record.matchCount !== undefined
    && (!isMonitorCount(record.matchCount) || record.matchCount !== record.matches.length)) {
    throw new MonitorProbeError("schema_drift", `${label}: tournament detail match counter is inconsistent`);
  }
  return { matches: record.matches };
}

function isSemanticTournamentCandidate(value: unknown) {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const identity = [
    "id",
    "eventId",
    "tournamentId",
    "tcode",
    "etapaId",
    "nodeId",
    "pageUrl",
    "tournamentNo",
    "competitionSlug",
  ].some((key) => Boolean(clean(record[key])));
  return identity && Boolean(clean(record.title));
}

function isSemanticTournamentMatch(value: unknown) {
  const match = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const identity = ["id", "sourceUrl", "matchNoInTournament", "matchNo"]
    .some((key) => Boolean(clean(match[key])));
  const teamA = readTournamentTeamLabel(match.teamA) || clean(match.teamAName);
  const teamB = readTournamentTeamLabel(match.teamB) || clean(match.teamBName);
  const hasTeams = Boolean(teamA && teamB);
  const hasTime = ["startTimeUtc", "startTimeMoscow", "dateKey", "matchDate", "matchDateTime"]
    .some((key) => Boolean(clean(match[key])));
  const hasBracketSlot = ["stage", "round", "court", "phase"]
    .some((key) => Boolean(clean(match[key])));
  return identity && (hasTeams || (hasTime && hasBracketSlot));
}

function readTournamentTeamLabel(value: unknown) {
  if (typeof value === "string") return clean(value);
  const team = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return clean(team.name) || clean(team.rawName) || clean(team.players);
}

function isMonitorCount(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

export function buildWttMonitorObservation(input: {
  rawSourceRows: number;
  normalizedSourceRows: number;
  inWindowRows: number;
  detailChecked: boolean;
  sourceStructureChecked: boolean;
}): ProbeObservation {
  const countersConsistent = input.rawSourceRows >= 0
    && input.normalizedSourceRows >= 0
    && input.inWindowRows >= 0
    && input.normalizedSourceRows <= input.rawSourceRows
    && input.inWindowRows <= input.normalizedSourceRows;
  if (!countersConsistent) {
    return {
      rawCandidates: Math.max(0, Math.trunc(input.rawSourceRows)),
      normalizedItems: Math.max(0, Math.trunc(input.inWindowRows)),
      detailChecked: false,
      explicitEmpty: false,
      errorClass: "schema_drift",
      summary: "WTT discovery returned inconsistent raw/normalized/window counters",
    };
  }

  const upstreamEmpty = input.sourceStructureChecked && input.rawSourceRows === 0;
  const dateWindowEmpty = input.sourceStructureChecked
    && input.rawSourceRows > 0
    && input.normalizedSourceRows > 0
    && input.inWindowRows === 0;
  const explainedEmpty = upstreamEmpty || dateWindowEmpty;
  const reason = upstreamEmpty ? "upstream_empty" : dateWindowEmpty ? "date_window" : "none";
  return {
    rawCandidates: input.rawSourceRows,
    normalizedItems: input.inWindowRows,
    detailChecked: input.inWindowRows > 0 ? input.detailChecked : explainedEmpty,
    explicitEmpty: explainedEmpty,
    summary: `WTT: ${input.rawSourceRows} raw events, ${input.normalizedSourceRows} structurally normalized, ${input.inWindowRows} in monitored window; empty_reason=${reason}`,
  };
}

export async function findSemanticCanary<T, Detail>(input: {
  candidates: readonly T[];
  maxCandidates?: number;
  signal?: AbortSignal;
  load(candidate: T): Promise<Detail>;
  isSemantic(detail: Detail): boolean;
}): Promise<{
  candidate: T | null;
  detail: Detail | null;
  lastDetail: Detail | null;
  attempted: number;
  failures: Array<{ candidate: T; error: unknown }>;
}> {
  const failures: Array<{ candidate: T; error: unknown }> = [];
  const limit = Math.max(1, Math.trunc(input.maxCandidates ?? MAX_SEMANTIC_CANARY_CANDIDATES));
  let attempted = 0;
  let lastDetail: Detail | null = null;

  for (const candidate of input.candidates.slice(0, limit)) {
    input.signal?.throwIfAborted();
    attempted += 1;
    try {
      const detail = await input.load(candidate);
      input.signal?.throwIfAborted();
      lastDetail = detail;
      if (input.isSemantic(detail)) return { candidate, detail, lastDetail, attempted, failures };
    } catch (error) {
      input.signal?.throwIfAborted();
      failures.push({ candidate, error });
    }
  }

  return { candidate: null, detail: null, lastDetail, attempted, failures };
}

export function sortWttCanaryCandidates<T extends { startDate?: unknown; endDate?: unknown }>(
  events: readonly T[],
  referenceDate = new Date().toISOString().slice(0, 10),
) {
  return events.slice().sort((left, right) => (
    wttCanaryDistance(left, referenceDate) - wttCanaryDistance(right, referenceDate)
    || clean(left.startDate).localeCompare(clean(right.startDate))
  ));
}

function wttCanaryDistance(event: { startDate?: unknown; endDate?: unknown }, referenceDate: string) {
  const start = parseMonitorDate(clean(event.startDate));
  const end = parseMonitorDate(clean(event.endDate)) ?? start;
  const reference = parseMonitorDate(referenceDate);
  if (reference === null || (start === null && end === null)) return Number.MAX_SAFE_INTEGER;
  if (start !== null && start <= reference && (end === null || end >= reference)) return 0;
  if (start !== null && start > reference) return start - reference;
  return end === null ? Number.MAX_SAFE_INTEGER : reference - end + 365 * 86_400_000;
}

function parseMonitorDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const time = new Date(`${value}T00:00:00.000Z`).getTime();
  return Number.isFinite(time) ? time : null;
}

function throwIfAllCandidateLoadsFailed(
  result: { attempted: number; failures: Array<{ error: unknown }> },
  fallbackMessage: string,
) {
  if (result.attempted === 0 || result.failures.length !== result.attempted) return;
  const placeholder = result.failures.find(({ error }) => (
    error instanceof MonitorProbeError && error.errorClass === "placeholder_404"
  ));
  throw placeholder?.error || result.failures[result.failures.length - 1]?.error
    || new MonitorProbeError("parse_failed", fallbackMessage);
}

function uniqueCandidateValues(items: readonly unknown[], keys: readonly string[]) {
  const values: string[] = [];
  for (const item of items) {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const value = keys.map((key) => clean(record[key])).find(Boolean) || "";
    if (value && !values.includes(value)) values.push(value);
  }
  return values;
}

function normalizeHltvCanaryUrl(value: string) {
  if (!value) return "";
  try {
    const url = new URL(value, "https://www.hltv.org");
    if (url.protocol !== "https:" || !["hltv.org", "www.hltv.org"].includes(url.hostname.toLowerCase())) return "";
    if (!/^\/events\/[1-9]\d{0,15}(?:\/[^/?#]+)?\/?$/i.test(url.pathname)) return "";
    url.hostname = "www.hltv.org";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function hasSemanticMatchRows(matches: readonly unknown[]) {
  return matches.some((item) => {
    const match = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return Boolean(clean(match.id) || clean(match.url));
  });
}

function isSemanticFandomScheduleRow(item: unknown) {
  const wrapper = item && typeof item === "object" ? item as Record<string, unknown> : {};
  const row = wrapper.title && typeof wrapper.title === "object"
    ? wrapper.title as Record<string, unknown>
    : wrapper;
  return Boolean(
    clean(row.MatchId)
    || ((clean(row.Team1) || clean(row.Team2)) && (clean(row.DateTime_UTC) || clean(row.OverviewPage))),
  );
}

function observation(rawCandidates: number, normalizedItems: number, detailChecked: boolean, explicitEmpty: boolean, summary: string): ProbeObservation {
  return { rawCandidates, normalizedItems, detailChecked, explicitEmpty, summary };
}

function assertFreshResult(value: any, label: string) {
  if (!value) throw new MonitorProbeError("parse_failed", `${label} returned no result`);
  if (value.cacheHit || value.stale) throw new MonitorProbeError("stale_cache", `${label} returned cached/stale data during a fresh probe`);
  if (value.errorClass && value.errorClass !== "empty_valid") {
    throw new MonitorProbeError(classifySourceError(value.errorClass), `${label}: ${value.errorClass}`);
  }
  if (value.ok !== true) throw new MonitorProbeError("parse_failed", `${label} did not return ok=true`);
}

function classifySourceError(value: unknown): "cloudflare_block" | "upstream_timeout" | "schema_drift" | "parse_failed" {
  const text = clean(value).toLowerCase();
  if (text.includes("cloudflare") || text.includes("blocked") || text.includes("403")) return "cloudflare_block";
  if (text.includes("timeout") || text.includes("abort")) return "upstream_timeout";
  if (text.includes("selector") || text.includes("schema")) return "schema_drift";
  return "parse_failed";
}

function classifyProbeError(error: unknown): ParserProbeErrorClass {
  if (error instanceof MonitorProbeError) return error.errorClass;
  const typedClass = error && typeof error === "object"
    ? (error as { errorClass?: unknown }).errorClass
    : undefined;
  return classifySourceError(typedClass || (error instanceof Error ? error.message : error));
}

function arrayOf(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function numberOr(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : fallback;
}

function safeHostname(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return "tline.local";
  }
}
