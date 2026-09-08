import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { normalizeKhlEventDetail } from "../../backend/src/sources/results/khl/normalize";
import { buildKhlMatchProtocolView } from "../../backend/src/results/khl/matchProtocol";
import {
  KHL_PENALTY_EXTRA_DEFINITIONS,
  projectKhlPenaltyExtras,
} from "../../backend/src/results/khl/penaltyExtras";

const endpoint = "/api/results/khl/bindings/penalty-extra";
const initialBindings = () => KHL_PENALTY_EXTRA_DEFINITIONS.map((definition) => ({
  extraCode: definition.code, label: definition.label, kind: definition.kind,
  adminExtraId: null as string | null, adminBindingStatus: "UNMAPPED",
}));

async function mockOtherRequests(page: Page, matches: unknown[] = []) {
  await page.clock.setFixedTime(new Date("2026-09-08T10:00:00Z"));
  await page.route("**/api/results/khl/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = path.endsWith("/matches") ? {
      matches, automation: null,
      pagination: { offset: 0, limit: 100, total: matches.length, hasMore: false },
    } : path.endsWith("/stages") ? { stages: [] } : { teams: [], players: [] };
    return route.fulfill({ json });
  });
}

async function openSettings(page: Page) {
  await page.goto("/results/khl");
  await page.getByTestId("khl-tab-settings").click();
  await page.getByTestId("khl-tab-extras").click();
  return page.getByTestId("khl-penalty-extra-settings");
}

test("penalty extras retain each of seven distinct confirmed IDs after reload", async ({ page }) => {
  let bindings = initialBindings();
  const writes: { extraCode: string; adminExtraId: string }[] = [];
  await mockOtherRequests(page);
  await page.route(`**${endpoint}`, (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { bindings } });
    const body = route.request().postDataJSON() as { extraCode: string; adminExtraId: string };
    writes.push(body);
    bindings = bindings.map((binding) => binding.extraCode === body.extraCode
      ? { ...binding, adminExtraId: body.adminExtraId, adminBindingStatus: "CONFIRMED" } : binding);
    return route.fulfill({ json: { ok: true, reused: false,
      binding: bindings.find((binding) => binding.extraCode === body.extraCode) } });
  });
  const settings = await openSettings(page);
  await expect(settings.getByRole("textbox")).toHaveCount(7);
  for (const [index, definition] of KHL_PENALTY_EXTRA_DEFINITIONS.entries()) {
    const row = settings.getByTestId(`khl-penalty-binding-${definition.code}`);
    await row.getByRole("textbox").fill(`test-penalty-${index + 1}`);
    await row.getByRole("button", { name: "Подтвердить", exact: true }).click();
    await expect(row.getByRole("button", { name: "Сохранено", exact: true })).toBeDisabled();
  }
  await expect(settings).toContainText("Привязано: 7 из 7");
  await settings.screenshot({ path: test.info().outputPath("penalty-settings.png") });
  expect(writes).toEqual(KHL_PENALTY_EXTRA_DEFINITIONS.map((definition, index) => ({
    extraCode: definition.code, adminExtraId: `test-penalty-${index + 1}`,
  })));
  await page.reload();
  await page.getByTestId("khl-tab-settings").click();
  await page.getByTestId("khl-tab-extras").click();
  for (const [index, definition] of KHL_PENALTY_EXTRA_DEFINITIONS.entries()) {
    const input = settings.getByTestId(`khl-penalty-binding-${definition.code}`).getByRole("textbox");
    await expect(input).toHaveValue(`test-penalty-${index + 1}`);
    await expect(input).toHaveJSProperty("readOnly", true);
    await expect(input).toBeEnabled();
  }
});

test("a rejected penalty ID keeps the draft editable and displays the API error", async ({ page }) => {
  await mockOtherRequests(page);
  await page.route(`**${endpoint}`, (route) => route.request().method() === "GET"
    ? route.fulfill({ json: { bindings: initialBindings() } })
    : route.fulfill({ status: 409, json: { error: {
      code: "BINDING_CONFLICT", message: "Этот ID уже закреплён за другим допом.",
    } } }));
  const settings = await openSettings(page);
  const row = settings.getByTestId("khl-penalty-binding-first_penalty_team");
  await row.getByRole("textbox").fill("test-conflicting-id");
  await row.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(settings.getByRole("alert")).toContainText("Этот ID уже закреплён за другим допом.");
  await expect(row.getByRole("textbox")).toHaveValue("test-conflicting-id");
  await expect(row.getByRole("textbox")).toBeEnabled();
  await expect(row.getByRole("button", { name: "Подтвердить", exact: true })).toBeEnabled();
  await expect(settings).toContainText("Привязано: 0 из 7");
});

test("penalty bindings recover after an unavailable settings request", async ({ page }) => {
  let unavailable = true;
  await mockOtherRequests(page);
  await page.route(`**${endpoint}`, (route) => route.fulfill(unavailable
    ? { status: 503, json: { error: "Не удалось загрузить ID допов." } }
    : { json: { bindings: initialBindings() } }));
  const settings = await openSettings(page);
  await expect(settings.getByRole("alert")).toContainText("Не удалось загрузить ID допов.");
  await expect(settings.getByRole("textbox")).toHaveCount(0);
  unavailable = false;
  await settings.getByRole("button", { name: "Повторить загрузку" }).click();
  await expect(settings.getByRole("textbox")).toHaveCount(7);
  await expect(settings.getByRole("alert")).toHaveCount(0);
});

