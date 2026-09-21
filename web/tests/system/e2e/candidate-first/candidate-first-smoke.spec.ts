import { resolve } from "node:path";
import { config as loadEnvironment } from "dotenv";
import axe from "axe-core";
import { expect, test, type Page } from "@playwright/test";

import { runCandidateFirstE2EControl } from "../../../helpers/candidate-first-e2e-control";
import { createSyntheticPdf } from "../../../helpers/cv-document-buffers";
import type { CandidateFirstDatabaseFixture } from "../../../helpers/candidate-first-database-fixture";

loadEnvironment({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const enabled = process.env.RUN_CANDIDATE_FIRST_E2E === "1";
const password = "Candidate-first fixture 2026!";

type Fixture = CandidateFirstDatabaseFixture;

let fixture: Fixture | undefined;

async function step(page: Page, name: string, action: () => Promise<void>) {
  try {
    await test.step(name, action);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`[CF-003 ${name}] ${page.url()}\n${detail}`, {
      cause: error,
    });
  }
}

async function gotoReady(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  // Workspace shell endpoints poll while the session is active, so waiting
  // for a global network-idle/load event is not a stable readiness condition.
  // Give the App Router client enough time to attach handlers before the
  // journey performs an input action.
  await page.waitForTimeout(2_000);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  if (!enabled) return;
  fixture = await runCandidateFirstE2EControl<Fixture>("create", {
    label: "smoke",
  });
});

test.afterAll(async () => {
  if (!fixture) return;
  await runCandidateFirstE2EControl("delete", { fixture });
});

