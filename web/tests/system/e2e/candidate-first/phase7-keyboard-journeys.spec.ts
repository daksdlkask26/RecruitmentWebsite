import { resolve } from "node:path";
import { config as loadEnvironment } from "dotenv";
import { Pool } from "pg";
import {
  expect,
  test,
  type CDPSession,
  type Locator,
  type Page,
} from "@playwright/test";
import axe from "axe-core";

import { prisma } from "@/backend/database/prisma";
import {
  runCandidatePhase3E2EControl,
  type CandidatePhase3BrowserFixture,
} from "../../../helpers/candidate-phase3-e2e-control";
import { seedReviewDraft } from "../../../helpers/cv-review-fixture";
import {
  runPhase5BrowserControl,
  type Phase5BrowserPrivateMatchIds,
} from "../../../helpers/phase5-browser-control";

loadEnvironment({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const enabled = process.env.RUN_CANDIDATE_FIRST_E2E === "1";
const password = "Candidate-first fixture 2026!";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const matrixTheme =
  process.env.PHASE7_MATRIX_THEME === "dark" ? "dark" : "light";
const matrixReducedMotion = process.env.PHASE7_MATRIX_REDUCED_MOTION === "1";
const matrixZoom = process.env.PHASE7_MATRIX_ZOOM === "200" ? 200 : 100;

let fixture: CandidatePhase3BrowserFixture | undefined;
let keyboardJobId = "";
let keyboardJobSlug = "";
let unavailableApplicationId = "";
let modernConversationId = "";
let reviewUploadId = "";
let matchIds: Phase5BrowserPrivateMatchIds | undefined;
const zoomSessions = new WeakMap<Page, CDPSession>();

async function tabTo(control: Locator, maxTabs = 500) {
  const page = control.page();
  await applyTwoHundredPercentReflow(page);
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();
  for (let index = 0; index <= maxTabs; index += 1) {
    if (await control.evaluate((node) => node === document.activeElement))
      return;
    await page.keyboard.press("Tab");
  }
  throw new Error(
    `PHASE7_KEYBOARD_CONTROL_NOT_TAB_REACHABLE:${await control.getAttribute("aria-label")}`,
  );
}

async function tabToAndType(control: Locator, value: string) {
  await tabTo(control);
  await control.press("Control+A");
  await control.pressSequentially(value);
}

async function pressEnter(control: Locator) {
  await tabTo(control);
  await expect(control).toBeFocused();
  await control.press("Enter");
}

async function pressSpace(control: Locator) {
  await tabTo(control);
  await expect(control).toBeFocused();
  await control.press("Space");
}

async function checkWithKeyboard(control: Locator) {
  if (await control.isChecked()) return;
  if ((await control.getAttribute("type")) !== "radio") {
    await pressSpace(control);
    return;
  }

  const fieldset = control.locator("xpath=ancestor::fieldset[1]");
  const group = (await fieldset.count())
    ? fieldset
    : control.locator("xpath=ancestor::*[@role='radiogroup'][1]");
  const radios = group.getByRole("radio");
  const count = await radios.count();
  let entry = radios.first();
  for (let index = 0; index < count; index += 1) {
    const candidate = radios.nth(index);
    if (await candidate.isChecked()) {
      entry = candidate;
      break;
    }
  }
  await tabTo(entry);
  for (let index = 0; index < count; index += 1) {
    if (await control.isChecked()) return;
    await entry.page().keyboard.press("ArrowRight");
  }
  throw new Error("PHASE7_KEYBOARD_RADIO_NOT_SELECTABLE");
}

async function loginWithKeyboard(page: Page, email: string) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const emailInput = page.getByLabel("Email address");
  const passwordInput = page.getByLabel("Password", { exact: true });
  const passwordRequirements = page.getByRole("button", {
    name: "Password requirements",
  });
  const showPassword = page.getByRole("button", {
    name: "Show password",
  });
  const forgotPassword = page.getByRole("link", {
    name: "Forgot password?",
    exact: true,
  });
  const submit = page.getByRole("button", { name: "Sign in" });

  await tabToAndType(emailInput, email);
  await emailInput.press("Tab");
  await expect(passwordRequirements).toBeFocused();
  await passwordRequirements.press("Tab");
  await expect(passwordInput).toBeFocused();
  await passwordInput.pressSequentially(password);
  await passwordInput.press("Tab");
  await expect(showPassword).toBeFocused();
  await showPassword.press("Tab");
  await expect(forgotPassword).toBeFocused();
  await forgotPassword.press("Tab");
  await expect(submit).toBeFocused();

  const response = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "POST" &&
      new URL(candidate.url()).pathname === "/api/identity/login",
  );
  await submit.press("Enter");
  const loginResponse = await response;
  const loginBody = await loginResponse.text();
  expect(loginResponse.status(), loginBody).toBe(200);
  await expect(page).toHaveURL(/\/dashboard$/u);
}

