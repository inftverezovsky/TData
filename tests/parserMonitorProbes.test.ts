import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  buildDltvProbeFailure,
  buildLiquipediaCanaryCandidates,
  buildHltvCanaryCandidates,
  buildHltvFallbackObservation,
  buildTournamentSearchObservation,
  buildWttMonitorObservation,
  createStaticParserProbesWithDependencies,
  createStaticParserProbes,
  findSemanticCanary,
  findUncoveredTLineProviders,
  getTournamentMonitorCoverage,
  runLiquipediaSemanticCanary,
  runTournamentMatchCanary,
  sortWttCanaryCandidates,
} from "../backend/src/monitoring/parserMonitorProbes";
import { MonitorProbeError } from "../backend/src/monitoring/parserMonitorCore";
import { buildMonitorRequestPlan } from "../backend/src/sources/monitorCanary";
import { unwrapWttRows } from "../backend/src/sources/tablet/WTT";
import { createDefaultOfficialSourceRegistry } from "../backend/src/tline/sources/registry";

test("HLTV canary candidates come from fresh discovery and never inject the Porto fallback", () => {
  assert.deepEqual(buildHltvCanaryCandidates([
    { id: "9001", url: "https://www.hltv.org/events/9001/current-event", status: "ongoing" },
    { id: "9002", status: "upcoming" },
    { id: "9001", url: "https://www.hltv.org/events/9001/current-event" },
    { id: "invalid", url: "https://example.com/events/8249/not-hltv" },
  ]), [
    "https://www.hltv.org/events/9001/current-event",
    "https://www.hltv.org/events/9002",
  ]);
});

test("HLTV Porto fallback is explicitly degraded to warning", () => {
  assert.deepEqual(buildHltvFallbackObservation({
    ok: true,
    matches: [{ id: "match-1" }],
    validEmpty: false,
  }, "upstream_timeout"), {
    rawCandidates: 1,
    normalizedItems: 1,
    detailChecked: true,
    explicitEmpty: false,
    status: "warning",
    errorClass: "upstream_timeout",
    summary: "HLTV discovery unavailable; fallback event 8249 verified with 1 match",
  });
});

test("semantic canary iteration skips empty and failed candidates before stopping on a match", async () => {
  const visited: string[] = [];
  const result = await findSemanticCanary({
    candidates: ["empty", "broken", "good", "unused"],
    maxCandidates: 4,
    async load(candidate) {
      visited.push(candidate);
      if (candidate === "broken") throw new Error("candidate failed");
      return candidate === "good" ? [{ id: "match-1" }] : [];
    },
    isSemantic: (matches) => matches.length > 0,
  });

  assert.deepEqual(visited, ["empty", "broken", "good"]);
  assert.equal(result.candidate, "good");
  assert.deepEqual(result.detail, [{ id: "match-1" }]);
  assert.deepEqual(result.lastDetail, [{ id: "match-1" }]);
  assert.equal(result.attempted, 3);
  assert.equal(result.failures.length, 1);
});

test("semantic canary retains the last structurally loaded empty detail", async () => {
  const result = await findSemanticCanary({
    candidates: ["first", "second"],
    async load(candidate) {
      return { candidate, matches: [] };
    },
    isSemantic: (detail) => detail.matches.length > 0,
  });

  assert.equal(result.detail, null);
  assert.deepEqual(result.lastDetail, { candidate: "second", matches: [] });
});

test("semantic canary iteration stops immediately when its monitor signal is aborted", async () => {
  const controller = new AbortController();
  const visited: string[] = [];
  await assert.rejects(findSemanticCanary({
    candidates: ["first", "second"],
    signal: controller.signal,
    async load(candidate) {
      visited.push(candidate);
      controller.abort(new Error("monitor stopped"));
      throw new Error("request aborted");
    },
    isSemantic: () => false,
  }), /monitor stopped/);
  assert.deepEqual(visited, ["first"]);
});

test("Liquipedia canary candidates are canonical, scope-bound and deduplicated", () => {
  for (const scope of ["dota2", "counterstrike", "leagueoflegends", "valorant"] as const) {
    assert.deepEqual(buildLiquipediaCanaryCandidates(scope, [
      {
        title: "Display name",
        url: `https://liquipedia.net/${scope}/Organizer/Event_One`,
      },
      {
        title: "Duplicate",
        url: `https://liquipedia.net/${scope}/Organizer/Event_One?utm_source=portal#schedule`,
      },
      {
        title: "Wrong game",
        url: `https://liquipedia.net/${scope === "dota2" ? "valorant" : "dota2"}/Other/Event`,
      },
      { title: "Wrong host", url: `https://example.com/${scope}/Event` },
      { title: "Missing URL" },
    ]), [{
      title: "Organizer/Event One",
      url: `https://liquipedia.net/${scope}/Organizer/Event_One`,
    }]);
  }
});

