import { resolve } from "node:path";
import { config as loadEnvironment } from "dotenv";
import { expect, test, type Locator, type Page } from "@playwright/test";
import axe from "axe-core";

import { prisma } from "@/backend/database/prisma";
import {
  runCandidatePhase3E2EControl,
  type CandidatePhase3BrowserFixture,
} from "../../../helpers/candidate-phase3-e2e-control";

loadEnvironment({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const enabled = process.env.RUN_CANDIDATE_FIRST_E2E === "1";
const password = "Candidate-first fixture 2026!";
const focusMarker = "data-phase7-focus-cycle-origin";

let fixture: CandidatePhase3BrowserFixture | undefined;

async function signIn(page: Page, email: string) {
  const response = await page.request.post("/api/identity/login", {
    headers: {
      Origin: process.env.CANDIDATE_ORIGIN ?? "http://localhost:3107",
      "Sec-Fetch-Site": "same-origin",
    },
    data: { email, password, returnTo: "/dashboard" },
  });
  expect(response.status(), await response.text()).toBe(200);
}

async function gotoReady(page: Page, route: string) {
  await page.goto(route, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await expect(page).not.toHaveTitle("");
  await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();
}

async function assertFocusCycle(
  page: Page,
  dialog: Locator,
  direction: "forward" | "backward",
) {
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate((root) => root.contains(document.activeElement)),
  ).toBe(true);
  const active = page.locator(":focus");
  await expect(active).toHaveCount(1);
  await active.evaluate(
    (node, marker) => node.setAttribute(marker, "true"),
    focusMarker,
  );
  let returned = false;
  for (let index = 0; index < 250; index += 1) {
    await page.keyboard.press(direction === "forward" ? "Tab" : "Shift+Tab");
    expect(
      await dialog.evaluate((root) => root.contains(document.activeElement)),
      `${direction} focus escaped the dialog`,
    ).toBe(true);
    if (await page.locator(`[${focusMarker}="true"]:focus`).count()) {
      returned = true;
      break;
    }
  }
  await page.locator(`[${focusMarker}="true"]`).evaluate((node, marker) => {
    node.removeAttribute(marker);
  }, focusMarker);
  expect(returned, `${direction} focus cycle did not wrap`).toBe(true);
}

async function assertModalContract({
  page,
  trigger,
  dialog,
  initialFocus,
  lockBodyScroll = true,
}: {
  page: Page;
  trigger: Locator;
  dialog: Locator;
  initialFocus: Locator;
  lockBodyScroll?: boolean;
}) {
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(initialFocus).toBeFocused();
  if (lockBodyScroll) {
    await expect
      .poll(() => page.evaluate(() => document.body.style.overflow))
      .toBe("hidden");
  }
  await assertFocusCycle(page, dialog, "forward");
  await assertFocusCycle(page, dialog, "backward");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
}

async function assertPageQuality(
  page: Page,
  id: string,
  expected: {
    theme: "light" | "dark";
    reducedMotion: boolean;
    visualViewportScale?: number;
  },
) {
  await page.addScriptTag({ content: axe.source });
  const result = await page.evaluate(async () => {
    const axeApi = (
      window as unknown as Window & {
        axe: {
          run: (root: Document) => Promise<{
            violations: Array<{
              id: string;
              impact: string | null;
              nodes: Array<{ target: string[] }>;
            }>;
          }>;
        };
      }
    ).axe;
    const report = await axeApi.run(document);
    const overflowingElements = Array.from(document.querySelectorAll("*"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id,
          classes:
            element instanceof HTMLElement ? element.className : undefined,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter(
        (element) =>
          element.width > 0 &&
          (element.left < -1 || element.right > window.innerWidth + 1),
      )
      .slice(0, 10);
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      theme: document.documentElement.dataset.theme ?? "",
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)")
        .matches,
      visualViewportScale: window.visualViewport?.scale ?? 1,
      visualViewportWidth: window.visualViewport?.width ?? window.innerWidth,
      horizontalOverflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
      overflowingElements,
      violations: report.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        targets: violation.nodes.map((node) => node.target),
      })),
    };
  });
  expect(result.theme, `${id}: theme`).toBe(expected.theme);
  expect(result.reducedMotion, `${id}: reduced motion`).toBe(
    expected.reducedMotion,
  );
  expect(
    result.horizontalOverflow,
    `${id}: horizontal overflow ${JSON.stringify(result.overflowingElements)}`,
  ).toBe(false);
  expect(result.violations, `${id}: axe violations`).toEqual([]);
  if (expected.visualViewportScale) {
    expect(
      result.visualViewportScale,
      `${id}: visual viewport scale`,
    ).toBeGreaterThanOrEqual(expected.visualViewportScale);
  }
  console.log(
    JSON.stringify({
      phase7PublicOverlay: true,
      id,
      result: "PASS",
      viewport: `${result.width}x${result.height}`,
      theme: result.theme,
      reducedMotion: result.reducedMotion,
      visualViewportScale: result.visualViewportScale,
      visualViewportWidth: result.visualViewportWidth,
      horizontalOverflow: false,
      axeViolations: 0,
    }),
  );
}