async function gotoReady(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await applyTwoHundredPercentReflow(page);
}

async function applyMatrixProfile(page: Page) {
  await page.emulateMedia({
    colorScheme: matrixTheme,
    reducedMotion: matrixReducedMotion ? "reduce" : "no-preference",
  });
  await page.addInitScript((theme) => {
    window.localStorage.setItem("smarthire-theme", theme);
  }, matrixTheme);
}

async function applyTwoHundredPercentReflow(page: Page) {
  if (matrixZoom !== 200) return;
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("PHASE7_MATRIX_VIEWPORT_MISSING");
  let cdp = zoomSessions.get(page);
  if (!cdp) {
    cdp = await page.context().newCDPSession(page);
    zoomSessions.set(page, cdp);
  }
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: Math.ceil(viewport.width / 2),
    height: Math.ceil(viewport.height / 2),
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
  });
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
}

async function assertJourneyQuality(page: Page, journey: string) {
  await applyTwoHundredPercentReflow(page);
  await expect(page).not.toHaveTitle("");
  await page.addScriptTag({ content: axe.source });
  const result = await page.evaluate(async () => {
    const axeApi = (
      window as unknown as Window & {
        axe: {
          run: (root: Document) => Promise<{
            violations: Array<{
              id: string;
              impact: string | null;
              nodes: Array<{ target: string[] }>;
            }>;
          }>;
        };
      }
    ).axe;
    const axeResult = await axeApi.run(document);
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      horizontalOverflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
      locale: document.documentElement.lang,
      theme: document.documentElement.dataset.theme ?? "",
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)")
        .matches,
      visualViewportScale: window.visualViewport?.scale ?? 1,
      visualViewportWidth: window.visualViewport?.width ?? window.innerWidth,
      seriousCriticalViolations: axeResult.violations
        .filter(
          (violation) =>
            violation.impact === "serious" || violation.impact === "critical",
        )
        .map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          targets: violation.nodes.map((node) => node.target),
        })),
    };
  });
  expect(result.horizontalOverflow, `${journey}: horizontal overflow`).toBe(
    false,
  );
  expect(result.locale, `${journey}: locale`).toBe("en");
  expect(result.theme, `${journey}: theme`).toBe(matrixTheme);
  expect(result.reducedMotion, `${journey}: reduced motion`).toBe(
    matrixReducedMotion,
  );
  if (matrixZoom === 200) {
    const viewport = page.viewportSize();
    if (!viewport) throw new Error("PHASE7_MATRIX_VIEWPORT_MISSING");
    expect(result.width, `${journey}: 200% reflow width`).toBeLessThanOrEqual(
      Math.ceil(viewport.width / 2) + 1,
    );
    expect(
      result.visualViewportScale,
      `${journey}: 200% page scale`,
    ).toBeGreaterThanOrEqual(1.9);
  }
  expect(
    result.seriousCriticalViolations,
    `${journey}: serious/critical axe violations`,
  ).toEqual([]);
  console.log(
    JSON.stringify({
      phase7Matrix: true,
      journey,
      project: test.info().project.name,
      viewport: `${result.width}x${result.height}`,
      zoom: matrixZoom,
      visualViewportScale: result.visualViewportScale,
      visualViewportWidth: result.visualViewportWidth,
      locale: result.locale,
      theme: result.theme,
      reducedMotion: result.reducedMotion,
      horizontalOverflow: result.horizontalOverflow,
      seriousCriticalAxeViolations: 0,
      keyboard: "Tab/Shift+Tab/Enter/Space/Escape only",
    }),
  );
}

