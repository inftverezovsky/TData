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

test("manual import keeps discipline select compact and shows OCR progress", async ({ page }) => {
  await page.route("**/api/admin-auth/session", async route => {
    await route.fulfill({ json: { authenticated: true } });
  });
  await page.route("**/api/manual-import/ocr", async route => {
    await route.fulfill({
      json: {
        ok: true,
        ocrText: "Team Liquid\nG2 Esports\n23 May, 16:10 | Table 1",
        ocrConfidence: 88,
        cached: false,
        warnings: [],
        variants: [{ name: "normalized", confidence: 88, matchesFound: 1 }],
      },
    });
  });
  await page.route("**/api/manual-import/parse", async route => {
    await route.fulfill({
      json: {
        ok: true,
        rawMatches: [
          {
            tournament: "Manual Import",
            team1: "Team Liquid",
            team2: "G2 Esports",
            date: "23.05.2026 16:10:00",
          },
        ],
        mappedMatches: [
          {
            id: "manual-1",
            tournament: "Manual Import",
            team1: { name: "Team Liquid", platformId: "111" },
            team2: { name: "G2 Esports", platformId: "222" },
            date: "23.05.2026 16:10:00",
            isReady: true,
          },
        ],
        normalizedText: "Team Liquid\nG2 Esports\n23 May, 16:10 | Table 1",
        ocrText: "Team Liquid\nG2 Esports\n23 May, 16:10 | Table 1",
        ocrConfidence: 88,
        parseSource: "local-ocr",
        warnings: [],
        fallback: true,
      },
    });
  });

  await page.goto("/manual-import");

  await expect(page.getByText("Дисциплина", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Дисциплина" })).toBeVisible();

  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
    name: "schedule.png",
    mimeType: "image/png",
    buffer: Buffer.from("fake-image"),
  });
  await page.getByRole("button", { name: /распознать/i }).click();

  await expect(page.getByText("Ход распознавания")).toBeVisible();
  await expect(page.getByText("OCR изображения")).toBeVisible();
  await expect(page.getByText(/Локальный OCR\. Найдено матчей: 1/)).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(1);
});

test("manual import automatically uses AI fallback after local OCR parse miss", async ({ page }) => {
  const parseBodies: string[] = [];

  await page.route("**/api/admin-auth/session", async route => {
    await route.fulfill({ json: { authenticated: true } });
  });
  await page.route("**/api/manual-import/ocr", async route => {
    await route.fulfill({
      json: {
        ok: true,
        ocrText: "messy OCR text that needs AI cleanup",
        ocrConfidence: 64,
        cached: false,
        warnings: [],
        variants: [{ name: "normalized", confidence: 64, matchesFound: 0 }],
      },
    });
  });
  await page.route("**/api/manual-import/parse", async route => {
    const body = route.request().postData() || "";
    parseBodies.push(body);

    if (parseBodies.length === 1) {
      await route.fulfill({
        status: 422,
        json: { ok: false, error: "Матчи не распознаны локальным парсером." },
      });
      return;
    }

    await route.fulfill({
      json: {
        ok: true,
        rawMatches: [
          {
            tournament: "Manual Import",
            team1: "NAVI",
            team2: "Vitality",
            date: "23.05.2026 18:00:00",
          },
        ],
        mappedMatches: [
          {
            id: "manual-ai-1",
            tournament: "Manual Import",
            team1: { name: "NAVI", platformId: "333" },
            team2: { name: "Vitality", platformId: "444" },
            date: "23.05.2026 18:00:00",
            isReady: true,
          },
        ],
        normalizedText: "NAVI vs Vitality 23.05.2026 18:00",
        ocrText: "messy OCR text that needs AI cleanup",
        ocrConfidence: 64,
        parseSource: "ai",
        warnings: [],
      },
    });
  });

  await page.goto("/manual-import");
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
    name: "messy-schedule.png",
    mimeType: "image/png",
    buffer: Buffer.from("fake-image"),
  });
  await page.getByRole("button", { name: /распознать/i }).click();

  await expect(page.getByText(/Отправляю OCR-текст в AI fallback автоматически/)).toBeVisible();
  await expect(page.getByText(/AI fallback\. Найдено матчей: 1/)).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  expect(parseBodies).toHaveLength(2);
  expect(parseBodies[0]).toContain('name="mode"');
  expect(parseBodies[0]).toContain("text");
  expect(parseBodies[1]).toContain('name="mode"');
  expect(parseBodies[1]).toContain("ai");
});