async function assertAxeCleanWithin(page: Page, root: Locator, id: string) {
  await page.addScriptTag({ content: axe.source });
  const violations = await root.evaluate(async (element) => {
    const axeApi = (
      window as unknown as Window & {
        axe: {
          run: (root: Element) => Promise<{
            violations: Array<{
              id: string;
              impact: string | null;
              nodes: Array<{ target: string[] }>;
            }>;
          }>;
        };
      }
    ).axe;
    const report = await axeApi.run(element);
    return report.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => node.target),
    }));
  });
  expect(violations, `${id}: axe violations`).toEqual([]);
  console.log(
    JSON.stringify({
      phase7PublicOverlay: true,
      id,
      result: "PASS",
      axeScope: "active-dialog",
      axeViolations: 0,
    }),
  );
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  if (!enabled) return;
  fixture = await runCandidatePhase3E2EControl<CandidatePhase3BrowserFixture>(
    "create",
    { label: "phase7-public-overlays" },
  );
  await prisma.accountPreferences.upsert({
    where: { userId: fixture.userIds[0]! },
    create: { userId: fixture.userIds[0]!, language: "EN" },
    update: { language: "EN" },
  });
});

test.afterAll(async () => {
  if (fixture) await runCandidatePhase3E2EControl("delete", { fixture });
  await prisma.$disconnect();
});