function penaltyMatch(simultaneous = false, unavailable = false) {
  const source = normalizeKhlEventDetail(JSON.parse(readFileSync(
    join(process.cwd(), "tests/fixtures/khl/shootout-901986.json"), "utf8"
  )));
  const normalized = {
    ...source, validation: { ...source.validation, ok: true, issues: [] },
    penaltyEvidence: { complete: !unavailable },
    penalties: [
      { ...source.penalties[0], segment: "P1" as const, elapsedSeconds: 299, durationMinutes: 2,
        teamSide: "home" as const, reason: "Подножка" },
      ...(simultaneous ? [{ ...source.penalties[0], segment: "P1" as const,
        elapsedSeconds: 299, durationMinutes: 2, teamSide: "away" as const, reason: "Задержка клюшкой" }] : []),
      { ...source.penalties[0], segment: "P1" as const, elapsedSeconds: 600, durationMinutes: 10,
        teamSide: "home" as const, reason: "Дисциплинарный штраф" },
      { ...source.penalties[0], segment: "P1" as const, elapsedSeconds: 800, durationMinutes: 20,
        teamSide: "away" as const, reason: "Дисциплинарный штраф до конца игры" },
      { ...source.penalties[0], segment: "P3" as const, elapsedSeconds: 3590, durationMinutes: 5,
        teamSide: "away" as const, reason: "Драка" },
      { ...source.penalties[0], segment: "OT1" as const, elapsedSeconds: 3700, durationMinutes: 2,
        teamSide: "home" as const, reason: "Толчок на борт" },
    ],
  };
  const protocol = { ...buildKhlMatchProtocolView(normalized), penaltyExtras: projectKhlPenaltyExtras(normalized) };
  const revision = { id: "test-revision", revisionNumber: 1, state: "VALIDATED",
    normalizedHash: "test-hash", validationIssues: [], createdAt: normalized.startsAt };
  const team = (side: "home" | "away") => ({
    ...normalized.teams[side], adminTeamId: null, adminBindingStatus: "UNMAPPED",
  });
  return {
    id: "test-match", khlGameId: "901986", stageId: "407", season: "2026/2027",
    startsAt: normalized.startsAt, status: "FINISHED", officialHomeScore: 3, officialAwayScore: 4,
    regulationHomeScore: 3, regulationAwayScore: 3, adminMatchId: null, adminBindingStatus: "UNMAPPED",
    homeTeam: team("home"), awayTeam: team("away"), activeRevision: revision, latestRevision: revision,
    displayRevision: { ...revision, source: "ACTIVE_VALIDATED" }, protocol,
    _count: { revisions: 1, participants: 44 },
  };
}

async function openResult(page: Page, match: ReturnType<typeof penaltyMatch>) {
  await mockOtherRequests(page, [match]);
  await page.goto("/results/khl");
  await page.getByTestId("khl-tab-archive").click();
  await page.getByTestId("khl-match-summary").click();
  await page.locator("summary").filter({ hasText: /^Штрафы ·/ }).click();
  await expect(page.getByTestId("khl-penalty-extras")).toBeVisible();
  return page.getByTestId("khl-penalty-extras");
}

test("penalty results show all seven calculated values and regulation event evidence", async ({ page }) => {
  const match = penaltyMatch();
  const results = await openResult(page, match);
  for (const extra of match.protocol.penaltyExtras.extras) {
    const row = results.getByTestId(`khl-penalty-result-${extra.code}`);
    await expect(row).toContainText(extra.label);
    await expect(row.getByTestId("khl-penalty-value")).toHaveText(extra.displayValue);
  }
  await expect(results).toContainText("Основное время: 60 минут");
  await expect(results).toContainText("00:00–04:59");
  await expect(results.getByTestId("khl-penalty-result-first_penalty_team")).toContainText("04:59");
  await expect(results.getByTestId("khl-penalty-result-first_penalty_team")).toContainText(match.homeTeam.name);
  await expect(results.getByTestId("khl-penalty-result-last_penalty_team")).toContainText("59:50");
  await expect(results).not.toContainText("61:40");
  await results.screenshot({ path: test.info().outputPath("penalty-results.png") });
});

test("simultaneous first penalties show ambiguity instead of choosing a team", async ({ page }) => {
  const results = await openResult(page, penaltyMatch(true));
  const firstTeam = results.getByTestId("khl-penalty-result-first_penalty_team");
  await expect(firstTeam.getByTestId("khl-penalty-value")).toHaveText("Обе команды одновременно");
  await expect(firstTeam).toContainText("однозначную команду определить нельзя");
  await expect(results.getByTestId("khl-penalty-result-first_two_minute_penalty_type"))
    .toContainText("Несколько видов одновременно");
});

test("an incomplete penalty protocol displays unavailable outcomes", async ({ page }) => {
  const results = await openResult(page, penaltyMatch(false, true));
  await expect(results).toContainText("Нет подтверждённого полного списка удалений.");
  await expect(results.getByTestId("khl-penalty-value")).toHaveText(Array(7).fill("Недоступно"));
});
