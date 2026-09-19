import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import {
  createHomeE2EFixture,
  deleteHomeE2EFixture,
  signInHomeUser,
} from "../home/home-e2e-fixture";
import { runHomeE2EControl } from "../../../helpers/home/home-e2e-control";
import {
  runPhase5BrowserControl,
  type Phase5BrowserPrivateMatchIds,
} from "../../../helpers/phase5-browser-control";

test.describe.configure({ mode: "serial" });

const colorScheme: "light" | "dark" =
  process.env.CF502_COLOR_SCHEME === "dark" ? "dark" : "light";
const evidencePath = resolve(
  process.cwd(),
  "test-results/phase5-cf502-" + colorScheme + "-" + process.pid + ".jsonl",
);

type HomeFixture = Awaited<ReturnType<typeof createHomeE2EFixture>>;

let fixture: HomeFixture;
let crossAccountFixture: HomeFixture;
let matchIds: Phase5BrowserPrivateMatchIds;
let longCopyCheckId: string;

type ZoomEvidence = Readonly<{
  requestedPercent: 200;
  method: "cdp-device-metrics-css-viewport-reflow";
  baseViewportWidth: number;
  baseViewportHeight: number;
  measuredViewportWidth: number;
  measuredViewportHeight: number;
  reflowVerified: boolean;
}>;

type QualityEvidence = Readonly<{
  overflow: boolean;
  reducedMotion: boolean;
  theme: string;
  keyboardFocus: boolean;
  seriousCriticalAxeViolations: number;
  zoom: ZoomEvidence;
}>;

const zoomEvidenceByPage = new WeakMap<Page, ZoomEvidence>();
const qualityEvidenceByPage = new WeakMap<Page, QualityEvidence>();

function recordState(
  testInfo: TestInfo,
  page: Page,
  state: string,
  status: "PASS" | "FAIL",
  error?: unknown,
) {
  const viewport = page.viewportSize();
  const row = {
    artifact: "CF-502",
    state,
    theme: colorScheme,
    viewport: viewport ? viewport.width + "x" + viewport.height : null,
    project: testInfo.project.name,
    status,
    quality: qualityEvidenceByPage.get(page) ?? null,
    environment: {
      productionBuild: process.env.PHASE5_PRODUCTION_BUILD === "1",
      buildOutput: process.env.PHASE5_BUILD_OUTPUT ?? null,
      baseUrl: process.env.PLAYWRIGHT_BASE_URL ?? null,
      isolatedDatabase: process.env.PHASE5_DB_NAME ?? null,
      sourceSpec:
        "tests/system/e2e/candidate-first/phase5-cf502-accessibility.spec.ts",
      config: "playwright.phase5.config.ts",
      routeMocks: false,
    },
    error:
      status === "FAIL"
        ? String(error instanceof Error ? error.message : error).slice(0, 500)
        : null,
  };
  appendFileSync(
    evidencePath,
    JSON.stringify(row) + String.fromCharCode(10),
    "utf8",
  );
}

async function runState(
  testInfo: TestInfo,
  page: Page,
  state: string,
  action: () => Promise<void>,
) {
  try {
    await action();
    recordState(testInfo, page, state, "PASS");
  } catch (error) {
    recordState(testInfo, page, state, "FAIL", error);
    throw error;
  }
}

async function setTwoHundredPercent(page: Page) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("CF502_VIEWPORT_MISSING");
  const cdp = await page.context().newCDPSession(page);
  const width = Math.max(1, Math.ceil(viewport.width / 2));
  const height = Math.max(1, Math.ceil(viewport.height / 2));
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
  });
  zoomEvidenceByPage.set(page, {
    requestedPercent: 200,
    method: "cdp-device-metrics-css-viewport-reflow",
    baseViewportWidth: viewport.width,
    baseViewportHeight: viewport.height,
    measuredViewportWidth: width,
    measuredViewportHeight: height,
    reflowVerified: false,
  });
}

