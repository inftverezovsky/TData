import { expect, test } from "@playwright/test";

test("home page exposes discipline navigation", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /оперативная панель tcyber/i })).toBeVisible();

  for (const slug of ["dota2", "counterstrike", "leagueoflegends", "valorant"]) {
    await expect(page.locator(`a[href="/${slug}"]`).first()).toBeVisible();
  }
});

test("settings password gate rejects bad password and unlocks with configured password", async ({ page }) => {
  await page.route("**/api/admin-auth/session", async route => {
    await route.fulfill({ json: { authenticated: false } });
  });
  await page.route("**/api/admin-auth/login", async route => {
    const body = route.request().postDataJSON() as { password?: string };
    await route.fulfill({
      status: body.password === "63016" ? 200 : 401,
      json: body.password === "63016" ? { ok: true } : { error: "Unauthorized" },
    });
  });
  await page.route("**/api/settings/global", async route => {
    await route.fulfill({ json: {} });
  });
  await page.route("**/api/admin/proxies", async route => {
    await route.fulfill({ json: { proxies: [] } });
  });

  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: /доступ ограничен/i })).toBeVisible();

  await page.getByPlaceholder("Пароль...").fill("wrong-password");
  await page.getByRole("button", { name: /разблокировать/i }).click();
  await expect(page.getByText(/неверный пароль/i)).toBeVisible();

  await page.getByPlaceholder("Пароль...").fill("63016");
  await page.getByRole("button", { name: /разблокировать/i }).click();

  await expect(page.getByRole("heading", { name: /настройки/i })).toBeVisible();
  await page.getByRole("button", { name: /параметры api и заливки/i }).click();
  await expect(page.getByRole("heading", { name: /параметры liquipedia/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /параметры заливки/i })).toBeVisible();

  await page.getByRole("button", { name: /менеджер прокси-пула/i }).click();
  await expect(page.getByText(/пул пуст/i)).toBeVisible();
  await expect(page.getByText("Прокси-хост", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Порт", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Логин", { exact: true })).toHaveCount(0);
});