test("runs the Candidate journey from CV import through application and messaging", async ({
  page,
  browser,
}) => {
  test.skip(
    !enabled,
    "Set RUN_CANDIDATE_FIRST_E2E=1 with an isolated *_test database to run the DB-backed smoke journey.",
  );
  if (!fixture) throw new Error("CF-003_FIXTURE_NOT_READY");
  test.setTimeout(300_000);

  let uploadId = "";
  let submittedApplicationId = "";

  await step(page, "login", async () => {
    await gotoReady(page, "/login");
    await page.getByLabel("Email address").fill(fixture!.candidateEmail);
    await page.getByLabel("Password", { exact: true }).fill(password);
    const response = page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" &&
        new URL(candidate.url()).pathname === "/api/identity/login",
    );
    await page.getByRole("button", { name: "Sign in" }).click();
    expect((await response).status()).toBe(200);
    await expect(page).toHaveURL(/\/dashboard$/u, { timeout: 30_000 });
  });

  await step(page, "profile", async () => {
    await gotoReady(page, "/profile");
    await expect(page.locator("main").first()).toBeVisible();
  });

  await step(page, "upload CV", async () => {
    await gotoReady(page, "/profile/cv-imports");
    const document = createSyntheticPdf(
      "Candidate-first smoke journey deterministic review proposal",
    );
    await page.getByLabel("CV file").setInputFiles({
      name: "candidate-first-smoke.pdf",
      mimeType: "application/pdf",
      buffer: document,
    });
    await expect(
      page.getByRole("status").filter({ hasText: /ready to upload/i }),
    ).toBeVisible();
    const reservation = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/account/cv-imports",
    );
    const contentUpload = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        new URL(response.url()).pathname.endsWith("/content"),
    );
    await page.getByRole("button", { name: /upload cv/i }).click();
    const response = await reservation;
    expect(response.status()).toBe(201);
    uploadId = ((await response.json()) as { uploadId: string }).uploadId;
    expect(uploadId).toBeTruthy();
    expect((await contentUpload).status()).toBe(202);
  });

  await step(page, "CV status", async () => {
    await gotoReady(
      page,
      `/profile/cv-imports/${encodeURIComponent(uploadId)}`,
    );
    await expect(page.locator("main").first()).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: /review ready/i }),
    ).toBeVisible({ timeout: 90_000 });
  });

  await step(page, "review CV", async () => {
    await gotoReady(
      page,
      `/profile/cv-imports/${encodeURIComponent(uploadId)}/review`,
    );
    await expect(
      page.getByRole("heading", { name: "Review CV proposals" }),
    ).toBeVisible();
    await page.getByLabel("Proposed headline").fill("Candidate-first Engineer");
    await page
      .getByRole("group", { name: "Decision for headline" })
      .getByRole("radio", { name: "Replace" })
      .check();
    await page
      .getByRole("checkbox", { name: "I have reviewed every proposal." })
      .check();
    await page.getByRole("button", { name: "Save review" }).click();
    await expect(page.getByRole("status")).toContainText("Review saved", {
      timeout: 30_000,
    });
  });

  await step(page, "confirm CV", async () => {
    await page
      .getByRole("checkbox", { name: /confirm updates my candidate profile/i })
      .check();
    await page
      .getByRole("button", { name: "Confirm selected changes" })
      .click();
    await expect(
      page.getByRole("heading", { name: "CV import confirmed" }),
    ).toBeVisible({ timeout: 30_000 });
  });

  await step(page, "Home", async () => {
    await gotoReady(page, "/");
    await expect(page.locator("main").first()).toBeVisible();
  });

  await step(page, "Jobs", async () => {
    await gotoReady(page, "/jobs");
    await expect(page).toHaveURL(/\/jobs(?:\?|$)/u);
    await expect(page.getByRole("heading").first()).toBeVisible();
  });

  await step(page, "Company", async () => {
    await gotoReady(page, "/company");
    await expect(page).toHaveURL(/\/company(?:\?|$)/u);
    await expect(page.locator("main").first()).toBeVisible();
  });

  await step(page, "Job Detail", async () => {
    await gotoReady(
      page,
      `/jobs/${encodeURIComponent(fixture!.jobs.activeSecond.slug)}`,
    );
    await expect(
      page.getByRole("heading", { name: fixture!.jobs.activeSecond.title }),
    ).toBeVisible();
  });

  await step(page, "Apply", async () => {
    await page.getByRole("link", { name: "Apply now" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/jobs/${fixture!.jobs.activeSecond.slug}/apply$`, "u"),
      { timeout: 30_000 },
    );
    const phone = page.getByLabel("Phone number");
    if (!(await phone.inputValue())) await phone.fill("0901234567");
    await page
      .getByRole("button", { name: "Continue to Application files" })
      .click();
    await expect(
      page
        .getByRole("list", { name: "Application steps" })
        .getByText("Application files", { exact: true }),
    ).toBeVisible();
    await page.getByRole("radiogroup").getByRole("radio").first().click();
    await page.getByRole("tab", { name: "Write text" }).click();
    await page
      .locator("#application-cover-letter-text")
      .fill("A candidate-visible cover letter.");
    await page
      .getByRole("button", { name: "Continue to Review and submit" })
      .click();
    await expect(page).toHaveURL(/\/apply\/review\?draftId=/u, {
      timeout: 30_000,
    });
    await expect(page.getByRole("heading", { name: /Apply/u })).toBeVisible();
    await page
      .getByRole("checkbox", {
        name: /I confirm that the information is correct/i,
      })
      .check();
    await expect(
      page.getByRole("button", { name: "Submit application" }),
    ).toBeEnabled();
    const submission = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/api\/candidate\/applications$/u.test(
          new URL(response.url()).pathname,
        ),
    );
    await page.getByRole("button", { name: "Submit application" }).click();
    const response = await submission;
    const responseBody = await response.text();
    expect(response.status(), responseBody).toBe(201);
    submittedApplicationId =
      (JSON.parse(responseBody) as { applicationId?: string }).applicationId ??
      "";
    expect(submittedApplicationId).toBeTruthy();
    await expect(page).toHaveURL(
      new RegExp(`/jobs/applied/${submittedApplicationId}/processing$`, "u"),
      { timeout: 30_000 },
    );
    await expect(page.locator("main").first()).toBeVisible();
  });

  await step(page, "Candidate Applications", async () => {
    await gotoReady(page, "/jobs/applied");
    await expect(page.locator("main").first()).toBeVisible();
    await expect(
      page.locator(`a[href="/jobs/applied/${submittedApplicationId}"]`),
    ).toBeVisible();
  });

  await step(page, "application detail and file action", async () => {
    await gotoReady(page, `/jobs/applied/${submittedApplicationId}`);
    await expect(page.locator("#application-tracker-title")).toBeVisible();
    await runCandidateFirstE2EControl("seed-timeline", {
      applicationId: submittedApplicationId,
    });
    await page.reload({ waitUntil: "domcontentloaded" });
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
    ).toBeVisible();
    const submittedFiles = page.locator("#submitted-files").first();
    await expect(submittedFiles).toBeVisible();
    const openHref = await submittedFiles
      .getByRole("link", { name: "Open" })
      .first()
      .getAttribute("href");
    const downloadHref = await submittedFiles
      .getByRole("link", { name: "Download" })
      .first()
      .getAttribute("href");
    expect(openHref).toBe(
      `/api/candidate/applications/${submittedApplicationId}/documents/cv`,
    );
    expect(downloadHref).toBe(
      `/api/candidate/applications/${submittedApplicationId}/documents/cv?download=1`,
    );
    const openResponse = await page.request.get(
      new URL(openHref!, page.url()).toString(),
    );
    expect(openResponse.status()).toBe(200);
    expect(openResponse.headers()["content-type"]).toMatch(/application\/pdf/u);
    expect((await openResponse.body()).byteLength).toBeGreaterThan(0);
    expect(openResponse.headers()["x-storage-locator"]).toBeUndefined();
    const downloadResponse = await page.request.get(
      new URL(downloadHref!, page.url()).toString(),
    );
    expect(downloadResponse.status()).toBe(200);
    expect(downloadResponse.headers()["content-disposition"]).toMatch(
      /^attachment;/u,
    );
    expect((await downloadResponse.body()).byteLength).toBeGreaterThan(0);
    const coverLetterResponse = await page.request.get(
      new URL(
        `/api/candidate/applications/${submittedApplicationId}/documents/cover-letter`,
        page.url(),
      ).toString(),
    );
    expect(coverLetterResponse.status()).toBe(200);
    expect(await coverLetterResponse.text()).toBe(
      "A candidate-visible cover letter.",
    );
    await expect(
      submittedFiles.getByText("A candidate-visible cover letter.").first(),
    ).toBeVisible();
    await expect(
      submittedFiles.getByRole("heading", { name: "Submitted profile" }),
    ).toBeVisible();
    await expect(
      submittedFiles.getByRole("heading", { name: "Submitted contact" }),
    ).toBeVisible();
    await expect(
      submittedFiles.getByRole("heading", { name: "Submission consent" }),
    ).toBeVisible();

    await runCandidateFirstE2EControl("expire-application-document", {
      applicationId: submittedApplicationId,
      kind: "cv",
      mode: "expired",
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      submittedFiles.getByRole("link", { name: "Open" }),
    ).toHaveCount(0);
    await expect(
      submittedFiles.getByRole("link", { name: "Download" }),
    ).toHaveCount(0);
    await expect(
      submittedFiles.getByRole("status").filter({ hasText: "Expired" }).first(),
    ).toBeVisible();
    const expiredOpenResponse = await page.request.get(
      new URL(
        `/api/candidate/applications/${submittedApplicationId}/documents/cv`,
        page.url(),
      ).toString(),
    );
    expect(expiredOpenResponse.status()).toBe(404);
    expect((await expiredOpenResponse.body()).byteLength).toBe(0);
    expect(expiredOpenResponse.headers()["cache-control"]).toBe(
      "private, no-store",
    );
    expect(JSON.stringify(expiredOpenResponse.headers())).not.toMatch(
      /storage|locator|checksum|digest|hold|retention/iu,
    );
    const expiredDownloadResponse = await page.request.get(
      new URL(
        `/api/candidate/applications/${submittedApplicationId}/documents/cv?download=1`,
        page.url(),
      ).toString(),
    );
    expect(expiredDownloadResponse.status()).toBe(404);
    expect((await expiredDownloadResponse.body()).byteLength).toBe(0);
    expect(expiredDownloadResponse.headers()["cache-control"]).toBe(
      "private, no-store",
    );
    expect(JSON.stringify(expiredDownloadResponse.headers())).not.toMatch(
      /storage|locator|checksum|digest|hold|retention/iu,
    );

    await expect(submittedFiles).toContainText(
      fixture!.jobs.activeSecond.title,
    );
    await expect(
      submittedFiles.getByText("A candidate-visible cover letter.").first(),
    ).toBeVisible();

    const liveJob = await runCandidateFirstE2EControl<{
      title: string;
      location: string;
      status: "ACTIVE" | "CLOSED";
      removedAt: string | null;
    }>("read-job", { jobId: fixture!.jobs.activeSecond.id });
    try {
      await runCandidateFirstE2EControl("update-job", {
        jobId: fixture!.jobs.activeSecond.id,
        data: {
          title: "Removed live listing",
          location: "Removed live location",
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
      await expect(submittedFiles).toContainText(
        fixture!.jobs.activeSecond.title,
      );
      await expect(submittedFiles).toContainText(
        fixture!.jobs.activeSecond.location,
      );
      await expect(submittedFiles).not.toContainText("Removed live listing");
    } finally {
      await runCandidateFirstE2EControl("update-job", {
        jobId: fixture!.jobs.activeSecond.id,
        data: liveJob,
      });
    }

    await page.goto("/jobs/applied", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(1_000);
    await page.goBack({ waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(
      new RegExp(`/jobs/applied/${submittedApplicationId}$`, "u"),
      { timeout: 30_000 },
    );
    await page.goForward({ waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/jobs\/applied$/u);

    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.evaluate(() => localStorage.removeItem("smarthire-theme"));
    await page.goBack({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1_000);
    await expect(submittedFiles).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => {
      const report = await (
        window as typeof window & {
          axe: {
            run: () => Promise<{
              violations: Array<{ id: string; impact?: string | null }>;
            }>;
          };
        }
      ).axe.run();
      return report.violations.filter(
        (violation) =>
          violation.impact === "serious" || violation.impact === "critical",
      );
    });
    expect(violations).toEqual([]);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1,
      ),
    ).toBe(true);
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();
    const browserStorage = await page.evaluate(() =>
      JSON.stringify({
        localStorage: Object.fromEntries(Object.entries(localStorage)),
        sessionStorage: Object.fromEntries(Object.entries(sessionStorage)),
      }),
    );
    expect(browserStorage).not.toContain(fixture!.candidateEmail);
    expect(browserStorage).not.toContain("A candidate-visible cover letter.");

    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    try {
      await secondPage.goto("/login", {
        waitUntil: "domcontentloaded",
      });
      await secondPage
        .getByLabel("Email address")
        .fill(fixture!.candidateEmail);
      await secondPage.getByLabel("Password", { exact: true }).fill(password);
      await secondPage.getByRole("button", { name: "Sign in" }).click();
      await expect(secondPage).toHaveURL(/\/dashboard$/u, {
        timeout: 30_000,
      });
      await secondPage.goto(`/jobs/applied/${submittedApplicationId}`, {
        waitUntil: "domcontentloaded",
      });
      const secondSubmittedFiles = secondPage
        .locator("#submitted-files")
        .first();
      await expect(secondSubmittedFiles).toContainText(
        fixture!.jobs.activeSecond.title,
      );
      await expect(
        secondSubmittedFiles
          .getByText("A candidate-visible cover letter.")
          .first(),
      ).toBeVisible();
    } finally {
      await secondContext.close();
    }
  });

  await step(page, "notification", async () => {
    await gotoReady(page, "/notifications");
    await expect(page.locator("main").first()).toBeVisible();
    await expect(page.getByText("Application submitted").first()).toBeVisible();
  });

  await step(page, "message", async () => {
    await gotoReady(page, `/jobs/applied/${fixture!.applicationId}/messages`);
    await expect(page.locator("main").first()).toBeVisible();
    await expect(
      page.getByText(
        /Thanks for applying\. We will review your profile shortly\./i,
      ),
    ).toBeVisible();
  });
});