test("Liquipedia semantic canary iterates fresh pages until the normalizer yields real matches", async () => {
  const controller = new AbortController();
  const visitedWikitext: string[] = [];
  const visitedParsed: string[] = [];
  const normalizedTitles: string[] = [];

  const observation = await runLiquipediaSemanticCanary({
    scope: "counterstrike",
    tournaments: [
      { title: "Empty", url: "https://liquipedia.net/counterstrike/Empty" },
      { title: "Broken", url: "https://liquipedia.net/counterstrike/Broken" },
      { title: "Good", url: "https://liquipedia.net/counterstrike/Good" },
      { title: "Unused", url: "https://liquipedia.net/counterstrike/Unused" },
    ],
    maxCandidates: 4,
    requireParsedHtml: true,
    signal: controller.signal,
    async fetchWikitext(candidate, signal) {
      assert.equal(signal, controller.signal);
      visitedWikitext.push(candidate.title);
      if (candidate.title === "Broken") throw new MonitorProbeError("schema_drift", "changed detail schema");
      return {
        pageId: candidate.title === "Good" ? 3 : 1,
        title: candidate.title,
        fullUrl: candidate.url,
        wikitext: `{{Infobox league|name=${candidate.title}|sdate=2026-08-30|edate=2026-09-01}}`,
      };
    },
    async fetchParsedHtml(page, signal) {
      assert.equal(signal, controller.signal);
      visitedParsed.push(page.title);
      return `<div class="infobox-header">${page.title}</div>`;
    },
    normalize(page) {
      normalizedTitles.push(page.title);
      return {
        sourceTitle: page.title,
        sourceUrl: page.pageUrl,
        name: page.title,
        participants: [],
        subPages: [],
        warnings: [],
        matches: page.title === "Good"
          ? [
              { matchId: "real-1", teamAName: "A", teamBName: "B", matchDateTime: "2026-09-01 18:00" },
              { matchId: "noise-only" },
            ]
          : [],
      };
    },
  });

  assert.deepEqual(visitedWikitext, ["Empty", "Broken", "Good"]);
  assert.deepEqual(visitedParsed, ["Empty", "Good"]);
  assert.deepEqual(normalizedTitles, ["Empty", "Good"]);
  assert.equal(observation.rawCandidates, 2);
  assert.equal(observation.normalizedItems, 1);
  assert.equal(observation.detailChecked, true);
  assert.equal(observation.explicitEmpty, false);
  assert.match(observation.summary || "", /4 portal candidates/);
  assert.match(observation.summary || "", /3 candidates checked/);
  assert.match(observation.summary || "", /2 raw matches/);
});

test("Liquipedia canary fail-closes empty discovery and detail pages without semantic matches", async () => {
  const dependencies = {
    async fetchWikitext(candidate: { title: string; url: string }) {
      return {
        pageId: 1,
        title: candidate.title,
        fullUrl: candidate.url,
        wikitext: "{{Infobox league|name=Empty|sdate=2026-08-30|edate=2026-09-01}}",
      };
    },
    async fetchParsedHtml() {
      return "<div>parsed</div>";
    },
    normalize(page: { title: string; pageUrl: string }) {
      return {
        sourceTitle: page.title,
        sourceUrl: page.pageUrl,
        name: page.title,
        participants: [],
        subPages: [],
        warnings: [],
        matches: [{ matchId: "identity-without-match-semantics" }],
      };
    },
  };

  await assert.rejects(
    runLiquipediaSemanticCanary({
      scope: "dota2",
      tournaments: [],
      signal: new AbortController().signal,
      ...dependencies,
    }),
    (error: unknown) => error instanceof MonitorProbeError && error.errorClass === "schema_drift",
  );

  await assert.rejects(
    runLiquipediaSemanticCanary({
      scope: "dota2",
      tournaments: [{ title: "Empty", url: "https://liquipedia.net/dota2/Empty" }],
      signal: new AbortController().signal,
      ...dependencies,
    }),
    (error: unknown) => error instanceof MonitorProbeError && error.errorClass === "schema_drift",
  );
});

test("a legacy detail canary cannot make broken empty discovery healthy", () => {
  const observation = buildTournamentSearchObservation({
    tournaments: [],
    summary: { total: 0, rawTotal: 0, matches: 0 },
  }, "CBV", true);

  assert.equal(observation.rawCandidates, 0);
  assert.equal(observation.normalizedItems, 0);
  assert.equal(observation.detailChecked, false);
  assert.equal(observation.explicitEmpty, false);
});

test("raw-before-filter metadata explains a legitimate seasonal empty window", () => {
  const observation = buildTournamentSearchObservation({
    tournaments: [],
    summary: {
      total: 0,
      rawTotal: 7,
      filteredOut: 7,
      emptyReason: "date_window",
      matches: 0,
    },
  }, "German Beach Tour", false);

  assert.equal(observation.rawCandidates, 7);
  assert.equal(observation.normalizedItems, 0);
  assert.equal(observation.detailChecked, true);
  assert.equal(observation.explicitEmpty, true);
  assert.match(observation.summary || "", /date_window/);
});

