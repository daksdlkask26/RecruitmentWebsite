import { resolve } from "node:path";
import { config as loadEnvironment } from "dotenv";
import axe from "axe-core";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { runCandidateFirstE2EControl } from "../../../helpers/candidate-first-e2e-control";
import type { CandidateFirstDatabaseFixture } from "../../../helpers/candidate-first-database-fixture";

loadEnvironment({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const enabled = process.env.RUN_CF107_E2E === "1";
const axeSource = axe.source;
type Fixture = CandidateFirstDatabaseFixture;

async function signIn(page: Page, email: string, password: string) {
  const response = await page.request.post("/api/identity/login", {
    headers: {
      Origin: "http://localhost:3001",
      "Sec-Fetch-Site": "same-origin",
    },
    data: { email, password, returnTo: "/dashboard" },
  });
  expect(response.status(), await response.text()).toBe(200);
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
}

async function seriousAxeViolations(page: Page) {
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(async () => {
    const report = await (
      window as typeof window & {
        axe: {
          run: () => Promise<{
            violations: Array<{ impact?: string | null; id: string }>;
          }>;
        };
      }
    ).axe.run();
    return report.violations.filter(
      (item) => item.impact === "serious" || item.impact === "critical",
    );
  });
}

async function closeContext(context: BrowserContext) {
  await context.close().catch(() => undefined);
}

if (enabled) {
  test.describe("CF-107 durable owner deletion receipt", () => {
    test.describe.configure({ mode: "serial" });
    let fixture: Fixture | undefined;
    let requestId = "";

    test.beforeAll(async () => {
      fixture = await runCandidateFirstE2EControl<Fixture>("create", {
        label: "cf107-receipt",
      });
      const receipt = await runCandidateFirstE2EControl<{ requestId: string }>(
        "create-deletion-receipt",
        { fixture },
      );
      requestId = receipt.requestId;
    });

    test.afterAll(async () => {
      if (fixture) await runCandidateFirstE2EControl("delete", { fixture });
    });

    test("survives refresh, Back/Forward, a new authenticated tab, and 320 px", async ({
      page,
    }) => {
      if (!fixture || !requestId) throw new Error("CF107_FIXTURE_NOT_READY");
      test.setTimeout(180_000);
      await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
      await signIn(page, fixture.employerEmail, fixture.employerPassword);
      const receiptUrl = `/recruiter/company-settings?deletionRequestId=${encodeURIComponent(requestId)}`;

      await page.goto(receiptUrl, { waitUntil: "domcontentloaded" });
      const receipt = page.getByTestId("company-deletion-receipt");
      await expect(receipt).toContainText("Completed.", { timeout: 30_000 });
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(receipt).toContainText("Completed.", { timeout: 30_000 });

      await page.goto("/recruiter/company-settings", {
        waitUntil: "domcontentloaded",
      });
      await page.goBack({ waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(new RegExp(`deletionRequestId=${requestId}`));
      await expect(receipt).toContainText("Completed.", { timeout: 30_000 });
      await page.goForward({ waitUntil: "domcontentloaded" });
      await page.goBack({ waitUntil: "domcontentloaded" });
      await expect(receipt).toContainText("Completed.", { timeout: 30_000 });

      const newTab = await page.context().newPage();
      await newTab.goto(receiptUrl, { waitUntil: "domcontentloaded" });
      await expect(
        newTab.getByTestId("company-deletion-receipt"),
      ).toContainText("Completed.", { timeout: 30_000 });
      await newTab.close();

      await page.setViewportSize({ width: 320, height: 720 });
      await page.goto(receiptUrl, { waitUntil: "domcontentloaded" });
      const overflow = await page.evaluate(() => {
        const viewportWidth = document.documentElement.clientWidth;
        return Array.from(document.querySelectorAll<HTMLElement>("body *"))
          .filter((element) => element.getBoundingClientRect().right > viewportWidth + 1)
          .slice(0, 10)
          .map((element) => ({
            tag: element.tagName,
            className: element.className,
            right: Math.round(element.getBoundingClientRect().right),
            width: Math.round(element.getBoundingClientRect().width),
          }));
      });
      expect(overflow).toEqual([]);
      await page.getByRole("button", { name: "Reload status" }).focus();
      await expect(page.getByRole("button", { name: "Reload status" })).toBeFocused();
      expect(await seriousAxeViolations(page)).toEqual([]);

      const browserStorage = await page.evaluate(() => ({
        local: Object.entries(localStorage),
        session: Object.entries(sessionStorage),
      }));
      expect(JSON.stringify(browserStorage)).not.toContain(requestId);
      expect(JSON.stringify(browserStorage)).not.toContain(fixture.candidateEmail);
      expect(JSON.stringify(browserStorage)).not.toContain(fixture.employerEmail);
    });

    test("returns the same content-free 404 to another authenticated account", async ({
      browser,
    }) => {
      if (!fixture || !requestId) throw new Error("CF107_FIXTURE_NOT_READY");
      const foreignContext = await browser.newContext();
      try {
        const foreignPage = await foreignContext.newPage();
        await signIn(
          foreignPage,
          fixture.candidateEmail,
          fixture.candidatePassword,
        );
        const response = await foreignPage.request.get(
          `/api/recruiter/company/deletion/${encodeURIComponent(requestId)}`,
        );
        expect(response.status()).toBe(404);
        const body = await response.json();
        expect(body).toEqual({ code: "COMPANY_DELETION_NOT_FOUND" });
        expect(JSON.stringify(body)).not.toContain(fixture.company.id);
      } finally {
        await closeContext(foreignContext);
      }
    });
  });
}
