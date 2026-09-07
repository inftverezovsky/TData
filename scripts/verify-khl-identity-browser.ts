import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, expect, type Locator } from "@playwright/test";
import { normalizeKhlEventDetail } from "@backend/sources/results/khl/normalize";
import { buildKhlMatchProtocolView } from "@backend/results/khl/matchProtocol";
import type { MatchesResponse, StoredMatch } from "@/components/results/khl/types";

const GAME_ID = "901981";
const CONTROLLED_CLOCK = "2026-09-05T20:00:00.000Z"; // 23:00 Europe/Moscow; explicitly controlled, not wall-clock evidence.
const IDENTITY_WARNING = "Статистика доступна · нет ID КХЛ";
const METRICS = ["shots_on_goal", "faceoffs_won", "power_play_goals", "penalty_minutes_2_4"] as const;

function configuration() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--live")) throw new Error("Only --live is supported.");
  const live = args.includes("--live");
  const url = new URL(process.env.KHL_IDENTITY_E2E_BASE_URL || (live ? "https://www.tdata.info" : "http://127.0.0.1:3014"));
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
  assert.equal(protocol.players.length, 47);
  assert.equal(protocol.players.filter((player) => player.khlPlayerId === null).length, 5);
  const revision = {
    id: "identity-browser-diagnostic", revisionNumber: 1, state: "REJECTED",
    normalizedHash: createHash("sha256").update(JSON.stringify(normalized)).digest("hex"),
    validationIssues: normalized.validation.issues, createdAt: CONTROLLED_CLOCK,
  };
  const team = (side: "home" | "away") => ({
    khlTeamId: normalized.teams[side].khlTeamId, name: normalized.teams[side].name,
    adminTeamId: null, adminBindingStatus: "UNMAPPED",
  });
  const match: StoredMatch = {
    id: "identity-browser-match", khlGameId: GAME_ID, stageId: normalized.identity.stageId,
    season: normalized.identity.season, startsAt: normalized.startsAt, status: "FINISHED",
    officialHomeScore: protocol.scores.official.home, officialAwayScore: protocol.scores.official.away,
    regulationHomeScore: protocol.scores.regulation.home, regulationAwayScore: protocol.scores.regulation.away,
    adminMatchId: null, adminBindingStatus: "UNMAPPED", homeTeam: team("home"), awayTeam: team("away"),
    activeRevision: null, latestRevision: revision, displayRevision: { ...revision, source: "LATEST_REJECTED" },
    protocol, _count: { revisions: 1, participants: 0 },
  };
  return {
    matches: [match], pagination: { offset: 0, limit: 100, total: 1, hasMore: false },
    automation: { configured: true, paused: true, enabled: false, cutoff: "2026-04-30T21:00:00.000Z",
      intervalMinutes: 10, lastFetchedAt: CONTROLLED_CLOCK, latestRun: null, activeRun: null },
  };
}

async function numericCell(row: Locator, index: number, value: number) {
  await expect(row.locator("td").nth(index)).toHaveText(String(value));
}

