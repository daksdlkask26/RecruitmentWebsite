import { defineConfig } from "@playwright/test";

const productionServer = process.env.PLAYWRIGHT_PRODUCTION === "1";
const appPort = process.env.PLAYWRIGHT_PORT ?? "3001";
const appBaseUrl =
  process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${appPort}`;

export default defineConfig({
  testDir: "./tests/performance/home",
  testMatch: /.*\.spec\.ts/u,
  fullyParallel: false,
  workers: 1,
  timeout: 30 * 60_000,
  expect: { timeout: 15_000 },
  webServer: {
    command: productionServer ? "npm run start" : "npm run dev",
    url: appBaseUrl,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "1",
    env: productionServer
      ? {
          NODE_ENV: "production",
          HOSTNAME: "::",
          PORT: appPort,
          CANDIDATE_ORIGIN: appBaseUrl,
          ADMIN_ORIGIN: `http://console.admin.localhost:${appPort}`,
          RECRUITER_ORIGIN: `http://console.recruiter.localhost:${appPort}`,
        }
      : undefined,
  },
  use: {
    baseURL: appBaseUrl,
    browserName: "chromium",
  },
  projects: [
    {
      name: "home-desktop-1366x768",
      use: { viewport: { width: 1366, height: 768 } },
    },
    {
      name: "home-mobile-390x844",
      use: { viewport: { width: 390, height: 844 } },
    },
  ],
});