async function seedKeyboardJob(currentFixture: CandidatePhase3BrowserFixture) {
  const skill = await prisma.skill.findUniqueOrThrow({
    where: { normalizedName: "typescript" },
  });
  keyboardJobId = `phase7-keyboard-job-${currentFixture.suffix}`;
  keyboardJobSlug = `${keyboardJobId}-slug`;
  await prisma.jobPosting.create({
    data: {
      id: keyboardJobId,
      companyId: currentFixture.company.id,
      industryId: "r03",
      subIndustryId: "r03-software-development",
      industryCode: "r03",
      subIndustryCode: "r03-software-development",
      slug: keyboardJobSlug,
      title: "Phase 7 keyboard journey role",
      normalizedTitle: "phase 7 keyboard journey role",
      summary: "A disposable role for keyboard-only Candidate evidence.",
      description: "A disposable role for keyboard-only Candidate evidence.",
      responsibilities: "Review and deliver accessible product increments.",
      requirements: "TypeScript fundamentals and testing evidence.",
      benefits: "Test-only fixture.",
      location: "Ho Chi Minh City",
      normalizedLocation: "ho chi minh city",
      employmentType: "FULL_TIME",
      experienceLevel: "MID",
      workArrangement: "HYBRID",
      salaryMin: 25_000_000,
      salaryMax: 45_000_000,
      salaryCurrency: "VND",
      salaryPeriod: "MONTH",
      searchDocumentNormalized:
        "phase 7 keyboard journey role typescript accessible",
      status: "ACTIVE",
      approvedAt: new Date("2026-09-20T08:00:00.000Z"),
      publishedAt: new Date("2026-09-20T08:00:00.000Z"),
      applicationDeadline: new Date("2026-12-31T08:00:00.000Z"),
      version: 1,
      skills: {
        create: {
          skillId: skill.id,
          displayName: "TypeScript",
          required: true,
          position: 0,
        },
      },
    },
  });
}

async function seedModernConversation(
  currentFixture: CandidatePhase3BrowserFixture,
) {
  const candidateId = currentFixture.userIds[0]!;
  const employerId = currentFixture.userIds[1]!;
  const participantLowId = [candidateId, employerId].sort()[0]!;
  const participantHighId = [candidateId, employerId].sort()[1]!;
  modernConversationId = `phase7-keyboard-messaging-${currentFixture.suffix}`;
  const now = new Date("2026-09-20T08:00:00.000Z");

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
          id: `phase7-keyboard-message-${currentFixture.suffix}`,
          sequence: 1,
          senderId: employerId,
          clientOperationId: `phase7-keyboard-operation-${currentFixture.suffix}`,
          content: "Phase 7 keyboard fixture message.",
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
    { label: "phase7-keyboard-journeys" },
  );

  await prisma.accountPreferences.upsert({
    where: { userId: fixture.userIds[0]! },
    create: { userId: fixture.userIds[0]!, language: "EN" },
    update: { language: "EN" },
  });

  await seedKeyboardJob(fixture);
  await seedModernConversation(fixture);

  const client = await pool.connect();
  try {
    const profile = await client.query<{ profileId: string }>(
      `SELECT "id" AS "profileId"
         FROM "CandidateProfile"
        WHERE "candidateUserId" = $1`,
      [fixture.userIds[0]],
    );
    const seededReview = await seedReviewDraft(
      client,
      "phase7-keyboard-review",
      {
        existingAccount: {
          accountId: fixture.userIds[0]!,
          profileId: profile.rows[0]!.profileId,
        },
      },
    );
    reviewUploadId = seededReview.uploadId;
  } finally {
    client.release();
  }

  const unavailable = await prisma.jobApplication.findFirst({
    where: {
      candidateUserId: fixture.userIds[0],
      jobPosting: { status: { in: ["CLOSED", "EXPIRED", "REMOVED"] } },
    },
    orderBy: { submittedAt: "desc" },
    select: { id: true },
  });
  unavailableApplicationId = unavailable?.id ?? "";
  if (!unavailableApplicationId)
    throw new Error("PHASE7_KEYBOARD_UNAVAILABLE_APPLICATION_MISSING");

  const seeded = await runPhase5BrowserControl<{
    matchIds: Phase5BrowserPrivateMatchIds;
  }>("seed", {
    input: {
      candidateUserId: fixture.userIds[0],
      employerUserId: fixture.userIds[1],
      confirmedCvId: await prisma.candidateCv
        .findFirstOrThrow({
          where: {
            candidateUserId: fixture.userIds[0],
            confirmedAt: { not: null },
          },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        })
        .then((cv) => cv.id),
      companyName: "Phase 7 keyboard fixture company",
      activeJob: { id: fixture.activeJobId },
      now: new Date("2026-09-20T08:00:00.000Z").toISOString(),
    },
  });
  matchIds = seeded.matchIds;
});

