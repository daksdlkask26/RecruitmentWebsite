import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
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

const password = "Synthetic CV Failure Recovery 004!";
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

type FailureSeed = Readonly<{
  label: string;
  status:
    | "INFECTED"
    | "SCAN_FAILED"
    | "VALIDATION_FAILED"
    | "PARSE_FAILED"
    | "SCANNING";
  failureCode: string | null;
  candidateScanRetriesUsed?: number;
  candidateParseRetriesUsed?: number;
}>;

type DurableRetryHistory = Readonly<{
  uploadId: string;
  priorAttemptId: string;
  nextAttemptNumber: number;
}>;

async function seedDurableRetryHistories(
  client: PoolClient,
  account: Readonly<{ accountId: string; profileId: string }>,
) {
  const now = new Date();
  const scan = await seedCvRecoveryImport(client, "e2e-scanner", {
    stage: "SCAN",
    mode: "TERMINAL_FAILURE",
    now,
    automaticAttemptsUsed: 3,
    existingAccount: account,
  });
  let latestScanId = scan.scanId;
  for (const attemptNumber of [2, 3]) {
    const assessmentId = `failure-scan-${attemptNumber}-${randomUUID()}`;
    const completedAt = new Date(now.getTime() + attemptNumber);
    await client.query(
      `INSERT INTO "CvScanAssessment" (
         "id", "uploadId", "sourceArtifactId", "accountId", "attemptNumber",
         "candidateInitiated", "status", "failureCode", "startedAt",
         "completedAt", "createdAt"
       ) VALUES (
         $1, $2, $3, $4, $5, false, 'INDETERMINATE',
         'SCANNER_UNAVAILABLE', $6, $6, $6
       )`,
      [
        assessmentId,
        scan.uploadId,
        scan.sourceId,
        scan.accountId,
        attemptNumber,
        completedAt,
      ],
    );
    latestScanId = assessmentId;
  }

  const parse = await seedCvRecoveryImport(client, "e2e-parser", {
    stage: "PARSE",
    mode: "TERMINAL_FAILURE",
    now: new Date(now.getTime() + 10),
    automaticAttemptsUsed: 3,
    existingAccount: account,
  });
  if (!parse.parseId) throw new Error("PARSE_RETRY_HISTORY_MISSING");
  let latestParseId = parse.parseId;
  for (const attemptNumber of [2, 3]) {
    const parseJobId = `failure-parse-${attemptNumber}-${randomUUID()}`;
    const completedAt = new Date(now.getTime() + 10 + attemptNumber);
    const inserted = await client.query(
      `INSERT INTO "CvParseJob" (
         "id", "uploadId", "extractionId", "accountId", "consentEventId",
         "previousAttemptId", "attemptNumber", "trigger", "status",
         "parserClass", "provider", "model", "purposeVersion", "inputVersion",
         "instructionVersion", "schemaVersion", "failureCode", "startedAt",
         "completedAt", "createdAt"
       )
       SELECT $1, prior."uploadId", prior."extractionId", prior."accountId",
              prior."consentEventId", prior."id", $2, 'AUTOMATIC_RETRY', 'FAILED',
              prior."parserClass", prior."provider", prior."model",
              prior."purposeVersion", prior."inputVersion",
              prior."instructionVersion", prior."schemaVersion",
              'PARSER_UNAVAILABLE', $3, $3, $3
         FROM "CvParseJob" prior
        WHERE prior."id" = $4`,
      [parseJobId, attemptNumber, completedAt, latestParseId],
    );
    if (inserted.rowCount !== 1) throw new Error("PARSE_RETRY_CHAIN_MISSING");
    latestParseId = parseJobId;
  }

  return {
    scan: {
      uploadId: scan.uploadId,
      priorAttemptId: latestScanId,
      nextAttemptNumber: 4,
    } satisfies DurableRetryHistory,
    parse: {
      uploadId: parse.uploadId,
      priorAttemptId: latestParseId,
      nextAttemptNumber: 4,
    } satisfies DurableRetryHistory,
  };
}

