import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { config as loadEnvironment } from "dotenv";
import { Pool } from "pg";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { prisma } from "@/backend/database/prisma";
import {
  grantExactRecoveryConsent,
  seedCvRecoveryImport,
} from "../../../helpers/cv-failure-retry-fixture";
import {
  runCandidatePhase3E2EControl,
  type CandidatePhase3BrowserFixture,
} from "../../../helpers/candidate-phase3-e2e-control";

loadEnvironment({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const enabled = process.env.RUN_CANDIDATE_FIRST_E2E === "1";
const password = "Candidate-first fixture 2026!";
const largeApplicationCount = 1_000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let fixture: CandidatePhase3BrowserFixture | undefined;
let retentionUploadId = "";
let recoveryUploadId = "";
let activeJobSlug = "";
let largeJobIds: string[] = [];
let modernConversationId = "";
let notificationTitle = "Application submitted";

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function login(page: Page, email: string) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const response = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "POST" &&
      new URL(candidate.url()).pathname === "/api/identity/login",
  );
  await page.getByRole("button", { name: "Sign in" }).click();
  expect((await response).status()).toBe(200);
  await expect(page).toHaveURL(/\/dashboard$/u);
}

async function assertFocusTrap(dialog: Locator, initialFocus?: Locator) {
  const focusables = dialog.locator(
    "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]",
  );
  const count = await focusables.count();
  expect(count).toBeGreaterThan(1);
  await expect(initialFocus ?? focusables.first()).toBeFocused();
  for (let index = 0; index < count; index += 1)
    await dialog.page().keyboard.press("Tab");
  expect(
    await dialog
      .page()
      .locator(":focus")
      .evaluate((node) => Boolean(node && node.closest('[role="dialog"]'))),
  ).toBe(true);
}

