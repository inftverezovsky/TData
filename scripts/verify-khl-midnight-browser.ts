import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, expect, type Browser } from "@playwright/test";
import { normalizeKhlEventDetail } from "@backend/sources/results/khl/normalize";
import { buildKhlMatchProtocolView } from "@backend/results/khl/matchProtocol";
import type { MatchesResponse, StoredMatch } from "@/components/results/khl/types";

const GAME_ID = "901981";
const BEFORE_MIDNIGHT = "2026-09-05T20:59:55.000Z";
const AFTER_MIDNIGHT = "2026-09-05T21:00:05.000Z";
const ADVANCE_MS = 15_000;

function configuration() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--live")) throw new Error("Only --live is supported.");
  const live = args.includes("--live");
  const url = new URL(process.env.KHL_MIDNIGHT_E2E_BASE_URL || (live ? "https://www.tdata.info" : "http://127.0.0.1:3014"));
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Use a bare origin without credentials, path, query or fragment.");
  }
  if (live ? url.origin !== "https://www.tdata.info"
    : url.protocol !== "http:" || url.port !== "3014" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("Fixture mode permits only loopback port 3014; --live permits only https://www.tdata.info.");
  }
  return { live, origin: url.origin };
}

function fixtureResponse(): MatchesResponse {
  const wrapper = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/khl/missing-player-ids-901981.json"), "utf8"));
  const normalized = normalizeKhlEventDetail(wrapper.event || wrapper);
  const protocol = buildKhlMatchProtocolView(normalized);
  const revision = { id: "midnight-diagnostic", revisionNumber: 1, state: "REJECTED",
    normalizedHash: "0".repeat(64), validationIssues: normalized.validation.issues, createdAt: BEFORE_MIDNIGHT };
  const team = (side: "home" | "away") => ({ khlTeamId: normalized.teams[side].khlTeamId,
    name: normalized.teams[side].name, adminTeamId: null, adminBindingStatus: "UNMAPPED" });
  const match: StoredMatch = {
    id: "midnight-match", khlGameId: GAME_ID, stageId: normalized.identity.stageId,
    season: normalized.identity.season, startsAt: normalized.startsAt, status: "FINISHED",
    officialHomeScore: protocol.scores.official.home, officialAwayScore: protocol.scores.official.away,
    regulationHomeScore: protocol.scores.regulation.home, regulationAwayScore: protocol.scores.regulation.away,
    adminMatchId: null, adminBindingStatus: "UNMAPPED", homeTeam: team("home"), awayTeam: team("away"),
    activeRevision: null, latestRevision: revision, displayRevision: { ...revision, source: "LATEST_REJECTED" },
    protocol, _count: { revisions: 1, participants: 0 },
  };
  return { matches: [match], pagination: { offset: 0, limit: 100, total: 1, hasMore: false },
    automation: { configured: true, paused: true, enabled: false, cutoff: "2026-04-30T21:00:00.000Z",
      intervalMinutes: 10, lastFetchedAt: BEFORE_MIDNIGHT, latestRun: null, activeRun: null } };
}