async function seedFailureImports(
  client: PoolClient,
  email: string,
  seeds: readonly FailureSeed[],
) {
  const owned = await client.query<{ accountId: string; profileId: string }>(
    `SELECT account."id" AS "accountId", profile."id" AS "profileId"
       FROM "user" account
       JOIN "CandidateProfile" profile ON profile."candidateUserId" = account."id"
      WHERE account."normalizedEmail" = $1`,
    [email.toLowerCase()],
  );
  if (!owned.rows[0]) throw new Error("REGISTERED_CANDIDATE_PROFILE_MISSING");

  const uploads = new Map<string, string>();
  for (const [index, seed] of seeds.entries()) {
    const uploadId = `failure-${seed.label}-${randomUUID()}`;
    const createdAt = new Date(Date.now() + index);
    const digest = (purpose: string) =>
      createHash("sha256").update(`${purpose}:${uploadId}`, "utf8").digest();
    await client.query(
      `INSERT INTO "CvUpload" (
         "id", "accountId", "profileId", "documentKind", "parserClass", "status",
         "declaredMediaType", "declaredBytes", "actualBytes", "quotaReservationBytes",
         "quotaReservationRemaining", "sourceSha256", "idempotencyDigest",
         "createBindingDigest", "failureCode", "automaticScanAttemptsUsed",
         "candidateScanRetriesUsed", "automaticParseAttemptsUsed",
         "candidateParseRetriesUsed", "contentReceivedAt", "expiresAt", "createdAt",
         "updatedAt"
       ) VALUES (
         $1, $2, $3, 'PDF', 'DETERMINISTIC_INTERNAL', $4,
         'application/pdf', 1, 1, 524289, 0, $5, $6, $7, $8,
         $9, $10, $11, $12, $13, $13::timestamp(3) + interval '30 days', $13, $13
       )`,
      [
        uploadId,
        owned.rows[0].accountId,
        owned.rows[0].profileId,
        seed.status,
        digest("source"),
        digest("idempotency"),
        digest("binding"),
        seed.failureCode,
        seed.status === "SCAN_FAILED" || seed.status === "INFECTED" ? 3 : 0,
        seed.candidateScanRetriesUsed ?? 0,
        seed.status === "PARSE_FAILED" ? 3 : 0,
        seed.candidateParseRetriesUsed ?? 0,
        createdAt,
      ],
    );
    uploads.set(seed.label, uploadId);
  }
  const retryHistories = await seedDurableRetryHistories(client, owned.rows[0]);
  uploads.set("scanner", retryHistories.scan.uploadId);
  uploads.set("parser-unavailable", retryHistories.parse.uploadId);
  return {
    accountId: owned.rows[0].accountId,
    uploads,
    retryHistories,
  };
}

async function assertSafeFailure(page: Page, expectedMessage: RegExp) {
  await expect
    .soft(
      page.getByRole("alert", {
        name: /CV processing could not finish/i,
      }),
    )
    .toContainText(expectedMessage);
  await expect
    .soft(
      page.getByRole("link", {
        name: /manual profile|enter.*profile manually/i,
      }),
    )
    .toBeVisible();
  await expect
    .soft(page.getByRole("button", { name: /delete import/i }))
    .toBeVisible();
  await expect
    .soft(page.locator("body"))
    .not.toContainText(
      /administrator|operator|dead[- ]?letter|dlq|clamd|scanner signature|provider payload|request id/i,
    );
  const technicalDetails = page
    .locator("details")
    .filter({ hasText: /technical details/i });
  await expect.soft(technicalDetails).toBeVisible();
  await technicalDetails.locator("summary").click();
}

