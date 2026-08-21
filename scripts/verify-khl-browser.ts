import assert from "node:assert/strict";

import { PrismaClient } from "@prisma/client";
import { chromium, expect, type Locator, type Page, type Response } from "@playwright/test";

import { KHL_RESULTS_AUTO_SYNC_PAUSED_KEY } from "@backend/results/khl/automation";
import { requireSameDatabaseUrl } from "./helpers/isolatedKhlDatabase";

const KHL_GAME_ID = "901973";
const API_EVENT_ID = "2986031";
const STAGE_ID = "395";
const MATCH_DATE = "2026-05-21";
const DIRECTORY_PLAYER_ID = "99000001";
const DIRECTORY_PLAYER_NAME = "KHL Browser Candidate Player";
const TEAM_STAT_CODES = [
  "shots_on_goal",
  "faceoffs_won",
  "power_play_goals",
  "penalty_minutes_2_4",
] as const;
const PLAYER_STAT_CODES = ["goals", "assists", "points"] as const;

type TargetTemplate = {
  khlGameId: string;
  teamStatTypes: Record<string, string>;
  playerStatTypes: Record<string, string>;
  teams: Record<"home" | "away", {
    stats: Record<string, { adminMatchStatId: string }>;
  }>;
  players: Array<{
    khlPlayerId: string;
    adminPlayerId: string;
    adminMatchPlayerId: string;
    stats: Record<string, string>;
  }>;
};