test("tournament match canary iterates fresh discovery candidates until detail has a semantic schedule", async () => {
  const controller = new AbortController();
  const visited: string[] = [];
  let activeLoads = 0;
  let peakLoads = 0;

  const observation = await runTournamentMatchCanary({
    label: "CBV",
    signal: controller.signal,
    result: {
      ok: true,
      tournaments: [
        { id: "empty", title: "Empty stage" },
        { id: "broken", title: "Broken stage" },
        { id: "good", title: "Good stage" },
        { id: "unused", title: "Unused stage" },
      ],
      summary: {
        total: 4,
        matches: 0,
        rawTotal: 9,
        filteredOut: 5,
        emptyReason: null,
      },
    },
    async loadDetail(candidate, signal) {
      assert.equal(signal, controller.signal);
      const id = String((candidate as { id: string }).id);
      visited.push(id);
      activeLoads += 1;
      peakLoads = Math.max(peakLoads, activeLoads);
      await Promise.resolve();
      activeLoads -= 1;
      if (id === "broken") throw new Error("detail request failed");
      return {
        id,
        title: `${id} detail`,
        matches: id === "good"
          ? [
              { id: "match-1", teamA: { name: "A" }, teamB: { name: "B" }, stage: "Final" },
              { id: "identity-only" },
            ]
          : [],
        matchCount: id === "good" ? 2 : 0,
      };
    },
  });

  assert.deepEqual(visited, ["empty", "broken", "good"]);
  assert.equal(peakLoads, 1);
  assert.equal(observation.rawCandidates, 9);
  assert.equal(observation.normalizedItems, 4);
  assert.equal(observation.detailChecked, true);
  assert.equal(observation.explicitEmpty, false);
  assert.match(observation.summary || "", /3 candidates checked/);
  assert.match(observation.summary || "", /2 raw detail matches, 1 semantic/);
});

test("tournament match canary fail-closes identity-only detail rows and unknown discovery schemas", async () => {
  const signal = new AbortController().signal;

  await assert.rejects(runTournamentMatchCanary({
    label: "Federvolley",
    signal,
    result: {
      ok: true,
      tournaments: [{ nodeId: "123", title: "Identity only" }],
      summary: { total: 1, matches: 1, rawTotal: 1, filteredOut: 0, emptyReason: null },
    },
    async loadDetail() {
      return {
        nodeId: "123",
        title: "Identity only",
        matches: [{ id: "match-without-teams-or-schedule" }],
        matchCount: 1,
      };
    },
  }), (error: unknown) => error instanceof MonitorProbeError && error.errorClass === "schema_drift");

  await assert.rejects(runTournamentMatchCanary({
    label: "German Beach Tour",
    signal,
    result: {
      ok: true,
      tournaments: [{ tournamentId: "123", title: "Tournament" }],
      summary: { total: 1, matches: 0, rawTotal: "unknown", filteredOut: 0 },
    },
    async loadDetail(candidate) {
      return candidate;
    },
  }), (error: unknown) => error instanceof MonitorProbeError && error.errorClass === "schema_drift");

  await assert.rejects(runTournamentMatchCanary({
    label: "12ndr",
    signal,
    result: { ok: true, tournaments: { changed: true }, summary: { total: 0, rawTotal: 0 } },
    async loadDetail(candidate) {
      return candidate;
    },
  }), (error: unknown) => error instanceof MonitorProbeError && error.errorClass === "schema_drift");
});

test("tournament match canary accepts seasonal empty only when raw discovery explains every filtered row", async () => {
  const signal = new AbortController().signal;
  let detailCalls = 0;
  const loadDetail = async (candidate: unknown) => {
    detailCalls += 1;
    return candidate;
  };

  const seasonal = await runTournamentMatchCanary({
    label: "beach.volley.ru",
    signal,
    result: {
      ok: true,
      tournaments: [],
      summary: { total: 0, matches: 0, rawTotal: 7, filteredOut: 7, emptyReason: "date_window" },
    },
    loadDetail,
  });
  assert.equal(detailCalls, 0);
  assert.equal(seasonal.rawCandidates, 7);
  assert.equal(seasonal.normalizedItems, 0);
  assert.equal(seasonal.detailChecked, true);
  assert.equal(seasonal.explicitEmpty, true);

  const categoryFiltered = await runTournamentMatchCanary({
    label: "VolleyballWorld",
    signal,
    result: {
      ok: true,
      tournaments: [],
      summary: { total: 0, matches: 0, rawTotal: 4, filteredOut: 4, emptyReason: "category_filter" },
    },
    loadDetail,
  });
  assert.equal(categoryFiltered.rawCandidates, 4);
  assert.equal(categoryFiltered.explicitEmpty, true);
  assert.match(categoryFiltered.summary || "", /category_filter/);

  for (const summary of [
    { total: 0, matches: 0, rawTotal: 0, filteredOut: 0, emptyReason: null },
    { total: 0, matches: 0, rawTotal: 7, filteredOut: 6, emptyReason: "date_window" },
    { total: 0, matches: 0, rawTotal: 7, filteredOut: 7, emptyReason: "unknown_reason" },
  ]) {
    await assert.rejects(runTournamentMatchCanary({
      label: "beach.volley.ru",
      signal,
      result: { ok: true, tournaments: [], summary },
      loadDetail,
    }), (error: unknown) => error instanceof MonitorProbeError && error.errorClass === "schema_drift");
  }
});