test("recovers from every bounded terminal failure and never remains stuck processing", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const owner = await registerCandidate(browser, "cv-failure-owner");
  const client = await pool.connect();
  let seeded: Awaited<ReturnType<typeof seedFailureImports>>;
  try {
    seeded = await seedFailureImports(client, owner.email, [
      {
        label: "infected",
        status: "INFECTED",
        failureCode: "MALWARE_DETECTED",
      },
      {
        label: "structural",
        status: "VALIDATION_FAILED",
        failureCode: "MALFORMED_DOCUMENT",
      },
      {
        label: "invalid-output",
        status: "PARSE_FAILED",
        failureCode: "PARSER_OUTPUT_INVALID",
      },
      {
        label: "exhausted",
        status: "PARSE_FAILED",
        failureCode: "RETRY_LIMIT_REACHED",
        candidateParseRetriesUsed: 2,
      },
      { label: "processing", status: "SCANNING", failureCode: null },
    ]);
  } finally {
    client.release();
  }

  await test.step("infected rejection is safe and replacement-only", async () => {
    await owner.page.goto(
      `/profile/cv-imports/${seeded.uploads.get("infected")}`,
    );
    await assertSafeFailure(owner.page, /could not continue|rejected safely/i);
    await expect.soft(owner.page.getByText("MALWARE_DETECTED")).toBeVisible();
    await expect
      .soft(owner.page.getByRole("button", { name: /retry/i }))
      .toHaveCount(0);
    await expect
      .soft(owner.page.getByRole("link", { name: /upload a replacement cv/i }))
      .toHaveAttribute("href", "/profile/cv-imports");
  });

  await test.step("scanner failure retries once, survives refresh, and exposes its counter", async () => {
    const uploadId = seeded.uploads.get("scanner")!;
    const history = seeded.retryHistories.scan;
    await owner.page.goto(`/profile/cv-imports/${uploadId}`);
    await assertSafeFailure(owner.page, /could not finish/i);
    await expect
      .soft(owner.page.getByText(/2 scan retries remaining/i))
      .toBeVisible();
    await expect
      .soft(owner.page.getByText(/retry (?:is available|available in)/i))
      .toBeVisible();

    let retryRequests = 0;
    owner.page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname ===
          `/api/account/cv-imports/${uploadId}/retries`
      )
        retryRequests += 1;
    });
    const retry = owner.page.getByRole("button", { name: /retry scan/i });
    await expect(retry).toBeVisible();
    const retryResponsePromise = owner.page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname ===
          `/api/account/cv-imports/${uploadId}/retries`,
    );
    await retry.dblclick();
    const retryResponse = await retryResponsePromise;
    expect(retryResponse.status()).toBe(202);
    const retryBody = await retryResponse.json();
    expect(retryBody).toEqual({
      uploadId,
      status: "SCAN_QUEUED",
      scanRetriesRemaining: 1,
      parseRetriesRemaining: 2,
    });
    await owner.page.waitForTimeout(250);
    expect(retryRequests).toBe(1);
    await expect(owner.page.getByText(/^scan queued$/i)).toBeVisible();

    const durable = await pool.query<{
      uploadStatus: string;
      candidateScanRetriesUsed: number;
      stage: string;
      priorAttemptId: string;
      attemptId: string;
      attemptNumber: number;
      candidateInitiated: boolean;
      attemptStatus: string;
    }>(
      `SELECT upload."status"::text AS "uploadStatus",
              upload."candidateScanRetriesUsed",
              retry."stage"::text AS "stage",
              retry."priorScanAssessmentId" AS "priorAttemptId",
              retry."scanAssessmentId" AS "attemptId",
              attempt."attemptNumber", attempt."candidateInitiated",
              attempt."status"::text AS "attemptStatus"
         FROM "CvUpload" upload
         JOIN "CvRetryRequest" retry ON retry."uploadId" = upload."id"
         JOIN "CvScanAssessment" attempt
           ON attempt."id" = retry."scanAssessmentId"
        WHERE upload."id" = $1`,
      [uploadId],
    );
    expect(durable.rows).toHaveLength(1);
    expect(durable.rows[0]).toMatchObject({
      uploadStatus: "SCAN_QUEUED",
      candidateScanRetriesUsed: 1,
      stage: "SCAN",
      priorAttemptId: history.priorAttemptId,
      attemptNumber: history.nextAttemptNumber,
      candidateInitiated: true,
    });
    expect(["QUEUED", "PROCESSING"]).toContain(
      durable.rows[0]?.attemptStatus,
    );
    expect(durable.rows[0]?.attemptId).toBeTruthy();

    await owner.page.reload();
    await expect(owner.page.getByText(/^scan queued$/i)).toBeVisible();
    await expect(
      owner.page.getByRole("button", { name: /retry scan/i }),
    ).toHaveCount(0);
  });

  await test.step("structural failure offers replacement without an unsafe retry", async () => {
    await owner.page.goto(
      `/profile/cv-imports/${seeded.uploads.get("structural")}`,
    );
    await assertSafeFailure(owner.page, /could not continue/i);
    await expect.soft(owner.page.getByText("MALFORMED_DOCUMENT")).toBeVisible();
    await expect
      .soft(owner.page.getByRole("button", { name: /retry/i }))
      .toHaveCount(0);
    const replacement = owner.page.getByRole("link", {
      name: /upload a replacement cv/i,
    });
    await expect.soft(replacement).toBeVisible();
    if (await replacement.isVisible().catch(() => false)) {
      await replacement.click();
      await expect.soft(owner.page).toHaveURL(/\/profile\/cv-imports$/u);
      await expect.soft(owner.page.getByLabel("CV file")).toBeVisible();
    }
  });

  await test.step("parser failure queues one durable bounded retry and survives refresh", async () => {
    const uploadId = seeded.uploads.get("parser-unavailable")!;
    const history = seeded.retryHistories.parse;
    await owner.page.goto(`/profile/cv-imports/${uploadId}`);
    await assertSafeFailure(owner.page, /could not finish/i);
    await expect.soft(owner.page.getByText("PARSER_UNAVAILABLE")).toBeVisible();
    await expect
      .soft(owner.page.getByText(/2 parsing retries remaining/i))
      .toBeVisible();
    const retry = owner.page.getByRole("button", { name: /retry parsing/i });
    await expect(retry).toBeVisible();
    const retryResponsePromise = owner.page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname ===
          `/api/account/cv-imports/${uploadId}/retries`,
    );
    await retry.click();
    const retryResponse = await retryResponsePromise;
    expect(retryResponse.status()).toBe(202);
    const retryBody = await retryResponse.json();
    expect(retryBody).toEqual({
      uploadId,
      status: "PARSE_QUEUED",
      scanRetriesRemaining: 2,
      parseRetriesRemaining: 1,
    });
    await expect(
      owner.page.getByText(/^(?:parse queued|parsing|parsing failed)$/iu).first(),
    ).toBeVisible();

    const durable = await pool.query<{
      uploadStatus: string;
      candidateParseRetriesUsed: number;
      stage: string;
      priorAttemptId: string;
      attemptId: string;
      previousAttemptId: string;
      attemptNumber: number;
      trigger: string;
      attemptStatus: string;
    }>(
      `SELECT upload."status"::text AS "uploadStatus",
              upload."candidateParseRetriesUsed",
              retry."stage"::text AS "stage",
              retry."priorParseJobId" AS "priorAttemptId",
              retry."parseJobId" AS "attemptId",
              attempt."previousAttemptId", attempt."attemptNumber",
              attempt."trigger"::text AS "trigger",
              attempt."status"::text AS "attemptStatus"
         FROM "CvUpload" upload
         JOIN "CvRetryRequest" retry ON retry."uploadId" = upload."id"
         JOIN "CvParseJob" attempt ON attempt."id" = retry."parseJobId"
        WHERE upload."id" = $1`,
      [uploadId],
    );
    expect(durable.rows).toHaveLength(1);
    expect(durable.rows[0]).toMatchObject({
      candidateParseRetriesUsed: 1,
      stage: "PARSE",
      priorAttemptId: history.priorAttemptId,
      previousAttemptId: history.priorAttemptId,
      attemptNumber: history.nextAttemptNumber,
      trigger: "CANDIDATE_RETRY",
    });
    // The isolated worker may claim the durable queue between the accepted
    // response and this read. Both states preserve the same retry contract.
    expect(["PARSE_QUEUED", "PARSING"]).toContain(
      durable.rows[0]?.uploadStatus,
    );
    expect(["QUEUED", "PROCESSING"]).toContain(
      durable.rows[0]?.attemptStatus,
    );
    expect(durable.rows[0]?.attemptId).toBeTruthy();

    await owner.page.reload();
    await expect(
      owner.page.getByText(/^(?:parse queued|parsing|parsing failed)$/iu).first(),
    ).toBeVisible();
    await expect(
      owner.page.getByRole("button", { name: /retry parsing/i }),
    ).toHaveCount(0);
  });

  await test.step("invalid output opens manual Profile and preserves failure history", async () => {
    const uploadId = seeded.uploads.get("invalid-output")!;
    await owner.page.goto(`/profile/cv-imports/${uploadId}`);
    await assertSafeFailure(owner.page, /could not continue/i);
    await expect
      .soft(owner.page.getByText("PARSER_OUTPUT_INVALID"))
      .toBeVisible();
    const manual = owner.page.getByRole("link", {
      name: /manual profile|enter.*profile manually/i,
    });
    if (await manual.isVisible().catch(() => false)) {
      await manual.click();
      await expect.soft(owner.page).toHaveURL(/\/profile$/u);
      await owner.page.goto(`/profile/cv-imports/${uploadId}`);
      await assertSafeFailure(owner.page, /could not continue/i);
      await expect
        .soft(owner.page.getByText("PARSER_OUTPUT_INVALID"))
        .toBeVisible();
    }
  });

  await test.step("retry exhaustion remains actionable without suggesting another retry", async () => {
    await owner.page.goto(
      `/profile/cv-imports/${seeded.uploads.get("exhausted")}`,
    );
    await assertSafeFailure(owner.page, /could not continue/i);
    await expect
      .soft(owner.page.getByText("RETRY_LIMIT_REACHED"))
      .toBeVisible();
    await expect
      .soft(owner.page.getByText(/no parsing retries remaining/i))
      .toBeVisible();
    await expect
      .soft(owner.page.getByRole("button", { name: /retry/i }))
      .toHaveCount(0);
  });

  await test.step("authoritative polling leaves processing after a terminal transition", async () => {
    const uploadId = seeded.uploads.get("processing")!;
    await owner.page.goto(`/profile/cv-imports/${uploadId}`);
    await expect
      .soft(owner.page.getByRole("status").filter({ hasText: /scanning/i }))
      .toContainText(/scanning/i);

    let statusRefreshes = 0;
    owner.page.on("request", (request) => {
      if (
        request.method() === "GET" &&
        new URL(request.url()).pathname ===
          `/api/account/cv-imports/${uploadId}`
      )
        statusRefreshes += 1;
    });
    const hiddenBaseline = statusRefreshes;
    await owner.page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await owner.page.waitForTimeout(2_500);
    expect(statusRefreshes).toBe(hiddenBaseline);

    await pool.query(
      `UPDATE "CvUpload"
          SET "status" = 'SCAN_FAILED', "failureCode" = 'SCANNER_UNAVAILABLE',
              "automaticScanAttemptsUsed" = 3, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = $1 AND "accountId" = $2`,
      [uploadId, seeded.accountId],
    );

    const visibleRefresh = owner.page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname ===
          `/api/account/cv-imports/${uploadId}`,
    );
    await owner.page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => false,
      });
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await visibleRefresh;
    expect(statusRefreshes).toBe(hiddenBaseline + 1);
    await expect
      .soft(owner.page.getByText("Security scan failed", { exact: true }))
      .toBeVisible({ timeout: 7_000 });
    await owner.page.reload();
    await expect
      .soft(owner.page.getByText("Security scan failed", { exact: true }))
      .toBeVisible();
  });

  await test.step("failure recovery does not overflow a 320px viewport", async () => {
    await owner.page.setViewportSize({ width: 320, height: 720 });
    await owner.page.goto(
      `/profile/cv-imports/${seeded.uploads.get("structural")}`,
    );
    const hasHorizontalOverflow = await owner.page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect.soft(hasHorizontalOverflow).toBe(false);
  });
});
