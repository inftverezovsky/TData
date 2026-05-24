import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? process.env.PORT ?? 3012);
const baseURL = `http://127.0.0.1:${port}`;
const useProductionServer = process.env.PLAYWRIGHT_PROD_SERVER === "1";
const webServerEnv: Record<string, string> = {
  NODE_OPTIONS: "--openssl-legacy-provider",
  ADMIN_PASSWORD: "63016",
  ADMIN_SESSION_SECRET: "e2e-session-secret",
};

if (process.env.DATABASE_URL) {
  webServerEnv.DATABASE_URL = process.env.DATABASE_URL;
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
      ? `npx next start -p ${port} -H 127.0.0.1`
      : `npx next dev -p ${port} -H 127.0.0.1`,
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