test("tournament match canary forwards abort signal and stops before the next detail candidate", async () => {
  const controller = new AbortController();
  const visited: string[] = [];

  await assert.rejects(runTournamentMatchCanary({
    label: "CBV",
    signal: controller.signal,
    result: {
      ok: true,
      tournaments: [
        { id: "first", title: "First" },
        { id: "second", title: "Second" },
      ],
      summary: { total: 2, matches: 0, rawTotal: 2, filteredOut: 0, emptyReason: null },
    },
    async loadDetail(candidate, signal) {
      assert.equal(signal, controller.signal);
      visited.push(String((candidate as { id: string }).id));
      controller.abort(new Error("monitor aborted"));
      return { matches: [] };
    },
  }), /monitor aborted/);
  assert.deepEqual(visited, ["first"]);
});

test("WTT off-season is healthy-empty only after a structurally valid discovery", () => {
  const offSeason = buildWttMonitorObservation({
    rawSourceRows: 12,
    normalizedSourceRows: 8,
    inWindowRows: 0,
    detailChecked: false,
    sourceStructureChecked: true,
  });
  assert.equal(offSeason.rawCandidates, 12);
  assert.equal(offSeason.normalizedItems, 0);
  assert.equal(offSeason.detailChecked, true);
  assert.equal(offSeason.explicitEmpty, true);
  assert.match(offSeason.summary || "", /date_window/);

  const schemaDrift = buildWttMonitorObservation({
    rawSourceRows: 12,
    normalizedSourceRows: 0,
    inWindowRows: 0,
    detailChecked: false,
    sourceStructureChecked: true,
  });
  assert.equal(schemaDrift.detailChecked, false);
  assert.equal(schemaDrift.explicitEmpty, false);
});

test("WTT accepts an explicit empty rows envelope but rejects unknown JSON schemas", () => {
  assert.deepEqual(unwrapWttRows([]), []);
  assert.deepEqual(unwrapWttRows({ rows: [] }), []);
  assert.throws(() => unwrapWttRows({ data: [] }), /unexpected rows schema/);
});

test("monitor mode limits a source detail plan to one sequential item", () => {
  assert.deepEqual(buildMonitorRequestPlan(["one", "two", "three"], 4, true), {
    items: ["one"],
    concurrency: 1,
  });
  assert.deepEqual(buildMonitorRequestPlan(["one", "two"], 4, false), {
    items: ["one", "two"],
    concurrency: 4,
  });
});

