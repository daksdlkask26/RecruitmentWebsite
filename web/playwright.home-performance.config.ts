import { defineConfig } from "@playwright/test";

const productionServer = process.env.PLAYWRIGHT_PRODUCTION === "1";

export default defineConfig({
  testDir: "./tests/performance/home",
  testMatch: /.*\.spec\.ts/u,
  fullyParallel: false,
  workers: 1,
  timeout: 30 * 60_000,
  expect: { timeout: 15_000 },
  webServer: {
    command: productionServer ? "npm run start" : "npm run dev",
    url: "http://localhost:3001",
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "1",
  },
  use: {
    baseURL: "http://localhost:3001",
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
