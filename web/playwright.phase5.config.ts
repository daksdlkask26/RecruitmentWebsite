import { defineConfig } from "@playwright/test";

const colorScheme =
  process.env.CF502_COLOR_SCHEME === "dark" ? "dark" : "light";
const port = process.env.PLAYWRIGHT_PORT ?? "3003";

export default defineConfig({
  testDir: "tests/system/e2e/candidate-first",
  testMatch: "phase5-cf502-accessibility.spec.ts",
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
        outputFile: `test-results/phase5-cf502-playwright-${colorScheme}.json`,
      },
    ],
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`,
    browserName: "chromium",
    colorScheme,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: `phase5-${colorScheme}-320`,
      use: { viewport: { width: 320, height: 720 } },
    },
    {
      name: `phase5-${colorScheme}-375`,
      use: { viewport: { width: 375, height: 812 } },
    },
    {
      name: `phase5-${colorScheme}-768`,
      use: { viewport: { width: 768, height: 900 } },
    },
    {
      name: `phase5-${colorScheme}-1280`,
      use: { viewport: { width: 1280, height: 900 } },
    },
  ],
});
