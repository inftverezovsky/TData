import assert from "node:assert/strict";

import { PrismaClient } from "@prisma/client";
import { chromium, expect, type Page, type Response } from "@playwright/test";

import { KHL_RESULTS_AUTO_SYNC_PAUSED_KEY } from "@backend/results/khl/automation";
import { requireSameDatabaseUrl } from "./helpers/isolatedKhlDatabase";

const KHL_GAME_ID = "901973";
const API_EVENT_ID = "2986031";
const STAGE_ID = "395";
const MATCH_DATE = "2026-05-21";
const DIRECTORY_PLAYER_ID = "99000001";
const DIRECTORY_PLAYER_NAME = "KHL Browser Candidate Player";

type TargetTemplate = {
  khlGameId: string;
  teamStatTypes: Record<string, string>;
  playerStatTypes: Record<string, string>;
  teams: Record<string, { stats: Record<string, { adminMatchStatId: string }> }>;
  players: Array<{
    khlPlayerId: string;
    adminPlayerId: string;
    adminMatchPlayerId: string;
    stats: Record<string, string>;
  }>;
};

type StageResponse = {
  transportExecuted: boolean;
  reused: boolean;
  delivery: { id: string; payloadHash: string };
};

async function main() {
  const baseUrl = requireLoopbackUrl(process.env.KHL_BROWSER_BASE_URL);
  const databaseUrl = requireSameDatabaseUrl(
    process.env.DATABASE_URL,
    process.env.TEST_DATABASE_URL
  );
  const adminPassword = requiredEnvironmentValue("ADMIN_PASSWORD");
  if (process.env.ALLOW_KHL_BROWSER_VERIFY !== "1") {
    throw new Error("Set ALLOW_KHL_BROWSER_VERIFY=1 for isolated browser verification.");
  }

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(30_000);
  const visible = expect.configure({ timeout: 30_000 });

  try {
  await prisma.globalSettings.upsert({
    where: { key: KHL_RESULTS_AUTO_SYNC_PAUSED_KEY },
    create: { key: KHL_RESULTS_AUTO_SYNC_PAUSED_KEY, value: "0" },
    update: { value: "0" },
  });
  await prisma.adminTeam.create({
    data: {
      disciplineSlug: "khl-browser-test",
      platformId: DIRECTORY_PLAYER_ID,
      platformName: DIRECTORY_PLAYER_NAME,
      platformNameEn: DIRECTORY_PLAYER_NAME,
      normalizedName: "khl browser candidate player",
      normalizedNameEn: "khl browser candidate player",
      sourceFileName: "isolated-browser-fixture",
    },
  });
  await page.goto(`${baseUrl}/results`);
  await visible(page).toHaveURL(`${baseUrl}/results/khl`);
  await visible(page.getByRole("heading", { name: "Доступ ограничен" })).toBeVisible();

  const unauthenticated = await page.evaluate(async () => {
    const stages = await fetch("/api/results/khl/stages");
    const invalidIngest = await fetch("/api/results/khl/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{invalid",
    });
    return { stages: stages.status, invalidIngest: invalidIngest.status };
  });
  assert.deepEqual(unauthenticated, { stages: 401, invalidIngest: 401 });

  await page.getByPlaceholder("Пароль...").fill(adminPassword);
  await page.getByRole("button", { name: "Разблокировать" }).click();
  await visible(page.getByRole("heading", { name: "КХЛ", exact: true })).toBeVisible();
  await visible(page.getByRole("heading", { name: "Автоматическое обновление включено" })).toBeVisible();
  await visible(page.getByText(/Только завершённые матчи с 01\.05\.2026/)).toBeVisible();

  const pauseResponsePromise = waitForApiResponse(page, "/api/results/khl/automation", "POST");
  await page.getByRole("button", { name: "Остановить автообновление" }).click();
  const pauseResponse = await pauseResponsePromise;
  assert.equal(pauseResponse.status(), 200);
  assert.deepEqual((await pauseResponse.json() as { automation: {
    configured: boolean;
    paused: boolean;
    enabled: boolean;
  } }).automation, { configured: true, paused: true, enabled: false });
  await visible(page.getByRole("heading", { name: "Автоматическое обновление остановлено" })).toBeVisible();
  assert.equal((await prisma.globalSettings.findUnique({
    where: { key: KHL_RESULTS_AUTO_SYNC_PAUSED_KEY },
  }))?.value, "1");

  await page.reload();
  await visible(page.getByRole("heading", { name: "Автоматическое обновление остановлено" })).toBeVisible();
  const resumeResponsePromise = waitForApiResponse(page, "/api/results/khl/automation", "POST");
  await page.getByRole("button", { name: "Запустить автообновление" }).click();
  const resumeResponse = await resumeResponsePromise;
  assert.equal(resumeResponse.status(), 200);
  assert.deepEqual((await resumeResponse.json() as { automation: {
    configured: boolean;
    paused: boolean;
    enabled: boolean;
  } }).automation, { configured: true, paused: false, enabled: true });
  await visible(page.getByRole("heading", { name: "Автоматическое обновление включено" })).toBeVisible();
  assert.equal((await prisma.globalSettings.findUnique({
    where: { key: KHL_RESULTS_AUTO_SYNC_PAUSED_KEY },
  }))?.value, "0");

  await page.getByText("Ручная проверка расписания (резервный режим)", { exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("select option").length > 1);
  await page.locator("select").selectOption(STAGE_ID);
  const dates = page.locator('input[type="date"]');
  await dates.nth(0).fill(MATCH_DATE);
  await dates.nth(1).fill(MATCH_DATE);

  const scheduleResponsePromise = waitForApiResponse(page, "/api/results/khl/schedule", "GET");
  await page.getByRole("button", { name: "Получить" }).click();
  const scheduleResponse = await scheduleResponsePromise;
  assert.equal(scheduleResponse.status(), 200);
  const scheduleBody = await scheduleResponse.json() as {
    events: Array<{ khlGameId: string; apiEventId: string }>;
  };
  assert.ok(scheduleBody.events.some((event) => (
    event.khlGameId === KHL_GAME_ID && event.apiEventId === API_EVENT_ID
  )));

  const scheduleRow = page.locator("details").filter({
    has: page.getByRole("heading", { name: "Расписание КХЛ" }),
  }).locator("div").filter({
    hasText: `KHL ${KHL_GAME_ID}`,
  }).filter({
    has: page.getByRole("button", { name: "Ingest / обновить" }),
  }).first();
  await visible(scheduleRow).toBeVisible();
  const ingestResponsePromise = waitForApiResponse(page, "/api/results/khl/ingest", "POST");
  await scheduleRow.getByRole("button", { name: "Ingest / обновить" }).click();
  const ingestResponse = await ingestResponsePromise;
  assert.equal(ingestResponse.status(), 200);
  const ingestBody = await ingestResponse.json() as {
    match: { khlGameId: string };
    idempotency: { reusedSnapshot: boolean; reusedRevision: boolean; activated: boolean };
  };
  assert.equal(ingestBody.match.khlGameId, KHL_GAME_ID);

  const repeatedIngestResponsePromise = waitForApiResponse(page, "/api/results/khl/ingest", "POST");
  await scheduleRow.getByRole("button", { name: "Ingest / обновить" }).click();
  const repeatedIngestResponse = await repeatedIngestResponsePromise;
  assert.equal(repeatedIngestResponse.status(), 200);
  const repeatedIngestBody = await repeatedIngestResponse.json() as {
    idempotency: { reusedSnapshot: boolean; reusedRevision: boolean; activated: boolean };
  };
  assert.equal(typeof repeatedIngestBody.idempotency.reusedSnapshot, "boolean");
  assert.equal(repeatedIngestBody.idempotency.reusedRevision, true);
  assert.equal(repeatedIngestBody.idempotency.activated, false);

  const protocol = matchArticle(page).getByTestId("khl-protocol");
  await visible(protocol).toBeVisible();
  await visible(protocol.getByText("Официальный протокол КХЛ · доступен без Admin mappings")).toBeVisible();
  await visible(protocol.getByText("Броски в створ")).toBeVisible();
  await visible(protocol.getByText("Все заявленные игроки · 43")).toBeVisible();
  await visible(protocol.getByTestId("khl-protocol-player")).toHaveCount(43);
  assert.equal(
    await matchArticle(page).getByPlaceholder("Admin team ID").first().inputValue(),
    ""
  );

  const previewBlockedPromise = waitForApiResponse(page, "/api/results/khl/preview", "GET");
  await matchArticle(page).getByRole("button", { name: "Сформировать preview" }).click();
  const blockedResponse = await previewBlockedPromise;
  assert.equal(blockedResponse.status(), 200);
  const blockedPreview = await blockedResponse.json() as { ready: boolean; issues: string[] };
  assert.equal(blockedPreview.ready, false);
  assert.ok(blockedPreview.issues.length > 0);
  await visible(matchArticle(page).getByText(/BLOCKED · причин:/)).toBeVisible();

  await confirmTeam(page, 0, "e2e-admin-team-home");
  await confirmTeam(page, 1, "e2e-admin-team-away");
  await visible(matchArticle(page).getByRole("button", { name: "Подтвердить матч" })).toBeEnabled();
  await matchArticle(page).getByPlaceholder("Admin match ID").fill("e2e-admin-match-901973");
  await matchArticle(page).getByPlaceholder("Admin match candidates JSON").fill(JSON.stringify([{
    adminMatchId: "e2e-admin-match-901973",
    startsAt: "2026-05-21T16:30:00.000Z",
    homeAdminTeamId: "e2e-admin-team-home",
    awayAdminTeamId: "e2e-admin-team-away",
    season: "2025/2026",
    stageId: STAGE_ID,
  }], null, 2));
  const matchBindingPromise = waitForApiResponse(page, "/api/results/khl/bindings/match", "POST");
  await matchArticle(page).getByRole("button", { name: "Подтвердить матч" }).click();
  assert.equal((await matchBindingPromise).status(), 200);

  await targetMappingsDetails(page).locator("summary").click();
  const templateResponsePromise = waitForApiResponse(page, "/api/results/khl/bindings/targets", "GET");
  await matchArticle(page).getByRole("button", { name: "Загрузить шаблон" }).click();
  assert.equal((await templateResponsePromise).status(), 200);
  const targetTextarea = targetMappingsDetails(page).locator("textarea");
  await visible(targetTextarea).toBeVisible();
  await visible(targetMappingsDetails(page).getByTestId("khl-target-bindings-form")).toBeVisible();
  await visible(targetMappingsDetails(page).getByTestId("khl-team-targets-home")).toBeVisible();
  await visible(targetMappingsDetails(page).getByTestId("khl-team-targets-away")).toBeVisible();

  const firstPlayerBinding = targetMappingsDetails(page).getByTestId("khl-player-binding").first();
  await firstPlayerBinding.locator("summary").click();
  const directoryResponsePromise = waitForApiResponse(
    page,
    "/api/results/khl/admin-directory/suggest",
    "GET"
  );
  await firstPlayerBinding.getByRole("combobox").fill(DIRECTORY_PLAYER_NAME);
  assert.equal((await directoryResponsePromise).status(), 200);
  await firstPlayerBinding.getByRole("option", { name: new RegExp(DIRECTORY_PLAYER_NAME) }).click();
  await visible(firstPlayerBinding.getByPlaceholder("Admin player ID")).toHaveValue(DIRECTORY_PLAYER_ID);
  assert.equal(await prisma.khlPlayer.count({ where: { adminPlayerId: DIRECTORY_PLAYER_ID } }), 0);
  const playerBindingResponsePromise = waitForApiResponse(
    page,
    "/api/results/khl/bindings/player",
    "POST"
  );
  await firstPlayerBinding.getByRole("button", { name: "Подтвердить игрока" }).click();
  assert.equal((await playerBindingResponsePromise).status(), 200);
  assert.equal(await prisma.khlPlayer.count({
    where: { adminPlayerId: DIRECTORY_PLAYER_ID, adminBindingStatus: "CONFIRMED" },
  }), 1);

  const targetTemplate = JSON.parse(await targetTextarea.inputValue()) as TargetTemplate;
  fillTargetTemplate(targetTemplate);
  const expectedTargetJson = JSON.stringify(targetTemplate, null, 2);
  await targetTextarea.fill(expectedTargetJson);

  const targetSavePromise = waitForApiResponse(page, "/api/results/khl/bindings/targets", "POST");
  const readyPreviewPromise = waitForApiResponse(page, "/api/results/khl/preview", "GET");
  await matchArticle(page).getByRole("button", { name: "Проверить и подтвердить IDs" }).click();
  assert.equal((await targetSavePromise).status(), 200);
  const readyResponse = await readyPreviewPromise;
  assert.equal(readyResponse.status(), 200);
  const readyPreview = await readyResponse.json() as {
    ready: boolean;
    revisionId: string;
    payloadHash: string;
    payload: unknown;
  };
  assert.equal(readyPreview.ready, true);
  assert.match(readyPreview.payloadHash, /^[a-f0-9]{64}$/);
  assert.ok(readyPreview.payload);
  await visible(matchArticle(page).getByText(/READY · SHA-256/)).toBeVisible();
  await matchArticle(page).getByText("Canonical payload").click();
  await visible(matchArticle(page).locator("pre")).toContainText("e2e-admin-match-901973");

  await page.reload();
  await visible(page.getByRole("heading", { name: "КХЛ", exact: true })).toBeVisible();
  await visible(matchArticle(page)).toBeVisible();
  await targetMappingsDetails(page).locator("summary").click();
  const prefillResponsePromise = waitForApiResponse(page, "/api/results/khl/bindings/targets", "GET");
  await matchArticle(page).getByRole("button", { name: "Загрузить шаблон" }).click();
  assert.equal((await prefillResponsePromise).status(), 200);
  assert.deepEqual(
    JSON.parse(await targetMappingsDetails(page).locator("textarea").inputValue()),
    targetTemplate
  );

  const postReloadPreviewPromise = waitForApiResponse(page, "/api/results/khl/preview", "GET");
  await matchArticle(page).getByRole("button", { name: "Сформировать preview" }).click();
  const postReloadPreview = await (await postReloadPreviewPromise).json() as {
    ready: boolean;
    revisionId: string;
    payloadHash: string;
  };
  assert.equal(postReloadPreview.ready, true);
  assert.equal(postReloadPreview.revisionId, readyPreview.revisionId);
  assert.equal(postReloadPreview.payloadHash, readyPreview.payloadHash);

  const newDiffPromise = waitForApiResponse(page, "/api/results/khl/diff", "GET");
  await matchArticle(page).getByRole("button", { name: "Diff со staging" }).click();
  const newDiffResponse = await newDiffPromise;
  const newDiff = await newDiffResponse.json() as { status: string };
  assert.equal(newDiff.status, "NEW");
  await visible(matchArticle(page).getByText("DIFF · NEW")).toBeVisible();

  const firstStageResponse = await stageThroughUi(page);
  assert.equal(firstStageResponse.transportExecuted, false);
  assert.equal(firstStageResponse.reused, false);
  await visible(matchArticle(page).getByText("DIFF · UNCHANGED")).toBeVisible();

  const repeatedStageResponse = await stageThroughUi(page);
  assert.equal(repeatedStageResponse.transportExecuted, false);
  assert.equal(repeatedStageResponse.reused, true);
  assert.equal(repeatedStageResponse.delivery.id, firstStageResponse.delivery.id);

  const parallelStages = await page.evaluate(async (input) => Promise.all(
    [0, 1].map(async () => {
      const response = await fetch("/api/results/khl/delivery/stage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      return { status: response.status, body: await response.json() };
    })
  ), {
    khlGameId: KHL_GAME_ID,
    expectedRevisionId: readyPreview.revisionId,
    expectedPayloadHash: readyPreview.payloadHash,
  }) as Array<{ status: number; body: StageResponse & { error?: string } }>;
  assert.deepEqual(parallelStages.map((result) => result.status), [200, 200]);
  for (const result of parallelStages) {
    assert.equal(result.body.transportExecuted, false);
    assert.equal(result.body.reused, true);
    assert.equal(result.body.delivery.id, firstStageResponse.delivery.id);
    assert.doesNotMatch(result.body.error || "", /P2002|P2034/);
  }

  const unchangedDiffPromise = waitForApiResponse(page, "/api/results/khl/diff", "GET");
  await matchArticle(page).getByRole("button", { name: "Diff со staging" }).click();
  const unchangedDiff = await (await unchangedDiffPromise).json() as { status: string };
  assert.equal(unchangedDiff.status, "UNCHANGED");

  const [deliveries, attempts, match] = await Promise.all([
    prisma.khlDelivery.findMany({ where: { adminMatchId: "e2e-admin-match-901973" } }),
    prisma.khlDeliveryAttempt.count(),
    prisma.khlMatch.findUnique({ where: { khlGameId: KHL_GAME_ID } }),
  ]);
  assert.equal(deliveries.length, 1);
  assert.equal(attempts, 0);
  assert.ok(match?.activeRevisionId);
  assert.equal(deliveries[0].payloadHash, readyPreview.payloadHash);
  const unexpectedBrowserErrors = browserErrors.filter((message) => (
    !/Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/.test(message)
  ));
  assert.deepEqual(unexpectedBrowserErrors, []);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    khlGameId: KHL_GAME_ID,
    payloadHash: readyPreview.payloadHash,
    deliveryId: deliveries[0].id,
    deliveryCount: deliveries.length,
    deliveryAttemptCount: attempts,
    transportExecuted: false,
    finalDiff: "UNCHANGED",
    automationControl: "PAUSE_PERSISTED_THEN_RESUMED",
    browserConsoleErrors: unexpectedBrowserErrors.length,
  }, null, 2)}\n`);
  } finally {
    await prisma.globalSettings.upsert({
      where: { key: KHL_RESULTS_AUTO_SYNC_PAUSED_KEY },
      create: { key: KHL_RESULTS_AUTO_SYNC_PAUSED_KEY, value: "0" },
      update: { value: "0" },
    }).catch(() => undefined);
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});

function matchArticle(page: Page) {
  return page.locator("article").filter({ hasText: `KHL game ${KHL_GAME_ID}` }).first();
}

function targetMappingsDetails(page: Page) {
  return matchArticle(page).locator("details").filter({
    has: page.getByText("Player/stat target mappings (JSON)", { exact: true }),
  });
}

async function confirmTeam(page: Page, index: number, adminTeamId: string) {
  const input = matchArticle(page).getByPlaceholder("Admin team ID").nth(index);
  await input.fill(adminTeamId);
  const responsePromise = waitForApiResponse(page, "/api/results/khl/bindings/team", "POST");
  await input.locator("xpath=..").getByRole("button", { name: "Подтвердить" }).click();
  assert.equal((await responsePromise).status(), 200);
}

function fillTargetTemplate(template: TargetTemplate) {
  assert.equal(template.khlGameId, KHL_GAME_ID);
  for (const code of Object.keys(template.teamStatTypes)) {
    template.teamStatTypes[code] = `e2e-team-stat-type-${code}`;
  }
  for (const code of Object.keys(template.playerStatTypes)) {
    template.playerStatTypes[code] = `e2e-player-stat-type-${code}`;
  }
  for (const [side, team] of Object.entries(template.teams)) {
    for (const [code, target] of Object.entries(team.stats)) {
      target.adminMatchStatId = `e2e-${side}-match-stat-${code}`;
    }
  }
  for (const player of template.players) {
    if (!player.adminPlayerId) player.adminPlayerId = `e2e-player-${player.khlPlayerId}`;
    player.adminMatchPlayerId = `e2e-match-player-${player.khlPlayerId}`;
    for (const code of Object.keys(player.stats)) {
      player.stats[code] = `e2e-player-${player.khlPlayerId}-stat-${code}`;
    }
  }
}

async function stageThroughUi(page: Page) {
  const stageResponsePromise = waitForApiResponse(page, "/api/results/khl/delivery/stage", "POST");
  const diffResponsePromise = waitForApiResponse(page, "/api/results/khl/diff", "GET");
  await matchArticle(page).getByRole("button", { name: "Зафиксировать staging (без отправки)" }).click();
  const response = await stageResponsePromise;
  assert.equal(response.status(), 200);
  const body = await response.json() as StageResponse;
  assert.equal((await diffResponsePromise).status(), 200);
  return body;
}

function waitForApiResponse(page: Page, pathname: string, method: string): Promise<Response> {
  return page.waitForResponse((response) => (
    new URL(response.url()).pathname === pathname
    && response.request().method() === method
  ), { timeout: 45_000 });
}

function requiredEnvironmentValue(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function requireLoopbackUrl(value: string | undefined) {
  const parsed = new URL(value || "");
  if (!isLoopbackHost(parsed.hostname) || parsed.protocol !== "http:") {
    throw new Error("KHL_BROWSER_BASE_URL must be an HTTP loopback URL.");
  }
  return parsed.origin;
}

function isLoopbackHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