async function seedLargeApplications(
  currentFixture: CandidatePhase3BrowserFixture,
) {
  const skill = await prisma.skill.findUniqueOrThrow({
    where: { normalizedName: "typescript" },
  });
  const extraJobs = Array.from({ length: 200 }, (_, index) => {
    const number = String(index + 1).padStart(3, "0");
    const id = `phase7-large-job-${currentFixture.suffix}-${number}`;
    return {
      id,
      companyId: currentFixture.company.id,
      industryId: "r03",
      subIndustryId: "r03-software-development",
      industryCode: "r03",
      subIndustryCode: "r03-software-development",
      slug: `${id}-slug`,
      title: `Phase 7 bounded role ${number}`,
      normalizedTitle: `phase 7 bounded role ${number}`,
      summary: "Isolated bounded-pagination fixture.",
      description: "A disposable job posting used only by Phase 7 evidence.",
      responsibilities: "Review applications in a bounded page.",
      requirements: "TypeScript fundamentals.",
      benefits: "Test-only fixture.",
      location: "Ho Chi Minh City",
      normalizedLocation: "ho chi minh city",
      employmentType: "FULL_TIME" as const,
      experienceLevel: "MID" as const,
      workArrangement: "HYBRID" as const,
      salaryMin: 25_000_000,
      salaryMax: 45_000_000,
      salaryCurrency: "VND",
      salaryPeriod: "MONTH" as const,
      searchDocumentNormalized: `phase 7 bounded role ${number} typescript`,
      status: "ACTIVE" as const,
      approvedAt: new Date("2026-09-01T08:00:00.000Z"),
      publishedAt: new Date("2026-09-01T08:00:00.000Z"),
      applicationDeadline: new Date("2026-12-31T08:00:00.000Z"),
      version: 1,
    };
  });
  await prisma.jobPosting.createMany({ data: extraJobs });
  largeJobIds = extraJobs.map((job) => job.id);
  await prisma.jobPostingSkill.createMany({
    data: extraJobs.map((job) => ({
      jobPostingId: job.id,
      skillId: skill.id,
      displayName: "TypeScript",
      required: true,
      position: 0,
    })),
  });
  const jobs = await prisma.jobPosting.findMany({
    where: { id: { in: largeJobIds } },
    orderBy: { id: "asc" },
    select: {
      id: true,
      title: true,
      location: true,
      employmentType: true,
      experienceLevel: true,
      workArrangement: true,
      version: true,
      company: { select: { displayName: true } },
    },
  });
  if (jobs.length !== 200)
    throw new Error("PHASE7_LARGE_JOB_FIXTURE_INCOMPLETE");
  const [candidate, cv] = await Promise.all([
    prisma.userAccount.findUniqueOrThrow({
      where: { id: currentFixture.userIds[0] },
      select: { email: true },
    }),
    prisma.candidateCv.findFirstOrThrow({
      where: { candidateUserId: currentFixture.userIds[0] },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        displayName: true,
        fileName: true,
        mimeType: true,
        byteSize: true,
        storageKey: true,
        version: true,
      },
    }),
  ]);
  const rows = Array.from({ length: largeApplicationCount }, (_, index) => {
    const job = jobs[Math.floor(index / 5)]!;
    const submittedAt = new Date(
      Date.UTC(2026, 8, 12, 8, 0, 0) - index * 60_000,
    );
    return {
      id: `phase7-large-${currentFixture.suffix}-${String(index + 1).padStart(4, "0")}`,
      candidateUserId: currentFixture.userIds[0]!,
      jobPostingId: job.id,
      applicationAttemptNumber: (index % 5) + 1,
      selectedCvId: cv.id,
      cvFileRef: cv.storageKey,
      contactSnapshot: {
        fullName: "Job Candidate 1",
        email: candidate.email,
        phone: "0901234567",
        location: "Ho Chi Minh City",
      },
      scoringStatus: "NOT_REQUESTED" as const,
      stage: "APPLIED" as const,
      stageVersion: 1,
      lastStageChangedAt: submittedAt,
      profileSnapshot: { candidateName: "Job Candidate 1" },
      cvSnapshot: {
        cvId: cv.id,
        displayName: cv.displayName,
        fileName: cv.fileName,
        mimeType: cv.mimeType,
        byteSize: cv.byteSize,
        cvVersion: cv.version,
      },
      jobSnapshot: {
        title: job.title,
        companyName: job.company.displayName,
        location: job.location,
        employmentType: job.employmentType,
        experienceLevel: job.experienceLevel,
        workArrangement: job.workArrangement,
        jobVersion: job.version,
      },
      consentVersion: "phase7-large",
      consentedAt: submittedAt,
      idempotencyKey: `phase7-large-key-${currentFixture.suffix}-${index + 1}`,
      submissionBindingDigest: digest(
        `phase7-large:${currentFixture.suffix}:${index + 1}`,
      ),
      submittedAt,
    };
  });
  await prisma.jobApplication.createMany({ data: rows });
}

