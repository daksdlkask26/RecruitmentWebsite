import { resolve } from "node:path";
import { config as loadEnvironment } from "dotenv";
import { expect, test, type Page } from "@playwright/test";
import { runCandidateFirstE2EControl } from "../../../helpers/candidate-first-e2e-control";
import type { CandidateFirstDatabaseFixture } from "../../../helpers/candidate-first-database-fixture";

loadEnvironment({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const enabled = process.env.RUN_CANDIDATE_FIRST_E2E === "1";
const password = "Candidate-first fixture 2026!";
let fixture: CandidateFirstDatabaseFixture | undefined;

async function gotoReady(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
}

async function expectApplicationReceipt(page: Page, applicationId: string) {
  await expect(
    page.getByRole("heading", {
      name: "Application intake progress",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("progressbar", {
      name: "Application intake progress",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(`Application ID: ${applicationId}`, { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("strong").filter({ hasText: /^Application received$/u }),
  ).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  if (!enabled) return;
  fixture = await runCandidateFirstE2EControl<CandidateFirstDatabaseFixture>(
    "create",
    { label: "cf301-submission" },
  );
});

test.afterAll(async () => {
  if (fixture) await runCandidateFirstE2EControl("delete", { fixture });
});

test("submits once and reloads the durable Candidate receipt without another POST", async ({
  browser,
  page,
}) => {
  test.skip(
    !enabled,
    "Set RUN_CANDIDATE_FIRST_E2E=1 with an isolated *_test database to run the CF-301 browser journey.",
  );
  if (!fixture) throw new Error("CF301_FIXTURE_NOT_READY");
  const currentFixture = fixture;
  test.setTimeout(180_000);

  await gotoReady(page, "/login");
  await page.getByLabel("Email address").fill(currentFixture.candidateEmail);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const login = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/identity/login",
  );
  await page.getByRole("button", { name: "Sign in" }).click();
  expect((await login).status()).toBe(200);
  await expect(page).toHaveURL(/\/dashboard$/u);

  await gotoReady(page, `/jobs/${currentFixture.jobs.activeSecond.slug}/apply`);
  const phone = page.getByLabel("Phone number");
  if (!(await phone.inputValue())) await phone.fill("0901234567");
  await page
    .getByRole("button", { name: "Continue to Application files" })
    .click();
  await page.getByRole("radiogroup").getByRole("radio").first().click();
  await page
    .getByRole("button", { name: "Continue to Review and submit" })
    .click();
  await expect(page).toHaveURL(/\/apply\/review\?draftId=/u);
  await page
    .getByRole("checkbox", {
      name: /I confirm that the information is correct/i,
    })
    .check();

  let submitPosts = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/candidate/applications"
    )
      submitPosts += 1;
  });
  const submission = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/candidate/applications",
  );
  await page.getByRole("button", { name: "Submit application" }).click();
  const response = await submission;
  expect(response.status()).toBe(201);
  const applicationId = ((await response.json()) as { applicationId?: string })
    .applicationId;
  expect(applicationId).toBeTruthy();
  if (!applicationId) throw new Error("CF301_APPLICATION_ID_MISSING");
  const receiptPath = `/jobs/applied/${applicationId}/processing`;
  await expect(page).toHaveURL(new RegExp(`${receiptPath}$`, "u"));
  await expectApplicationReceipt(page, applicationId);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(new RegExp(`${receiptPath}$`, "u"));
  await expectApplicationReceipt(page, applicationId);
  await page.goBack({ waitUntil: "domcontentloaded" });
  await page.goForward({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(new RegExp(`${receiptPath}$`, "u"));
  await expectApplicationReceipt(page, applicationId);
  expect(submitPosts).toBe(1);

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  let secondSubmitPosts = 0;
  secondPage.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/candidate/applications"
    )
      secondSubmitPosts += 1;
  });
  try {
    await gotoReady(secondPage, "/login");
    await secondPage
      .getByLabel("Email address")
      .fill(currentFixture.candidateEmail);
    await secondPage.getByLabel("Password", { exact: true }).fill(password);
    const secondLogin = secondPage.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/identity/login",
    );
    await secondPage.getByRole("button", { name: "Sign in" }).click();
    expect((await secondLogin).status()).toBe(200);
    await gotoReady(secondPage, receiptPath);
    await expectApplicationReceipt(secondPage, applicationId);
    expect(secondSubmitPosts).toBe(0);
  } finally {
    await secondContext.close();
  }
});
