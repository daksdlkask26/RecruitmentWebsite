import { resolve } from "node:path";
import { config as loadEnvironment } from "dotenv";
import axe from "axe-core";
import { expect, test, type Page } from "@playwright/test";
import { runCandidateFirstE2EControl } from "../../../helpers/candidate-first-e2e-control";
import {
  runCandidatePhase3E2EControl,
  type CandidatePhase3BrowserFixture,
} from "../../../helpers/candidate-phase3-e2e-control";

loadEnvironment({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const enabled = process.env.RUN_CANDIDATE_PHASE3_E2E === "1";
const password = "Candidate-first fixture 2026!";

let fixture: CandidatePhase3BrowserFixture | undefined;

async function login(page: Page, email: string) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2_000);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const loginResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/identity/login",
  );
  await page.getByRole("button", { name: "Sign in" }).click();
  expect((await loginResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/dashboard$/u, { timeout: 30_000 });
}

async function assertNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
}

async function assertAccessibleThemeState(
  page: Page,
  selector = 'main[aria-labelledby="team-applications-title"]',
) {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.evaluate(() => localStorage.removeItem("smarthire-theme"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1_000);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.addScriptTag({ content: axe.source });
  const violations = await page.locator(selector).evaluate(async (main) => {
    const report = await (
      window as typeof window & {
        axe: {
          run: (context: Element) => Promise<{
            violations: Array<{ id: string; impact?: string | null }>;
          }>;
        };
      }
    ).axe.run(main);
    return report.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    );
  });
  expect(violations).toEqual([]);
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  if (!enabled) return;
  fixture =
    await runCandidatePhase3E2EControl<CandidatePhase3BrowserFixture>("create");
});

test.afterAll(async () => {
  if (!fixture) return;
  await runCandidatePhase3E2EControl("delete", { fixture });
});