async function runSeriousA11y(page: Page) {
  const axePath = resolve(process.cwd(), "../node_modules/axe-core/axe.min.js");
  await page.addScriptTag({ content: readFileSync(axePath, "utf8") });
  const violations = await page.evaluate(async () => {
    const result = await (
      window as unknown as Window & {
        axe: {
          run: (root: Document) => Promise<{
            violations: Array<{
              id: string;
              impact: string | null;
              nodes: Array<{ target: string[]; failureSummary?: string }>;
            }>;
          }>;
        };
      }
    ).axe.run(document);
    return result.violations
      .filter(
        (violation) =>
          violation.impact === "critical" || violation.impact === "serious",
      )
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.map((node) => ({
          target: node.target,
          failureSummary: node.failureSummary,
        })),
      }));
  });
  expect(violations, JSON.stringify(violations)).toEqual([]);
  return violations;
}

async function assertQuality(page: Page) {
  // Authentication/recovery routes intentionally remain light in the
  // product theme contract. All Candidate and report routes still have to
  // honor the requested light/dark matrix.
  const expectedTheme =
    new URL(page.url()).pathname === "/login" ? "light" : colorScheme;
  await expect
    .poll(() =>
      page.evaluate(() => ({
        overflow:
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1,
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)")
          .matches,
        theme: document.documentElement.dataset.theme,
      })),
    )
    .toMatchObject({
      overflow: true,
      reducedMotion: true,
      theme: expectedTheme,
    });
  await page.keyboard.press("Tab");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const element = document.activeElement;
        return Boolean(
          element &&
          element !== document.body &&
          (element.matches(
            "a,button,input,select,textarea,[tabindex],[role='button']",
          ) ||
            element.getAttribute("role") === "button"),
        );
      }),
    )
    .toBe(true);
  const measurements = await page.evaluate(() => {
    const element = document.activeElement;
    const rect = element?.getBoundingClientRect();
    const style = element ? window.getComputedStyle(element) : null;
    return {
      overflow:
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)")
        .matches,
      theme: document.documentElement.dataset.theme ?? "",
      keyboardFocus: Boolean(
        element &&
        element !== document.body &&
        (element.matches(
          "a,button,input,select,textarea,[tabindex],[role='button']",
        ) ||
          element.getAttribute("role") === "button") &&
        rect &&
        rect.width > 0 &&
        rect.height > 0 &&
        style &&
        style.visibility !== "hidden" &&
        style.display !== "none",
      ),
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      clientWidth: document.documentElement.clientWidth,
      clientHeight: document.documentElement.clientHeight,
    };
  });
  const zoom = zoomEvidenceByPage.get(page);
  if (!zoom) throw new Error("CF502_ZOOM_EVIDENCE_MISSING");
  const reflowVerified =
    measurements.innerWidth <= Math.ceil(zoom.baseViewportWidth / 2) + 1 &&
    measurements.innerHeight <= Math.ceil(zoom.baseViewportHeight / 2) + 1 &&
    measurements.clientWidth <= Math.ceil(zoom.baseViewportWidth / 2) + 1;
  expect(reflowVerified).toBe(true);
  const violations = await runSeriousA11y(page);
  qualityEvidenceByPage.set(page, {
    overflow: measurements.overflow,
    reducedMotion: measurements.reducedMotion,
    theme: measurements.theme,
    keyboardFocus: measurements.keyboardFocus,
    seriousCriticalAxeViolations: violations.length,
    zoom: {
      ...zoom,
      measuredViewportWidth: measurements.innerWidth,
      measuredViewportHeight: measurements.innerHeight,
      reflowVerified,
    },
  });
}

async function openReport(page: Page, checkId: string) {
  await page.goto("/cv-match-check/" + encodeURIComponent(checkId));
  await expect(page.locator(".private-match-ready-page")).toBeVisible();
  await page.getByRole("button", { name: /View full match report/i }).click();
  await expect(page.locator(".pmr-page")).toBeVisible();
}

async function assertNoIllustrativeScore(page: Page) {
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/\b87%\b/u);
  expect(body).not.toMatch(/Illustrative match estimate/u);
}

async function cleanupPrivateMatches() {
  if (!fixture) return;
  await runPhase5BrowserControl("cleanup", {
    candidateUserId: fixture.candidate.id,
  });
}

