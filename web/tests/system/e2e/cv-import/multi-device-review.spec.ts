import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type Request,
} from "@playwright/test";
import { Pool } from "pg";

import {
  cleanupReviewAccounts,
  seedReviewDraft,
} from "../../../helpers/cv-review-fixture";

test.describe.configure({ mode: "serial" });

const password = "Synthetic CV Multi Device 004!";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const contexts: BrowserContext[] = [];
const emails = new Set<string>();

test.afterAll(async () => pool.end());
test.afterEach(async () => {
  try {
    const registered = [...emails];
    emails.clear();
    if (registered.length) {
      const client = await pool.connect();
      try {
        const accounts = await client.query<{ id: string }>(
          `SELECT "id" FROM "user" WHERE "normalizedEmail" = ANY($1::text[])`,
          [registered.map((email) => email.toLowerCase())],
        );
        await cleanupReviewAccounts(
          client,
          accounts.rows.map(({ id }) => id),
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

async function registerCandidate(browser: Browser) {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  const email = `cv-multi-device-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
  emails.add(email);
  const mailDirectory = resolve(process.cwd(), ".local/mail");
  const before = new Set(await readdir(mailDirectory).catch(() => []));

  await page.goto("/register");
  await page.getByLabel("Full name").fill("Multi-device Candidate");
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

async function loginOnSecondDevice(browser: Browser, email: string) {
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

async function seedForCandidate(email: string) {
  const client = await pool.connect();
  try {
    const account = await client.query<{
      accountId: string;
      profileId: string;
      revision: number;
    }>(
      `SELECT account."id" AS "accountId", profile."id" AS "profileId",
              profile."revision"
         FROM "user" account
         JOIN "CandidateProfile" profile
           ON profile."candidateUserId" = account."id"
        WHERE account."normalizedEmail" = $1`,
      [email.toLowerCase()],
    );
    if (!account.rows[0]) throw new Error("CANDIDATE_PROFILE_MISSING");
    return seedReviewDraft(client, "multi-device-e2e", {
      profileRevision: account.rows[0].revision,
      existingAccount: account.rows[0],
    });
  } finally {
    client.release();
  }
}

function mutationHeaders(request: Request) {
  return {
    "content-type": "application/json",
    "x-csrf-token": request.headers()["x-csrf-token"] ?? "",
    origin: request.headers().origin ?? new URL(request.url()).origin,
    "sec-fetch-site": request.headers()["sec-fetch-site"] ?? "same-origin",
  };
}

async function chooseHeadline(
  page: Page,
  value: string,
  action: "add" | "replace",
) {
  await page.getByLabel("Proposed headline").fill(value);
  await page
    .getByRole("group", { name: "Decision for headline" })
    .getByRole("radio", { name: action })
    .check();
  await page
    .getByRole("checkbox", { name: "I have reviewed every proposal." })
    .check();
}

test("preserves a losing device's edits and requires re-review after a direct Profile change", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const deviceA = await registerCandidate(browser);
  const deviceB = await loginOnSecondDevice(browser, deviceA.email);
  const seeded = await seedForCandidate(deviceA.email);
  const reviewUrl = `/profile/cv-imports/${seeded.uploadId}/review`;

  await Promise.all([deviceA.page.goto(reviewUrl), deviceB.goto(reviewUrl)]);
  await expect(
    deviceA.page.getByRole("heading", { name: "Review CV proposals" }),
  ).toBeVisible();
  await expect(
    deviceB.getByRole("heading", { name: "Review CV proposals" }),
  ).toBeVisible();

  await chooseHeadline(deviceA.page, "Device A winner", "add");
  await chooseHeadline(deviceB, "Device B preserved", "add");
  let deviceASaveRequest: Request | null = null;
  deviceA.page.on("request", (request) => {
    if (
      request.method() === "PATCH" &&
      new URL(request.url()).pathname ===
        `/api/account/cv-drafts/${seeded.draftId}`
    )
      deviceASaveRequest = request;
  });
  const firstSave = deviceA.page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname ===
        `/api/account/cv-drafts/${seeded.draftId}`,
  );
  await deviceA.page.getByRole("button", { name: "Save review" }).click();
  expect((await firstSave).status()).toBe(200);
  await expect(deviceA.page.getByRole("status")).toContainText("Review saved");

  const staleSave = deviceB.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname ===
        `/api/account/cv-drafts/${seeded.draftId}`,
  );
  await deviceB.getByRole("button", { name: "Save review" }).click();
  expect((await staleSave).status()).toBe(409);
  await expect(
    deviceB.getByRole("heading", {
      name: "Review conflict needs your choice",
    }),
  ).toBeFocused();
  await expect(deviceB.getByLabel("Proposed headline")).toHaveValue(
    "Device B preserved",
  );
  await expect(deviceB.getByText("Device B preserved")).toBeVisible();

  await deviceB
    .getByRole("button", { name: "Compare with latest saved review" })
    .click();
  await expect(
    deviceB.getByText(/latest saved draft revision 1/i),
  ).toBeVisible();
  await expect(deviceB.getByLabel("Proposed headline")).toHaveValue(
    "Device B preserved",
  );
  await deviceB
    .getByRole("button", { name: "Reapply my edits to latest" })
    .click();
  const reappliedSave = deviceB.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname ===
        `/api/account/cv-drafts/${seeded.draftId}`,
  );
  await deviceB.getByRole("button", { name: "Save review" }).click();
  expect((await reappliedSave).status()).toBe(200);
  await expect(deviceB.getByText("Review draft revision 2")).toBeVisible();

  expect(deviceASaveRequest).not.toBeNull();
  const directProfileEdit = await deviceA.page.request.patch(
    "/api/account/profile",
    {
      headers: mutationHeaders(deviceASaveRequest!),
      data: {
        section: "basics",
        baseRevision: 0,
        basics: {
          headline: "Direct Profile winner",
          summary: null,
          phone: null,
          location: null,
        },
      },
    },
  );
  expect(directProfileEdit.status()).toBe(200);

  await deviceB
    .getByLabel("Proposed headline")
    .fill("CV value after explicit re-review");
  const staleProfileSave = deviceB.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname ===
        `/api/account/cv-drafts/${seeded.draftId}`,
  );
  await deviceB.getByRole("button", { name: "Save review" }).click();
  expect((await staleProfileSave).status()).toBe(409);
  await expect(deviceB.getByLabel("Proposed headline")).toHaveValue(
    "CV value after explicit re-review",
  );
  await deviceB
    .getByRole("button", { name: "Compare with latest saved review" })
    .click();
  await deviceB
    .getByRole("button", { name: "Reapply my edits to latest" })
    .click();
  await deviceB
    .getByRole("group", { name: "Decision for headline" })
    .getByRole("radio", { name: "replace" })
    .check();
  const reviewedSave = deviceB.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname ===
        `/api/account/cv-drafts/${seeded.draftId}`,
  );
  await deviceB.getByRole("button", { name: "Save review" }).click();
  expect((await reviewedSave).status()).toBe(200);
  await expect(deviceB.getByText("Review draft revision 3")).toBeVisible();

  await deviceB
    .getByRole("checkbox", {
      name: /confirm updates my candidate profile/i,
    })
    .check();
  const confirmation = deviceB.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname ===
        `/api/account/cv-drafts/${seeded.draftId}/confirm`,
  );
  await deviceB
    .getByRole("button", { name: "Confirm selected changes" })
    .click();
  expect((await confirmation).status()).toBe(201);
  await expect(
    deviceB.getByRole("heading", { name: "CV import confirmed" }),
  ).toBeVisible();

  const profile = await deviceB.request
    .get("/api/account/profile")
    .then((response) => response.json());
  expect(profile).toMatchObject({
    revision: 2,
    basics: { headline: "CV value after explicit re-review" },
  });
});
