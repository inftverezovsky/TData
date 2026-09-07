import { defineConfig, devices } from "@playwright/test";
import { requireTestDatabaseUrl } from "./scripts/helpers/testDatabase";

const port = Number(process.env.PLAYWRIGHT_PORT ?? process.env.PORT ?? 3012);
const baseURL = `http://127.0.0.1:${port}`;
const useProductionServer = process.env.PLAYWRIGHT_PROD_SERVER === "1";
const webServerEnv: Record<string, string> = {
  NODE_OPTIONS: "--openssl-legacy-provider",
  ADMIN_PASSWORD: "63016",
  ADMIN_SESSION_SECRET: "e2e-session-secret",
  // Тестовый origin использует HTTP loopback; production HTTPS по умолчанию оставляет cookie Secure.
  ADMIN_COOKIE_SECURE: "false",
  // Smoke-тесты не наследуют рабочую БД из локального .env.
  DATABASE_URL: process.env.DATABASE_URL
    ? requireTestDatabaseUrl(process.env.DATABASE_URL)
    : "postgresql://127.0.0.1:1/tdata_test_unavailable?schema=public&connect_timeout=1",
  TLINE_ENABLED: "0",
  TLINE_SCHEDULER_READY: "0",
  KHL_RESULTS_AUTO_SYNC_ENABLED: "0",
};

// Только отдельный DB E2E использует локальный mock Admin API для проверки отправки.
if (["1", "true"].includes(process.env.RUN_DB_E2E || "")) {
  requireTestDatabaseUrl(process.env.DATABASE_URL);
  Object.assign(webServerEnv, {
    ADMIN_UPLOAD_ALLOWED_HOSTS: "127.0.0.1",
    ADMIN_UPLOAD_ALLOW_PRIVATE_HOSTS: "1",
    ADMIN_UPLOAD_ALLOW_INSECURE_HTTP: "1",
    ADMIN_UPLOAD_ALLOW_ANY_PUBLIC_HOST: "0",
    EXTERNAL_PLATFORM_ALLOWED_HOSTS: "",
    // Локальный mock не должен получать авторизацию или mTLS из рабочей .env.
    ADMIN_AUTH_MODE: "none",
    ADMIN_MTLS_ENABLED: "false",
    ADMIN_AUTH_ALLOW_NONE: "1",
  });
}

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: useProductionServer
      ? `npx next start frontend -p ${port} -H 127.0.0.1`
      : `npx next dev frontend -p ${port} -H 127.0.0.1`,
    url: baseURL,
    reuseExistingServer: Boolean(process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER) && !useProductionServer,
    timeout: 120_000,
    env: webServerEnv,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-smoke",
      testMatch: /app-smoke\.spec\.ts/,
      use: { ...devices["Pixel 5"] },
    },
  ],
});