async function seedPrivateMatches() {
  const databaseFixture =
    fixture.databaseFixture as typeof fixture.databaseFixture & {
      confirmedCvIds: string[];
    };
  const input = {
    candidateUserId: fixture.candidate.id,
    employerUserId: fixture.employer.id,
    confirmedCvId: databaseFixture.confirmedCvIds[0],
    companyName: "NextGen Careers fixture company",
    activeJob: { id: databaseFixture.jobs.active.id },
    now: new Date().toISOString(),
  };
  const seeded = await runPhase5BrowserControl<{
    matchIds: Phase5BrowserPrivateMatchIds;
    longCopyCheckId: string;
  }>("seed", { input });
  matchIds = seeded.matchIds;
  longCopyCheckId = seeded.longCopyCheckId;
}

test.beforeAll(async () => {
  fixture = await createHomeE2EFixture("cf502-production-" + colorScheme);
  crossAccountFixture = await createHomeE2EFixture(
    "cf502-cross-account-" + colorScheme,
  );
  await seedPrivateMatches();
});

test.afterAll(async () => {
  await cleanupPrivateMatches();
  if (crossAccountFixture) await deleteHomeE2EFixture(crossAccountFixture);
  if (fixture) await deleteHomeE2EFixture(fixture);
});

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
  await page.addInitScript((theme) => {
    window.localStorage.setItem("smarthire-theme", theme);
  }, colorScheme);
  expect([320, 375, 768, 1280]).toContain(page.viewportSize()?.width);
  await setTwoHundredPercent(page);
});

test("matrix: guest employer and profile states", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await runState(testInfo, page, "Guest", async () => {
    await page.goto("/cv-match-check/" + matchIds.fullHigh);
    await expect(page).toHaveURL(/\/login/u);
    await assertQuality(page);
  });
  await runState(testInfo, page, "Employer", async () => {
    await signInHomeUser(page, fixture.employer.email);
    await page.goto("/cv-match-check/" + matchIds.fullHigh);
    await expect(
      page.getByRole("heading", { name: /no longer available/i }),
    ).toBeVisible();
    await assertQuality(page);
  });
  await runState(testInfo, page, "Profile AVAILABLE", async () => {
    await cleanupPrivateMatches();
    await signInHomeUser(page, fixture.candidate.email);
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Smart Match" }),
    ).toBeVisible();
    await expect(page.locator('[data-match-source="profile"]')).toBeVisible();
    await expect(
      page.getByText("Profile estimate", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Profile signals compared", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/CV Match Check score/i)).toHaveCount(0);
    await expect(
      page.getByText(/Complete your profile to view your fit/i),
    ).toHaveCount(0);
    await assertQuality(page);
  });
  await runState(testInfo, page, "Candidate without Profile", async () => {
    // The private CV projection intentionally has precedence over the
    // profile-only fallback. Remove the task-owned private checks for this
    // state so the browser proves the independent insufficient-Profile path,
    // then restore the reports for the remaining matrix states.
    await cleanupPrivateMatches();
    await runPhase5BrowserControl("profile-empty", {
      candidateUserId: fixture.candidate.id,
    });
    await page.goto("/");
    await expect(
      page.getByText(/Complete your profile to view your fit/i),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: /Profile match is locked/i }),
    ).toBeVisible();
    await assertQuality(page);
    await runPhase5BrowserControl("profile-restore", {
      candidateUserId: fixture.candidate.id,
    });
    await seedPrivateMatches();
  });
});

