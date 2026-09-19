import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createHomeE2EFixture,
  deleteHomeE2EFixture,
  setHomeLocale,
} from "./home-e2e-fixture";

let fixture: Awaited<ReturnType<typeof createHomeE2EFixture>>;
const colorScheme: "light" | "dark" =
  process.env.CF405_COLOR_SCHEME === "dark" ? "dark" : "light";

type AxeViolation = { id: string; impact: string | null; nodes: unknown[] };
type AxeApi = {
  run: (
    root: Document,
    options: unknown,
  ) => Promise<{ violations: AxeViolation[] }>;
};

test.beforeAll(async () => {
  fixture = await createHomeE2EFixture("cf405-accessibility");
});

test.afterAll(async () => {
  if (fixture) await deleteHomeE2EFixture(fixture);
});

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
  await page.addInitScript(
    (theme) => window.localStorage.setItem("smarthire-theme", theme),
    colorScheme,
  );
  expect([320, 375, 768, 1280]).toContain(page.viewportSize()?.width);
});

test("Home remains accessible, keyboard-usable, and overflow-free in the production journey", async ({
  page,
}) => {
  await page.goto("/");
  await setHomeLocale(page, "en");
  await expect
    .poll(() => page.locator("html").getAttribute("data-theme"))
    .toBe(colorScheme);
  await expect
    .poll(() => page.locator("html").evaluate((node) => node.style.colorScheme))
    .toBe(colorScheme);

  const axePath = resolve(process.cwd(), "../node_modules/axe-core/axe.min.js");
  await page.addScriptTag({ content: readFileSync(axePath, "utf8") });
  const axeResult = await page.evaluate(async () => {
    const result = await (
      window as unknown as Window & { axe: AxeApi }
    ).axe.run(document, {});
    return result.violations
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.length,
      }))
      .filter(
        (violation) =>
          violation.impact === "critical" || violation.impact === "serious",
      );
  });
  expect(axeResult, JSON.stringify(axeResult)).toEqual([]);

  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);

  // Use Chromium's page-scale emulation instead of CSS `zoom`.  The latter
  // enlarges the root element itself and therefore reports an artificial
  // document width even when the layout is overflow-free. Page-scale is the
  // browser-level equivalent of 200% zoom and keeps the CSS viewport contract
  // intact for a meaningful overflow assertion.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
  await page.evaluate(() => {
    document.documentElement.dataset.motion = "reduced";
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);

  const search = page.getByLabel("Keyword");
  await search.focus();
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus-visible")).toHaveCount(1);
  await page.getByRole("button", { name: "Search jobs" }).press("Enter");
  await expect(page).toHaveURL(/\/jobs(?:\?|$)/u);
});