async function main() {
  const config = configuration();
  const fixture = config.live ? null : fixtureResponse();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: config.origin, timezoneId: "Europe/Moscow", serviceWorkers: "block" });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(30_000);
  const browserErrors: string[] = [];
  const blockedWrites: string[] = [];
  const unexpectedFixtureReads: string[] = [];
  let getRequests = 0;
  let releaseClock: (() => void) | undefined;
  const clockReady = new Promise<void>((resolve) => { releaseClock = resolve; });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  try {
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() !== "GET") {
        blockedWrites.push(`${request.method()} ${url.pathname}`);
        await route.abort("blockedbyclient");
        return;
      }
      getRequests++;
      if (url.origin === config.origin && url.pathname === "/api/results/khl/matches") {
        await clockReady;
        if (fixture) { await route.fulfill({ json: fixture }); return; }
      }
      if (fixture && url.origin === config.origin && url.pathname.startsWith("/api/results/khl/")) {
        if (url.pathname === "/api/results/khl/settings") {
          await route.fulfill({ json: { teams: [], players: [], statMappings: [] } }); return;
        }
        if (url.pathname === "/api/results/khl/stages") {
          await route.fulfill({ json: { stages: [] } }); return;
        }
        unexpectedFixtureReads.push(url.pathname);
        await route.abort("blockedbyclient"); return;
      }
      await route.continue();
    });
    const firstRequest = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/results/khl/matches");
    const firstResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/results/khl/matches");
    await page.goto("/results/khl", { waitUntil: "domcontentloaded" });
    await firstRequest; // The client effect has run: hydrate using wall time before controlling the result day.
    await page.clock.setFixedTime(new Date(CONTROLLED_CLOCK));
    releaseClock?.();
    const response = await firstResponse;
    assert.equal(response.status(), 200);
    const data = await response.json() as MatchesResponse;
    const match = data.matches.find((entry) => entry.khlGameId === GAME_ID);
    assert.ok(match?.protocol, "901981 must be present in the loaded response with its actual protocol.");
    const protocol = match.protocol;
    assert.equal(protocol.players.length, 47);
    assert.equal(protocol.players.filter((player) => player.khlPlayerId === null).length, 5);

    await page.getByTestId("khl-tab-today").click();
    const card = page.getByTestId("khl-match-disclosure").filter({ hasText: `KHL game ${GAME_ID}` });
    await expect(card).toHaveCount(1);
    await expect(card.getByTestId("khl-revision-badge")).toHaveText(IDENTITY_WARNING);
    await expect(card.getByTestId("khl-revision-badge")).toHaveClass(/bg-amber/);
    await expect(card).not.toContainText(/Не входит в статистику дня|не входит в статистику дня/);
    await card.getByTestId("khl-match-summary").click();
    await card.getByRole("tab", { name: "Игроки", exact: true }).click();
    const roster = card.getByTestId("khl-protocol-player");
    await expect(roster).toHaveCount(47);
    await expect(roster.filter({ hasText: "ID КХЛ пока отсутствует в источнике" })).toHaveCount(5);

    await page.getByTestId("khl-tab-daily").click();
    await expect(page.getByRole("heading", { name: "Статистика игрового дня", exact: true })).toBeVisible();
    const dayPlayers = page.getByTestId("khl-day-player");
    const dayTeams = page.getByTestId("khl-day-team");
    if (!config.live) {
      await expect(dayPlayers).toHaveCount(47);
      await expect(dayTeams).toHaveCount(2);
      await expect(page.getByText("Учтено матчей: 1", { exact: true })).toBeVisible();
    }
    for (const player of protocol.players) {
      const row = dayPlayers.filter({ has: page.getByText(player.name, { exact: true }) });
      await expect(row).toHaveCount(1);
      await numericCell(row, 2, player.regulation.goals);
      await numericCell(row, 3, player.regulation.assists);
      await numericCell(row, 4, player.regulation.points);
    }
    for (const side of ["home", "away"] as const) {
      const team = protocol.teams[side];
      const row = dayTeams.filter({ has: page.getByText(team.name, { exact: true }) });
      await expect(row).toHaveCount(1);
      await numericCell(row, 2, protocol.scores.regulation[side]);
      for (const [index, code] of METRICS.entries()) {
        const metric = team.metrics.find((entry) => entry.code === code);
        assert.ok(metric);
        await numericCell(row, index + 3, metric.regulationTotal);
      }
    }
    assert.deepEqual(blockedWrites, [], "No non-GET request may even be attempted.");
    assert.deepEqual(unexpectedFixtureReads, []);
    assert.deepEqual(browserErrors, []);
    console.log(JSON.stringify({
      ok: true, mode: config.live ? "live-read-only" : "fixture", origin: config.origin,
      browserClockControlled: true, browserClock: CONTROLLED_CLOCK, timezone: "Europe/Moscow",
      gameId: GAME_ID, rosterPlayers: 47, missingKhlPlayerIds: 5, dailyPlayersVerified: 47,
      dailyTeamsVerified: 2, getRequests, nonGetAttempts: 0, browserErrors: 0,
      databaseAccessFromVerifier: false, adminWrites: false,
    }));
  } finally {
    releaseClock?.();
    await context.close();
    await browser.close();
  }
}

main().catch((cause) => {
  console.error("[KHL identity browser]", cause instanceof Error ? cause.message : "Unknown failure");
  process.exitCode = 1;
});
