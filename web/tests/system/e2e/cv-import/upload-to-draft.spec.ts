import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { Pool } from "pg";

import {
  createSyntheticDocx,
  createSyntheticPdf,
} from "../../../helpers/cv-document-buffers";
import { cleanupReviewAccounts } from "../../../helpers/cv-review-fixture";

test.describe.configure({ mode: "serial" });

const password = "Synthetic CV Feature 004!";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const contexts: BrowserContext[] = [];
const candidateEmails = new Set<string>();

test.afterAll(async () => pool.end());
test.afterEach(async () => {
  try {
    const emails = [...candidateEmails];
    candidateEmails.clear();
    if (emails.length) {
      const client = await pool.connect();
      try {
        const accounts = await client.query<{ id: string }>(
          `SELECT "id" FROM "user" WHERE "normalizedEmail" = ANY($1::text[])`,
          [emails.map((email) => email.toLowerCase())],
        );
        await cleanupReviewAccounts(
          client,
          accounts.rows.map((row) => row.id),
        );
      } finally {
        client.release();
      }
    }
  } finally {
    await Promise.allSettled(
      contexts.splice(0).map((context) => context.close()),
    );
  }
});

async function registerCandidate(
  browser: Browser,
  label: string,
): Promise<{ page: Page; email: string }> {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  const email = `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
  candidateEmails.add(email);
  const mailDirectory = resolve(process.cwd(), ".local/mail");
  const before = new Set(await readdir(mailDirectory).catch(() => []));
  await page.goto("/register");
  await page.getByLabel("Full name").fill(`Candidate ${label}`);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  let verificationLink = "";
  await expect
    .poll(async () => {
      for (const name of (await readdir(mailDirectory)).filter(
        (entry) => !before.has(entry),
      )) {
        const body = await readFile(resolve(mailDirectory, name), "utf8");
        if (body.includes(`To: ${email}`)) {
          verificationLink =
            body.match(
              /http:\/\/localhost:3001\/verify-email\?token=[A-Za-z0-9._~-]+/u,
            )?.[0] ?? "";
        }
      }
      return verificationLink;
    })
    .not.toBe("");
  await page.goto(verificationLink);
  await page.getByRole("link", { name: "Continue to login" }).click();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  return { page, email };
}

async function loginCandidate(
  browser: Browser,
  email: string,
): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const login = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/identity/login",
  );
  await page.getByRole("button", { name: "Sign in" }).click();
  expect((await login).status()).toBe(200);
  await expect(page).toHaveURL(/\/dashboard$/u);
  return page;
}

test("uploads synthetic PDF and DOCX through REVIEW_READY without mutating Profile", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const candidate = await registerCandidate(browser, "cv-upload");
  const page = candidate.page;
  const requests = { reservation: 0, content: 0 };
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/account/cv-imports"
    )
      requests.reservation += 1;
    if (
      request.method() === "PUT" &&
      /\/api\/account\/cv-imports\/[^/]+\/content$/u.test(
        new URL(request.url()).pathname,
      )
    )
      requests.content += 1;
  });
  const before = await page.request
    .get("/api/account/profile")
    .then((response) => response.json());
  for (const [index, fixture] of [
    {
      name: "synthetic.pdf",
      mimeType: "application/pdf",
      buffer: createSyntheticPdf(
        "Synthetic CV upload with enough searchable text for deterministic extraction",
      ),
    },
    {
      name: "synthetic.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: createSyntheticDocx(),
    },
  ].entries()) {
    await page.goto("/profile/cv-imports");
    await expect(
      page.getByRole("button", { name: /upload cv/i }),
    ).toBeEnabled();
    await page.getByLabel("CV file").setInputFiles(fixture);
    await expect(
      page.getByRole("status").filter({ hasText: /is ready to upload/i }),
    ).toBeVisible();
    await page.getByRole("button", { name: /upload cv/i }).click();
    await expect(
      page.getByRole("heading", { name: "CV processing status" }),
    ).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText("Review ready", { exact: true })).toBeVisible({
      timeout: 90_000,
    });
    await expect(page).toHaveURL(/\/profile\/cv-imports\/[^/]+$/u);
    const statusUrl = page.url();
    const countsAfterUpload = { ...requests };
    if (index === 0) {
      await page.reload();
      await expect(page).toHaveURL(statusUrl);
      await expect(page.getByText("Review ready", { exact: true })).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(/\/profile\/cv-imports$/u);
      await page.goForward();
      await expect(page).toHaveURL(statusUrl);
      expect(requests).toEqual(countsAfterUpload);

      const secondSession = await loginCandidate(browser, candidate.email);
      await secondSession.goto(statusUrl);
      await expect(
        secondSession.getByRole("heading", { name: "CV processing status" }),
      ).toBeVisible();
      await expect(
        secondSession.getByText("Review ready", { exact: true }),
      ).toBeVisible();
    }
    await page.goto("/profile/cv-imports");
    await expect(
      page
        .getByRole("listitem")
        .filter({ hasText: new RegExp(`${fixture.name}.*review ready`, "is") }),
    ).toBeVisible();
  }
  const after = await page.request
    .get("/api/account/profile")
    .then((response) => response.json());
  expect(after.revision).toBe(before.revision);
  expect(after).toEqual(before);
});

test("shows replacement guidance and denies a foreign import", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const ownerCandidate = await registerCandidate(browser, "cv-owner");
  const owner = ownerCandidate.page;
  await owner.route("**/api/account/cv-imports", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "CV_PROCESSING_UNAVAILABLE",
          message: "The CV processing service is unavailable.",
        },
      }),
    });
  });
  await owner.goto("/profile/cv-imports");
  await owner.getByLabel("CV file").setInputFiles({
    name: "reservation-failure.pdf",
    mimeType: "application/pdf",
    buffer: createSyntheticPdf(),
  });
  await owner.getByRole("button", { name: /upload cv/i }).click();
  await expect(owner).toHaveURL(/\/profile\/cv-imports$/u);
  await expect(owner.getByText("Upload failed.", { exact: true })).toBeVisible();
  await owner.unroute("**/api/account/cv-imports");

  await owner.route(
    "**/api/account/cv-imports/*/content",
    async (route) => {
      await route.fulfill({ status: 503, body: "content upload failed" });
    },
  );
  await owner.getByLabel("CV file").setInputFiles({
    name: "content-failure.pdf",
    mimeType: "application/pdf",
    buffer: createSyntheticPdf(),
  });
  await owner.getByRole("button", { name: /upload cv/i }).click();
  await expect(owner).toHaveURL(/\/profile\/cv-imports$/u);
  await expect(owner.getByText("Upload failed.", { exact: true })).toBeVisible();
  await owner.unroute("**/api/account/cv-imports/*/content");

  await owner.goto("/profile/cv-imports");
  await expect(owner.getByRole("button", { name: /upload cv/i })).toBeEnabled();
  await owner.getByLabel("CV file").setInputFiles({
    name: "image-only.pdf",
    mimeType: "application/pdf",
    buffer: createSyntheticPdf(""),
  });
  await expect(
    owner.getByRole("status").filter({ hasText: /is ready to upload/i }),
  ).toBeVisible();
  const reservationResponse = owner.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/account/cv-imports",
  );
  await owner.getByRole("button", { name: /upload cv/i }).click();
  const uploadId = String(
    ((await (await reservationResponse).json()) as { uploadId?: unknown })
      .uploadId ?? "",
  );
  await expect(owner.getByText(/replace.*cv/i)).toBeVisible({
    timeout: 90_000,
  });
  expect(uploadId).toBeTruthy();

  await expect(owner).toHaveURL(/\/profile\/cv-imports\/[^/]+$/u);
  const statusUrl = owner.url();
  const other = await registerCandidate(browser, "cv-other");
  const denied = await other.page.request.get(
    `/api/account/cv-imports/${uploadId}`,
  );
  expect(denied.status()).toBe(404);
  const foreignPage = await other.page.goto(statusUrl);
  expect(foreignPage?.status()).toBe(404);
  const foreignBody = await other.page.locator("body").innerText();
  expect(foreignBody).not.toContain("image-only.pdf");

  const missingPage = await other.page.goto(
    "/profile/cv-imports/nonexistent-upload-404",
  );
  expect(missingPage?.status()).toBe(404);
  const missingBody = await other.page.locator("body").innerText();
  expect(missingBody).not.toContain("image-only.pdf");
});
