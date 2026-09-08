import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { Pool, type PoolClient } from "pg";

import { seedCvRecoveryImport } from "../../../helpers/cv-failure-retry-fixture";
import { cleanupReviewAccounts } from "../../../helpers/cv-review-fixture";

test.describe.configure({ mode: "serial" });

const password = "Synthetic Consent Retention 004!";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const contexts: BrowserContext[] = [];
const candidateEmails = new Set<string>();
const cvStorageRoot = resolve(process.cwd(), ".local/cv-storage-cf-phase2");

test.afterAll(async () => {
  await pool.end();
});

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
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
  return { page, email };
}

async function ownedAccount(client: PoolClient, email: string) {
  const result = await client.query<{
    accountId: string;
    profileId: string;
    profileRevision: number;
  }>(
    `SELECT account."id" AS "accountId", profile."id" AS "profileId",
            profile."revision" AS "profileRevision"
       FROM "user" account
       JOIN "CandidateProfile" profile ON profile."candidateUserId" = account."id"
      WHERE account."normalizedEmail" = $1`,
    [email.toLowerCase()],
  );
  if (!result.rows[0]) throw new Error("REGISTERED_CANDIDATE_PROFILE_MISSING");
  return result.rows[0];
}

async function seedAwaitingConsent(
  client: PoolClient,
  email: string,
  label: string,
) {
  const account = await ownedAccount(client, email);
  const fixture = await seedCvRecoveryImport(client, label, {
    stage: "PARSE",
    mode: "TERMINAL_FAILURE",
    parserClass: "EXTERNAL_OPENAI",
    now: new Date(),
    existingAccount: account,
  });
  await client.query(
    `UPDATE "CvUpload"
        SET "status" = 'AWAITING_CONSENT', "failureCode" = NULL
      WHERE "id" = $1`,
    [fixture.uploadId],
  );
  await normalizeStorageLocators(client, fixture.uploadId);
  return { ...fixture, account };
}

async function normalizeStorageLocators(
  client: PoolClient,
  uploadId: string,
): Promise<void> {
  const artifacts = await client.query<{ id: string }>(
    `SELECT "id" FROM "CvStoredArtifact"
      WHERE "uploadId" = $1 ORDER BY "id"`,
    [uploadId],
  );
  await mkdir(cvStorageRoot, { recursive: true });
  for (const artifact of artifacts.rows) {
    const locator = `cv004_${randomUUID().replaceAll("-", "")}`;
    await writeFile(resolve(cvStorageRoot, locator), Buffer.from([0x00]), {
      flag: "wx",
      mode: 0o600,
    });
    await client.query(
      `UPDATE "CvStoredArtifact"
          SET "storageAdapter" = 'filesystem-v1',
              "storageLocator" = $2
        WHERE "id" = $1`,
      [artifact.id, locator],
    );
  }
}