test("verifies the final-source public overlay, responsive and zoom matrix", async ({
  page,
}) => {
  test.skip(!enabled, "Requires an isolated Candidate-first E2E database.");
  if (!fixture) throw new Error("PHASE7_PUBLIC_OVERLAY_FIXTURE_NOT_READY");
  test.setTimeout(900_000);

  await page.addInitScript(() => {
    window.localStorage.setItem("smarthire-theme", "light");
  });
  await page.emulateMedia({
    colorScheme: "light",
    reducedMotion: "no-preference",
  });
  await signIn(page, fixture.candidateEmail);
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoReady(page, "/jobs");
  await assertPageQuality(page, "jobs-shell-1280", {
    theme: "light",
    reducedMotion: false,
  });

  const quickViewTrigger = page
    .getByRole("button", { name: "Quick view", exact: true })
    .first();
  const quickView = page.locator(".job-quick-view-panel");
  await assertModalContract({
    page,
    trigger: quickViewTrigger,
    dialog: quickView,
    initialFocus: quickView.getByRole("button", { name: "Close quick view" }),
  });
  await quickViewTrigger.click();
  await assertPageQuality(page, "quick-view", {
    theme: "light",
    reducedMotion: false,
  });
  await page.keyboard.press("Escape");

  const categoryTrigger = page.getByRole("button", {
    name: "Job Category",
    exact: true,
  });
  const categoryDialog = page.locator("#job-category-flyout");
  await categoryTrigger.click();
  await expect(categoryDialog).toBeVisible();
  await expect(
    categoryDialog.getByPlaceholder("Filter skills or titles..."),
  ).toBeFocused();
  await assertFocusCycle(page, categoryDialog, "forward");
  await assertFocusCycle(page, categoryDialog, "backward");
  const wheelContract = await page.evaluate(() => {
    const background = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 40,
    });
    document.body.dispatchEvent(background);
    const dialog = document.querySelector("#job-category-flyout");
    if (!dialog) throw new Error("PHASE7_CATEGORY_DIALOG_MISSING");
    const foreground = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 40,
    });
    dialog.dispatchEvent(foreground);
    return {
      backgroundPrevented: background.defaultPrevented,
      dialogPrevented: foreground.defaultPrevented,
    };
  });
  expect(wheelContract).toEqual({
    backgroundPrevented: true,
    dialogPrevented: false,
  });
  await assertPageQuality(page, "category-explorer", {
    theme: "light",
    reducedMotion: false,
  });
  await page.keyboard.press("Escape");
  await expect(categoryTrigger).toBeFocused();

  const imageTrigger = page.getByRole("button", {
    name: "Search jobs from an image",
    exact: true,
  });
  const imageDialog = page.locator(".global-image-search-panel");
  await assertModalContract({
    page,
    trigger: imageTrigger,
    dialog: imageDialog,
    initialFocus: imageDialog.getByRole("button", {
      name: "Close image search",
    }),
  });
  await imageTrigger.click();
  await assertPageQuality(page, "image-search", {
    theme: "light",
    reducedMotion: false,
  });
  await page.keyboard.press("Escape");

  const saveTrigger = page.getByRole("button", {
    name: "Save filter",
    exact: true,
  });
  const saveDialog = page.locator(".job-save-filter-dialog");
  await assertModalContract({
    page,
    trigger: saveTrigger,
    dialog: saveDialog,
    initialFocus: saveDialog.getByRole("textbox", { name: "Search name" }),
  });
  await saveTrigger.click();
  await assertPageQuality(page, "save-filter", {
    theme: "light",
    reducedMotion: false,
  });
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.evaluate(() => {
    window.localStorage.setItem("smarthire-theme", "dark");
    document.documentElement.dataset.theme = "dark";
  });
  const mobileTrigger = page.getByRole("button", { name: /^Filters/u });
  const mobileDialog = page.getByRole("dialog", {
    name: "Filters",
    exact: true,
  });
  await assertModalContract({
    page,
    trigger: mobileTrigger,
    dialog: mobileDialog,
    initialFocus: mobileDialog.getByRole("button", {
      name: "Close filters",
      exact: true,
    }),
  });
  await mobileTrigger.click();
  await assertPageQuality(page, "mobile-filters-320", {
    theme: "dark",
    reducedMotion: true,
  });
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 375, height: 900 });
  await assertPageQuality(page, "responsive-375", {
    theme: "dark",
    reducedMotion: true,
  });
  await page.setViewportSize({ width: 768, height: 900 });
  await assertPageQuality(page, "responsive-768", {
    theme: "dark",
    reducedMotion: true,
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({
    colorScheme: "light",
    reducedMotion: "no-preference",
  });
  await page.evaluate(() => {
    window.localStorage.setItem("smarthire-theme", "light");
    document.documentElement.dataset.theme = "light";
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 640,
    height: 450,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: 1280,
    screenHeight: 900,
  });
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
  const zoomTrigger = page.getByRole("button", { name: /^Filters/u });
  await zoomTrigger.focus();
  await expect(zoomTrigger).toBeFocused();
  await page.keyboard.press("Enter");
  const zoomDialog = page.getByRole("dialog", {
    name: "Filters",
    exact: true,
  });
  await expect(zoomDialog).toBeVisible();
  await assertAxeCleanWithin(page, zoomDialog, "zoom-200-dialog");
  await page.keyboard.press("Escape");
  await expect(zoomTrigger).toBeFocused();
  await assertPageQuality(page, "zoom-200", {
    theme: "light",
    reducedMotion: false,
    visualViewportScale: 1.9,
  });
});
