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
  cleanupReviewAccounts,
  seedReviewDraft,
} from "../../../helpers/cv-review-fixture";

test.describe.configure({ mode: "serial" });

const password = "Synthetic CV Review 004!";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const candidateContexts: BrowserContext[] = [];
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
    const contexts = candidateContexts.splice(0);
    await Promise.allSettled(contexts.map((context) => context.close()));
  }
});

async function registerCandidate(
  browser: Browser,
  label: string,
): Promise<{ page: Page; email: string }> {
  const context = await browser.newContext();
  candidateContexts.push(context);
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
  const registrationResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/identity/register",
  );
  await page.getByRole("button", { name: "Create account" }).click();
  expect((await registrationResponse).status()).toBe(202);
  let verificationLink = "";
  await expect
    .poll(
      async () => {
        for (const name of (await readdir(mailDirectory)).filter(
          (entry) => !before.has(entry),
        )) {
          const body = await readFile(resolve(mailDirectory, name), "utf8");
          if (body.includes(`To: ${email}`))
            verificationLink =
              body.match(
                /http:\/\/localhost:3001\/verify-email\?token=[A-Za-z0-9._~-]+/u,
              )?.[0] ?? "";
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
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
  return { page, email };
}

async function seedForCandidate(email: string, label: string) {
  const client = await pool.connect();
  try {
    const owned = await client.query<{
      accountId: string;
      profileId: string;
      revision: number;
    }>(
      `SELECT account."id" AS "accountId", profile."id" AS "profileId", profile."revision"
         FROM "user" account
         JOIN "CandidateProfile" profile ON profile."candidateUserId" = account."id"
        WHERE account."normalizedEmail" = $1`,
      [email.toLowerCase()],
    );
    if (!owned.rows[0]) throw new Error("REGISTERED_CANDIDATE_PROFILE_MISSING");
    return await seedReviewDraft(client, label, {
      profileRevision: owned.rows[0].revision,
      existingAccount: owned.rows[0],
    });
  } finally {
    client.release();
  }
}

test("reviews, saves, reloads, selectively confirms, replays, and denies cross-account access", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const owner = await registerCandidate(browser, "cv-review-owner");
  const seeded = await seedForCandidate(owner.email, "e2e-review");
  const profileBefore = await owner.page.request
    .get("/api/account/profile")
    .then((response) => response.json());
  const coldReviewLoadStartedAt = performance.now();
  await owner.page.goto(`/profile/cv-imports/${seeded.uploadId}/review`);
  await expect(
    owner.page.getByRole("heading", { name: "Review CV proposals" }),
  ).toBeVisible();
  const unavailableReceipt = await owner.page.request.get(
    `/profile/cv-imports/${seeded.uploadId}/receipt`,
  );
  const unavailableReceiptBody = await unavailableReceipt.text();
  expect(unavailableReceipt.status()).toBe(404);
  expect(unavailableReceiptBody).not.toContain("Platform Engineer");
  const coldReviewLoadMs = performance.now() - coldReviewLoadStartedAt;
  const rejectedWarmups = await owner.page.evaluate(async (draftId) => {
    const options: RequestInit = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    };
    const [save, confirm] = await Promise.all([
      fetch(`/api/account/cv-drafts/${draftId}`, {
        ...options,
        method: "PATCH",
      }),
      fetch(`/api/account/cv-drafts/${draftId}/confirm`, options),
    ]);
    return [save.status, confirm.status];
  }, seeded.draftId);
  expect(rejectedWarmups).toEqual([403, 400]);
  await owner.page.goto("/profile/cv-imports");
  const reviewLoadStartedAt = performance.now();
  await owner.page.goto(`/profile/cv-imports/${seeded.uploadId}/review`);
  await expect(
    owner.page.getByRole("heading", { name: "Review CV proposals" }),
  ).toBeVisible();
  const reviewLoadMs = performance.now() - reviewLoadStartedAt;

  await owner.page
    .getByLabel("Proposed headline")
    .fill("Reviewed Platform Engineer");
  await owner.page
    .getByRole("group", { name: "Decision for headline" })
    .getByRole("radio", { name: "add" })
    .check();
  await owner.page
    .getByRole("group", { name: "Decision for TypeScript" })
    .getByRole("radio", { name: "add" })
    .check();
  await owner.page
    .getByRole("checkbox", { name: "I have reviewed every proposal." })
    .check();
  let saveRequest:
    | {
        url: string;
        csrf: string;
        origin: string;
        fetchSite: string;
        body: unknown;
      }
    | undefined;
  owner.page.on("request", (request) => {
    if (
      request.method() !== "PATCH" ||
      new URL(request.url()).pathname !==
        `/api/account/cv-drafts/${seeded.draftId}`
    )
      return;
    saveRequest = {
      url: request.url(),
      csrf: request.headers()["x-csrf-token"] ?? "",
      origin: request.headers().origin ?? new URL(request.url()).origin,
      fetchSite: request.headers()["sec-fetch-site"] ?? "same-origin",
      body: request.postDataJSON(),
    };
  });
  const saveStartedAt = performance.now();
  await owner.page.getByRole("button", { name: "Save review" }).click();
  await expect(owner.page.getByRole("status")).toContainText("Review saved");
  const saveMs = performance.now() - saveStartedAt;

  await owner.page.reload();
  await expect(owner.page.getByLabel("Proposed headline")).toHaveValue(
    "Reviewed Platform Engineer",
  );
  await expect(
    owner.page
      .getByRole("group", { name: "Decision for headline" })
      .getByRole("radio", { name: "add" }),
  ).toBeChecked();

  let confirmationRequest:
    | {
        url: string;
        key: string;
        csrf: string;
        origin: string;
        fetchSite: string;
        body: unknown;
      }
    | undefined;
  let confirmationPostCount = 0;
  owner.page.on("request", (request) => {
    if (request.method() !== "POST" || !request.url().endsWith("/confirm"))
      return;
    confirmationPostCount += 1;
    confirmationRequest = {
      url: request.url(),
      key: request.headers()["idempotency-key"] ?? "",
      csrf: request.headers()["x-csrf-token"] ?? "",
      origin: request.headers().origin ?? new URL(request.url()).origin,
      fetchSite: request.headers()["sec-fetch-site"] ?? "same-origin",
      body: request.postDataJSON(),
    };
  });
  await owner.page
    .getByRole("checkbox", { name: /confirm updates my candidate profile/i })
    .check();
  const confirmationResponse = owner.page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname ===
        `/api/account/cv-drafts/${seeded.draftId}/confirm`,
  );
  const confirmStartedAt = performance.now();
  await owner.page
    .getByRole("button", { name: "Confirm selected changes" })
    .click();
  await expect(
    owner.page.getByRole("heading", { name: "CV import confirmed" }),
  ).toBeVisible();
  await expect(owner.page).toHaveURL(
    `/profile/cv-imports/${seeded.uploadId}/receipt`,
  );
  const originalResponse = await confirmationResponse;
  expect(originalResponse.status()).toBe(201);
  const originalReceipt = await originalResponse.json();
  const postsAfterConfirm = confirmationPostCount;
  await owner.page.reload();
  await expect(
    owner.page.getByRole("heading", { name: "CV import confirmed" }),
  ).toBeVisible();
  expect(confirmationPostCount).toBe(postsAfterConfirm);
  await owner.page.goBack();
  await expect(owner.page).toHaveURL(/\/profile\/cv-imports$/u);
  await owner.page.goForward();
  await expect(owner.page).toHaveURL(
    `/profile/cv-imports/${seeded.uploadId}/receipt`,
  );
  await expect(
    owner.page.getByRole("heading", { name: "CV import confirmed" }),
  ).toBeVisible();
  await owner.page.getByRole("link", { name: "View import status" }).click();
  await expect(owner.page).toHaveURL(`/profile/cv-imports/${seeded.uploadId}`);
  await expect(
    owner.page.getByRole("heading", { name: "CV processing status" }),
  ).toBeVisible();
  const confirmMs = performance.now() - confirmStartedAt;
  console.info(
    `[cv-us2-performance] ${JSON.stringify({
      coldReviewLoadMs: Math.round(coldReviewLoadMs),
      reviewLoadMs: Math.round(reviewLoadMs),
      saveMs: Math.round(saveMs),
      confirmMs: Math.round(confirmMs),
    })}`,
  );
  expect(reviewLoadMs).toBeLessThanOrEqual(3_000);
  expect(saveMs).toBeLessThanOrEqual(2_000);
  expect(confirmMs).toBeLessThanOrEqual(2_000);

  const profile = await owner.page.request
    .get("/api/account/profile")
    .then((response) => response.json());
  expect(profile).toMatchObject({
    revision: profileBefore.revision + 1,
    basics: { headline: "Reviewed Platform Engineer" },
  });
  expect(profile.skills).toEqual([
    expect.objectContaining({ label: "TypeScript" }),
  ]);
  expect(profile.experience).toEqual([]);
  expect(originalReceipt).toMatchObject({
    draftId: seeded.draftId,
    uploadId: seeded.uploadId,
    profileRevisionBefore: profileBefore.revision,
    profileRevisionAfter: profileBefore.revision + 1,
    appliedCounts: {
      scalars: 1,
      experiences: 0,
      education: 0,
      skills: 1,
      socialLinks: 0,
    },
  });
  expect(originalReceipt.profileRevisionAfter).toBe(
    originalReceipt.profileRevisionBefore + 1,
  );
  expect(confirmationRequest).toBeDefined();
  const replay = await owner.page.request.post(confirmationRequest!.url, {
    headers: {
      "content-type": "application/json",
      "idempotency-key": confirmationRequest!.key,
      "x-csrf-token": confirmationRequest!.csrf,
      origin: confirmationRequest!.origin,
      "sec-fetch-site": confirmationRequest!.fetchSite,
    },
    data: confirmationRequest!.body,
  });
  expect(replay.status()).toBe(200);
  expect(await replay.json()).toEqual(originalReceipt);

  const lifecycle = await pool.query<{
    uploadStatus: string;
    uploadConfirmedAt: Date;
    uploadInaccessibleAt: Date;
    uploadDeleteAfter: Date;
    draftStatus: string;
    draftRevision: number;
    draftConfirmedAt: Date;
    draftInaccessibleAt: Date;
    payloadDeleteAfter: Date;
    payloadDeletedAt: Date | null;
    proposalPresent: boolean;
    reviewPresent: boolean;
    provenancePresent: boolean;
    receiptId: string;
    receiptConfirmedAt: Date;
  }>(
    `SELECT upload."status" AS "uploadStatus",
            upload."confirmedAt" AS "uploadConfirmedAt",
            upload."contentInaccessibleAt" AS "uploadInaccessibleAt",
            upload."deleteAfter" AS "uploadDeleteAfter",
            draft."status" AS "draftStatus",
            draft."revision" AS "draftRevision",
            draft."confirmedAt" AS "draftConfirmedAt",
            draft."contentInaccessibleAt" AS "draftInaccessibleAt",
            draft."payloadDeleteAfter",
            draft."payloadDeletedAt",
            draft."proposalPayload" IS NOT NULL AS "proposalPresent",
            draft."reviewPayload" IS NOT NULL AS "reviewPresent",
            draft."provenancePayload" IS NOT NULL AS "provenancePresent",
            receipt."id" AS "receiptId",
            receipt."confirmedAt" AS "receiptConfirmedAt"
       FROM "CvUpload" upload
       JOIN "CvDraft" draft ON draft."uploadId" = upload."id"
       JOIN "CvImportConfirmation" receipt ON receipt."uploadId" = upload."id"
      WHERE upload."id" = $1`,
    [seeded.uploadId],
  );
  expect(lifecycle.rows).toHaveLength(1);
  const frozen = lifecycle.rows[0];
  expect(frozen).toMatchObject({
    uploadStatus: "CONFIRMED",
    draftStatus: "CONFIRMED",
    proposalPresent: true,
    reviewPresent: true,
    provenancePresent: true,
    payloadDeletedAt: null,
    receiptId: originalReceipt.receiptId,
  });
  expect(frozen.draftRevision).toBe(originalReceipt.draftRevision);
  expect(frozen.uploadConfirmedAt).toEqual(frozen.receiptConfirmedAt);
  expect(frozen.uploadInaccessibleAt).toEqual(frozen.receiptConfirmedAt);
  expect(frozen.draftConfirmedAt).toEqual(frozen.receiptConfirmedAt);
  expect(frozen.draftInaccessibleAt).toEqual(frozen.receiptConfirmedAt);
  const purgeAt = new Date(
    frozen.receiptConfirmedAt.getTime() + 7 * 86_400_000,
  );
  expect(frozen.uploadDeleteAfter).toEqual(purgeAt);
  expect(frozen.payloadDeleteAfter).toEqual(purgeAt);

  const artifacts = await pool.query<{
    kind: string;
    contentInaccessibleAt: Date;
    deleteAfter: Date;
    deletedAt: Date | null;
  }>(
    `SELECT "kind", "contentInaccessibleAt", "deleteAfter", "deletedAt"
       FROM "CvStoredArtifact"
      WHERE "uploadId" = $1
      ORDER BY "kind"::text`,
    [seeded.uploadId],
  );
  expect(artifacts.rows.map((artifact) => artifact.kind)).toEqual([
    "EXTRACTED_TEXT",
    "SOURCE_DOCUMENT",
  ]);
  for (const artifact of artifacts.rows) {
    expect(artifact.contentInaccessibleAt).toEqual(frozen.receiptConfirmedAt);
    expect(artifact.deleteAfter).toEqual(purgeAt);
    expect(artifact.deletedAt).toBeNull();
  }

  expect(saveRequest).toBeDefined();
  const immutableSave = await owner.page.request.patch(saveRequest!.url, {
    headers: {
      "content-type": "application/json",
      "x-csrf-token": saveRequest!.csrf,
      origin: saveRequest!.origin,
      "sec-fetch-site": saveRequest!.fetchSite,
    },
    data: saveRequest!.body,
  });
  expect(immutableSave.status()).toBe(404);
  const inaccessibleDraft = await owner.page.request.get(
    `/api/account/cv-drafts/${seeded.draftId}`,
  );
  expect(inaccessibleDraft.status()).toBe(404);

  const unchanged = await pool.query(
    `SELECT upload."status" AS "uploadStatus", upload."confirmedAt" AS "uploadConfirmedAt",
            upload."deleteAfter" AS "uploadDeleteAfter", draft."status" AS "draftStatus",
            draft."revision" AS "draftRevision", draft."confirmedAt" AS "draftConfirmedAt",
            draft."payloadDeleteAfter", draft."proposalPayload", draft."reviewPayload",
            draft."provenancePayload"
       FROM "CvUpload" upload
       JOIN "CvDraft" draft ON draft."uploadId" = upload."id"
      WHERE upload."id" = $1`,
    [seeded.uploadId],
  );
  expect(unchanged.rows).toHaveLength(1);
  expect(unchanged.rows[0]).toMatchObject({
    uploadStatus: "CONFIRMED",
    draftStatus: "CONFIRMED",
    draftRevision: originalReceipt.draftRevision,
    uploadConfirmedAt: frozen.uploadConfirmedAt,
    uploadDeleteAfter: frozen.uploadDeleteAfter,
    draftConfirmedAt: frozen.draftConfirmedAt,
    payloadDeleteAfter: frozen.payloadDeleteAfter,
  });

  const audit = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS "count"
       FROM "AuditEvent"
      WHERE "actorUserId" = $1
        AND "action" = 'cv_import.confirmed'
        AND "targetType" = 'cv_confirmation'
        AND "targetId" = $2`,
    [seeded.accountId, originalReceipt.receiptId],
  );
  expect(audit.rows[0].count).toBe("1");

  const profileAfterReplay = await owner.page.request
    .get("/api/account/profile")
    .then((response) => response.json());
  expect(profileAfterReplay).toEqual(profile);

  const outsider = await registerCandidate(browser, "cv-review-outsider");
  const deniedDraft = await outsider.page.request.get(
    `/api/account/cv-drafts/${seeded.draftId}`,
  );
  await outsider.page.goto(`/profile/cv-imports/${seeded.uploadId}/review`);
  expect(deniedDraft.status()).toBe(404);
  await expect(
    outsider.page.getByRole("heading", { name: /page could not be found/i }),
  ).toBeVisible();

  const foreignReceipt = await outsider.page.request.get(
    `/profile/cv-imports/${seeded.uploadId}/receipt`,
  );
  expect(foreignReceipt.status()).toBe(404);
  const foreignReceiptBody = await foreignReceipt.text();
  expect(foreignReceiptBody).not.toContain(originalReceipt.receiptId);
  expect(foreignReceiptBody).not.toContain("Reviewed Platform Engineer");

  const missingReceipt = await owner.page.request.get(
    "/profile/cv-imports/nonexistent-receipt-404/receipt",
  );
  expect(missingReceipt.status()).toBe(404);
  const missingReceiptBody = await missingReceipt.text();
  expect(missingReceiptBody).not.toContain(originalReceipt.receiptId);
  expect(missingReceiptBody).not.toContain("Reviewed Platform Engineer");

  await pool.query(
    `UPDATE "CvUpload"
        SET "status" = 'CANCELLED',
            "contentInaccessibleAt" = NOW(),
            "deleteAfter" = NOW(),
            "deletedAt" = NOW()
      WHERE "id" = $1`,
    [seeded.uploadId],
  );
  const tombstonedReceipt = await owner.page.request.get(
    `/profile/cv-imports/${seeded.uploadId}/receipt`,
  );
  expect(tombstonedReceipt.status()).toBe(404);
  const tombstonedReceiptBody = await tombstonedReceipt.text();
  expect(tombstonedReceiptBody).not.toContain(originalReceipt.receiptId);
  expect(tombstonedReceiptBody).not.toContain("Reviewed Platform Engineer");
});