async function seedModernMessagingConversation(
  currentFixture: CandidatePhase3BrowserFixture,
) {
  const candidateId = currentFixture.userIds[0]!;
  const employerId = currentFixture.userIds[1]!;
  const participantLowId = [candidateId, employerId].sort()[0]!;
  const participantHighId = [candidateId, employerId].sort()[1]!;
  modernConversationId = `phase7-messaging-${currentFixture.suffix}`;
  const now = new Date("2026-09-12T08:00:00.000Z");
  await prisma.messagingConversation.create({
    data: {
      id: modernConversationId,
      participantLowId,
      participantHighId,
      contextType: "APPLICATION",
      contextReference: currentFixture.applicationId,
      applicationId: currentFixture.applicationId,
      companyId: currentFixture.company.id,
      nextMessageSequence: 2,
      lastMessageSequence: 1,
      lastMessageAt: now,
      participants: {
        create: [{ userId: candidateId }, { userId: employerId }],
      },
      messages: {
        create: {
          id: `phase7-messaging-message-${currentFixture.suffix}`,
          sequence: 1,
          senderId: employerId,
          clientOperationId: `phase7-messaging-operation-${currentFixture.suffix}`,
          content: "Phase 7 messaging safety fixture message.",
          createdAt: now,
        },
      },
    },
  });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  if (!enabled) return;
  fixture = await runCandidatePhase3E2EControl<CandidatePhase3BrowserFixture>(
    "create",
    { label: "phase7-authenticated" },
  );
  const client = await pool.connect();
  try {
    const account = await client.query<{ profileId: string }>(
      `SELECT "id" AS "profileId"
         FROM "CandidateProfile"
        WHERE "candidateUserId" = $1`,
      [fixture.userIds[0]],
    );
    const seeded = await seedCvRecoveryImport(
      client,
      "phase7-retention-overlay",
      {
        stage: "PARSE",
        mode: "TERMINAL_FAILURE",
        parserClass: "EXTERNAL_OPENAI",
        now: new Date("2026-09-12T08:00:00.000Z"),
        existingAccount: {
          accountId: fixture.userIds[0]!,
          profileId: account.rows[0]!.profileId,
        },
      },
    );
    await client.query(
      `UPDATE "CvUpload"
          SET "status" = 'AWAITING_CONSENT', "failureCode" = NULL
        WHERE "id" = $1`,
      [seeded.uploadId],
    );
    retentionUploadId = seeded.uploadId;
    const recovery = await seedCvRecoveryImport(
      client,
      "phase7-browser-recovery",
      {
        stage: "PARSE",
        mode: "TERMINAL_FAILURE",
        parserClass: "EXTERNAL_OPENAI",
        now: new Date("2026-09-12T08:05:00.000Z"),
        existingAccount: {
          accountId: fixture.userIds[0]!,
          profileId: account.rows[0]!.profileId,
        },
      },
    );
    recoveryUploadId = recovery.uploadId;
    await grantExactRecoveryConsent(
      client,
      recovery,
      new Date("2026-09-12T08:05:00.000Z"),
    );
    const job = await client.query<{ slug: string }>(
      `SELECT "slug" FROM "JobPosting" WHERE "id" = $1`,
      [fixture.activeJobId],
    );
    activeJobSlug = job.rows[0]!.slug;
  } finally {
    client.release();
  }
  await prisma.company.update({
    where: { id: fixture.companyTwoId },
    data: {
      publicDescription: `Phase 7 long company description. ${"Accessible company information for the isolated browser fixture. ".repeat(40)}`,
    },
  });
  const notification = await prisma.inAppNotification.findFirstOrThrow({
    where: {
      recipientUserId: fixture.userIds[0],
      kind: "APPLICATION_SUBMITTED",
    },
    orderBy: { createdAt: "desc" },
    select: { title: true },
  });
  notificationTitle = notification.title;
  await seedLargeApplications(fixture);
  await seedModernMessagingConversation(fixture);
});

test.afterAll(async () => {
  if (fixture) {
    if (recoveryUploadId) {
      await prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw`
          SELECT set_config('smarthire.cv_retention_mode', 'on', true)
        `;
        await transaction.cvUpload.delete({ where: { id: recoveryUploadId } });
      });
    }
    if (modernConversationId) {
      await prisma.messagingReport.deleteMany({
        where: { conversationId: modernConversationId },
      });
      await prisma.messagingMessage.deleteMany({
        where: { conversationId: modernConversationId },
      });
      await prisma.messagingConversationParticipant.deleteMany({
        where: { conversationId: modernConversationId },
      });
      await prisma.userMessagingBlock.deleteMany({
        where: {
          OR: [
            {
              blockerUserId: { in: fixture.userIds },
              blockedUserId: { in: fixture.userIds },
            },
            {
              blockerUserId: { in: fixture.userIds },
              blockedUserId: { in: fixture.userIds },
            },
          ],
        },
      });
      await prisma.messagingConversation.delete({
        where: { id: modernConversationId },
      });
    }
    await prisma.jobApplication.deleteMany({
      where: {
        id: { startsWith: `phase7-large-${fixture.suffix}-` },
      },
    });
    if (largeJobIds.length) {
      await prisma.jobPostingSkill.deleteMany({
        where: { jobPostingId: { in: largeJobIds } },
      });
      await prisma.jobPosting.deleteMany({
        where: { id: { in: largeJobIds } },
      });
    }
    await runCandidatePhase3E2EControl("delete", { fixture });
  }
  await prisma.$disconnect();
  await pool.end();
});

