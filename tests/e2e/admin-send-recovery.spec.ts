import { expect, test } from "@playwright/test";

for (const finish of ["login", "cancel"] as const) {
  test(`manual send ${finish}: preserves selected data through the administrator gate`, async ({ page }) => {
    const sentBodies: unknown[] = [];
    let loginAttempts = 0;
    await page.route("**/api/manual-import/preview", (route) => route.fulfill({ json: {
      phpArray: [{ shapka: 777, sport: 73, max: 1, match: [{ date: "07.09.2026 18:00:00", team1: 111, team2: 222 }] }],
      phpArrayText: "array()", serialized: "fixture", postBody: "fixt=fixture", readyMatchesCount: 1, skippedMatches: [], warnings: [], mappedMatches: [],
    } }));
    await page.route("**/api/manual-import/send", (route) => {
      sentBodies.push(route.request().postDataJSON());
      return route.fulfill(sentBodies.length === 1
        ? { status: 401, json: { ok: false, error: "Unauthorized", code: "AUTH_REQUIRED" } }
        : { json: { ok: true, status: 200, rawResponse: "accepted" } });
    });
    await page.route("**/api/admin-auth/login", (route) => {
      loginAttempts += 1;
      return route.fulfill(loginAttempts === 1
        ? { status: 429, headers: { "Retry-After": "30" }, json: { error: "Rate limited" } }
        : { json: { ok: true } });
    });
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto("/manual-import");
    await expect(async () => {
      await page.getByRole("button", { name: "Ссылка", exact: true }).click();
      await expect(page.getByPlaceholder("https://docs.google.com/spreadsheets/...")).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    await page.getByLabel("Шаг 1 · ID дисциплины").fill("73");
    await page.getByLabel("Шаг 2 · ID шапки").fill("777");
    await page.getByRole("button", { name: "Добавить матч", exact: true }).click();
    await page.getByLabel("Дата, матч 1", { exact: true }).fill("07.09.2026 18:00:00");
    await page.getByLabel("Команда 1, матч 1", { exact: true }).fill("Alpha");
    await page.getByLabel("Команда 2, матч 1", { exact: true }).fill("Beta");
    await page.getByLabel("ID команды 1, матч 1", { exact: true }).fill("111");
    await page.getByLabel("ID команды 2, матч 1", { exact: true }).fill("222");
    await page.getByRole("button", { name: "Сформировать (1)", exact: true }).click();
    await page.getByRole("button", { name: "Залить в API", exact: true }).click();

    const gate = page.getByRole("dialog", { name: "Вход для отправки" });
    await expect(gate).toBeVisible();
    await expect(gate.getByLabel("Пароль администратора")).toBeFocused();
    expect(sentBodies).toHaveLength(1);
    if (finish === "login") {
      await gate.getByLabel("Пароль администратора").fill("test-only-password");
      await gate.getByRole("button", { name: "Войти и продолжить" }).click();
      await expect(gate.getByRole("alert")).toHaveText("Слишком много попыток. Повторите через 30 сек.");
      expect(sentBodies).toHaveLength(1);
      await gate.getByRole("button", { name: "Войти и продолжить" }).click();
      await expect(page.getByText("Данные успешно залиты. Статус: 200", { exact: true })).toBeVisible();
      expect(sentBodies).toHaveLength(2);
      expect(sentBodies[1]).toEqual(sentBodies[0]);
    } else {
      await gate.press("Escape");
      await expect(page.getByRole("button", { name: "Залить в API", exact: true })).toBeEnabled();
      expect(sentBodies).toHaveLength(1);
      expect(loginAttempts).toBe(0);
    }
    await expect(gate).not.toBeVisible();
    await expect(page.getByLabel("Команда 1, матч 1", { exact: true })).toHaveValue("Alpha");
  });
}
