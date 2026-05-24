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

test("manual import hides discipline selector and uses AI-first image recognition", async ({ page }) => {
  const parseBodies: string[] = [];
  let ocrCalled = false;

  await page.route("**/api/admin-auth/session", async route => {
    await route.fulfill({ json: { authenticated: true } });
  });
  await page.route("**/api/manual-import/ocr", async route => {
    ocrCalled = true;
    await route.fulfill({ status: 500, json: { ok: false, error: "OCR should not be called on AI success" } });
  });
  await page.route("**/api/manual-import/parse", async route => {
    parseBodies.push(route.request().postData() || "");
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
        ocrText: "",
        ocrConfidence: null,
        parseSource: "ai",
        warnings: [],
      },
    });
  });

  await page.goto("/manual-import");

  await expect(page.getByText("Дисциплина", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Дисциплина" })).toHaveCount(0);

  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
    name: "schedule.png",
    mimeType: "image/png",
    buffer: Buffer.from("fake-image"),
  });
  await page.getByRole("button", { name: /распознать/i }).click();

  await expect(page.getByText("Ход распознавания")).toBeVisible();
  await expect(page.getByText("AI распознавание")).toBeVisible();
  await expect(page.getByText("OCR изображения")).toHaveCount(0);
  await expect(page.getByText(/ArcCodex AI\. Найдено матчей: 1/)).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByRole("checkbox", { name: /выбрать все матчи/i })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /выбрать матч team liquid против g2 esports/i })).toBeChecked();
  await expect(page.getByRole("button", { name: /сформировать \(1\)/i })).toBeEnabled();
  expect(ocrCalled).toBe(false);
  expect(parseBodies).toHaveLength(1);
  expect(parseBodies[0]).toContain('name="mode"');
  expect(parseBodies[0]).toContain("ai");
  expect(parseBodies[0]).toContain('name="fast"');
  expect(parseBodies[0]).toContain("true");
  expect(parseBodies[0]).toContain('name="disciplineId"');
  expect(parseBodies[0]).not.toContain('name="disciplineSlug"');
});

test("manual import shows manual OCR fallback when AI image recognition fails", async ({ page }) => {
  const parseBodies: string[] = [];
  let ocrCalls = 0;

  await page.route("**/api/admin-auth/session", async route => {
    await route.fulfill({ json: { authenticated: true } });
  });
  await page.route("**/api/manual-import/ocr", async route => {
    ocrCalls += 1;
    await route.fulfill({
      json: {
        ok: true,
        ocrText: "NAVI\nVitality\n23 May, 18:00 | Table 1",
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
        json: { ok: false, error: "ArcCodex AI не вернул матчи." },
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
        normalizedText: "NAVI\nVitality\n23 May, 18:00 | Table 1",
        ocrText: "NAVI\nVitality\n23 May, 18:00 | Table 1",
        ocrConfidence: 64,
        parseSource: "local-text",
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

  await expect(page.getByText(/OCR fallback можно запустить вручную/)).toBeVisible();
  await expect(page.getByRole("button", { name: /запустить ocr fallback/i })).toBeVisible();
  await expect(page.getByText("OCR изображения")).toHaveCount(0);
  expect(ocrCalls).toBe(0);
  expect(parseBodies).toHaveLength(1);
  expect(parseBodies[0]).toContain('name="mode"');
  expect(parseBodies[0]).toContain("ai");
  expect(parseBodies[0]).toContain('name="fast"');

  await page.getByRole("button", { name: /запустить ocr fallback/i }).click();

  await expect(page.getByText("OCR изображения")).toBeVisible();
  await expect(page.getByText(/Локальный OCR\. Найдено матчей: 1/)).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  expect(ocrCalls).toBe(1);
  expect(parseBodies).toHaveLength(2);
  expect(parseBodies[0]).toContain('name="mode"');
  expect(parseBodies[0]).toContain("ai");
  expect(parseBodies[1]).toContain('name="mode"');
  expect(parseBodies[1]).toContain("text");
});

test("manual import text-only recognition does not call OCR", async ({ page }) => {
  const parseBodies: string[] = [];
  let ocrCalled = false;

  await page.route("**/api/admin-auth/session", async route => {
    await route.fulfill({ json: { authenticated: true } });
  });
  await page.route("**/api/manual-import/ocr", async route => {
    ocrCalled = true;
    await route.fulfill({ status: 500, json: { ok: false, error: "OCR should not be called for text-only parse" } });
  });
  await page.route("**/api/manual-import/parse", async route => {
    parseBodies.push(route.request().postData() || "");
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
            id: "manual-text-1",
            tournament: "Manual Import",
            team1: { name: "Team Liquid", platformId: "111" },
            team2: { name: "G2 Esports", platformId: "222" },
            date: "23.05.2026 16:10:00",
            isReady: true,
          },
        ],
        normalizedText: "Team Liquid\nG2 Esports\n23 May, 16:10 | Table 1",
        ocrText: "",
        ocrConfidence: null,
        parseSource: "local-text",
        warnings: [],
      },
    });
  });

  await page.goto("/manual-import");
  await page.getByPlaceholder("Вставьте текст расписания или OCR...").fill("Team Liquid\nG2 Esports\n23 May, 16:10 | Table 1");
  await page.getByRole("button", { name: /распознать/i }).click();

  await expect(page.getByText(/Локальный парсер текста\. Найдено матчей: 1/)).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  expect(ocrCalled).toBe(false);
  expect(parseBodies).toHaveLength(1);
  expect(parseBodies[0]).toContain('name="mode"');
  expect(parseBodies[0]).toContain("text");
});

