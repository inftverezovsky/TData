import { expect, test } from "@playwright/test";

import type { TLineTeamMapping } from "../../frontend/src/components/tline/types";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/admin-auth/session", (route) => route.fulfill({ json: { authenticated: true } }));
  await page.route("**/api/tline/sports", (route) => route.fulfill({
    json: {
      ok: true,
      data: [{ id: "volleyball", slug: "volleyball", name: "Волейбол", active: true, autoEnabled: true }],
    },
  }));
  await page.route("**/api/tline/global-headers", (route) => route.fulfill({ json: { ok: true, data: [] } }));
  await page.route("**/api/tline/runs/latest**", (route) => route.fulfill({
    json: {
      ok: true,
      data: {
        id: "run-1",
        state: "SUCCEEDED",
        championships: [{
          id: "women",
          name: "Высшая лига А. Женщины",
          status: "OK",
          comparisons: [{
            id: "match-1",
            automaticStatus: "AUTO_OK",
            effectiveStatus: "AUTO_OK",
            source: { externalId: "123", startsAt: "2026-08-30T11:00:00.000Z", teamHome: "Динамо-Ак Барс", teamAway: "Локомотив" },
            admin: { externalId: "987", startsAt: "2026-08-30T11:00:00.000Z", teamHome: "Динамо-Ак Барс", teamAway: "Локомотив" },
          }],
        }],
      },
    },
  }));
  await page.route("**/api/tline/runs/active**", (route) => route.fulfill({ json: { ok: true, data: null } }));
  await page.route("**/api/tline/history**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/run-history")) {
      return route.fulfill({ json: { ok: true, data: {
        id: "run-history",
        state: "FAILED",
        championships: [{ id: "history-championship", name: "Исторический чемпионат", status: "PARSER_FAILED", comparisons: [] }],
      } } });
    }
    return route.fulfill({ json: { ok: true, data: [{
      id: "run-history",
      trigger: "MANUAL",
      state: "FAILED",
      periodFrom: "2026-08-20T00:00:00.000Z",
      periodTo: "2026-08-21T00:00:00.000Z",
      createdAt: "2026-08-21T01:00:00.000Z",
      includeUndatedSourceMatches: true,
      counts: { total: 1, processed: 1, error: 1, critical: 0 },
    }] } });
  });
  await page.route("**/api/tline/comparisons/*/decision", (route) => route.fulfill({ json: { ok: true, data: {} } }));
});

