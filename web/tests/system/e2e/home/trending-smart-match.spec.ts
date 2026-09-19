import { expect, test } from "@playwright/test";
import {
  createHomeE2EFixture,
  deleteHomeE2EFixture,
  setHomeLocale,
  signInHomeUser,
} from "./home-e2e-fixture";

let fixture: Awaited<ReturnType<typeof createHomeE2EFixture>>;
test.beforeAll(async () => {
  fixture = await createHomeE2EFixture("match");
});
test.afterAll(async () => {
  if (fixture) await deleteHomeE2EFixture(fixture);
});

test("candidate sees one explainable estimate and save success/failure recovery", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInHomeUser(page, fixture.candidate.email);
  await expect(page.getByText("Profile estimate")).toBeVisible();
  await expect(
    page.getByText(/not applicant screening or a hiring decision/iu),
  ).toBeVisible();
  const estimates = page.locator("#smart-match .home-match-ring");
  await expect(estimates).toHaveCount(1);
  await expect(
    page.getByRole("img", { name: /%.*match.*available/iu }),
  ).toBeVisible();

  await page.route("**/api/saved-jobs/**", (route) =>
    route.fulfill({ status: 503, body: "{}" }),
  );
  await page.getByRole("button", { name: "Save job" }).first().click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Could not update saved jobs" }),
  ).toBeVisible();
  await page.unroute("**/api/saved-jobs/**");
  await page.getByRole("button", { name: "Save job" }).first().click();
  await expect(
    page.getByRole("status").filter({ hasText: "Job saved" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Saved" }).first(),
  ).toHaveAttribute("aria-pressed", "true");
});

test("guest illustration never creates a job-card score and save requires an account", async ({
  page,
}) => {
  await page.goto("/");
  await setHomeLocale(page, "en");
  await expect(
    page.getByText("This example does not use your profile or a live job."),
  ).toBeVisible();
  await expect(page.locator("#smart-match .home-match-ring")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Log in to save this job" }).first(),
  ).toHaveAttribute("href", /\/login\?returnTo=%2Fjobs%2F/u);
});