test("manual import can cancel an in-flight AI recognition request", async ({ page }) => {
  await page.route("**/api/admin-auth/session", async route => {
    await route.fulfill({ json: { authenticated: true } });
  });
  await page.route("**/api/manual-import/parse", async route => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.fulfill({ status: 499, json: { ok: false, error: "cancelled" } }).catch(() => undefined);
  });

  await page.goto("/manual-import");
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
    name: "slow-schedule.png",
    mimeType: "image/png",
    buffer: Buffer.from("fake-image"),
  });
  await page.getByRole("button", { name: /распознать/i }).click();

  await expect(page.getByRole("button", { name: /отменить/i })).toBeVisible();
  await page.getByRole("button", { name: /отменить/i }).click();

  await expect(page.getByText("Распознавание отменено.").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /распознать/i })).toBeEnabled();
});

test("manual import service upload sends only selected matches and opens popup", async ({ page }) => {
  let serviceRequestBody: any = null;

  await page.route("**/api/admin-auth/session", async route => {
    await route.fulfill({ json: { authenticated: true } });
  });
  await page.route("**/api/manual-import/parse", async route => {
    await route.fulfill({
      json: {
        ok: true,
        rawMatches: [
          {
            tournament: "Manual Import",
            team1: "Team Alpha",
            team2: "Team Beta",
            date: "24.05.2026 11:50:00",
          },
          {
            tournament: "Manual Import",
            team1: "Team Gamma",
            team2: "Team Delta",
            date: "24.05.2026 12:50:00",
          },
        ],
        mappedMatches: [
          {
            id: "manual-service-1",
            tournament: "Manual Import",
            team1: { name: "Team Alpha", platformId: "101" },
            team2: { name: "Team Beta", platformId: "202" },
            date: "24.05.2026 11:50:00",
            isReady: true,
          },
          {
            id: "manual-service-2",
            tournament: "Manual Import",
            team1: { name: "Team Gamma", platformId: "303" },
            team2: { name: "Team Delta", platformId: "404" },
            date: "24.05.2026 12:50:00",
            isReady: true,
          },
        ],
        normalizedText: "Team Alpha vs Team Beta\nTeam Gamma vs Team Delta",
        ocrText: "",
        ocrConfidence: null,
        parseSource: "local-text",
        warnings: [],
      },
    });
  });
  await page.route("**/api/manual-import/service-link", async route => {
    serviceRequestBody = route.request().postDataJSON();
    await route.fulfill({
      json: {
        ok: true,
        jsonUrl: "http://localhost/api/manual-import/json/test-token",
        serviceUrl: "about:blank#manual-service-upload",
        readyMatchesCount: 1,
      },
    });
  });

  await page.goto("/manual-import");
  await page.getByPlaceholder("12345").fill("777");
  await page.getByPlaceholder("Вставьте текст расписания или OCR...").fill("Team Alpha vs Team Beta\nTeam Gamma vs Team Delta");
  await page.getByRole("button", { name: /распознать/i }).click();

  await expect(page.locator("tbody tr")).toHaveCount(2);
  await expect(page.getByRole("checkbox", { name: /выбрать все матчи/i })).toBeChecked();
  await page.getByRole("checkbox", { name: /выбрать матч team gamma против team delta/i }).uncheck();

  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: /залить через сервис/i }).click();
  await popupPromise;

  await expect.poll(() => serviceRequestBody?.matches?.length).toBe(1);
  await expect(page.getByText("JSON-ссылка для сервиса")).toBeVisible();
  await expect(page.locator('input[readonly][value="http://localhost/api/manual-import/json/test-token"]')).toBeVisible();
  expect(serviceRequestBody.matches[0].team1).toBe("Team Alpha");
  expect(serviceRequestBody.matches[0].team2).toBe("Team Beta");
});