test("TLine renders the control surface and keeps state while help opens", async ({ page }) => {
  await page.goto("/tline");
  await expect(page).toHaveURL(/\/tline\/line$/);
  await expect(page.getByRole("link", { name: "TLine" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Запустить проверку" })).toBeVisible();
  await expect(page.getByText("Высшая лига А. Женщины")).toBeVisible();

  const search = page.getByPlaceholder("Поиск по чемпионатам, командам и ID...");
  await search.fill("Динамо");
  await page.getByRole("button", { name: "Инфо" }).click();
  await expect(page.getByRole("dialog", { name: "Справка TLine" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Как работает" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Справка TLine" })).toHaveCount(0);
  await expect(search).toHaveValue("Динамо");
  await expect(page.getByRole("button", { name: "Инфо" })).toBeFocused();

  await expect(page.getByText("Статусы", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/профиль/i)).toHaveCount(0);
});

test("manual run keeps the undated-match filter off by default and sends an explicit choice", async ({ page }) => {
  let requestBody: Record<string, unknown> | null = null;
  await page.route("**/api/tline/runs/manual", async (route) => {
    requestBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 202,
      json: {
        ok: true,
        data: {
          run: {
            id: "run-floorball",
            state: "QUEUED",
            includeUndatedSourceMatches: true,
            championships: [],
          },
          deduplicated: false,
        },
      },
    });
  });

  await page.goto("/tline/line");
  await page.getByRole("button", { name: "Фильтры" }).click();
  const filter = page.getByRole("checkbox", { name: "Включать матчи без даты" });
  await expect(filter).not.toBeChecked();
  await filter.check();
  await page.getByRole("button", { name: "Запустить проверку" }).click();
  await expect.poll(() => requestBody?.includeUndatedSourceMatches).toBe(true);
});

test("hockey pilot exposes the unpublished-stage diagnostic and fresh source metrics", async ({ page }) => {
  const hockeySport = { id: "hockey", slug: "hockey", name: "Хоккей", active: true, autoEnabled: false };
  await page.route("**/api/tline/sports", (route) => route.fulfill({ json: { ok: true, data: [hockeySport] } }));
  await page.route("**/api/tline/runs/latest**", (route) => route.fulfill({
    json: {
      ok: true,
      data: {
        id: "run-hockey",
        state: "PARTIAL",
        championships: [{
          id: "hockey-belarus",
          name: "Хоккей. Беларусь. Высшая лига",
          status: "PENDING",
          reasons: ["ADMIN_LINE_NOT_CONFIGURED", "SOURCE_STAGE_NOT_PUBLISHED"],
          comparisons: [],
        }],
      },
    },
  }));
  await page.route("**/api/tline/schedule", (route) => route.fulfill({
    json: { ok: true, data: { enabled: false, slots: ["08:00", "12:00", "16:00", "22:00"] } },
  }));

  await page.goto("/tline/line");
  await expect(page.getByRole("combobox", { name: "Вид спорта" })).toHaveValue("hockey");
  await expect(page.getByText("Хоккей. Беларусь. Высшая лига")).toBeVisible();
  await expect(page.getByText(/Официальные этапы сезона 2026\/27 ещё не опубликованы; товарищеские матчи исключены/)).toBeVisible();

  const championship = {
    id: "hockey-belarus",
    name: "Хоккей. Беларусь. Высшая лига",
    sportId: "hockey",
    sourceUrl: "https://hockey.by/calendar/",
    globalHeaderId: null,
    globalHeader: null,
    active: true,
    autoEnabled: false,
    allowedTimeDriftMinutes: null,
  };
  await page.route("**/api/tline/championships", (route) => route.fulfill({ json: { ok: true, data: [championship] } }));
  // Выбранный фиктивный чемпионат также загружает сопоставления: ни один запрос этой страницы не должен уходить в реальную БД.
  await page.route("**/api/tline/championships/hockey-belarus/team-mappings", (route) => route.fulfill({
    json: { ok: true, data: [] },
  }));
  await page.route("**/api/tline/admin-connection/status", (route) => route.fulfill({
    json: { ok: true, data: { configured: false, connected: false } },
  }));
  await page.route("**/api/tline/championships/hockey-belarus/test", (route) => route.fulfill({
    json: {
      ok: true,
      data: {
        teamCount: 15,
        matchCount: 20,
        eligibleMatchCount: 0,
        excludedMatchCount: 20,
        diagnostics: { reasonCodes: ["SOURCE_STAGE_NOT_PUBLISHED"] },
      },
    },
  }));

  await page.goto("/tline/settings");
  await expect(page.getByText("Команды источника ещё не синхронизированы.")).toBeVisible();
  await page.getByRole("button", { name: "Проверить источник" }).click();
  await expect(page.getByText(/Команд: 15\. Матчей найдено: 20, допущено: 0, исключено: 20/)).toBeVisible();
});

test("TLine settings exposes all operator sections", async ({ page }) => {
  let mapping: TLineTeamMapping = {
    id: "unmapped:source-1",
    sourceTeamId: "source-1",
    sourceTeamExternalId: "official-1",
    sourceTeamName: "Локомотив",
    adminTeamId: null,
    adminTeamPlatformId: null,
    adminTeamName: null,
    status: "UNMAPPED",
    matchMethod: null,
    inDirectory: false,
    locked: false,
    confidence: null,
  };
  const championship = { id: "champ-1", name: "Высшая лига А. Женщины", sportId: "volleyball", sourceUrl: "https://volley.ru/calendar/champ-1/allgames", globalHeaderId: "header-1", globalHeader: { id: "header-1", adminShapkaId: "833524", name: "Волейбол России", active: true }, active: true, autoEnabled: false, allowedTimeDriftMinutes: 2 };
  await page.route("**/api/tline/global-headers", (route) => route.fulfill({ json: { ok: true, data: [{ id: "header-1", sportId: "volleyball", sportName: "Волейбол", adminShapkaId: "833524", name: "Волейбол России", active: true, teamCount: 1, championships: [{ id: "champ-1", name: championship.name, active: true }] }] } }));
  await page.route("**/api/tline/championships", (route) => route.fulfill({ json: { ok: true, data: [championship] } }));
  await page.route("**/api/tline/championships/champ-1/admin-teams/import", (route) => route.fulfill({ json: { ok: true, data: { importedCount: 2, createdCount: 1, updatedCount: 1, membershipCount: 2 } } }));
  await page.route("**/api/tline/championships/champ-1/admin-teams?**", (route) => route.fulfill({ json: { ok: true, data: { items: [{ id: "admin-42", platformId: "42", name: "Локомотив", inDirectory: true }] } } }));
  await page.route("**/api/tline/championships/champ-1/team-mappings", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { ok: true, data: [mapping] } });
    const body = route.request().postDataJSON() as { platformId: string; adminName?: string };
    mapping = { ...mapping, id: "mapping-1", adminTeamId: "admin-manual", adminTeamPlatformId: body.platformId, adminTeamName: body.adminName || mapping.sourceTeamName, status: "MANUAL_MAPPED", matchMethod: "manual", locked: true };
    return route.fulfill({ json: { ok: true, data: mapping } });
  });
  await page.route("**/api/tline/team-mappings/mapping-1", async (route) => {
    if (route.request().method() === "DELETE") mapping = { ...mapping, adminTeamId: null, adminTeamPlatformId: null, adminTeamName: null, status: "MANUAL_UNMAPPED", matchMethod: "manual_unmapped", locked: true };
    else if ((route.request().postDataJSON() as { locked?: boolean }).locked === false) mapping = { ...mapping, status: "UNMAPPED", matchMethod: null, locked: false };
    return route.fulfill({ json: { ok: true, data: mapping } });
  });
  await page.route("**/api/tline/schedule", (route) => route.fulfill({ json: { ok: true, data: { enabled: false, slots: ["08:00", "12:00", "16:00", "22:00"] } } }));
  await page.route("**/api/tline/admin-connection/status", (route) => route.fulfill({ json: { ok: true, data: { configured: false, connected: false } } }));

  await page.goto("/tline/settings");
  await expect(page.getByRole("heading", { name: "Настройки TLine" })).toBeVisible();
  for (const label of ["Виды спорта", "Глобальные шапки", "Чемпионаты", "Справочник команд Админа", "Маппинг команд", "Автопроверка", "Подключение к Admin"]) {
    await expect(page.getByRole("heading", { name: label })).toBeVisible();
  }
  await page.getByRole("button", { name: "Редактировать" }).last().click();
  await page.getByPlaceholder("Положительный Team ID").fill("987654");
  await page.getByPlaceholder("Название Admin").fill("Локо вручную");
  const mappingTable = page.locator("table");
  await mappingTable.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByText("Вне справочника")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await mappingTable.getByRole("button", { name: "Очистить" }).click();
  await expect(page.getByText("MANUAL_UNMAPPED", { exact: true })).toBeVisible();
  await mappingTable.getByRole("button", { name: "Снять блокировку" }).click();
  await expect(page.getByText("UNMAPPED", { exact: true })).toBeVisible();
});

test("TLine opens saved history and exposes manual decisions from the status", async ({ page }) => {
  await page.goto("/tline/line");
  await page.getByRole("button", { name: "История запусков" }).click();
  await expect(page.getByText("Матчи без даты: включены")).toBeVisible();
  await page.getByRole("button", { name: /Ручной.*Ошибка/ }).click();
  await expect(page.getByText("Исторический чемпионат")).toBeVisible();
  await page.getByRole("button", { name: "Вернуться к последнему", exact: true }).click();
  await expect(page.getByText("Высшая лига А. Женщины")).toBeVisible();

  await page.locator('summary[aria-label^="ok:"]').click();
  await expect(page.getByRole("button", { name: "Подтвердить OK вручную" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Отметить ошибкой вручную" })).toBeVisible();
});
