import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/admin-auth/session", (route) => route.fulfill({ json: { authenticated: true } }));
});

test("TLine refuses to overwrite an unavailable schedule with defaults", async ({ page }) => {
  let scheduleAvailable = false;
  let writes = 0;
  await page.route("**/api/tline/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/schedule")) {
      if (route.request().method() === "PATCH") {
        writes += 1;
        return route.fulfill({ json: { ok: true, data: {} } });
      }
      return route.fulfill(
        scheduleAvailable
          ? { json: { ok: true, data: { enabled: true, slots: ["11:00"], nextRunAt: null } } }
          : { status: 503, json: { ok: false, error: { message: "Расписание временно недоступно" } } },
      );
    }
    return route.fulfill({
      json: { ok: true, data: path.endsWith("/status") ? { configured: false, connected: false } : [] },
    });
  });
  await page.goto("/tline/settings");
  await expect(page.getByRole("alert").filter({ hasText: "Расписание временно недоступно" })).toBeVisible();
  const section = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Автопроверка", exact: true }) });
  await expect(section.getByRole("button", { name: "Сохранить", exact: true })).toBeDisabled();
  expect(writes).toBe(0);
  scheduleAvailable = true;
  await page.getByRole("button", { name: "Повторить загрузку" }).click();
  await expect(section.getByRole("button", { name: "Сохранить", exact: true })).toBeEnabled();
  await expect(section.getByRole("checkbox", { name: "Включена", exact: true })).toBeChecked();
  expect(writes).toBe(0);
});

test("TLine preserves sport drafts across failed saves and catalogue refreshes", async ({ page }) => {
  let saveFails = true;
  let extraSport = false;
  const sport = {
    id: "s1",
    name: "Волейбол",
    slug: "volleyball",
    adminSportId: "10",
    active: true,
    autoEnabled: false,
  };
  await page.route("**/api/tline/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/sports/s1")) {
      if (saveFails)
        return route.fulfill({ status: 500, json: { ok: false, error: { message: "Ошибка сохранения спорта" } } });
      Object.assign(sport, route.request().postDataJSON());
      return route.fulfill({ json: { ok: true, data: sport } });
    }
    if (path.endsWith("/sports")) {
      if (route.request().method() === "POST") extraSport = true;
      return route.fulfill({
        json: {
          ok: true,
          data: [sport, ...(extraSport ? [{ id: "s2", name: "Хоккей", slug: "hockey", active: true }] : [])],
        },
      });
    }
    const data = path.endsWith("/schedule")
      ? { enabled: false, slots: [], nextRunAt: null }
      : path.endsWith("/status")
        ? { configured: false, connected: false }
        : [];
    return route.fulfill({ json: { ok: true, data } });
  });
  await page.goto("/tline/settings");
  const section = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Виды спорта", exact: true }) });
  await section.getByText("Параметры проверки", { exact: true }).click();
  const editor = section.locator("details").first();
  await editor.getByLabel("Admin Sport ID", { exact: true }).fill("77");
  await editor.getByRole("button", { name: "Сохранить спорт", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Ошибка сохранения спорта" })).toBeVisible();
  await expect(editor.getByLabel("Admin Sport ID", { exact: true })).toHaveValue("77");
  const create = section.locator("form").filter({ has: page.getByRole("button", { name: "Добавить", exact: true }) });
  await create.getByLabel("Название", { exact: true }).fill("Хоккей");
  await create.getByLabel("Slug", { exact: true }).fill("hockey");
  await create.getByRole("button", { name: "Добавить", exact: true }).click();
  await expect(section.getByText("Хоккей", { exact: true })).toBeVisible();
  await expect(editor.getByLabel("Admin Sport ID", { exact: true })).toHaveValue("77");
  saveFails = false;
  await editor.getByRole("button", { name: "Сохранить спорт", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Параметры вида спорта сохранены." })).toBeVisible();
  expect(sport.adminSportId).toBe("77");
});

test("TLine retains header edits on save failure and exposes failed settings loads", async ({ page }) => {
  let loadFailed = true;
  let saveFailed = true;
  const header = {
    id: "h1",
    sportId: "s1",
    sportName: "Волейбол",
    adminShapkaId: "42",
    name: "Исходная шапка",
    active: true,
    teamCount: 0,
    championships: [],
  };
  await page.route("**/api/admin-auth/session", (route) => route.fulfill({ json: { authenticated: true } }));
  await page.route("**/api/tline/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/global-headers/h1")) {
      if (saveFailed)
        return route.fulfill({ status: 500, json: { ok: false, error: { message: "Не удалось сохранить шапку" } } });
      Object.assign(header, route.request().postDataJSON());
      return route.fulfill({ json: { ok: true, data: header } });
    }
    if (path.endsWith("/sports") && loadFailed)
      return route.fulfill({ status: 503, json: { ok: false, error: { message: "Справочник временно недоступен" } } });
    const data = path.endsWith("/sports")
      ? [{ id: "s1", name: "Волейбол", slug: "volleyball" }]
      : path.endsWith("/global-headers")
        ? [header]
        : path.endsWith("/schedule")
          ? { enabled: false, slots: [], nextRunAt: null }
          : path.endsWith("/status")
            ? { configured: false, connected: false }
            : [];
    return route.fulfill({ json: { ok: true, data } });
  });
  await page.goto("/tline/settings");
  await expect(page.getByRole("alert").filter({ hasText: "Справочник временно недоступен" })).toBeVisible();
  loadFailed = false;
  await page.getByRole("button", { name: "Повторить загрузку" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Справочник временно недоступен" })).toHaveCount(0);
  const section = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Глобальные шапки", exact: true }) });
  await section.getByRole("button", { name: "Редактировать", exact: true }).click();
  const editor = section.locator("form").filter({ has: page.getByRole("button", { name: "Сохранить", exact: true }) });
  const name = editor.getByLabel("Название", { exact: true });
  await name.fill("Исправленная шапка");
  await section.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Не удалось сохранить шапку" })).toBeVisible();
  await expect(name).toHaveValue("Исправленная шапка");
  saveFailed = false;
  await section.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(section.getByText("Исправленная шапка", { exact: true })).toBeVisible();
  await expect(section.getByRole("button", { name: "Отмена", exact: true })).toHaveCount(0);
});
