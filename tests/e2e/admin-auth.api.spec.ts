import { expect, test } from "@playwright/test";

test("real settings login persists its HTTP-only session across a browser reload", async ({ page, context }) => {
  // Здесь нет route mocks: браузер, Origin, cookie и БД проходят настоящий authentication flow.
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: /доступ ограничен/i })).toBeVisible();
  await page.getByPlaceholder("Пароль...").fill("63016");
  const loginResponse = page.waitForResponse((response) => response.url().endsWith("/api/admin-auth/login"));
  await page.getByRole("button", { name: /разблокировать/i }).click();
  expect((await loginResponse).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Настройки TData.", exact: true })).toBeVisible();
  const hasHttpOnlyCookie = (await context.cookies()).some((cookie) => cookie.name === "tdata_admin_session" && cookie.httpOnly);
  expect(hasHttpOnlyCookie).toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Настройки TData.", exact: true })).toBeVisible();
  const authenticated = await page.evaluate(async () => {
    const response = await fetch("/api/admin-auth/session");
    const body = await response.json() as { authenticated?: boolean };
    return response.ok && body.authenticated === true;
  });
  expect(authenticated).toBe(true);
});

test("admin auth protects settings endpoints and creates a usable session cookie", async ({ request, baseURL }) => {
  const protectedRequests = [
    () => request.get("/api/settings/global"),
    () => request.post("/api/settings/global"),
    () => request.get("/api/settings"),
    () => request.post("/api/settings"),
    () => request.get("/api/admin/proxies"),
    () => request.get("/api/admin/health"),
    () => request.post("/api/admin/sandbox"),
    () => request.get("/api/admin-settings/counterstrike"),
    () => request.post("/api/admin-settings/counterstrike"),
    () => request.get("/api/admin-settings/proxy-pool"),
    () => request.post("/api/admin-settings/proxy-pool"),
    () => request.delete("/api/admin-settings/proxy-pool?id=example"),
    () => request.get("/api/admin-settings/identity-sync"),
    () => request.post("/api/admin-settings/identity-sync"),
    () => request.get("/api/cron/check-proxies"),
    () => request.post("/api/manual-import/send"),
    () => request.post("/api/sync-matches"),
    () => request.post("/api/counterstrike/hltv/admin-send"),
    () => request.post("/api/dota2/tournament/fixture/admin-fixt-send"),
  ];

  for (const makeRequest of protectedRequests) {
    const response = await makeRequest();
    expect(response.status()).toBe(401);
  }

  const publicSuggestValidation = await request.get("/api/admin-teams/suggest?q=test");
  expect(publicSuggestValidation.status()).toBe(400);

  const publicHltvSearchValidation = await request.get("/api/counterstrike/search-hltv?force=true");
  expect(publicHltvSearchValidation.status()).toBe(400);

  const publicTeamMapping = await request.get("/api/team-mapping?discipline=counterstrike");
  expect(publicTeamMapping.status()).not.toBe(401);

  const publicCacheClearValidation = await request.post("/api/settings/clear-search-cache", {
    data: { source: "hltv", disciplineSlug: "../counterstrike" },
  });
  expect(publicCacheClearValidation.status()).toBe(400);

  const publicImportValidation = await request.post("/api/counterstrike/import-tournament", {
    data: { title: "" },
  });
  expect(publicImportValidation.status()).not.toBe(401);

  const publicSearchValidation = await request.post("/api/dota2/search-tournament", {
    data: { query: "" },
  });
  expect(publicSearchValidation.status()).not.toBe(401);

  const badLogin = await request.post("/api/admin-auth/login", {
    headers: { origin: baseURL! },
    data: { password: "wrong-password" },
  });
  expect(badLogin.status()).toBe(401);

  const login = await request.post("/api/admin-auth/login", {
    headers: { origin: baseURL! },
    data: { password: "63016" },
  });
  expect(login.status()).toBe(200);

  const setCookie = login.headers()["set-cookie"];
  expect(setCookie).toContain("tdata_admin_session=");

  const cookie = setCookie.split(";")[0];
  const session = await request.get("/api/admin-auth/session", {
    headers: { cookie },
  });
  await expect(session).toBeOK();
  await expect(await session.json()).toMatchObject({ authenticated: true });

  const settings = await request.get("/api/settings/global", {
    headers: { cookie },
  });
  await expect(settings).toBeOK();

  const proxies = await request.get("/api/admin/proxies", {
    headers: { cookie },
  });
  await expect(proxies).toBeOK();
});