test("monitor-mode partial details cannot populate normal VLR or DLTV caches", () => {
  const vlr = fs.readFileSync(path.join(process.cwd(), "backend", "src", "sources", "tdata", "vlr", "scraper.ts"), "utf8");
  const dltv = fs.readFileSync(path.join(process.cwd(), "backend", "src", "sources", "tdata", "dltv", "client.ts"), "utf8");
  assert.match(vlr, /if \(!options\.monitorMode\) setCache\(/);
  assert.match(dltv, /if \(!options\.monitorMode\) writeDltvCache\(/);
});

test("monitor metadata uses actual upstream hostnames", () => {
  const probes = createStaticParserProbes();
  assert.equal(probes.find((probe) => probe.id === "khl")?.hostname, "khl.api.webcaster.pro");
  assert.equal(
    probes.find((probe) => probe.id === "wtt")?.hostname,
    "wtt-web-frontdoor-cthahjeqhbh6aqe3.a01.azurefd.net",
  );
});

test("TLine coverage can be derived from the live official-source registry", () => {
  const providers = createDefaultOfficialSourceRegistry().providers;
  assert.deepEqual(
    findUncoveredTLineProviders(
      ["volley-ru", "hockey-by", "unknown"],
      providers,
    ),
    ["unknown"],
  );
  assert.deepEqual(providers, ["volley-ru", "nffr-floorball", "hockey-by"]);
});

test("tournament monitor registry covers every registered provider", () => {
  const coverage = getTournamentMonitorCoverage();
  assert.ok(coverage.length > 0);
  assert.deepEqual(coverage.filter((item) => !item.covered), []);
});

test("DLTV match-page failures classify placeholders separately from parser failures", () => {
  assert.equal(buildDltvProbeFailure([]), null);
  assert.deepEqual(buildDltvProbeFailure([
    { errorClass: "upstream_placeholder_404", error: "published placeholder" },
  ]), {
    errorClass: "placeholder_404",
    summary: "DLTV: 1 match page failed (1 upstream placeholder 404)",
  });
  assert.deepEqual(buildDltvProbeFailure([
    { error: "upstream response 502" },
    { error: "invalid match schema" },
  ]), {
    errorClass: "parse_failed",
    summary: "DLTV: 2 match pages failed",
  });
});

test("all static provider adapters can run semantic canaries with injected upstreams", async () => {
  const signal = new AbortController().signal;
  const tournamentSearch = {
    ok: true,
    tournaments: [{ id: "tournament-1", title: "Tournament 1" }],
    summary: { total: 1, matches: 1, rawTotal: 1, filteredOut: 0, emptyReason: null },
  };
  const tournamentDetail = {
    id: "tournament-1",
    title: "Tournament 1",
    gender: "men",
    matches: [{ id: "match-1", teamA: "Alpha", teamB: "Beta" }],
    matchCount: 1,
  };
  const volleyballSource = (searchName: string, detailName: string) => ({
    [searchName]: async () => tournamentSearch,
    [detailName]: async () => tournamentDetail,
  });

  const probes = createStaticParserProbesWithDependencies({
    loadLiquipediaPortal: async () => ({
      fetchDisciplinePortal: async (scope: string) => ({
        slug: scope,
        tournaments: [{ url: `https://liquipedia.net/${scope}/Test_Event` }],
      }),
    }),
    loadLiquipediaClient: async () => ({
      fetchPageWikitext: async (_apiUrl: string, scope: string) => ({
        pageId: 1,
        title: "Test Event",
        fullUrl: `https://liquipedia.net/${scope}/Test_Event`,
        wikitext: "{{Infobox league|name=Test Event}}{{Match|team1=Alpha|team2=Beta}}",
      }),
      fetchPageParsed: async () => "<div class='brkts-match'>Alpha — Beta</div>",
    }),
    loadNormalizers: async () => ({
      getNormalizer: () => (page: { title: string; pageUrl: string }) => ({
        sourceTitle: page.title,
        sourceUrl: page.pageUrl,
        name: page.title,
        participants: [],
        subPages: [],
        warnings: [],
        matches: [{ matchId: "match-1", teamAName: "Alpha", teamBName: "Beta" }],
      }),
    }),
    loadEnv: async () => ({ shouldFetchParsedHtmlForDiscipline: () => true }),
    loadHltv: async () => ({
      runHltvScript: async (mode: string) => mode === "events"
        ? { ok: true, events: [{ id: "9001" }] }
        : { ok: true, title: "HLTV Event", matches: [{ id: "match-1" }] },
    }),
    loadVlr: async () => ({
      runVlrScraper: async (mode: string) => mode === "events"
        ? { ok: true, events: [{ id: "vlr-1" }] }
        : {
            ok: true,
            title: "VLR Event",
            matches: [{ id: "match-1" }],
            diagnostics: { vlr: { matchPagesFetched: 1 } },
          },
    }),
    loadDltv: async () => ({
      runDltv: async (mode: string) => mode === "events"
        ? { ok: true, events: [{ id: "dltv-1" }] }
        : { ok: true, matches: [{ id: "match-1", team1: "Alpha", team2: "Beta" }], matchPageFailures: [] },
    }),
    loadFandom: async () => ({
      fetchFandomTournamentCargoEvents: async () => [{ title: { OverviewPage: "League/Test" } }],
      fetchFandomMatchScheduleCargo: async () => [{ title: { MatchId: "match-1" } }],
    }),
    loadVolleyballWorld: async () => ({
      searchAllVolleyballWorldBeachTournaments: async () => ({
        ...tournamentSearch,
        tournaments: [tournamentDetail],
        summary: {
          ...tournamentSearch.summary,
          byGender: {
            men: { rawTotal: 1, total: 1, matches: 1 },
            women: { rawTotal: 0, total: 0, matches: 0 },
          },
        },
        upstream: { cacheStatus: "miss" },
      }),
    }),
    loadBeachVolleyRu: async () => volleyballSource("searchBeachVolleyRuTournaments", "fetchBeachVolleyRuTournament"),
    loadGermanBeachTour: async () => volleyballSource("searchGermanBeachTourTournaments", "fetchGermanBeachTourTournament"),
    loadTwelveNdr: async () => volleyballSource("searchTwelveNdrTournaments", "fetchTwelveNdrTournament"),
    loadCbv: async () => volleyballSource("searchCBVTournaments", "fetchCBVTournament"),
    loadFedervolley: async () => volleyballSource("searchFedervolleyTournaments", "fetchFedervolleyTournament"),
    loadWtt: async () => ({
      fetchWttEvents: async () => [{ id: "raw-1" }],
      normalizeWttTournamentEvents: () => [{ eventId: "wtt-1", timeZoneId: "2" }],
      resolveWttDateRange: () => ({ fromDate: new Date(0), toDate: new Date(1) }),
      isWttTournamentInRange: () => true,
      fetchWttSchedule: async () => [{ matchId: "match-1" }],
      normalizeWttSchedule: () => ({ matches: [{ id: "match-1" }] }),
    }),
    loadKhl: async () => ({
      KhlApiClient: class {
        async listStages() { return [{ stageId: "stage-1", current: true }]; }
        async listEvents() { return [{ apiEventId: "event-1" }]; }
        async getEventDetail() { return { apiEventId: "event-1" }; }
      },
    }),
    loadKhlNormalizer: async () => ({
      normalizeKhlEventDetail: () => ({ identity: { apiEventId: "event-1", matchId: "match-1" } }),
    }),
  } as any);

  const expectedIds = [
    "liquipedia:dota2",
    "liquipedia:counterstrike",
    "liquipedia:leagueoflegends",
    "liquipedia:valorant",
    "hltv",
    "vlr",
    "dltv",
    "fandom",
    "volleyballworld",
    "beachvolleyru",
    "germanbeachtour",
    "twelvendrcsvp",
    "twelvendroevv",
    "cbv",
    "federvolley",
    "wtt",
    "khl",
  ];

  for (const id of expectedIds) {
    const probe = probes.find((candidate) => candidate.id === id);
    assert.ok(probe, `missing probe ${id}`);
    const result = await probe.run(1, signal);
    assert.equal(result.detailChecked, true, `${id} did not verify source detail`);
    assert.ok(result.rawCandidates > 0, `${id} did not report raw candidates`);
  }
});

test("VLR monitor rejects an overview schedule when full match loading produced a warning", async () => {
  const probes = createStaticParserProbesWithDependencies({
    loadVlr: async () => ({
      runVlrScraper: async (mode: string) => mode === "events"
        ? { ok: true, events: [{ id: "vlr-1" }] }
        : {
            ok: true,
            title: "Partial overview",
            warning: "Не удалось загрузить полное расписание /matches",
            matches: [{ id: "overview-match" }],
            diagnostics: { vlr: { matchPagesFetched: 1 } },
          },
    }),
  } as any);
  const probe = probes.find((candidate) => candidate.id === "vlr");
  assert.ok(probe);
  await assert.rejects(
    probe.run(1, new AbortController().signal),
    (error: unknown) => error instanceof MonitorProbeError && error.errorClass === "parse_failed",
  );
});

test("fresh-probe failures retain cloudflare and stale-cache classifications", async () => {
  const signal = new AbortController().signal;
  const hltv = createStaticParserProbesWithDependencies({
    loadHltv: async () => ({
      runHltvScript: async (mode: string) => mode === "events"
        ? { ok: false, errorClass: "cloudflare_block" }
        : { ok: true, matches: [{ id: "fallback-match" }] },
    }),
  } as any).find((candidate) => candidate.id === "hltv");
  assert.ok(hltv);
  await assert.rejects(
    hltv.run(1, signal),
    (error: unknown) => error instanceof MonitorProbeError && error.errorClass === "cloudflare_block",
  );

  const vlr = createStaticParserProbesWithDependencies({
    loadVlr: async () => ({
      runVlrScraper: async () => ({ ok: true, cacheHit: true, events: [{ id: "vlr-1" }] }),
    }),
  } as any).find((candidate) => candidate.id === "vlr");
  assert.ok(vlr);
  await assert.rejects(
    vlr.run(1, signal),
    (error: unknown) => error instanceof MonitorProbeError && error.errorClass === "stale_cache",
  );
});

test("HLTV monitor preserves an upstream typed Cloudflare error", async () => {
  const hltv = createStaticParserProbesWithDependencies({
    loadHltv: async () => ({
      runHltvScript: async () => {
        throw Object.assign(new Error("challenge page"), { errorClass: "cloudflare_block" });
      },
    }),
  } as any).find((candidate) => candidate.id === "hltv");
  assert.ok(hltv);
  await assert.rejects(
    hltv.run(1, new AbortController().signal),
    (error: unknown) => error instanceof MonitorProbeError && error.errorClass === "cloudflare_block",
  );
});

test("DLTV monitor accepts an explicit current empty state only after a historical semantic canary", async () => {
  const visited: string[] = [];
  const dltv = createStaticParserProbesWithDependencies({
    loadDltv: async () => ({
      runDltv: async (mode: string, candidate?: string) => {
        if (mode === "events") {
          return { ok: true, events: [{ id: "current", url: "https://dltv.org/events/current" }] };
        }
        visited.push(String(candidate));
        if (String(candidate).includes("the-international-2026")) {
          return {
            ok: true,
            event: { participants: [{ name: "Alpha" }], matchUrls: ["https://dltv.org/matches/1"] },
            matches: [{ id: "1", team1: "Alpha", team2: "Beta" }],
            matchPageFailures: [],
          };
        }
        return {
          ok: true,
          event: { participants: [], matchUrls: [] },
          matches: [],
          matchPageFailures: [],
        };
      },
    }),
  } as any).find((candidate) => candidate.id === "dltv");
  assert.ok(dltv);

  const result = await dltv.run(1, new AbortController().signal);
  assert.equal(result.normalizedItems, 0);
  assert.equal(result.detailChecked, true);
  assert.equal(result.explicitEmpty, true);
  assert.deepEqual(visited, [
    "https://dltv.org/events/current",
    "https://dltv.org/events/the-international-2026",
  ]);
});

test("WTT monitor validates raw schedule with the production normalizer", async () => {
  let normalizerCalls = 0;
  const probes = createStaticParserProbesWithDependencies({
    loadWtt: async () => ({
      fetchWttEvents: async () => [{ id: "raw-1" }],
      normalizeWttTournamentEvents: () => [{ eventId: "wtt-1", timeZoneId: "2" }],
      resolveWttDateRange: () => ({ fromDate: new Date(0), toDate: new Date(1) }),
      isWttTournamentInRange: () => true,
      fetchWttSchedule: async () => [{ structurally: "invalid" }],
      normalizeWttSchedule: () => {
        normalizerCalls += 1;
        return { matches: [] };
      },
    }),
  } as any);
  const probe = probes.find((candidate) => candidate.id === "wtt");
  assert.ok(probe);
  const result = await probe.run(1, new AbortController().signal);
  assert.equal(normalizerCalls, 1);
  assert.equal(result.detailChecked, false);
  assert.equal(result.explicitEmpty, false);
});

test("WTT monitor checks later in-window candidates when the first schedule has no semantic matches", async () => {
  const visited: string[] = [];
  const probes = createStaticParserProbesWithDependencies({
    loadWtt: async () => ({
      fetchWttEvents: async () => [{ id: "raw-1" }, { id: "raw-2" }],
      normalizeWttTournamentEvents: () => [
        { eventId: "wtt-empty", timeZoneId: "2" },
        { eventId: "wtt-good", timeZoneId: "2" },
      ],
      resolveWttDateRange: () => ({ fromDate: new Date(0), toDate: new Date(1) }),
      isWttTournamentInRange: () => true,
      fetchWttSchedule: async (eventId: string) => {
        visited.push(eventId);
        return [{ eventId }];
      },
      normalizeWttSchedule: (_schedule: unknown, context: { eventId: string }) => ({
        matches: context.eventId === "wtt-good" ? [{ id: "match-1" }] : [],
      }),
    }),
  } as any);
  const probe = probes.find((candidate) => candidate.id === "wtt");
  assert.ok(probe);
  const result = await probe.run(1, new AbortController().signal);
  assert.deepEqual(visited, ["wtt-empty", "wtt-good"]);
  assert.equal(result.detailChecked, true);
});

test("WTT monitor prioritizes the current event and enables the production API fallback", async () => {
  const visited: Array<{ id: string; allowApiFallback: boolean }> = [];
  const probes = createStaticParserProbesWithDependencies({
    loadWtt: async () => ({
      fetchWttEvents: async () => [{ id: "raw-current" }, { id: "raw-future" }],
      normalizeWttTournamentEvents: () => [
        { eventId: "far-future", timeZoneId: "2", startDate: "2026-11-01", endDate: "2026-11-05" },
        { eventId: "current", timeZoneId: "75", startDate: "2026-08-31", endDate: "2026-09-05" },
      ],
      resolveWttDateRange: () => ({ fromDate: "2026-09-01", toDate: "2026-11-29" }),
      isWttTournamentInRange: () => true,
      fetchWttSchedule: async (eventId: string, options: { allowApiFallback: boolean }) => {
        visited.push({ id: eventId, allowApiFallback: options.allowApiFallback });
        return [{ eventId }];
      },
      normalizeWttSchedule: (_schedule: unknown, context: { eventId: string }) => ({
        matches: context.eventId === "current" ? [{ id: "match-1" }] : [],
      }),
    }),
  } as any);
  const probe = probes.find((candidate) => candidate.id === "wtt");
  assert.ok(probe);

  const result = await probe.run(1, new AbortController().signal);
  assert.equal(result.detailChecked, true);
  assert.deepEqual(visited, [{ id: "current", allowApiFallback: true }]);
});

test("WTT canary ordering is immutable and ranks an overlapping event before future events", () => {
  const input = [
    { eventId: "future", startDate: "2026-10-01", endDate: "2026-10-05" },
    { eventId: "current", startDate: "2026-08-31", endDate: "2026-09-05" },
  ];
  const sorted = sortWttCanaryCandidates(input, "2026-09-01");
  assert.deepEqual(sorted.map((event) => event.eventId), ["current", "future"]);
  assert.deepEqual(input.map((event) => event.eventId), ["future", "current"]);
});

test("KHL monitor fail-closes when production detail normalization rejects upstream schema", async () => {
  let normalizerCalls = 0;
  const probes = createStaticParserProbesWithDependencies({
    loadKhl: async () => ({
      KhlApiClient: class {
        async listStages() { return [{ stageId: "stage-1", current: true }]; }
        async listEvents() { return [{ apiEventId: "event-1" }]; }
        async getEventDetail() { return { changed: true }; }
      },
    }),
    loadKhlNormalizer: async () => ({
      normalizeKhlEventDetail: () => {
        normalizerCalls += 1;
        throw new Error("missing team_a");
      },
    }),
  } as any);
  const probe = probes.find((candidate) => candidate.id === "khl");
  assert.ok(probe);
  await assert.rejects(
    probe.run(1, new AbortController().signal),
    (error: unknown) => error instanceof MonitorProbeError && error.errorClass === "schema_drift",
  );
  assert.equal(normalizerCalls, 1);
});

test("KHL monitor verifies a historical detail before accepting an empty local canary window", async () => {
  let requestedDays = 0;
  const historicalStartsAt = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
  const probes = createStaticParserProbesWithDependencies({
    loadKhl: async () => ({
      KhlApiClient: class {
        async listStages() { return [{ stageId: "stage-1", current: true }]; }
        async listEvents(input: { from: Date; to: Date }) {
          requestedDays = Math.round((input.to.getTime() - input.from.getTime()) / (24 * 60 * 60 * 1000));
          return [{ apiEventId: "historical-1", startsAt: historicalStartsAt }];
        }
        async getEventDetail() { return { id: "historical-1" }; }
      },
    }),
    loadKhlNormalizer: async () => ({
      normalizeKhlEventDetail: () => ({ identity: { apiEventId: "historical-1", matchId: "match-1" } }),
    }),
  } as any);
  const probe = probes.find((candidate) => candidate.id === "khl");
  assert.ok(probe);
  const result = await probe.run(1, new AbortController().signal);
  assert.ok(requestedDays >= 365);
  assert.equal(result.rawCandidates, 1);
  assert.equal(result.normalizedItems, 0);
  assert.equal(result.detailChecked, true);
  assert.equal(result.explicitEmpty, true);
});

test("KHL monitor uses the previous stage when the current stage only has scheduled games", async () => {
  const requestedStages: string[] = [];
  const detailStages: string[] = [];
  const probes = createStaticParserProbesWithDependencies({
    loadKhl: async () => ({
      KhlApiClient: class {
        async listStages() {
          return [
            { stageId: "407", current: true },
            { stageId: "395", current: false },
          ];
        }
        async listEvents(input: { stageId: string }) {
          requestedStages.push(input.stageId);
          return input.stageId === "407"
            ? [{ apiEventId: "future-1", stageId: "407", status: "scheduled", startsAt: new Date(Date.now() + 86_400_000).toISOString() }]
            : [{ apiEventId: "finished-1", stageId: "395", status: "finished", startsAt: new Date(Date.now() - 86_400_000).toISOString() }];
        }
        async getEventDetail(input: { stageId: string }) {
          detailStages.push(input.stageId);
          return { id: "finished-1" };
        }
      },
    }),
    loadKhlNormalizer: async () => ({
      normalizeKhlEventDetail: () => ({ identity: { apiEventId: "finished-1", matchId: "match-1" } }),
    }),
  } as any);
  const probe = probes.find((candidate) => candidate.id === "khl");
  assert.ok(probe);

  const result = await probe.run(1, new AbortController().signal);
  assert.deepEqual(requestedStages, ["407", "395"]);
  assert.deepEqual(detailStages, ["395"]);
  assert.equal(result.rawCandidates, 1);
  assert.equal(result.normalizedItems, 1);
  assert.equal(result.detailChecked, true);
});

test("VolleyballWorld monitor uses one shared all-gender range with raw counters", async () => {
  let calls = 0;
  let receivedSignal: AbortSignal | undefined;
  const signal = new AbortController().signal;
  const probes = createStaticParserProbesWithDependencies({
    loadVolleyballWorld: async () => ({
      searchAllVolleyballWorldBeachTournaments: async (input: { signal?: AbortSignal }) => {
        calls += 1;
        receivedSignal = input.signal;
        return {
          ok: true,
          tournaments: [{
            id: "women-1",
            title: "Women's event",
            gender: "women",
            matches: [{ id: "match-1", teamA: "Alpha", teamB: "Beta" }],
            matchCount: 1,
          }],
          summary: {
            total: 1,
            matches: 1,
            rawTotal: 2,
            filteredOut: 1,
            emptyReason: null,
            byGender: {
              men: { rawTotal: 1, total: 0, matches: 0 },
              women: { rawTotal: 1, total: 1, matches: 1 },
            },
          },
          upstream: { cacheStatus: "miss" },
        };
      },
    }),
  } as any);
  const probe = probes.find((candidate) => candidate.id === "volleyballworld");
  assert.ok(probe);
  const result = await probe.run(1, signal);
  assert.equal(calls, 1);
  assert.equal(receivedSignal, signal);
  assert.equal(result.rawCandidates, 2);
  assert.equal(result.detailChecked, true);
  assert.equal(probe.timeoutMs, 270_000);
});

test("future beach and OEVV schedules use recent finished semantic canaries", async () => {
  const futureSearch = {
    ok: true,
    tournaments: [{ id: "future", title: "Future", status: "upcoming", startDate: "2099-09-10" }],
    monitorCanaries: [{ id: "history", title: "History", status: "finished", startDate: "2099-08-01" }],
    summary: { total: 1, matches: 0, rawTotal: 2, filteredOut: 1, emptyReason: null },
  };
  const source = (searchName: string, detailName: string) => ({
    [searchName]: async () => futureSearch,
    [detailName]: async (candidate: { id: string }) => ({
      ...candidate,
      matches: candidate.id === "history"
        ? [{ id: "match-1", teamA: "Alpha", teamB: "Beta" }]
        : [],
      matchCount: candidate.id === "history" ? 1 : 0,
    }),
  });
  const probes = createStaticParserProbesWithDependencies({
    loadBeachVolleyRu: async () => source("searchBeachVolleyRuTournaments", "fetchBeachVolleyRuTournament"),
    loadTwelveNdr: async () => source("searchTwelveNdrTournaments", "fetchTwelveNdrTournament"),
  } as any);

  for (const id of ["beachvolleyru", "twelvendroevv"]) {
    const probe = probes.find((candidate) => candidate.id === id);
    assert.ok(probe);
    const result = await probe.run(1, new AbortController().signal);
    assert.equal(result.normalizedItems, 0);
    assert.equal(result.detailChecked, true);
    assert.equal(result.explicitEmpty, true);
    assert.match(result.summary || "", /historical canary/i);
  }
});

test("VolleyballWorld monitor rejects shared results without both gender split counters", async () => {
  const probes = createStaticParserProbesWithDependencies({
    loadVolleyballWorld: async () => ({
      searchAllVolleyballWorldBeachTournaments: async () => ({
        ok: true,
        tournaments: [],
        summary: { total: 0, matches: 0, rawTotal: 1, filteredOut: 1, emptyReason: "date_window" },
        upstream: { cacheStatus: "miss" },
      }),
    }),
  } as any);
  const probe = probes.find((candidate) => candidate.id === "volleyballworld");
  assert.ok(probe);
  await assert.rejects(
    probe.run(1, new AbortController().signal),
    (error: unknown) => error instanceof MonitorProbeError && error.errorClass === "schema_drift",
  );
});