type ScheduleEventSummary = {
  khlGameId: string;
  apiEventId: string;
  teams: {
    home: { khlTeamId: string; name: string };
    away: { khlTeamId: string; name: string };
  };
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

  const rootTabs = rootTabList(page);
  await visible(rootTabs.getByRole("tab", { name: "Настройки", exact: true })).toBeVisible();
  await visible(rootTabs.getByRole("tab", { name: "Результаты", exact: true })).toBeVisible();
  await visible(page.getByTestId("khl-results-workspace")).toBeVisible();

  const resultsTabs = resultsTabList(page);
  await visible(resultsTabs.getByTestId("khl-tab-today")).toContainText("Матчи сегодня");
  await visible(resultsTabs.getByTestId("khl-tab-daily")).toContainText("Статистика игрового дня");
  await visible(resultsTabs.getByTestId("khl-tab-archive")).toContainText("Архив");
  await resultsTabs.getByTestId("khl-tab-daily").click();
  await visible(page.getByRole("heading", { name: "Статистика игрового дня" })).toBeVisible();
  await resultsTabs.getByTestId("khl-tab-archive").click();
  await visible(page.getByRole("heading", { name: "Архив с 1 мая 2026 года" })).toBeVisible();

  await rootTabs.getByRole("tab", { name: "Настройки", exact: true }).click();
  await visible(page.getByTestId("khl-settings-workspace")).toBeVisible();
  const settingsTabs = settingsTabList(page);
  for (const [testId, label] of [
    ["khl-tab-players", "Игроки"],
    ["khl-tab-teams", "Команды"],
    ["khl-tab-matches", "Матчи"],
    ["khl-tab-statistics", "Статистика"],
    ["khl-tab-extras", "Допы"],
  ] as const) {
    await visible(settingsTabs.getByTestId(testId)).toHaveText(label);
  }
  await settingsTabs.getByTestId("khl-tab-extras").click();
  await visible(page.getByRole("heading", { name: "Дополнительные привязки" })).toBeVisible();
  await rootTabs.getByRole("tab", { name: "Результаты", exact: true }).click();
  await visible(page.getByTestId("khl-results-workspace")).toBeVisible();

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

  await selectRootTab(page, "settings");
  await selectSettingsTab(page, "matches");
  const manualSchedule = settingsWorkspace(page).locator("details").filter({
    hasText: "Ручная проверка расписания · резервный режим",
  }).first();
  await manualSchedule.locator("summary").click();
  await manualSchedule.locator("select option").nth(1).waitFor({ state: "attached" });
  await manualSchedule.locator("select").selectOption(STAGE_ID);
  const dates = manualSchedule.locator('input[type="date"]');
  await dates.nth(0).fill(MATCH_DATE);
  await dates.nth(1).fill(MATCH_DATE);

  const scheduleResponsePromise = waitForApiResponse(page, "/api/results/khl/schedule", "GET");
  await manualSchedule.getByRole("button", { name: "Получить" }).click();
  const scheduleResponse = await scheduleResponsePromise;
  assert.equal(scheduleResponse.status(), 200);
  const scheduleBody = await scheduleResponse.json() as {
    events: ScheduleEventSummary[];
  };
  const scheduleEvent = scheduleBody.events.find((event) => (
    event.khlGameId === KHL_GAME_ID && event.apiEventId === API_EVENT_ID
  ));
  assert.ok(scheduleEvent);

  const scheduleRow = manualSchedule.locator("div").filter({
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

  await selectSettingsTab(page, "players");
  const playerTeamGroups = settingsWorkspace(page).getByTestId("khl-player-team-group");
  await visible(playerTeamGroups).toHaveCount(2);
  assert.equal(await playerTeamGroups.evaluateAll((nodes) => (
    nodes.every((node) => !(node as HTMLDetailsElement).open)
  )), true);
  const firstPlayerTeam = playerTeamGroups.first();
  await firstPlayerTeam.getByTestId("khl-player-team-summary").click();
  assert.equal(await firstPlayerTeam.evaluate((node) => (node as HTMLDetailsElement).open), true);
  await visible(firstPlayerTeam.locator("article").first()).toBeVisible();
  await visible(firstPlayerTeam.getByPlaceholder("Admin player ID").first()).toBeVisible();

  await selectRootTab(page, "results");
  await selectResultsTab(page, "archive");
  const resultArticle = resultMatchArticle(page);
  const matchDisclosure = resultArticle.getByTestId("khl-match-disclosure");
  const matchSummary = matchDisclosure.getByTestId("khl-match-summary");
  await visible(matchSummary).toContainText(`KHL game ${KHL_GAME_ID}`);
  await visible(matchSummary).toContainText("Игроков: 43");
  await expect(matchDisclosure).not.toHaveAttribute("open", "");
  await expect(matchDisclosure.getByTestId("khl-protocol-overview")).not.toBeVisible();
  await matchSummary.click();
  await expect(matchDisclosure).toHaveAttribute("open", "");
  const matchTabs = matchDisclosure.getByRole("tablist", { name: /^Данные матча/ });
  await visible(matchTabs.getByTestId("khl-tab-overview")).toHaveText("Матч / допы");
  await visible(matchTabs.getByTestId("khl-tab-players")).toHaveText("Игроки");
  await visible(matchTabs.getByTestId("khl-tab-statistics")).toHaveText("Статистика");

  const overviewProtocol = matchDisclosure.getByTestId("khl-protocol-overview");
  await visible(overviewProtocol).toBeVisible();
  await visible(overviewProtocol.getByText("Официальный протокол КХЛ · доступен без Admin mappings")).toBeVisible();
  await visible(overviewProtocol.getByRole("heading", { name: "Счёт по периодам" })).toBeVisible();
  await visible(overviewProtocol.getByText(/Голы · \d+/)).toBeVisible();
  await visible(overviewProtocol.getByText(/Штрафы · \d+/)).toBeVisible();

  await matchTabs.getByTestId("khl-tab-players").click();
  const playersProtocol = matchDisclosure.getByTestId("khl-protocol-players");
  await visible(playersProtocol.getByText("Все заявленные игроки · 43")).toBeVisible();
  await visible(playersProtocol.getByTestId("khl-protocol-player")).toHaveCount(43);

  await matchTabs.getByTestId("khl-tab-statistics").click();
  const statisticsProtocol = matchDisclosure.getByTestId("khl-protocol-statistics");
  await visible(statisticsProtocol.getByRole("heading", { name: "Командная статистика" })).toBeVisible();
  await visible(statisticsProtocol.getByText("Броски в створ", { exact: true })).toBeVisible();

  const unmappedMatch = await prisma.khlMatch.findUnique({
    where: { khlGameId: KHL_GAME_ID },
    include: { homeTeam: true, awayTeam: true },
  });
  assert.equal(unmappedMatch?.homeTeam.adminTeamId, null);
  assert.equal(unmappedMatch?.awayTeam.adminTeamId, null);
  assert.equal(unmappedMatch?.adminMatchId, null);

  await selectRootTab(page, "settings");
  await selectSettingsTab(page, "matches");
  let matchCard = settingsMatchCard(page);
  await openDetails(matchCard);

  const previewBlockedPromise = waitForApiResponse(page, "/api/results/khl/preview", "GET");
  await matchCard.getByRole("button", { name: "Preview", exact: true }).click();
  const blockedResponse = await previewBlockedPromise;
  assert.equal(blockedResponse.status(), 200);
  const blockedPreview = await blockedResponse.json() as { ready: boolean; issues: string[] };
  assert.equal(blockedPreview.ready, false);
  assert.ok(blockedPreview.issues.length > 0);
  await visible(matchCard.getByText(/BLOCKED · \d+/)).toBeVisible();

  await selectSettingsTab(page, "teams");
  await confirmTeam(page, scheduleEvent.teams.home.khlTeamId, "e2e-admin-team-home");
  await confirmTeam(page, scheduleEvent.teams.away.khlTeamId, "e2e-admin-team-away");

  await selectSettingsTab(page, "matches");
  matchCard = settingsMatchCard(page);
  await openDetails(matchCard);
  await visible(matchCard.getByRole("button", { name: "Подтвердить матч" })).toBeEnabled();
  await matchCard.getByPlaceholder("Admin match ID").fill("e2e-admin-match-901973");
  await matchCard.getByPlaceholder("[]", { exact: true }).fill(JSON.stringify([{
    adminMatchId: "e2e-admin-match-901973",
    startsAt: "2026-05-21T16:30:00.000Z",
    homeAdminTeamId: "e2e-admin-team-home",
    awayAdminTeamId: "e2e-admin-team-away",
    season: "2025/2026",
    stageId: STAGE_ID,
  }], null, 2));
  const matchBindingPromise = waitForApiResponse(page, "/api/results/khl/bindings/match", "POST");
  await matchCard.getByRole("button", { name: "Подтвердить матч" }).click();
  assert.equal((await matchBindingPromise).status(), 200);

  await selectSettingsTab(page, "statistics");
  await saveStatTypeMappings(page);
  await selectStatisticsMatch(page);
  const templateResponsePromise = waitForApiResponse(page, "/api/results/khl/bindings/targets", "GET");
  await settingsWorkspace(page).getByRole("button", { name: "Загрузить сохранённые IDs" }).click();
  const templateResponse = await templateResponsePromise;
  assert.equal(templateResponse.status(), 200);
  const templateBody = await templateResponse.json() as { template: TargetTemplate };
  assert.deepEqual(templateBody.template.teamStatTypes, expectedTeamStatTypes());
  assert.deepEqual(templateBody.template.playerStatTypes, expectedPlayerStatTypes());
  const targetForm = settingsWorkspace(page).getByTestId("khl-target-bindings-form");
  await visible(targetForm).toBeVisible();
  await visible(targetForm.getByTestId("khl-team-targets-home")).toBeVisible();
  await visible(targetForm.getByTestId("khl-team-targets-away")).toBeVisible();

  const firstPlayer = templateBody.template.players[0];
  assert.ok(firstPlayer);
  const firstPlayerBinding = targetPlayerBinding(page, firstPlayer.khlPlayerId);
  await openDetails(firstPlayerBinding);
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
  const playerTemplateRefreshPromise = waitForApiResponse(
    page,
    "/api/results/khl/bindings/targets",
    "GET"
  );
  await firstPlayerBinding.getByRole("button", { name: "Подтвердить игрока" }).click();
  assert.equal((await playerBindingResponsePromise).status(), 200);
  assert.equal((await playerTemplateRefreshPromise).status(), 200);
  assert.equal(await prisma.khlPlayer.count({
    where: { adminPlayerId: DIRECTORY_PLAYER_ID, adminBindingStatus: "CONFIRMED" },
  }), 1);
  await visible(
    targetPlayerBinding(page, firstPlayer.khlPlayerId).getByPlaceholder("Admin player ID")
  ).toBeDisabled();

  const targetTemplate = buildExpectedTargetTemplate({
    ...templateBody.template,
    players: templateBody.template.players.map((player) => (
      player.khlPlayerId === firstPlayer.khlPlayerId
        ? { ...player, adminPlayerId: DIRECTORY_PLAYER_ID }
        : player
    )),
  });
  await fillTargetEditor(page, targetTemplate);

  const targetSavePromise = waitForApiResponse(page, "/api/results/khl/bindings/targets", "POST");
  const readyPreviewPromise = waitForApiResponse(page, "/api/results/khl/preview", "GET");
  await settingsWorkspace(page).getByRole("button", { name: "Подтвердить target IDs" }).click();
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

  await selectSettingsTab(page, "matches");
  matchCard = settingsMatchCard(page);
  await openDetails(matchCard);
  await visible(matchCard.getByText("READY", { exact: true })).toBeVisible();
  await visible(matchCard.getByText(`SHA-256 ${readyPreview.payloadHash}`)).toBeVisible();
  await matchCard.getByText("Canonical payload").click();
  await visible(matchCard.locator("pre")).toContainText("e2e-admin-match-901973");

  await page.reload();
  await visible(page.getByRole("heading", { name: "КХЛ", exact: true })).toBeVisible();
  await selectRootTab(page, "settings");
  await selectSettingsTab(page, "statistics");
  await selectStatisticsMatch(page);
  const prefillResponsePromise = waitForApiResponse(page, "/api/results/khl/bindings/targets", "GET");
  await settingsWorkspace(page).getByRole("button", { name: "Загрузить сохранённые IDs" }).click();
  const prefillResponse = await prefillResponsePromise;
  assert.equal(prefillResponse.status(), 200);
  const prefillBody = await prefillResponse.json() as { template: TargetTemplate };
  assert.deepEqual(prefillBody.template, targetTemplate);
  await assertTargetEditorPrefill(page, targetTemplate);

  await selectSettingsTab(page, "matches");
  matchCard = settingsMatchCard(page);
  await openDetails(matchCard);

  const postReloadPreviewPromise = waitForApiResponse(page, "/api/results/khl/preview", "GET");
  await matchCard.getByRole("button", { name: "Preview", exact: true }).click();
  const postReloadPreview = await (await postReloadPreviewPromise).json() as {
    ready: boolean;
    revisionId: string;
    payloadHash: string;
  };
  assert.equal(postReloadPreview.ready, true);
  assert.equal(postReloadPreview.revisionId, readyPreview.revisionId);
  assert.equal(postReloadPreview.payloadHash, readyPreview.payloadHash);

  const newDiffPromise = waitForApiResponse(page, "/api/results/khl/diff", "GET");
  await matchCard.getByRole("button", { name: "Diff", exact: true }).click();
  const newDiffResponse = await newDiffPromise;
  const newDiff = await newDiffResponse.json() as { status: string };
  assert.equal(newDiff.status, "NEW");
  await visible(matchCard.getByText("DIFF · NEW")).toBeVisible();

  const firstStageResponse = await stageThroughUi(page);
  assert.equal(firstStageResponse.transportExecuted, false);
  assert.equal(firstStageResponse.reused, false);
  await visible(matchCard.getByText("DIFF · UNCHANGED")).toBeVisible();

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
  await settingsMatchCard(page).getByRole("button", { name: "Diff", exact: true }).click();
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
    playerTeamGroups: 2,
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

function rootTabList(page: Page) {
  return page.getByRole("tablist", { name: "КХЛ: настройки или результаты" });
}

function settingsWorkspace(page: Page) {
  return page.getByTestId("khl-settings-workspace");
}

function settingsTabList(page: Page) {
  return settingsWorkspace(page).getByRole("tablist", { name: "Разделы настроек КХЛ" });
}

function resultsTabList(page: Page) {
  return page.getByTestId("khl-results-workspace").getByRole("tablist", {
    name: "Разделы результатов КХЛ",
  });
}

async function selectRootTab(page: Page, tab: "settings" | "results") {
  await rootTabList(page).getByTestId(`khl-tab-${tab}`).click();
  await expect(page.getByTestId(`khl-${tab}-workspace`)).toBeVisible();
}

async function selectSettingsTab(
  page: Page,
  tab: "players" | "teams" | "matches" | "statistics" | "extras"
) {
  await settingsTabList(page).getByTestId(`khl-tab-${tab}`).click();
}

async function selectResultsTab(page: Page, tab: "today" | "daily" | "archive") {
  await resultsTabList(page).getByTestId(`khl-tab-${tab}`).click();
}

function resultMatchArticle(page: Page) {
  return page.getByTestId("khl-results-workspace").locator("article").filter({
    hasText: `KHL game ${KHL_GAME_ID}`,
  }).first();
}

function settingsMatchCard(page: Page) {
  return settingsWorkspace(page).locator("details").filter({
    hasText: `KHL ${KHL_GAME_ID}`,
  }).filter({
    has: page.getByPlaceholder("Admin match ID"),
  }).first();
}

function targetPlayerBinding(page: Page, khlPlayerId: string) {
  return settingsWorkspace(page).getByTestId("khl-target-bindings-form")
    .getByTestId("khl-player-binding")
    .filter({ hasText: `KHL ${khlPlayerId} ·` })
    .first();
}

async function openDetails(details: Locator) {
  if (await details.getAttribute("open") === null) {
    await details.locator("summary").first().click();
  }
  await expect(details).toHaveAttribute("open", "");
}

async function confirmTeam(page: Page, khlTeamId: string, adminTeamId: string) {
  const teamRow = settingsWorkspace(page).locator("article").filter({
    hasText: `KHL ${khlTeamId} ·`,
  }).first();
  const input = teamRow.getByPlaceholder("Admin team ID");
  await input.fill(adminTeamId);
  const responsePromise = waitForApiResponse(page, "/api/results/khl/bindings/team", "POST");
  await teamRow.getByRole("button", { name: "Подтвердить", exact: true }).click();
  assert.equal((await responsePromise).status(), 200);
}

async function saveStatTypeMappings(page: Page) {
  const panel = settingsWorkspace(page).locator("section").filter({
    has: page.getByRole("heading", { name: "Типы статистики Admin", exact: true }),
  }).first();
  for (const [code, adminStatTypeId] of Object.entries({
    ...expectedTeamStatTypes(),
    ...expectedPlayerStatTypes(),
  })) {
    const label = panel.getByText(code, { exact: true }).locator("xpath=ancestor::label");
    await label.getByPlaceholder("Admin stat type ID").fill(adminStatTypeId);
  }
  const responsePromise = waitForApiResponse(
    page,
    "/api/results/khl/bindings/stat-types",
    "POST"
  );
  await panel.getByRole("button", { name: "Подтвердить типы статистики" }).click();
  assert.equal((await responsePromise).status(), 200);
  await expect(panel.getByPlaceholder("Admin stat type ID").first()).toBeDisabled();
}

async function selectStatisticsMatch(page: Page) {
  const select = settingsWorkspace(page).locator(
    `select:has(option[value="${KHL_GAME_ID}"])`
  );
  await select.selectOption(KHL_GAME_ID);
}

function expectedTeamStatTypes() {
  return Object.fromEntries(TEAM_STAT_CODES.map((code) => [
    code,
    `e2e-team-stat-type-${code}`,
  ]));
}

function expectedPlayerStatTypes() {
  return Object.fromEntries(PLAYER_STAT_CODES.map((code) => [
    code,
    `e2e-player-stat-type-${code}`,
  ]));
}

function buildExpectedTargetTemplate(template: TargetTemplate): TargetTemplate {
  assert.equal(template.khlGameId, KHL_GAME_ID);
  const next = structuredClone(template);
  next.teamStatTypes = expectedTeamStatTypes();
  next.playerStatTypes = expectedPlayerStatTypes();
  for (const [side, team] of Object.entries(next.teams)) {
    for (const [code, target] of Object.entries(team.stats)) {
      target.adminMatchStatId = `e2e-${side}-match-stat-${code}`;
    }
  }
  next.players = next.players.map((player) => ({
    ...player,
    adminPlayerId: player.adminPlayerId || `e2e-player-${player.khlPlayerId}`,
    adminMatchPlayerId: `e2e-match-player-${player.khlPlayerId}`,
    stats: Object.fromEntries(Object.keys(player.stats).map((code) => [
      code,
      `e2e-player-${player.khlPlayerId}-stat-${code}`,
    ])),
  }));
  return next;
}

async function fillTargetEditor(page: Page, template: TargetTemplate) {
  const form = settingsWorkspace(page).getByTestId("khl-target-bindings-form");
  for (const side of ["home", "away"] as const) {
    const teamGroup = form.getByTestId(`khl-team-targets-${side}`);
    for (const code of TEAM_STAT_CODES) {
      await teamGroup.getByPlaceholder(`Admin target ID · ${teamStatLabel(code)}`).fill(
        template.teams[side].stats[code].adminMatchStatId
      );
    }
  }

  for (const player of template.players) {
    const binding = targetPlayerBinding(page, player.khlPlayerId);
    await openDetails(binding);
    await fillEditableInput(
      binding.getByPlaceholder("Admin player ID"),
      player.adminPlayerId
    );
    await fillEditableInput(
      binding.getByPlaceholder("Admin match-player ID"),
      player.adminMatchPlayerId
    );
    for (const code of PLAYER_STAT_CODES) {
      await fillEditableInput(
        binding.getByPlaceholder(`Admin ${code} record ID`),
        player.stats[code]
      );
    }
  }
}

async function assertTargetEditorPrefill(page: Page, template: TargetTemplate) {
  const form = settingsWorkspace(page).getByTestId("khl-target-bindings-form");
  await expect(form).toBeVisible();
  for (const side of ["home", "away"] as const) {
    const teamGroup = form.getByTestId(`khl-team-targets-${side}`);
    for (const code of TEAM_STAT_CODES) {
      await expect(
        teamGroup.getByPlaceholder(`Admin target ID · ${teamStatLabel(code)}`)
      ).toHaveValue(template.teams[side].stats[code].adminMatchStatId);
    }
  }
  for (const player of template.players) {
    const binding = targetPlayerBinding(page, player.khlPlayerId);
    await expect(binding.getByPlaceholder("Admin player ID")).toHaveValue(player.adminPlayerId);
    await expect(binding.getByPlaceholder("Admin match-player ID")).toHaveValue(
      player.adminMatchPlayerId
    );
    for (const code of PLAYER_STAT_CODES) {
      await expect(binding.getByPlaceholder(`Admin ${code} record ID`)).toHaveValue(
        player.stats[code]
      );
    }
  }
}

async function fillEditableInput(input: Locator, value: string) {
  if (await input.isDisabled()) {
    await expect(input).toHaveValue(value);
  } else {
    await input.fill(value);
  }
}

function teamStatLabel(code: typeof TEAM_STAT_CODES[number]) {
  if (code === "shots_on_goal") return "Броски в створ";
  if (code === "faceoffs_won") return "Выигранные вбрасывания";
  if (code === "power_play_goals") return "Голы в большинстве";
  return "Штрафные минуты 2/4";
}

async function stageThroughUi(page: Page) {
  const stageResponsePromise = waitForApiResponse(page, "/api/results/khl/delivery/stage", "POST");
  const diffResponsePromise = waitForApiResponse(page, "/api/results/khl/diff", "GET");
  await settingsMatchCard(page).getByRole("button", { name: "Staging без отправки" }).click();
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
