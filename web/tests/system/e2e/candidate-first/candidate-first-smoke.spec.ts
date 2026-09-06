import { resolve } from "node:path";
import { config as loadEnvironment } from "dotenv";
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
    await expect(page).toHaveURL(/\/dashboard$/u);
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
    await page.getByRole("button", { name: /upload cv/i }).click();
    const response = await reservation;
    expect(response.status()).toBe(201);
    uploadId = ((await response.json()) as { uploadId: string }).uploadId;
    expect(uploadId).toBeTruthy();
  });

  await step(page, "CV status", async () => {
    await gotoReady(
      page,
      `/profile/cv-imports/${encodeURIComponent(uploadId)}`,
    );
    await expect(page.locator("main").first()).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: /ready for review/i }),
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
    await expect(page.getByRole("status")).toContainText("Review saved");
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
    ).toBeVisible();
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
    await page
      .getByRole("button", { name: "Continue to Review and submit" })
      .click();
    await expect(page).toHaveURL(/\/apply\/review\?draftId=/u);
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
    expect(response.status()).toBe(201);
    submittedApplicationId =
      ((await response.json()) as { applicationId?: string }).applicationId ??
      "";
    expect(submittedApplicationId).toBeTruthy();
    await expect(page).toHaveURL(
      new RegExp(`/jobs/applied/${submittedApplicationId}/processing$`, "u"),
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
    await expect(page.locator("#submitted-files")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /view unavailable for/i }).first(),
    ).toBeDisabled();
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
