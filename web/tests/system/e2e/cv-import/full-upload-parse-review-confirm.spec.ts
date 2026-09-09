import { readdir, readFile, unlink } from "node:fs/promises";
import { relative, resolve } from "node:path";

import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { Pool } from "pg";

import { createSyntheticPdf } from "../../../helpers/cv-document-buffers";
import { cleanupReviewAccounts } from "../../../helpers/cv-review-fixture";

test.describe.configure({ mode: "serial" });

const password = "Synthetic uninterrupted CV 004!";
const selectedHeadline = "Selected Full Journey Engineer";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const contexts: BrowserContext[] = [];
const candidateEmails = new Set<string>();

async function deleteExactLocalArtifacts(
  artifacts: ReadonlyArray<{ storageAdapter: string; storageLocator: string }>,
) {
  const localArtifacts = artifacts.filter(
    ({ storageAdapter }) => storageAdapter === "filesystem",
  );
  if (localArtifacts.length === 0) return;
  const allowedRoots = new Set([
    resolve(process.cwd(), ".local/cv-storage"),
    resolve(process.cwd(), ".local/cv-storage-cf-phase2"),
  ]);
  const allowedRoot = resolve(process.cwd(), ".local/cv-storage");
  const configuredRoot = resolve(
    process.env.CV_STORAGE_LOCAL_ROOT ?? allowedRoot,
  );
  if (!allowedRoots.has(configuredRoot)) {
    throw new Error("CV_E2E_STORAGE_ROOT_UNSAFE");
  }
  for (const { storageLocator } of localArtifacts) {
    if (!/^[A-Za-z0-9_-]{32,128}$/u.test(storageLocator)) {
      throw new Error("CV_E2E_STORAGE_LOCATOR_UNSAFE");
    }
    const target = resolve(configuredRoot, storageLocator);
    const path = relative(configuredRoot, target);
    if (
      !path ||
      path.startsWith("..") ||
      path.includes("/") ||
      path.includes("\\")
    ) {
      throw new Error("CV_E2E_STORAGE_TARGET_UNSAFE");
    }
    await unlink(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

test.afterAll(async () => pool.end());

test.afterEach(async () => {
  try {
    const emails = [...candidateEmails];
    candidateEmails.clear();
    if (emails.length > 0) {
      const client = await pool.connect();
      try {
        const accounts = await client.query<{ id: string }>(
          `SELECT "id" FROM "user" WHERE "normalizedEmail" = ANY($1::text[])`,
          [emails.map((email) => email.toLowerCase())],
        );
        const accountIds = accounts.rows.map(({ id }) => id);
        const artifacts = await client.query<{
          storageAdapter: string;
          storageLocator: string;
        }>(
          `SELECT "storageAdapter", "storageLocator"
             FROM "CvStoredArtifact"
            WHERE "accountId" = ANY($1::text[])`,
          [accountIds],
        );
        await deleteExactLocalArtifacts(artifacts.rows);
        await cleanupReviewAccounts(client, accountIds);
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

async function registerCandidate(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  const email = `cv-full-journey-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
  candidateEmails.add(email);
  const mailDirectory = resolve(process.cwd(), ".local/mail");
  const before = new Set(await readdir(mailDirectory).catch(() => []));

  await page.goto("/register");
  await page.getByLabel("Full name").fill("Uninterrupted CV Candidate");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  const registration = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/identity/register",
  );
  await page.getByRole("button", { name: "Create account" }).click();
  expect((await registration).status()).toBe(202);

  let verificationLink = "";
  await expect
    .poll(
      async () => {
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
      },
      { timeout: 30_000 },
    )
    .not.toBe("");
  await page.goto(verificationLink);
  await page.getByRole("link", { name: "Continue to login" }).click();
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

test("uploads, generates, reviews, selects, and confirms one uninterrupted import", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const page = await registerCandidate(browser);
  const profileBefore = await page.request
    .get("/api/account/profile")
    .then((response) => response.json());

  await page.goto("/profile/cv-imports");
  await expect(page.getByRole("button", { name: /upload cv/i })).toBeEnabled();
  const document = createSyntheticPdf(
    "Synthetic generated proposal for the uninterrupted Feature 004 journey",
  );
  await page.getByLabel("CV file").setInputFiles({
    name: "synthetic-full-journey.pdf",
    mimeType: "application/pdf",
    buffer: document,
  });
  await expect(
    page.getByRole("status").filter({ hasText: /is ready to upload/i }),
  ).toBeVisible();
  const reservationPromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/account/cv-imports",
  );
  await page.getByRole("button", { name: /upload cv/i }).click();
  const reservation = await reservationPromise;
  expect(reservation.status()).toBe(201);
  const { uploadId } = (await reservation.json()) as { uploadId: string };

  await expect(
    page.getByRole("status").filter({ hasText: /review ready/i }),
  ).toBeVisible({ timeout: 90_000 });

  const generated = await pool.query<{
    uploadStatus: string;
    draftId: string;
    proposalPresent: boolean;
    parseCompletedAt: Date;
  }>(
    `SELECT upload."status" AS "uploadStatus", draft."id" AS "draftId",
            draft."proposalPayload" IS NOT NULL AS "proposalPresent",
            parse."completedAt" AS "parseCompletedAt"
       FROM "CvUpload" upload
       JOIN "CvDraft" draft ON draft."uploadId" = upload."id"
       JOIN "CvParseJob" parse ON parse."id" = draft."parseJobId"
      WHERE upload."id" = $1`,
    [uploadId],
  );
  expect(generated.rows).toHaveLength(1);
  expect(generated.rows[0]).toMatchObject({
    uploadStatus: "REVIEW_READY",
    proposalPresent: true,
    parseCompletedAt: expect.any(Date),
  });
  expect(
    await page.request
      .get("/api/account/profile")
      .then((response) => response.json()),
  ).toEqual(profileBefore);

  await page.goto(`/profile/cv-imports/${uploadId}/review`);
  await expect(
    page.getByRole("heading", { name: "Review CV proposals" }),
  ).toBeVisible();
  await page.getByLabel("Proposed headline").fill(selectedHeadline);
  await page
    .getByRole("group", { name: "Decision for headline" })
    .getByRole("radio", { name: "add" })
    .check();
  await page
    .getByRole("checkbox", { name: "I have reviewed every proposal." })
    .check();
  await page.getByRole("button", { name: "Save review" }).click();
  await expect(page.getByRole("status")).toContainText("Review saved");

  const profileBeforeConfirm = await page.request
    .get("/api/account/profile")
    .then((response) => response.json());
  expect(profileBeforeConfirm).toEqual(profileBefore);

  await page
    .getByRole("checkbox", {
      name: /confirm updates my candidate profile/i,
    })
    .check();
  const confirmationPromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname ===
        `/api/account/cv-drafts/${generated.rows[0].draftId}/confirm`,
  );
  await page.getByRole("button", { name: "Confirm selected changes" }).click();
  await expect(
    page.getByRole("heading", { name: "CV import confirmed" }),
  ).toBeVisible();
  const confirmation = await confirmationPromise;
  expect(confirmation.status()).toBe(201);
  const receipt = await confirmation.json();

  const profileAfter = await page.request
    .get("/api/account/profile")
    .then((response) => response.json());
  expect(profileAfter).toEqual({
    ...profileBefore,
    empty: false,
    revision: profileBefore.revision + 1,
    basics: { ...profileBefore.basics, headline: selectedHeadline },
  });
  expect(receipt).toMatchObject({
    uploadId,
    draftId: generated.rows[0].draftId,
    profileRevisionBefore: profileBefore.revision,
    profileRevisionAfter: profileBefore.revision + 1,
    appliedCounts: {
      scalars: 1,
      experiences: 0,
      education: 0,
      skills: 0,
      socialLinks: 0,
    },
  });
  expect(receipt.profileRevisionAfter).toBe(receipt.profileRevisionBefore + 1);
  expect(JSON.stringify(receipt)).not.toContain(selectedHeadline);
  expect(JSON.stringify(receipt)).not.toContain("synthetic-full-journey.pdf");

  const persisted = await pool.query<{
    headline: string;
    revision: number;
    confirmationCount: number;
  }>(
    `SELECT profile."headline", profile."revision",
            count(receipt."id")::int AS "confirmationCount"
       FROM "CandidateProfile" profile
       JOIN "CvUpload" upload ON upload."profileId" = profile."id"
       JOIN "CvImportConfirmation" receipt ON receipt."uploadId" = upload."id"
      WHERE upload."id" = $1
      GROUP BY profile."id"`,
    [uploadId],
  );
  expect(persisted.rows).toEqual([
    {
      headline: selectedHeadline,
      revision: profileBefore.revision + 1,
      confirmationCount: 1,
    },
  ]);
});
