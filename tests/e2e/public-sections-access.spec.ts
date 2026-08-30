import { expect, test } from "@playwright/test";

test("only the API settings section asks for the administrative password", async ({ page }) => {
  await page.route("**/api/admin-auth/session", (route) => route.fulfill({
    json: { authenticated: false },
  }));
  await page.route("**/api/tline/**", (route) => route.fulfill({
    status: 503,
    json: { ok: false, error: { code: "TEST_UNAVAILABLE", message: "Unavailable in access test." } },
  }));
  await page.route("**/api/results/khl/**", (route) => route.fulfill({
    status: 503,
    json: { error: "Unavailable in access test." },
  }));

  await page.goto("/tline/line");
  await expect(page.getByRole("button", { name: "Запустить проверку" })).toBeVisible();
  await expect(page.getByText("Доступ ограничен")).toHaveCount(0);

  await page.goto("/tline/settings");
  await expect(page.getByRole("heading", { name: "Настройки TLine" })).toBeVisible();
  await expect(page.getByText("Доступ ограничен")).toHaveCount(0);

  await page.goto("/results/khl");
  await expect(page.getByLabel("КХЛ: настройки или результаты")).toBeVisible();
  await expect(page.getByText("Доступ ограничен")).toHaveCount(0);

  await page.goto("/sandbox");
  await expect(page.getByRole("heading", { name: "Песочница TData." })).toBeVisible();
  await expect(page.getByText("Доступ ограничен")).toHaveCount(0);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Доступ ограничен" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Разблокировать" })).toBeVisible();
});
