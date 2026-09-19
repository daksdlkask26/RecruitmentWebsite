import { defineConfig } from "@playwright/test";

const colorScheme =
  process.env.CF405_COLOR_SCHEME === "dark" ? "dark" : "light";

export default defineConfig({
  testDir: "tests/system/e2e/home",
  testMatch: /phase4-cf405-(accessibility|journey)\.spec\.ts/u,
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: `test-results/phase4-cf405-playwright-${colorScheme}.json`,
      },
    ],
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3003",
    browserName: "chromium",
    colorScheme,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: `phase4-${colorScheme}-320`,
      use: { viewport: { width: 320, height: 720 } },
    },
    {
      name: `phase4-${colorScheme}-375`,
      use: { viewport: { width: 375, height: 812 } },
    },
    {
      name: `phase4-${colorScheme}-768`,
      use: { viewport: { width: 768, height: 900 } },
    },
    {
      name: `phase4-${colorScheme}-1280`,
      use: { viewport: { width: 1280, height: 900 } },
    },
  ],
});