async function completeExternalParse(
  client: PoolClient,
  fixture: Awaited<ReturnType<typeof seedAwaitingConsent>>,
) {
  const latest = await client.query<{ id: string }>(
    `SELECT "id" FROM "CvParseJob"
      WHERE "uploadId" = $1
      ORDER BY "attemptNumber" DESC, "createdAt" DESC LIMIT 1`,
    [fixture.uploadId],
  );
  const parseJobId = latest.rows[0]?.id;
  if (!parseJobId) throw new Error("CONSENT_PARSE_JOB_MISSING");
  const now = new Date();
  const draftId = `consent-e2e-draft-${randomUUID()}`;
  await client.query("BEGIN");
  try {
    await client.query(
      `SELECT "id" FROM "CvParseJob" WHERE "id" = $1 FOR UPDATE`,
      [parseJobId],
    );
    await client.query(
      `INSERT INTO "CvDraft" (
         "id", "uploadId", "accountId", "profileId", "parseJobId", "status",
         "schemaVersion", "revision", "sourceProfileRevision",
         "reviewedProfileRevision", "proposalPayload", "provenancePayload",
         "payloadBytes", "provenanceBytes", "expiresAt", "createdAt", "updatedAt"
       ) SELECT $1, upload."id", upload."accountId", upload."profileId", $2,
                'EDITABLE', 'cv-draft-v1', 0, $3, $3, '{}'::jsonb, '{}'::jsonb,
                2, 2, upload."expiresAt", $4, $4
           FROM "CvUpload" upload
          WHERE upload."id" = $5
            AND NOT EXISTS (
              SELECT 1 FROM "CvDraft" existing
               WHERE existing."uploadId" = upload."id"
            )
        ON CONFLICT ("uploadId") DO NOTHING`,
      [
        draftId,
        parseJobId,
        fixture.account.profileRevision,
        now,
        fixture.uploadId,
      ],
    );
    await client.query(
      `UPDATE "CvParseJob"
          SET "status" = 'SUCCEEDED', "startedAt" = $2, "completedAt" = $2,
              "providerRequestIdHmac" = decode(repeat('77', 32), 'hex')
        WHERE "id" = $1`,
      [parseJobId, now],
    );
    await client.query(
      `UPDATE "CvUpload" SET "status" = 'REVIEW_READY', "failureCode" = NULL
        WHERE "id" = $1`,
      [fixture.uploadId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return { parseJobId, draftId };
}

async function makeLatestQueuedParseProcessing(
  client: PoolClient,
  uploadId: string,
) {
  const now = new Date();
  const result = await client.query<{ id: string }>(
    `UPDATE "CvParseJob"
        SET "status" = 'PROCESSING', "startedAt" = $2,
            "leaseOwner" = 'consent-e2e-worker',
            "leaseExpiresAt" = $2::timestamp(3) + interval '90 seconds'
      WHERE "id" = (
        SELECT "id" FROM "CvParseJob"
         WHERE "uploadId" = $1 AND "status" = 'QUEUED'
         ORDER BY "attemptNumber" DESC LIMIT 1
      ) RETURNING "id"`,
    [uploadId, now],
  );
  if (!result.rows[0]) throw new Error("LATEST_QUEUED_PARSE_MISSING");
  await client.query(
    `UPDATE "CvUpload" SET "status" = 'PARSING' WHERE "id" = $1`,
    [uploadId],
  );
  return result.rows[0].id;
}

async function advanceCleanupDeadline(uploadId: string): Promise<void> {
  const client = await pool.connect();
  await client.query("BEGIN");
  try {
    await client.query(
      `UPDATE "CvUpload"
          SET "deleteAfter" = CURRENT_TIMESTAMP - interval '1 second'
        WHERE "id" = $1`,
      [uploadId],
    );
    await client.query(
      `UPDATE "CvStoredArtifact"
          SET "deleteAfter" = CURRENT_TIMESTAMP - interval '1 second'
        WHERE "uploadId" = $1 AND "status" <> 'DELETED'`,
      [uploadId],
    );
    await client.query(
      `UPDATE "CvDraft"
          SET "payloadDeleteAfter" = CURRENT_TIMESTAMP - interval '1 second'
        WHERE "uploadId" = $1 AND "payloadDeletedAt" IS NULL`,
      [uploadId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

test("grants exact consent, blocks revoked/changed bindings, and deletes during processing", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const owner = await registerCandidate(browser, "cv-consent-owner");

  await owner.page.goto("/profile/cv-imports");
  await expect(owner.page.getByRole("note")).toContainText(
    /deterministic parser runs inside smarthire/i,
  );
  const externalParser = owner.page.getByRole("radio", {
    name: "External OpenAI",
  });
  await expect(externalParser).toBeEnabled();
  await externalParser.click();
  await expect(owner.page.getByRole("note")).toContainText(
    /external parser remains blocked until you separately consent/i,
  );
  await expect(owner.page.getByRole("checkbox")).toHaveCount(0);

  const client = await pool.connect();
  let completed!: Awaited<ReturnType<typeof seedAwaitingConsent>>;
  let controlled!: Awaited<ReturnType<typeof seedAwaitingConsent>>;
  try {
    completed = await seedAwaitingConsent(
      client,
      owner.email,
      "e2e-consent-complete",
    );
    controlled = await seedAwaitingConsent(
      client,
      owner.email,
      "e2e-consent-delete",
    );
  } finally {
    client.release();
  }

  await test.step("external work is blocked before exact consent and then completes", async () => {
    await owner.page.goto(`/profile/cv-imports/${completed.uploadId}`);
    await expect(
      owner.page.getByRole("checkbox", {
        name: /i agree that smarthire may send/i,
      }),
    ).not.toBeChecked();
    const before = await pool.query<{ active: number }>(
      `SELECT count(*)::int AS active FROM "CvParseJob"
        WHERE "uploadId" = $1 AND "status" IN ('QUEUED', 'PROCESSING')`,
      [completed.uploadId],
    );
    expect(before.rows[0]?.active).toBe(0);
    await owner.page
      .getByRole("checkbox", { name: /i agree that smarthire may send/i })
      .check();
    const responsePromise = owner.page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith(
          `/${completed.uploadId}/consent`,
        ),
    );
    await owner.page
      .getByRole("button", { name: /grant external processing consent/i })
      .click();
    expect((await responsePromise).status()).toBe(201);
    await expect(
      owner.page.getByRole("button", {
        name: /revoke consent for future processing/i,
      }),
    ).toBeVisible();
    const completionClient = await pool.connect();
    try {
      await completeExternalParse(completionClient, completed);
    } finally {
      completionClient.release();
    }
    await owner.page.reload();
    await expect(
      owner.page.getByText("Review ready", { exact: true }),
    ).toBeVisible();
    await expect(
      owner.page.getByRole("link", { name: /review draft/i }),
    ).toBeVisible();
    await owner.page
      .getByRole("button", { name: /revoke consent for future processing/i })
      .click();
    await expect(
      owner.page
        .getByText(/cannot recall processing already transmitted/i)
        .first(),
    ).toBeVisible();
  });

  await test.step("revocation cancels queued retry and a changed binding requires a fresh grant", async () => {
    await owner.page.goto(`/profile/cv-imports/${controlled.uploadId}`);
    await owner.page
      .getByRole("checkbox", { name: /i agree that smarthire may send/i })
      .check();
    const controlledGrant = owner.page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith(
          `/${controlled.uploadId}/consent`,
        ),
    );
    await owner.page
      .getByRole("button", { name: /grant external processing consent/i })
      .click();
    await controlledGrant;
    await expect(
      owner.page.getByRole("button", {
        name: /revoke consent for future processing/i,
      }),
    ).toBeVisible();
    await owner.page
      .getByRole("button", { name: /revoke consent for future processing/i })
      .click();
    await expect(
      owner.page.getByText(/future external processing is blocked/i),
    ).toBeVisible();
    const cancelled = await pool.query<{ active: number; cancelled: number }>(
      `SELECT
         count(*) FILTER (WHERE "status" IN ('QUEUED','PROCESSING'))::int AS active,
         count(*) FILTER (WHERE "status" = 'CANCELLED')::int AS cancelled
       FROM "CvParseJob" WHERE "uploadId" = $1`,
      [controlled.uploadId],
    );
    expect(cancelled.rows[0]?.active).toBe(0);
    expect(cancelled.rows[0]?.cancelled).toBeGreaterThan(0);

    await pool.query(
      `INSERT INTO "CvProcessingConsent" (
         "id", "accountId", "uploadId", "action", "provider", "providerClass",
         "model", "purposeVersion", "noticeVersion", "consentTextVersion",
         "occurredAt", "createdAt"
       ) VALUES ($1, $2, $3, 'GRANTED', 'openai', 'EXTERNAL_OPENAI',
         'changed-model-requires-new-grant', 'cv-profile-fact-extraction-v1',
         'cv-processing.v1', 'cv-external-consent.v1', now() + interval '1 second',
         now() + interval '1 second')`,
      [
        `changed-binding-${randomUUID()}`,
        controlled.accountId,
        controlled.uploadId,
      ],
    );
    await owner.page.reload();
    const fresh = owner.page.getByRole("checkbox", {
      name: /i agree that smarthire may send/i,
    });
    await expect(fresh).not.toBeChecked();
    await fresh.check();
    await owner.page
      .getByRole("button", { name: /grant external processing consent/i })
      .click();
    await expect(
      owner.page.getByRole("button", {
        name: /revoke consent for future processing/i,
      }),
    ).toBeVisible();
  });

  await test.step("candidate deletion wins active processing and reaches DELETED only after cleanup", async () => {
    const processingClient = await pool.connect();
    try {
      await makeLatestQueuedParseProcessing(
        processingClient,
        controlled.uploadId,
      );
    } finally {
      processingClient.release();
    }
    await owner.page.reload();
    const deleteTrigger = owner.page.getByRole("button", {
      name: /cancel and delete this cv import/i,
    });
    await deleteTrigger.click();
    await expect(owner.page.getByRole("dialog")).toContainText(
      /within 24 hours/i,
    );
    const deletionResponse = owner.page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        new URL(response.url()).pathname.endsWith(`/${controlled.uploadId}`),
    );
    await owner.page
      .getByRole("button", { name: /confirm cancel and delete/i })
      .click();
    const accepted = await deletionResponse;
    expect(accepted.status()).toBe(202);
    const outcome = (await accepted.json()) as {
      status: string;
      deleteAfter: string;
      contentInaccessibleAt: string;
    };
    expect(outcome.status).toBe("CANCELLED");
    expect(new Date(outcome.deleteAfter).getTime()).toBeLessThanOrEqual(
      new Date(outcome.contentInaccessibleAt).getTime() + 24 * 60 * 60_000,
    );
    await expect(owner.page.getByText(/cancelled/i)).toBeVisible();
    await expect(owner.page.getByLabel("Processing timeline")).toHaveCount(0);
    await owner.page.reload();
    await expect(owner.page.getByRole("status")).toContainText(
      /cleanup is pending/i,
    );
    const cancelledState = await pool.query<{
      status: string;
      activeWork: number;
      inaccessible: boolean;
    }>(
      `SELECT upload."status"::text,
              (SELECT count(*)::int FROM "CvParseJob" job
                WHERE job."uploadId" = upload."id"
                  AND job."status" IN ('QUEUED','PROCESSING')) AS "activeWork",
              upload."contentInaccessibleAt" IS NOT NULL AS inaccessible
         FROM "CvUpload" upload WHERE upload."id" = $1`,
      [controlled.uploadId],
    );
    expect(cancelledState.rows[0]).toEqual({
      status: "CANCELLED",
      activeWork: 0,
      inaccessible: true,
    });

    await advanceCleanupDeadline(controlled.uploadId);
    await expect
      .poll(
        async () => {
          const response = await owner.page.request.get(
            `/api/account/cv-imports/${controlled.uploadId}`,
          );
          return (await response.json()).status;
        },
        { timeout: 30_000 },
      )
      .toBe("DELETED");
    await owner.page.reload();
    await expect(owner.page.getByText("Deleted", { exact: true })).toBeVisible();
    await expect(owner.page.getByRole("status")).toContainText(
      /temporary import content has been removed/i,
    );
    await expect(
      owner.page.getByRole("link", { name: /open candidate profile/i }),
    ).toHaveAttribute("href", "/profile");
  });
});

test("naturally expires an unconfirmed import without candidate DELETE and completes deadline cleanup", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const owner = await registerCandidate(browser, "cv-natural-expiry");
  const client = await pool.connect();
  let fixture!: Awaited<ReturnType<typeof seedCvRecoveryImport>>;
  const retentionMs = 30 * 24 * 60 * 60_000;
  const fixtureNow = new Date(Date.now() - retentionMs + 8_000);
  try {
    const account = await ownedAccount(client, owner.email);
    fixture = await seedCvRecoveryImport(client, "e2e-natural-expiry", {
      stage: "PARSE",
      mode: "TERMINAL_FAILURE",
      now: fixtureNow,
      existingAccount: account,
    });
    await normalizeStorageLocators(client, fixture.uploadId);
    await client.query(
      `UPDATE "CvUpload"
          SET "createdAt" = CURRENT_TIMESTAMP + interval '10 seconds' - interval '30 days',
              "expiresAt" = CURRENT_TIMESTAMP + interval '10 seconds'
        WHERE "id" = $1`,
      [fixture.uploadId],
    );
  } finally {
    client.release();
  }

  await owner.page.goto(`/profile/cv-imports/${fixture.uploadId}`);
  await expect(
    owner.page.getByText("Parsing failed", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () => {
        const response = await owner.page.request.get(
          `/api/account/cv-imports/${fixture.uploadId}`,
        );
        return (await response.json()).status;
      },
      { timeout: 30_000 },
    )
    .toBe("EXPIRED");

  const tombstoneResponse = await owner.page.request.get(
    `/api/account/cv-imports/${fixture.uploadId}`,
  );
  expect(tombstoneResponse.status()).toBe(200);
  const tombstone = await tombstoneResponse.json();
  expect(tombstone).toMatchObject({
    uploadId: fixture.uploadId,
    status: "EXPIRED",
  });
  expect(tombstone).not.toHaveProperty("draft");
  expect(tombstone).not.toHaveProperty("failure");
  await owner.page.reload();
  await expect(owner.page.getByText("Expired", { exact: true })).toBeVisible();
  await expect(
    owner.page.getByRole("button", { name: /retry|confirm/i }),
  ).toHaveCount(0);
  await expect(owner.page.getByLabel("Processing timeline")).toHaveCount(0);
  await expect(owner.page.getByRole("status")).toContainText(
    /content and retry access are disabled/i,
  );

  const beforePurgeAudit = await pool.query<{
    deleted: number;
    expired: number;
  }>(
    `SELECT
       count(*) FILTER (WHERE "action" = 'cv_import.deleted')::int AS deleted,
       count(*) FILTER (WHERE "action" = 'cv_import.expired')::int AS expired
     FROM "AuditEvent" WHERE "targetId" = $1`,
    [fixture.uploadId],
  );
  expect(beforePurgeAudit.rows[0]).toEqual({ deleted: 0, expired: 1 });
  await expect
    .poll(
      async () => {
        const final = await pool.query<{
          status: string;
          deleted: boolean;
          remainingArtifacts: number;
        }>(
          `SELECT upload."status"::text, upload."deletedAt" IS NOT NULL AS deleted,
                  (SELECT count(*)::int FROM "CvStoredArtifact" artifact
                    WHERE artifact."uploadId" = upload."id"
                      AND artifact."status" <> 'DELETED') AS "remainingArtifacts"
             FROM "CvUpload" upload WHERE upload."id" = $1`,
          [fixture.uploadId],
        );
        return final.rows[0];
      },
      { timeout: 30_000 },
    )
    .toEqual({ status: "EXPIRED", deleted: true, remainingArtifacts: 0 });
  await owner.page.reload();
  await expect(owner.page.getByText("Expired", { exact: true })).toBeVisible();
  await expect(
    owner.page.getByRole("link", { name: /open candidate profile/i }),
  ).toHaveAttribute("href", "/profile");
});
