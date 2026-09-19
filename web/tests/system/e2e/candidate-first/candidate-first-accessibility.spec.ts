import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { config as loadEnvironment } from "dotenv";
import axe from "axe-core";
import { expect, test, type Page } from "@playwright/test";

import { runCandidateFirstE2EControl } from "../../../helpers/candidate-first-e2e-control";
import type { CandidateFirstDatabaseFixture } from "../../../helpers/candidate-first-database-fixture";

loadEnvironment({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const enabled = process.env.RUN_CANDIDATE_FIRST_E2E === "1";
const password = "Candidate-first fixture 2026!";
const axeSource = axe.source;
const reportPath = resolve(
  process.cwd(),
  "..",
  "docs",
  "audits",
  "candidate-first",
  "pre-phase",
  "evidence",
  "cf004-accessibility.json",
);

type Fixture = CandidateFirstDatabaseFixture;
type Viewport = { name: string; width: number; height: number };
type Result = {
  route: string;
  viewport: Viewport;
  zoom: "100%" | "200%";
  axeSeriousOrCritical: number;
  horizontalOverflow: boolean;
  keyboardFocusVisible: boolean;
  status: "PASS" | "FAIL";
  error?: string;
};

const viewports: Viewport[] = [
  { name: "mobile-320", width: 320, height: 720 },
  { name: "mobile-375", width: 375, height: 812 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1280", width: 1280, height: 800 },
];

async function gotoReady(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(1_000);
}

async function axeSeriousOrCritical(page: Page) {
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(async () => {
    const report = await (
      window as typeof window & {
        axe: {
          run: () => Promise<{
            violations: Array<{
              id: string;
              impact?: string | null;
              help: string;
              nodes: Array<{ target: string[] }>;
            }>;
          }>;
        };
      }
    ).axe.run();
    return report.violations
      .filter((item) => item.impact === "serious" || item.impact === "critical")
      .map((item) => ({
        id: item.id,
        impact: item.impact,
        help: item.help,
        targets: item.nodes.flatMap((node) => node.target),
      }));
  });
}

async function hasHorizontalOverflow(page: Page) {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1,
  );
}

async function signIn(page: Page, fixture: Fixture) {
  const response = await page.request.post("/api/identity/login", {
    headers: {
      Origin: process.env.CANDIDATE_ORIGIN ?? "http://localhost:3101",
      "Sec-Fetch-Site": "same-origin",
    },
    data: {
      email: fixture.candidateEmail,
      password,
      returnTo: "/dashboard",
    },
  });
  expect(response.status(), await response.text()).toBe(200);
  await gotoReady(page, "/dashboard");
}

test.describe.configure({ mode: "serial" });

let fixture: Fixture | undefined;
const results: Result[] = [];

test.beforeAll(async () => {
  if (!enabled) return;
  fixture = await runCandidateFirstE2EControl<Fixture>("create", {
    label: "accessibility",
  });
});

test.afterAll(async () => {
  if (fixture) await runCandidateFirstE2EControl("delete", { fixture });
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        schemaVersion: "candidate-first-cf004-accessibility-v1",
        generatedAt: new Date().toISOString(),
        mode: "LOCAL_CHROMIUM",
        axeImpactThreshold: ["serious", "critical"],
        dimensions: { viewports, zoom: ["100%", "200%"] },
        results,
        summary: {
          totalCases: results.length,
          passed: results.filter((result) => result.status === "PASS").length,
          failed: results.filter((result) => result.status === "FAIL").length,
          seriousOrCriticalAxeViolations: results.reduce(
            (total, result) => total + result.axeSeriousOrCritical,
            0,
          ),
          horizontalOverflowCases: results.filter(
            (result) => result.horizontalOverflow,
          ).length,
        },
        limitations: [
          "Axe runs on the authenticated Candidate pages listed in this file.",
          "200% is a Chromium CDP page scale factor and is verified through visualViewport.scale; no CSS zoom is injected.",
          "Manual screen-reader and color-contrast review remains separate from this automated gate.",
        ],
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
});

test("Candidate pages have no serious/critical axe findings at required breakpoints", async ({
  page,
}) => {
  test.skip(
    !enabled,
    "Set RUN_CANDIDATE_FIRST_E2E=1 with an isolated *_test database to run Candidate accessibility evidence.",
  );
  if (!fixture) throw new Error("CF004_CANDIDATE_FIXTURE_NOT_READY");
  test.setTimeout(900_000);
  await signIn(page, fixture);
  const routes = [
    "/",
    "/profile",
    "/profile/cv-imports",
    "/jobs/applied",
    `/jobs/applied/${fixture.applicationId}`,
    `/jobs/applied/${fixture.applicationId}/messages`,
  ];

  for (const viewport of viewports) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    for (const route of routes) {
      const item: Result = {
        route,
        viewport,
        zoom: "100%",
        axeSeriousOrCritical: -1,
        horizontalOverflow: true,
        keyboardFocusVisible: false,
        status: "FAIL",
      };
      try {
        await gotoReady(page, route);
        const violations = await axeSeriousOrCritical(page);
        item.axeSeriousOrCritical = violations.length;
        item.horizontalOverflow = await hasHorizontalOverflow(page);
        await page.keyboard.press("Tab");
        item.keyboardFocusVisible = await page.locator(":focus").isVisible();
        if (
          violations.length ||
          item.horizontalOverflow ||
          !item.keyboardFocusVisible
        ) {
          throw new Error(
            JSON.stringify({
              violations,
              horizontalOverflow: item.horizontalOverflow,
              keyboardFocusVisible: item.keyboardFocusVisible,
            }),
          );
        }
        item.status = "PASS";
      } catch (error) {
        item.error = error instanceof Error ? error.message : String(error);
      }
      results.push(item);
    }
  }

  await page.setViewportSize({ width: 640, height: 720 });
  await gotoReady(page, "/profile");
  const zoomItem: Result = {
    route: "/profile",
    viewport: { name: "zoom-640", width: 640, height: 720 },
    zoom: "200%",
    axeSeriousOrCritical: -1,
    horizontalOverflow: true,
    keyboardFocusVisible: false,
    status: "FAIL",
  };
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
    await expect
      .poll(() => page.evaluate(() => window.visualViewport?.scale ?? 1))
      .toBeGreaterThanOrEqual(1.9);
    const violations = await axeSeriousOrCritical(page);
    zoomItem.axeSeriousOrCritical = violations.length;
    zoomItem.horizontalOverflow = await hasHorizontalOverflow(page);
    await page.keyboard.press("Tab");
    zoomItem.keyboardFocusVisible = await page.locator(":focus").isVisible();
    if (
      violations.length ||
      zoomItem.horizontalOverflow ||
      !zoomItem.keyboardFocusVisible
    ) {
      throw new Error(
        JSON.stringify({
          violations,
          horizontalOverflow: zoomItem.horizontalOverflow,
          keyboardFocusVisible: zoomItem.keyboardFocusVisible,
        }),
      );
    }
    zoomItem.status = "PASS";
  } catch (error) {
    zoomItem.error = error instanceof Error ? error.message : String(error);
  }
  results.push(zoomItem);
  expect(
    results.filter((result) => result.status === "FAIL"),
    JSON.stringify(results, null, 2),
  ).toEqual([]);
});