test("Candidate timeline keeps durable history after refresh and job removal", async ({
  page,
}) => {
  test.skip(
    !enabled,
    "Set RUN_CANDIDATE_PHASE3_E2E=1 with an isolated *_test database to run the Phase 3 browser journey.",
  );
  if (!fixture) throw new Error("PHASE3_E2E_FIXTURE_NOT_READY");
  test.setTimeout(120_000);
  await login(page, fixture.candidateEmail);
  await page.goto(`/jobs/applied/${fixture.applicationId}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("#application-tracker-title:visible")).toHaveCount(
    1,
  );

  const liveJob = await runCandidateFirstE2EControl<{
    title: string;
    location: string;
    status: "ACTIVE" | "CLOSED";
    removedAt: string | null;
  }>("read-job", { jobId: fixture.activeJobId });
  try {
    await runCandidateFirstE2EControl("seed-timeline", {
      applicationId: fixture.applicationId,
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.locator('[data-event-code="APPLICATION_SUBMITTED"]:visible'),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-event-code="APPLICATION_SUBMITTED"]:visible'),
    ).toBeVisible();
    await expect(
      page.locator('[data-event-code="APPLICATION_VIEWED"]:visible'),
    ).toBeVisible();
    await expect(
      page.locator('[data-event-code="APPLICATION_SHORTLISTED"]:visible'),
    ).toBeVisible();
    await expect(
      page.locator('[data-event-code="INTERVIEW_STARTED"]:visible'),
    ).toBeVisible();
    await expect(
      page.locator('[data-event-code="APPLICATION_REJECTED"]:visible'),
    ).toBeVisible();
    await expect(
      page
        .locator("p:visible")
        .filter({ hasText: /^The hiring team completed its decision\.$/u }),
    ).toHaveCount(1);
    await expect(
      page.locator("#application-tracker-title:visible"),
    ).toHaveCount(1);

    await runCandidateFirstE2EControl("update-job", {
      jobId: fixture.activeJobId,
      data: {
        title: "Phase 3 removed listing",
        location: "Phase 3 removed location",
        status: "CLOSED",
        removedAt: new Date(),
      },
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: /This job listing is no longer available\./u })
        .first(),
    ).toBeVisible();
    const submittedSnapshot = page.locator("#submitted-files").first();
    await expect(submittedSnapshot).toBeVisible();
    const snapshotText = await submittedSnapshot.textContent();
    expect(snapshotText).toContain("TypeScript");
    expect(snapshotText).toContain("Full time");
    await expect(
      submittedSnapshot.getByText("Phase 3 removed listing", { exact: true }),
    ).toHaveCount(0);
  } finally {
    await runCandidateFirstE2EControl("update-job", {
      jobId: fixture.activeJobId,
      data: liveJob,
    });
  }
});

test("Candidate ordinary and Team lists traverse bounded pages and restore deep filters", async ({
  page,
}) => {
  test.skip(
    !enabled,
    "Set RUN_CANDIDATE_PHASE3_E2E=1 with an isolated *_test database to run the Phase 3 browser journey.",
  );
  if (!fixture) throw new Error("PHASE3_E2E_FIXTURE_NOT_READY");
  test.setTimeout(180_000);
  await login(page, fixture.candidateEmail);

  await page.goto("/jobs/applied?filter=ALL&sort=SUBMITTED_DESC", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(3_000);
  await expect(
    page.getByRole("heading", { name: "Applications" }),
  ).toBeVisible();
  await expect(page.getByText("26 applications")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(24);
  const ordinaryPageOneUrl = page.url();
  const ordinaryLoadMore = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/candidate/applications" &&
      new URL(response.url()).searchParams.has("cursor"),
  );
  await page.getByRole("button", { name: "Next page" }).click();
  expect((await ordinaryLoadMore).status()).toBe(200);
  await expect(page.getByRole("article")).toHaveCount(2, {
    timeout: 30_000,
  });
  const ordinaryPageTwoUrl = page.url();
  expect(new URL(ordinaryPageTwoUrl).searchParams.get("cursor")).toBeTruthy();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("article")).toHaveCount(2, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1_000);
  await page.goBack();
  await expect(page).toHaveURL(ordinaryPageOneUrl);
  await expect(page.getByRole("article")).toHaveCount(24, {
    timeout: 30_000,
  });
  await page.goForward();
  await expect(page).toHaveURL(ordinaryPageTwoUrl);
  await expect(page.getByRole("article")).toHaveCount(2, {
    timeout: 30_000,
  });
  await assertAccessibleThemeState(
    page,
    'section[aria-labelledby="candidate-applications-title"]',
  );

  await page.getByRole("button", { name: /Filter: All applications/u }).click();
  const interviewFilterResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === "GET" &&
      url.pathname === "/api/candidate/applications" &&
      url.searchParams.get("filter") === "INTERVIEW" &&
      !url.searchParams.has("cursor")
    );
  });
  await page.getByRole("option", { name: /Interview/u }).click();
  expect((await interviewFilterResponse).status()).toBe(200);
  await expect(page.locator('[data-stage="interviewing"]')).toHaveCount(1);
  expect(new URL(page.url()).searchParams.get("filter")).toBe("INTERVIEW");

  await page.goto("/jobs/applied/team?sort=SUBMITTED_DESC", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(3_000);
  await expect(
    page.getByRole("heading", { name: "Team Applications" }),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(24);
  const teamPageOneUrl = page.url();
  const teamLoadMore = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/candidate/team-applications" &&
      new URL(response.url()).searchParams.has("cursor"),
  );
  await page.getByRole("button", { name: "Next page" }).click();
  expect((await teamLoadMore).status()).toBe(200);
  await expect(page.getByRole("article")).toHaveCount(3, {
    timeout: 30_000,
  });
  const teamPageTwoUrl = page.url();
  expect(new URL(teamPageTwoUrl).searchParams.get("cursor")).toBeTruthy();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("article")).toHaveCount(3, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1_000);
  await page.goBack();
  await expect(page).toHaveURL(teamPageOneUrl);
  await expect(page.getByRole("article")).toHaveCount(24, {
    timeout: 30_000,
  });
  await page.goForward();
  await expect(page).toHaveURL(teamPageTwoUrl);
  await expect(page.getByRole("article")).toHaveCount(3, {
    timeout: 30_000,
  });
  await assertAccessibleThemeState(page);
  await assertNoHorizontalOverflow(page);
});

test("Owner selects an explicit company, opens an authorized CV, reconciles decisions, and restores history", async ({
  page,
}) => {
  test.skip(
    !enabled,
    "Set RUN_CANDIDATE_PHASE3_E2E=1 with an isolated *_test database to run the Phase 3 browser journey.",
  );
  if (!fixture) throw new Error("PHASE3_E2E_FIXTURE_NOT_READY");
  test.setTimeout(180_000);
  await login(page, fixture.employerEmail);
  await page.goto("/recruiter/company-settings/team/applications", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(3_000);
  await expect(
    page.getByText("Choose a company to view its Team Applications."),
  ).toBeVisible();

  const companySelect = page.getByRole("combobox", { name: "Company scope" });
  await companySelect.selectOption(fixture.companyIds[0]!);
  await expect(page).toHaveURL(
    new RegExp(`[?&]companyId=${fixture.companyIds[0]}`),
  );
  await expect(page.getByText("25 applications")).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(24);
  const ownerPageOneUrl = page.url();
  const ownerNextResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === "GET" &&
      url.pathname === "/api/recruiter/company/team/applications" &&
      url.searchParams.has("cursor")
    );
  });
  await page.getByRole("button", { name: "Next page" }).click();
  expect((await ownerNextResponse).status()).toBe(200);
  await expect(page.getByRole("listitem")).toHaveCount(1, {
    timeout: 30_000,
  });
  const ownerPageTwoUrl = page.url();
  expect(new URL(ownerPageTwoUrl).searchParams.get("cursor")).toBeTruthy();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("listitem")).toHaveCount(1, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1_000);
  await page.goBack();
  await expect(page).toHaveURL(ownerPageOneUrl);
  await expect(page.getByRole("listitem")).toHaveCount(24, {
    timeout: 30_000,
  });
  await page.goForward();
  await expect(page).toHaveURL(ownerPageTwoUrl);
  await expect(page.getByRole("listitem")).toHaveCount(1, {
    timeout: 30_000,
  });
  await page.goBack();
  await expect(page).toHaveURL(ownerPageOneUrl);
  await expect(page.getByRole("listitem")).toHaveCount(24, {
    timeout: 30_000,
  });

  await page.getByRole("listitem").nth(0).getByRole("button").click();
  await expect(
    page.getByRole("heading", { name: "Job Candidate 1" }),
  ).toBeVisible();
  const cvLink = page.getByRole("link", { name: "View CV" });
  const cvHref = await cvLink.getAttribute("href");
  expect(cvHref).toBeTruthy();
  const cvResponse = await page.request.get(
    new URL(cvHref!, page.url()).toString(),
  );
  expect(cvResponse.status()).toBe(200);
  expect(cvResponse.headers()["content-type"]).toMatch(/application\/pdf/u);
  expect((await cvResponse.body()).byteLength).toBeGreaterThan(0);
  expect(cvResponse.headers()["x-storage-locator"]).toBeUndefined();

  await page.getByRole("button", { name: "Accept and invite" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Accept and invite" })
    .click();
  await expect(page.getByRole("status")).toHaveText(
    "The application was accepted and the invitation was sent.",
    { timeout: 30_000 },
  );
  const firstSelectedUrl = page.url();

  await page.getByRole("listitem").nth(1).getByRole("button").click();
  await expect(
    page.getByRole("button", { name: "Reject application" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reject application" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Reject application" })
    .click();
  await expect(page.getByRole("status")).toHaveText(
    "The team application was rejected.",
    { timeout: 30_000 },
  );

  const selectedUrl = page.url();
  expect(new URL(selectedUrl).searchParams.get("selected")).toBeTruthy();
  await page.goBack();
  await expect(page).toHaveURL(firstSelectedUrl);
  await expect(
    page.getByRole("heading", { name: "Job Candidate 1" }),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(
    new RegExp(`[?&]companyId=${fixture.companyIds[0]}`),
  );
  expect(new URL(page.url()).searchParams.get("selected")).toBeNull();
  await expect(page.getByText("Select an application")).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(firstSelectedUrl);
  await page.goForward();
  await expect(page).toHaveURL(selectedUrl);
  await expect(page.getByRole("status")).toHaveText(
    "The team application was rejected.",
  );

  await companySelect.selectOption(fixture.companyTwoId);
  await expect(page).toHaveURL(
    new RegExp(`[?&]companyId=${fixture.companyTwoId}`),
  );
  await expect(page.getByText("1 application")).toBeVisible();
  const companyTwoUrl = page.url();
  await page.goBack();
  if (
    new URL(page.url()).searchParams.get("companyId") === fixture.companyTwoId
  )
    await page.goBack();
  await expect(page).toHaveURL(
    new RegExp(`[?&]companyId=${fixture.companyIds[0]}`),
  );
  await page.goForward();
  if (page.url() !== companyTwoUrl) await page.goForward();
  await expect(page).toHaveURL(
    new RegExp(`[?&]companyId=${fixture.companyTwoId}`),
  );
  await assertAccessibleThemeState(page);
  await assertNoHorizontalOverflow(page);
});