test("authenticated job report and team withdrawal overlays trap focus and restore it", async ({
  page,
}) => {
  test.skip(!enabled, "Requires the isolated Candidate-first E2E database.");
  if (!fixture) throw new Error("PHASE7_FIXTURE_NOT_READY");
  test.setTimeout(120_000);
  await login(page, fixture.candidateEmail);

  await page.goto(`/jobs/${activeJobSlug}`, { waitUntil: "domcontentloaded" });
  const reportTrigger = page.getByRole("button", { name: "Report this job" });
  await reportTrigger.click();
  const reportDialog = page.getByRole("dialog", { name: "Report this job" });
  await expect(reportDialog).toBeVisible();
  await assertFocusTrap(reportDialog);
  await page.keyboard.press("Escape");
  await expect(reportDialog).toHaveCount(0);
  await expect(reportTrigger).toBeFocused();

  await reportTrigger.click();
  await page.getByLabel("Reason").selectOption("OTHER");
  await reportDialog
    .getByRole("textbox", { name: /Details/iu })
    .fill(
      "This isolated posting needs a safety review before candidates apply.",
    );
  const reportResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/reports"),
  );
  await page.getByRole("button", { name: "Submit report" }).click();
  expect((await reportResponse).status()).toBe(201);
  await expect(page.getByRole("status")).toContainText("Report submitted");

  await page.goto("/jobs/applied/team?sort=SUBMITTED_DESC", {
    waitUntil: "domcontentloaded",
  });
  const withdrawTrigger = page
    .locator("article")
    .filter({ has: page.getByRole("button", { name: "Withdraw" }) })
    .first()
    .getByRole("button", { name: "Withdraw" });
  await expect(withdrawTrigger).toBeVisible();
  await withdrawTrigger.click();
  const withdrawDialog = page.getByRole("dialog", {
    name: "Withdraw team application",
  });
  await expect(withdrawDialog).toBeVisible();
  await assertFocusTrap(withdrawDialog);
  await page.keyboard.press("Escape");
  await expect(withdrawDialog).toHaveCount(0);
  await expect(withdrawTrigger).toBeFocused();

  await withdrawTrigger.click();
  const withdrawal = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      new URL(response.url()).pathname.includes(
        "/api/candidate/team-applications/",
      ),
  );
  await page
    .getByRole("button", { name: "Withdraw application" })
    .last()
    .click();
  const withdrawalResponse = await withdrawal;
  expect(withdrawalResponse.status()).toBe(200);
  expect((await withdrawalResponse.json()).status).toBe("WITHDRAWN");
  await expect(page.getByRole("status")).toContainText("was withdrawn");
});

test("authenticated CV retention overlay cancels safely and restores focus", async ({
  page,
}) => {
  test.skip(!enabled, "Requires the isolated Candidate-first E2E database.");
  if (!fixture || !retentionUploadId)
    throw new Error("PHASE7_RETENTION_NOT_READY");
  test.setTimeout(120_000);
  await login(page, fixture.candidateEmail);
  await page.goto(`/profile/cv-imports/${retentionUploadId}`, {
    waitUntil: "domcontentloaded",
  });
  const retention = page.getByTestId("cv-retention-actions");
  const trigger = retention.getByRole("button", {
    name: /cancel and delete this cv import/i,
  });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const dialog = page.getByRole("dialog", {
    name: "Permanently delete temporary CV data?",
  });
  await expect(dialog).toBeVisible();
  await assertFocusTrap(dialog, dialog.getByRole("button", { name: /keep/i }));
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  const deletion = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      new URL(response.url()).pathname.endsWith(`/${retentionUploadId}`),
  );
  await dialog
    .getByRole("button", { name: /confirm cancel and delete/i })
    .click();
  expect((await deletion).status()).toBe(202);
  await expect(retention.getByRole("status")).toContainText(
    /Deletion accepted\. Content access is disabled immediately/i,
  );
});