test("matrix: report projection states", async ({ page }, testInfo) => {
  test.setTimeout(360_000);
  await signInHomeUser(page, fixture.candidate.email);
  const states: Array<[string, string, () => Promise<void>]> = [
    [
      "CV AVAILABLE",
      matchIds.fullHigh,
      async () => {
        await openReport(page, matchIds.fullHigh);
        await expect(page.locator(".pmr-score")).toContainText(/\/ 100/u);
        await expect(
          page.getByRole("link", { name: /Apply now/i }),
        ).toBeVisible();
        await assertQuality(page);
      },
    ],
    [
      "FULL_REPORT MEDIUM",
      matchIds.fullMedium,
      async () => {
        await openReport(page, matchIds.fullMedium);
        await expect(page.locator(".pmr-page")).toContainText(
          /Review the evidence|alignment/i,
        );
        await assertQuality(page);
      },
    ],
    [
      "FULL_REPORT LOW",
      matchIds.fullLow,
      async () => {
        await openReport(page, matchIds.fullLow);
        await expect(page.locator(".pmr-page")).toContainText(
          /review|evidence/i,
        );
        await assertQuality(page);
      },
    ],
    [
      "LIMITED_REPORT",
      matchIds.limited,
      async () => {
        await openReport(page, matchIds.limited);
        await expect(
          page.getByRole("button", { name: /Retry AI/i }),
        ).toBeVisible();
        await expect(page.locator(".pmr-score")).not.toContainText(
          /Hybrid|Final/i,
        );
        await assertQuality(page);
      },
    ],
    [
      "incomplete CV",
      matchIds.incompleteCv,
      async () => {
        await openReport(page, matchIds.incompleteCv);
        await expect(page.locator(".pmr-score")).toContainText(
          /—|unavailable/i,
        );
        await assertNoIllustrativeScore(page);
        await assertQuality(page);
      },
    ],
    [
      "incomplete JD",
      matchIds.incompleteJd,
      async () => {
        await openReport(page, matchIds.incompleteJd);
        await expect(page.locator(".pmr-score")).toContainText(
          /—|unavailable/i,
        );
        await assertNoIllustrativeScore(page);
        await assertQuality(page);
      },
    ],
    [
      "missing criteria",
      matchIds.missingCriteria,
      async () => {
        await openReport(page, matchIds.missingCriteria);
        await expect(page.locator(".pmr-score")).toContainText(
          /—|unavailable/i,
        );
        await assertNoIllustrativeScore(page);
        await assertQuality(page);
      },
    ],
    [
      "evidence-empty",
      matchIds.evidenceEmpty,
      async () => {
        await openReport(page, matchIds.evidenceEmpty);
        await expect(
          page.getByText(/No bounded evidence quotes are available/i),
        ).toBeVisible();
        await assertQuality(page);
      },
    ],
    [
      "unavailable failed parse",
      matchIds.failedParse,
      async () => {
        await openReport(page, matchIds.failedParse);
        await expect(page.locator(".pmr-score")).toContainText(
          /—|unavailable/i,
        );
        await assertNoIllustrativeScore(page);
        await assertQuality(page);
      },
    ],
    [
      "queued",
      matchIds.queued,
      async () => {
        await page.goto("/cv-match-check/" + matchIds.queued);
        await expect(
          page.getByRole("heading", { name: /Analyzing your CV/i }),
        ).toBeVisible();
        await assertQuality(page);
      },
    ],
    [
      "analyzing",
      matchIds.analyzing,
      async () => {
        await page.goto("/cv-match-check/" + matchIds.analyzing);
        await expect(
          page.getByRole("heading", { name: /Analyzing your CV/i }),
        ).toBeVisible();
        await assertQuality(page);
      },
    ],
    [
      "retrying",
      matchIds.retrying,
      async () => {
        await openReport(page, matchIds.retrying);
        await expect(
          page.getByRole("button", { name: /Retrying/i }),
        ).toBeVisible();
        await assertQuality(page);
      },
    ],
    [
      "retry failure",
      matchIds.retryFailure,
      async () => {
        await openReport(page, matchIds.retryFailure);
        await expect(
          page.getByRole("button", { name: /Retry AI/i }),
        ).toBeVisible();
        await assertQuality(page);
      },
    ],
    [
      "expired",
      matchIds.expired,
      async () => {
        await page.goto("/cv-match-check/" + matchIds.expired);
        await expect(
          page.getByRole("heading", { name: /no longer available/i }),
        ).toBeVisible();
        await assertQuality(page);
      },
    ],
    [
      "revoked",
      matchIds.revoked,
      async () => {
        await page.goto("/cv-match-check/" + matchIds.revoked);
        await expect(
          page.getByRole("heading", { name: /no longer available/i }),
        ).toBeVisible();
        await assertQuality(page);
      },
    ],
    [
      "deleted",
      matchIds.deleted,
      async () => {
        await page.goto("/cv-match-check/" + matchIds.deleted);
        await expect(
          page.getByRole("heading", { name: /no longer available/i }),
        ).toBeVisible();
        await assertQuality(page);
      },
    ],
  ];
  for (const [state, , action] of states) {
    await runState(testInfo, page, state, action);
  }
});