test.afterAll(async () => {
  if (fixture) {
    await runPhase5BrowserControl("cleanup", {
      candidateUserId: fixture.userIds[0],
    });
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
    if (keyboardJobId) {
      await prisma.jobApplication.deleteMany({
        where: { jobPostingId: keyboardJobId },
      });
      await prisma.jobPostingSkill.deleteMany({
        where: { jobPostingId: keyboardJobId },
      });
      await prisma.jobPosting.delete({ where: { id: keyboardJobId } });
    }
    if (reviewUploadId) {
      await prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw`
          SELECT set_config('smarthire.cv_retention_mode', 'on', true)
        `;
        await transaction.cvUpload.delete({ where: { id: reviewUploadId } });
      });
    }
    await runCandidatePhase3E2EControl("delete", { fixture });
  }
  await prisma.$disconnect();
  await pool.end();
});

test("completes all nine Candidate primary journeys with keyboard input", async ({
  page,
}) => {
  test.skip(!enabled, "Requires the isolated Candidate-first E2E database.");
  if (!fixture || !matchIds || !keyboardJobSlug)
    throw new Error("PHASE7_KEYBOARD_FIXTURE_NOT_READY");
  test.setTimeout(900_000);

  let submittedApplicationId = "";
  await applyMatrixProfile(page);
  await loginWithKeyboard(page, fixture.candidateEmail);
  await applyTwoHundredPercentReflow(page);

  await test.step("J1 jobs discovery, detail, back and forward", async () => {
    await gotoReady(page, "/jobs");
    const jobLink = page.locator(`a[href="/jobs/${keyboardJobSlug}"]`);
    await expect(jobLink).toBeVisible();
    await pressEnter(jobLink);
    await expect(
      page.getByRole("heading", { name: "Phase 7 keyboard journey role" }),
    ).toBeVisible();
    await pressEnter(page.getByRole("link", { name: "Back to jobs" }));
    await expect(page).toHaveURL(/\/jobs(?:\?|$)/u);
    await pressEnter(page.locator(`a[href="/jobs/${keyboardJobSlug}"]`));
    await expect(page).toHaveURL(new RegExp(`/jobs/${keyboardJobSlug}$`, "u"));
    await assertJourneyQuality(page, "J1-jobs-search-and-apply-entry");
  });

  await test.step("J2 company discovery, detail and long content", async () => {
    await gotoReady(page, "/company");
    const companyLink = page.locator(
      `a[href="/company/${fixture!.companyTwoId}"]`,
    );
    await expect(companyLink).toBeVisible();
    await pressEnter(companyLink);
    await expect(
      page.getByRole("heading", { name: "Phase 3 Browser two" }),
    ).toBeVisible();
    await expect(
      page.getByText("Isolated Candidate-first browser fixture.", {
        exact: false,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await assertJourneyQuality(page, "J2-company-discovery");
  });

  await test.step("J3 CV import, review and receipt", async () => {
    await gotoReady(page, "/profile/cv-imports");
    const importEntry = page.getByRole("link", { name: "Review draft" }).last();
    await expect(importEntry).toBeVisible();
    await pressEnter(importEntry);
    await expect(page).toHaveURL(
      new RegExp(`/profile/cv-imports/${reviewUploadId}$`, "u"),
    );
    await pressEnter(page.getByRole("link", { name: "Review draft" }));
    await expect(page).toHaveURL(
      new RegExp(`/profile/cv-imports/${reviewUploadId}/review$`, "u"),
    );
    await expect(
      page.getByRole("heading", { name: "Review CV proposals" }),
    ).toBeVisible();
    await tabToAndType(
      page.getByLabel("Proposed headline"),
      "Keyboard-first Engineer",
    );
    await checkWithKeyboard(
      page
        .getByRole("group", { name: "Decision for headline" })
        .getByRole("radio", { name: "Replace" }),
    );
    await checkWithKeyboard(
      page.getByRole("checkbox", {
        name: "I have reviewed every proposal.",
      }),
    );
    await pressEnter(page.getByRole("button", { name: "Save review" }));
    await expect(page.getByRole("status")).toContainText("Review saved");
    await checkWithKeyboard(
      page.getByRole("checkbox", {
        name: /confirm updates my candidate profile/i,
      }),
    );
    await pressEnter(
      page.getByRole("button", { name: "Confirm selected changes" }),
    );
    await expect(
      page.getByRole("heading", { name: "CV import confirmed" }),
    ).toBeVisible();
    await assertJourneyQuality(page, "J3-cv-import-review");
  });

  await test.step("J4 application review and submit", async () => {
    await gotoReady(page, `/jobs/${keyboardJobSlug}/apply`);
    const phone = page.getByLabel("Phone number");
    if (!(await phone.inputValue())) await tabToAndType(phone, "0901234567");
    await pressEnter(
      page.getByRole("button", { name: "Continue to Application files" }),
    );
    await checkWithKeyboard(
      page.getByRole("radiogroup").getByRole("radio").first(),
    );
    await pressEnter(
      page.getByRole("button", { name: "Continue to Review and submit" }),
    );
    await expect(page).toHaveURL(/\/apply\/review\?draftId=/u);
    await checkWithKeyboard(
      page.getByRole("checkbox", {
        name: /I confirm that the information is correct/i,
      }),
    );
    const submission = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/candidate/applications",
    );
    await pressEnter(page.getByRole("button", { name: "Submit application" }));
    const response = await submission;
    const responseBody = await response.text();
    expect(response.status(), responseBody).toBe(201);
    submittedApplicationId =
      ((await response.json()) as { applicationId?: string }).applicationId ??
      "";
    expect(submittedApplicationId).toBeTruthy();
    await expect(page).toHaveURL(
      new RegExp(`/jobs/applied/${submittedApplicationId}/processing$`, "u"),
    );
    await expect(
      page.getByRole("heading", { name: "Application intake progress" }),
    ).toBeVisible();
    await assertJourneyQuality(page, "J4-application-review-submit");
  });

  await test.step("J5 application history, detail, pagination and unavailable job", async () => {
    await gotoReady(page, "/jobs/applied");
    const nextPage = page.getByRole("button", { name: "Next page" });
    await expect(nextPage).toBeVisible();
    const nextPageResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === "/api/candidate/applications" &&
        new URL(response.url()).searchParams.has("cursor"),
    );
    await pressEnter(nextPage);
    expect((await nextPageResponse).status()).toBe(200);
    await expect(page).toHaveURL(/cursor=/u);

    // The newly submitted application is ordered onto the first page. Keep
    // the pagination assertion above, then return through the normal page
    // route before exercising the keyboard detail journey.
    await gotoReady(page, "/jobs/applied");
    const submittedLink = page.locator(
      `a[href="/jobs/applied/${submittedApplicationId}"]`,
    );
    await expect(submittedLink).toBeVisible();
    await pressEnter(submittedLink);
    await expect(page).toHaveURL(
      new RegExp(`/jobs/applied/${submittedApplicationId}$`, "u"),
    );
    await gotoReady(page, `/jobs/applied/${unavailableApplicationId}`);
    await expect(
      page.getByText(/This job listing is no longer available\./u),
    ).toBeVisible();
    await assertJourneyQuality(page, "J5-application-history-and-detail");
  });

  await test.step("J6 private CV Match states and result", async () => {
    await gotoReady(
      page,
      `/cv-match-check/${encodeURIComponent(matchIds!.fullHigh)}`,
    );
    await expect(page.locator(".private-match-ready-page")).toBeVisible();
    await pressEnter(
      page.getByRole("button", { name: /View full match report/i }),
    );
    await expect(page.locator(".pmr-page")).toBeVisible();
    await assertJourneyQuality(page, "J6-private-cv-match");
  });

  await test.step("J7 notifications read state", async () => {
    await gotoReady(page, "/notifications");
    const notification = page
      .locator("li.notification-inbox__item")
      .filter({ hasText: "Application submitted" })
      .first();
    await expect(notification).toHaveAttribute("data-read", "false");
    await pressSpace(
      page.locator("button.notification-filter-btn").filter({
        hasText: "Unread",
      }),
    );
    const markRead = notification.locator(".notification-inbox__mark-read");
    const readResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname.endsWith("/read"),
    );
    await pressEnter(markRead);
    expect((await readResponse).status()).toBe(200);
    await pressSpace(
      page.locator("button.notification-filter-btn").filter({
        hasText: /^Read$/u,
      }),
    );
    await expect(
      page
        .locator("li.notification-inbox__item")
        .filter({ hasText: "Application submitted" })
        .first(),
    ).toHaveAttribute("data-read", "true");
    await assertJourneyQuality(page, "J7-notifications-read-state");
  });

  await test.step("J8 messaging send, recovery, revocation and block", async () => {
    await gotoReady(
      page,
      `/messages?conversation=${encodeURIComponent(modernConversationId)}`,
    );
    await expect(
      page.getByText("Phase 7 keyboard fixture message.", { exact: true }),
    ).toBeVisible();

    const reportTrigger = page.getByRole("button", { name: "Report" });
    await pressEnter(reportTrigger);
    const reportDialog = page.getByRole("dialog", {
      name: "Report inappropriate content",
    });
    await expect(reportDialog).toBeVisible();
    await expect(
      reportDialog.getByRole("button", { name: "Close" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(reportDialog).toHaveCount(0);
    await expect(reportTrigger).toBeFocused();

    const blockTrigger = page.getByRole("button", { name: /^Block /u });
    await pressEnter(blockTrigger);
    const blockDialog = page.getByRole("dialog", { name: "Stop contact?" });
    await expect(blockDialog).toBeVisible();
    const cancelBlock = blockDialog.getByRole("button", { name: /cancel/i });
    await expect(cancelBlock).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(blockDialog).toHaveCount(0);
    await expect(blockTrigger).toBeFocused();

    await pressEnter(blockTrigger);
    await expect(cancelBlock).toBeFocused();
    const blockResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.includes("/api/messaging/blocks/"),
    );
    await pressEnter(page.getByRole("button", { name: "Confirm block" }));
    expect((await blockResponse).status()).toBe(200);
    const unblockTrigger = page.getByRole("button", { name: /^Unblock /u });
    await expect(unblockTrigger).toBeVisible();
    await pressEnter(unblockTrigger);
    const unblockDialog = page.getByRole("dialog", {
      name: "Continue messaging?",
    });
    await expect(unblockDialog).toBeVisible();
    await pressEnter(
      unblockDialog.getByRole("button", { name: "Confirm unblock" }),
    );
    const composer = page.getByRole("textbox", { name: "Message" });
    await expect(composer).toBeEnabled();
    const sentContent = "Phase 7 keyboard message survives reload.";
    await tabToAndType(composer, sentContent);
    await pressEnter(page.getByRole("button", { name: "Send" }));
    await expect(page.getByText(sentContent, { exact: true })).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(sentContent, { exact: true })).toBeVisible();
    await assertJourneyQuality(page, "J8-messaging-block-report-revocation");
  });

  await test.step("J9 representative modal focus and return", async () => {
    await gotoReady(page, `/jobs/${keyboardJobSlug}`);
    const reportTrigger = page.getByRole("button", {
      name: "Report this job",
    });
    await pressEnter(reportTrigger);
    const reportDialog = page.getByRole("dialog", {
      name: "Report this job",
    });
    await expect(reportDialog).toBeVisible();
    await expect(reportDialog.locator("select").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(reportDialog).toHaveCount(0);
    await expect(reportTrigger).toBeFocused();
    await assertJourneyQuality(page, "J9-authenticated-overlay-focus-return");
  });
});