test("authenticated CV parse failure queues one bounded retry", async ({
  page,
}) => {
  test.skip(!enabled, "Requires the isolated Candidate-first E2E database.");
  if (!fixture || !recoveryUploadId)
    throw new Error("PHASE7_RECOVERY_FIXTURE_NOT_READY");
  test.setTimeout(120_000);
  await login(page, fixture.candidateEmail);
  await page.goto(`/profile/cv-imports/${recoveryUploadId}`, {
    waitUntil: "domcontentloaded",
  });

  const retry = page.getByRole("button", { name: /Retry parsing/i });
  await expect(retry).toBeVisible();
  const retryResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname ===
        `/api/account/cv-imports/${recoveryUploadId}/retries`,
  );
  await retry.click();
  const retryResponse = await retryResponsePromise;
  expect(retryResponse.status()).toBe(202);
  await expect(
    page.getByTestId("cv-failure-recovery").getByRole("status"),
  ).toContainText(/Retry queued|Requesting retry/i);
});

test("company detail and 1,000-record application pagination stay bounded", async ({
  page,
}) => {
  test.skip(!enabled, "Requires the isolated Candidate-first E2E database.");
  if (!fixture) throw new Error("PHASE7_FIXTURE_NOT_READY");
  test.setTimeout(120_000);
  await login(page, fixture.candidateEmail);

  await page.goto(`/company/${fixture.companyTwoId}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("heading", { name: "Phase 3 Browser two" }),
  ).toBeVisible();
  await expect(
    page.getByText("Phase 7 long company description.", { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);

  await page.goto("/jobs/applied", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("1026 applications")).toBeVisible();
  const firstPageCards = page.locator(
    "article.candidate-application-list-card",
  );
  const firstPageCount = await firstPageCards.count();
  expect(firstPageCount).toBeGreaterThan(0);
  expect(firstPageCount).toBeLessThanOrEqual(24);
  const firstCardHref = await firstPageCards
    .first()
    .getByRole("link", { name: /View application status/u })
    .getAttribute("href");
  const loadMore = page.getByRole("button", { name: "Next page" });
  await expect(loadMore).toBeVisible();
  const nextPage = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/candidate/applications" &&
      new URL(response.url()).searchParams.has("cursor"),
  );
  await loadMore.click();
  expect((await nextPage).status()).toBe(200);
  await expect(page).toHaveURL(/cursor=/u);
  const secondPageCount = await firstPageCards.count();
  expect(secondPageCount).toBeGreaterThan(0);
  expect(secondPageCount).toBeLessThanOrEqual(24);
  const secondCardHref = await firstPageCards
    .first()
    .getByRole("link", { name: /View application status/u })
    .getAttribute("href");
  expect(secondCardHref).not.toBe(firstCardHref);
});

test("authenticated notifications expose read state beyond color and survive refetch", async ({
  page,
}) => {
  test.skip(!enabled, "Requires the isolated Candidate-first E2E database.");
  if (!fixture) throw new Error("PHASE7_FIXTURE_NOT_READY");
  test.setTimeout(120_000);
  await login(page, fixture.candidateEmail);
  await page.goto("/notifications", { waitUntil: "domcontentloaded" });

  const notification = page
    .locator("li.notification-inbox__item")
    .filter({ hasText: notificationTitle })
    .first();
  await expect(notification).toBeVisible();
  await expect(notification).toHaveAttribute("data-read", "false");
  await expect(notification.getByText("Unread", { exact: true })).toBeVisible();

  const unreadFilter = page
    .locator("button.notification-filter-btn")
    .filter({ hasText: "Unread" });
  await unreadFilter.click();
  await expect(notification).toBeVisible();

  const markRead = notification.locator(".notification-inbox__mark-read");
  const readResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname.includes("/api/notifications/") &&
      new URL(response.url()).pathname.endsWith("/read"),
  );
  await markRead.click();
  expect((await readResponse).status()).toBe(200);
  await expect(notification).toHaveCount(0);

  const readFilter = page
    .locator("button.notification-filter-btn")
    .filter({ hasText: /^Read$/u });
  await readFilter.click();
  await expect(notification).toBeVisible();
  await expect(notification).toHaveAttribute("data-read", "true");
  await expect(notification.getByText("Read", { exact: true })).toBeVisible();

  const unreadCountResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/notifications/unread-count",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  expect((await unreadCountResponse).status()).toBe(200);
  await expect(
    page
      .locator("li.notification-inbox__item")
      .filter({ hasText: notificationTitle })
      .first(),
  ).toHaveAttribute("data-read", "true");
});

test("messaging report and block overlays remain keyboard-safe and recover access", async ({
  page,
}) => {
  test.skip(!enabled, "Requires the isolated Candidate-first E2E database.");
  if (!fixture) throw new Error("PHASE7_FIXTURE_NOT_READY");
  test.setTimeout(120_000);
  await login(page, fixture.candidateEmail);
  if (!modernConversationId) throw new Error("PHASE7_MESSAGING_NOT_READY");
  await page.goto(
    `/messages?conversation=${encodeURIComponent(modernConversationId)}`,
    {
      waitUntil: "domcontentloaded",
    },
  );
  await expect(
    page.getByText("Phase 7 messaging safety fixture message.", {
      exact: true,
    }),
  ).toBeVisible();

  const reportTrigger = page.getByRole("button", { name: "Report" });
  await reportTrigger.click();
  const reportDialog = page.getByRole("dialog", {
    name: "Report inappropriate content",
  });
  await expect(reportDialog).toBeVisible();
  await assertFocusTrap(
    reportDialog,
    reportDialog.getByRole("button", { name: "Close" }),
  );
  await page.keyboard.press("Escape");
  await expect(reportDialog).toHaveCount(0);
  await expect(reportTrigger).toBeFocused();
  await reportTrigger.click();
  await expect(reportDialog).toBeVisible();
  await reportDialog.getByRole("button", { name: "Submit report" }).click();
  await expect(reportDialog.getByRole("status")).toContainText(
    "Your report was received",
  );
  await reportDialog.getByRole("button", { name: "Close" }).click();

  const blockTrigger = page.getByRole("button", { name: /^Block /u });
  await blockTrigger.click();
  const blockDialog = page.getByRole("dialog", { name: "Stop contact?" });
  await expect(blockDialog).toBeVisible();
  await assertFocusTrap(
    blockDialog,
    blockDialog.getByRole("button", { name: /cancel/i }),
  );
  await page.keyboard.press("Escape");
  await expect(blockDialog).toHaveCount(0);
  await expect(blockTrigger).toBeFocused();
  await blockTrigger.click();
  const blockResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.includes("/api/messaging/blocks/"),
  );
  await blockDialog.getByRole("button", { name: "Confirm block" }).click();
  expect((await blockResponse).status()).toBe(200);
  await expect(
    page.getByRole("status").filter({ hasText: "You have blocked messaging" }),
  ).toBeVisible();
  const unblockTrigger = page.getByRole("button", { name: /^Unblock /u });
  await unblockTrigger.click();
  const unblockDialog = page.getByRole("dialog", {
    name: "Continue messaging?",
  });
  await expect(unblockDialog).toBeVisible();
  await unblockDialog.getByRole("button", { name: "Confirm unblock" }).click();
  const composer = page.getByRole("textbox", { name: "Message" });
  await expect(composer).toBeEnabled();
  const sentContent = "Phase 7 authenticated message survives history reload.";
  await composer.fill(sentContent);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(sentContent, { exact: true })).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText(sentContent, { exact: true })).toBeVisible();
});