test("matrix: direct link refresh back forward second tab and long EN VI", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(300_000);
  await signInHomeUser(page, fixture.candidate.email);
  await runState(testInfo, page, "direct link and refresh", async () => {
    await openReport(page, matchIds.fullHigh);
    await page.reload();
    await expect(page.locator(".private-match-ready-page")).toBeVisible();
    await assertQuality(page);
  });
  await runState(testInfo, page, "Back Forward", async () => {
    await page.goto("/cv-match-check/" + matchIds.fullHigh);
    await page.goto("/cv-match-check/" + matchIds.fullMedium);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(matchIds.fullHigh, "u"));
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(matchIds.fullMedium, "u"));
    await assertQuality(page);
  });
  await runState(testInfo, page, "second authenticated tab", async () => {
    await openReport(page, matchIds.fullHigh);
    const secondTab = await page.context().newPage();
    await secondTab.goto("/cv-match-check/" + matchIds.fullHigh);
    await expect(secondTab.locator(".private-match-ready-page")).toBeVisible();
    await secondTab.close();
    await assertQuality(page);
  });
  await runState(testInfo, page, "cross-account denial", async () => {
    const otherContext = await browser.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL,
      colorScheme,
    });
    try {
      const candidateBPage = await otherContext.newPage();
      await candidateBPage.emulateMedia({
        colorScheme,
        reducedMotion: "reduce",
      });
      await signInHomeUser(candidateBPage, crossAccountFixture.candidate.email);
      await candidateBPage.goto("/cv-match-check/" + matchIds.fullHigh);
      await expect(
        candidateBPage.getByRole("heading", { name: /no longer available/i }),
      ).toBeVisible();
      await expect(candidateBPage.locator(".pmr-page")).toHaveCount(0);
    } finally {
      await otherContext.close();
    }
    await assertQuality(page);
  });
  await runState(testInfo, page, "long EN VI", async () => {
    await openReport(page, longCopyCheckId);
    await expect(page.locator(".pmr-page")).toBeVisible();
    await assertQuality(page);
    await runHomeE2EControl("set-language", {
      userId: fixture.candidate.id,
      language: "VI",
    });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "vi");
    await assertQuality(page);
    await runHomeE2EControl("set-language", {
      userId: fixture.candidate.id,
      language: "EN",
    });
  });
});

test("matrix: closed and expired Apply", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await signInHomeUser(page, fixture.candidate.email);
  const databaseFixture = fixture.databaseFixture;
  const activeSecond = databaseFixture.jobs.activeSecond;
  const cvId = (
    fixture.databaseFixture as typeof fixture.databaseFixture & {
      confirmedCvIds: string[];
    }
  ).confirmedCvIds[0];
  await runState(testInfo, page, "closed Apply", async () => {
    await runHomeE2EControl("close-authoritative-job", {
      jobId: activeSecond.id,
      companyId: databaseFixture.company.id,
      actorUserId: fixture.employer.id,
    });
    await page.goto(
      "/jobs/" +
        activeSecond.slug +
        "/apply?cvVersionId=" +
        encodeURIComponent(cvId),
    );
    await expect(page.locator("body")).toContainText(
      /no longer accepting|not available|unavailable|closed/i,
    );
    await assertQuality(page);
  });
  await runState(testInfo, page, "expired Apply", async () => {
    await runPhase5BrowserControl("expire-apply-job", {
      jobId: activeSecond.id,
    });
    await page.goto(
      "/jobs/" +
        activeSecond.slug +
        "/apply?cvVersionId=" +
        encodeURIComponent(cvId),
    );
    await expect(page.locator("body")).toContainText(
      /no longer accepting|not available|unavailable|expired|closed/i,
    );
    await assertQuality(page);
  });
});
