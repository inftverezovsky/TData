import { expect, test } from "@playwright/test";

for (const settings of [
  { panel: /^TableT\s/, key: "tablet_wtt_default_days" },
  { panel: /^TBvolley\s/, key: "tbvolley_default_days" },
]) {
  test(`${settings.key}: failed save keeps edited values until a confirmed retry`, async ({ page }) => {
    let saveAttempts = 0;
    await page.route("**/api/admin-auth/session", (route) => route.fulfill({ json: { authenticated: true } }));
    await page.route("**/api/settings/global", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: { [settings.key]: "14" } });
        return;
      }
      saveAttempts += 1;
      expect(route.request().postDataJSON()[settings.key]).toBe("21");
      await route.fulfill(saveAttempts === 1
        ? { status: 401, json: { error: "Сессия истекла. Повторите сохранение." } }
        : { json: { ok: true } });
    });

    await page.goto("/settings");
    await page.getByRole("button", { name: settings.panel }).click();
    await page.getByRole("button", { name: "Изменить", exact: true }).first().click();
    const field = page.locator(`input[name="${settings.key}"]`);
    await field.fill("21");
    await page.getByRole("button", { name: "Сохранить", exact: true }).first().click();

    // У Next.js есть собственный route announcer с role="alert"; выбираем сообщение именно этого запроса.
    const saveError = page.getByRole("alert").filter({ hasText: "Сессия истекла. Повторите сохранение." });
    await expect(saveError).toBeVisible();
    await expect(field).toHaveValue("21");
    await page.getByRole("button", { name: "Сохранить", exact: true }).first().click();
    await expect(field).toHaveCount(0);
    await expect(saveError).toHaveCount(0);
    expect(saveAttempts).toBe(2);
  });
}

test("settings retry restores server values after a failed load", async ({ page }) => {
  let serverRecovered = false;
  await page.route("**/api/admin-auth/session", (route) => route.fulfill({ json: { authenticated: true } }));
  await page.route("**/api/settings/global", async (route) => {
    // В dev StrictMode может повторить начальную загрузку: сервер восстанавливается только перед ручным retry.
    await route.fulfill(!serverRecovered
      ? { status: 503, json: { error: "Настройки временно недоступны" } }
      : { json: { tablet_wtt_default_days: "9" } });
  });

  await page.goto("/settings");
  await page.getByRole("button", { name: /^TableT\s/ }).click();
  const loadError = page.getByRole("alert").filter({ hasText: "Настройки временно недоступны" });
  await expect(loadError).toBeVisible();
  await expect(page.getByRole("button", { name: "Изменить", exact: true })).toHaveCount(0);
  serverRecovered = true;
  await page.getByRole("button", { name: "Повторить загрузку настроек" }).click();
  await page.getByRole("button", { name: "Изменить", exact: true }).first().click();
  await expect(page.locator('input[name="tablet_wtt_default_days"]')).toHaveValue("9");
  await expect(loadError).toHaveCount(0);
});

test("manual import queues one preview for repeated screenshot content in a single batch", async ({ page }, testInfo) => {
  await page.route("**/api/admin-auth/session", (route) => route.fulfill({ json: { authenticated: true } }));
  await page.goto("/manual-import");
  // Серверная разметка появляется до гидратации. Идемпотентное действие подтверждает готовность React-обработчиков.
  await expect(async () => {
    await page.getByRole("button", { name: "Ссылка", exact: true }).click();
    await expect(page.getByPlaceholder("https://docs.google.com/spreadsheets/...")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  const screenshot = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWPwd3uKFTEMLQkAx2RegfGP+TAAAAAASUVORK5CYII=",
    "base64",
  );
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles([
    { name: "first.png", mimeType: "image/png", buffer: screenshot },
    { name: "duplicate.png", mimeType: "image/png", buffer: screenshot },
  ]);
  await expect(page.getByRole("button", { name: /Удалить скрин/ })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Удалить скрин first.png" })).toBeVisible();
  await expect(page.getByText(/Добавлено скринов: 1\..*дубликатов: 1/)).toBeVisible();
  // Проверяем вычисленные цвета: глобальные стили не должны превращать белый текст payload в белый-на-белом.
  const payloadHeading = page.getByRole("heading", { name: "Данные для заливки", exact: true });
  const payloadPanel = page.locator('section[data-panel-theme="dark"]').filter({ has: payloadHeading });
  await expect(payloadPanel).toHaveCSS("background-color", "rgb(2, 6, 23)");
  await expect(payloadHeading).toHaveCSS("color", "rgb(255, 255, 255)");
  await page.screenshot({ path: testInfo.outputPath("manual-import-queue.png"), fullPage: true });
});