async function verifyCase(browser: Browser, config: ReturnType<typeof configuration>, rollover: boolean) {
  const context = await browser.newContext({ baseURL: config.origin, timezoneId: "Europe/Moscow", serviceWorkers: "block" });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(30_000);
  const fixture = config.live ? null : fixtureResponse();
  const browserErrors: string[] = [];
  const writes: string[] = [];
  const unexpectedReads: string[] = [];
  let freezeReads = false;
  let heldReadAttempts = 0;
  let postFreezeResponses = 0;
  let matchesResponses = 0;
  let releaseReads: (() => void) | undefined;
  const readsReleased = new Promise<void>((resolve) => { releaseReads = resolve; });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin === config.origin && url.pathname.startsWith("/api/results/khl/")) {
      if (freezeReads) postFreezeResponses++;
      if (url.pathname === "/api/results/khl/matches") matchesResponses++;
    }
  });
  try {
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() !== "GET") {
        writes.push(`${request.method()} ${url.pathname}`);
        await route.abort("blockedbyclient"); return;
      }
      if (freezeReads) {
        heldReadAttempts++;
        // Polling may attempt a read, but no further HTTP request or response can refresh the matches array.
        await readsReleased;
        await route.abort("blockedbyclient"); return;
      }
      if (fixture && url.origin === config.origin && url.pathname.startsWith("/api/results/khl/")) {
        if (url.pathname === "/api/results/khl/matches") { await route.fulfill({ json: fixture }); return; }
        if (url.pathname === "/api/results/khl/stages") { await route.fulfill({ json: { stages: [] } }); return; }
        if (url.pathname === "/api/results/khl/settings") {
          await route.fulfill({ json: { teams: [], players: [], statMappings: [] } }); return;
        }
        unexpectedReads.push(url.pathname);
        await route.abort("blockedbyclient"); return;
      }
      await route.continue();
    });
    // Install before navigation: server/client date mismatches must remain observable, never suppressed.
    await page.clock.install({ time: new Date(rollover ? "2026-09-05T20:55:00.000Z" : AFTER_MIDNIGHT) });
    const firstResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/results/khl/matches");
    await page.goto("/results/khl", { waitUntil: "domcontentloaded" });
    const response = await firstResponse;
    assert.equal(response.status(), 200);
    const data = await response.json() as MatchesResponse;
    assert.ok(data.matches.some((match) => match.khlGameId === GAME_ID && match.protocol?.players.length === 47));
    await page.waitForLoadState("networkidle");
    const today = page.getByTestId("khl-tab-today");
    const daily = page.getByTestId("khl-tab-daily");
    const archive = page.getByTestId("khl-tab-archive");
    const targetCard = page.getByTestId("khl-match-disclosure").filter({ hasText: `KHL game ${GAME_ID}` });
    await today.click();
    if (rollover) {
      await expect(page.getByText(/^Московская дата:/)).toContainText("5 сентября 2026");
      await expect(targetCard).toHaveCount(1);
      await daily.click();
      if (!config.live) {
        await expect(page.getByTestId("khl-day-player")).toHaveCount(47);
        await expect(page.getByTestId("khl-day-team")).toHaveCount(2);
      }
      freezeReads = true;
      const initialMatchesResponses = matchesResponses;
      await page.clock.pauseAt(new Date(BEFORE_MIDNIGHT));
      await expect(page.getByText(/^Суммы P1–P3 за/)).toContainText("5 сентября 2026");
      await page.clock.runFor(ADVANCE_MS);
      // No tab click, remount, HTTP response, or matches-array replacement triggers this update.
      await expect(page.getByText(/^Суммы P1–P3 за/)).toContainText("6 сентября 2026");
      await expect(page.getByTestId("khl-day-player")).toHaveCount(0);
      await expect(page.getByTestId("khl-day-team")).toHaveCount(0);
      await expect(page.getByText("Учтено матчей: 0", { exact: true })).toBeVisible();
      assert.equal(matchesResponses, initialMatchesResponses, "Matches must not be refreshed across midnight.");
      assert.equal(postFreezeResponses, 0, "No extra KHL HTTP response may drive the day change.");
      await today.click();
    }
    await expect(page.getByText(/^Московская дата:/)).toContainText("6 сентября 2026");
    await expect(targetCard).toHaveCount(0);
    await archive.click();
    await expect(targetCard).toHaveCount(1);
    assert.deepEqual(writes, [], "No non-GET request may even be attempted.");
    assert.deepEqual(unexpectedReads, []);
    assert.deepEqual(browserErrors, [], "Hydration and browser errors are acceptance failures.");
    return { case: rollover ? "same-page-midnight" : "initial-next-day", ok: true,
      matchesResponses, heldReadAttempts, postFreezeResponses, nonGetAttempts: writes.length,
      browserErrors: browserErrors.length, browserTime: await page.evaluate(() => new Date().toISOString()) };
  } finally {
    // Remove handlers before aborting deliberately withheld reads during teardown only.
    page.removeAllListeners();
    releaseReads?.();
    await context.close();
  }
}

async function main() {
  const config = configuration();
  const browser = await chromium.launch({ headless: true });
  const results: Array<Record<string, unknown>> = [];
  try {
    for (const rollover of [false, true]) {
      try { results.push(await verifyCase(browser, config, rollover)); }
      catch (error) { results.push({ case: rollover ? "same-page-midnight" : "initial-next-day", ok: false,
        error: error instanceof Error ? error.message : "Unknown failure" }); }
    }
  } finally { await browser.close(); }
  const ok = results.every((result) => result.ok);
  console.log(JSON.stringify({ ok, mode: config.live ? "live-read-only" : "fixture", origin: config.origin,
    browserClockControlled: true, timezone: "Europe/Moscow", beforeMidnight: BEFORE_MIDNIGHT,
    afterMidnight: AFTER_MIDNIGHT, advanceMs: ADVANCE_MS, gameId: GAME_ID, results,
    databaseAccessFromVerifier: false, adminWrites: false }));
  if (!ok) process.exitCode = 1;
}

main().catch((error) => { console.error("[KHL midnight browser]", error instanceof Error ? error.message : "Unknown failure"); process.exitCode = 1; });
