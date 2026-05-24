import { expect, test } from "@playwright/test";

test("admin auth protects settings endpoints and creates a usable session cookie", async ({ request }) => {
  const protectedRequests = [
    () => request.get("/api/settings/global"),
    () => request.post("/api/settings/global"),
    () => request.get("/api/settings"),
    () => request.post("/api/settings"),
    () => request.post("/api/settings/clear-search-cache"),
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
    () => request.post("/api/counterstrike/tournament/example/admin-fixt-preview"),
    () => request.post("/api/counterstrike/tournament/example/admin-fixt-send"),
    () => request.post("/api/counterstrike/tournament/example/admin-fixt-mark-uploaded"),
    () => request.post("/api/counterstrike/hltv/admin-send"),
    () => request.post("/api/counterstrike/hltv/matches/manual"),
    () => request.get("/api/counterstrike/search-hltv?query=test&force=true"),
    () => request.get("/api/counterstrike/hltv/events?force=true"),
    () => request.get("/api/counterstrike/hltv/matches?force=true"),
    () => request.get("/api/counterstrike/hltv/health?force=true"),
    () => request.get("/api/counterstrike/portal?t=1"),
    () => request.post("/api/sync-matches"),
    () => request.get("/api/cron/check-proxies"),
    () => request.get("/api/team-mapping"),
    () => request.post("/api/team-mapping"),
    () => request.delete("/api/team-mapping?name=Example&discipline=counterstrike"),
    () => request.post("/api/team-mapping/auto"),
    () => request.post("/api/team-mapping/fuzzy"),
    () => request.post("/api/counterstrike/tournament/example/admin-mapping"),
    () => request.post("/api/counterstrike/tournament/example/platform-id"),
    () => request.get("/api/disciplines/counterstrike/platform-id"),
    () => request.post("/api/disciplines/counterstrike/platform-id"),
    () => request.get("/api/counterstrike/tournament/example/raw"),
    () => request.get("/api/counterstrike/tournament/example/upload-history"),
    () => request.get("/api/imports"),
    () => request.post("/api/dota2/search-tournament", { data: { query: "test", force: true } }),
  ];

  for (const makeRequest of protectedRequests) {
    const response = await makeRequest();
    expect(response.status()).toBe(401);
  }

  const publicSuggestValidation = await request.get("/api/admin-teams/suggest?q=test");
  expect(publicSuggestValidation.status()).toBe(400);

  const publicImportValidation = await request.post("/api/counterstrike/import-tournament", {
    data: { title: "" },
  });
  expect(publicImportValidation.status()).toBe(400);

  const badLogin = await request.post("/api/admin-auth/login", {
    data: { password: "wrong-password" },
  });
  expect(badLogin.status()).toBe(401);

  const login = await request.post("/api/admin-auth/login", {
    data: { password: "63016" },
  });
  expect(login.status()).toBe(200);

  const setCookie = login.headers()["set-cookie"];
  expect(setCookie).toContain("tcyber_admin_session=");

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
