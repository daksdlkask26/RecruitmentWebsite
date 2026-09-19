import { expect, test } from "@playwright/test";
import {
  createHomeE2EFixture,
  deleteHomeE2EFixture,
  openHomeNavigationIfCompact,
  signInHomeUser,
} from "./home-e2e-fixture";
import { runHomeE2EControl } from "../../../helpers/home/home-e2e-control";

let fixture: Awaited<ReturnType<typeof createHomeE2EFixture>>;
test.beforeAll(async () => {
  fixture = await createHomeE2EFixture("session");
});
test.afterAll(async () => {
  if (fixture) await deleteHomeE2EFixture(fixture);
});

test("candidate account, shortcuts, logout, and expired-session reset stay on one Home", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await signInHomeUser(page, fixture.candidate.email);
  await openHomeNavigationIfCompact(page);
  await expect(
    page.getByRole("link", { name: "Open your profile" }).last(),
  ).toBeVisible();
  for (const [name, href] of [
    ["My Dashboard", "/dashboard"],
    ["My Applications", "/jobs/applied"],
    ["Saved Jobs", "/jobs/saved"],
  ])
    await expect(page.getByRole("link", { name }).first()).toHaveAttribute(
      "href",
      href,
    );
  await page.getByRole("button", { name: "Log out" }).first().click();
  await openHomeNavigationIfCompact(page);
  await expect(
    page.getByRole("link", { name: /^(?:Log in|Đăng nhập)$/u }).first(),
  ).toBeVisible();
  await expect(page.getByText(fixture.candidate.name)).toHaveCount(0);

  await signInHomeUser(page, fixture.candidate.email);
  await runHomeE2EControl("expire-user", { userId: fixture.candidate.id });
  await page.reload();
  await openHomeNavigationIfCompact(page);
  await expect(
    page.getByRole("link", { name: /^(?:Log in|Đăng nhập)$/u }).first(),
  ).toBeVisible();
  await expect(page.getByText(fixture.candidate.name)).toHaveCount(0);
  await expect(page.getByText("Profile estimate")).toHaveCount(0);
});

test("approved employer receives only the authorized employer presentation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInHomeUser(page, fixture.employer.email);
  await openHomeNavigationIfCompact(page);
  await expect(
    page.getByRole("link", { name: "My Dashboard" }).first(),
  ).toBeVisible();
  await expect(page.getByText("My Applications")).toHaveCount(0);
  await expect(page.getByText("Saved Jobs")).toHaveCount(0);
  await expect(
    page.getByText("This example does not use your profile or a live job."),
  ).toBeVisible();
  await expect(page.getByText("Profile estimate")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Post a Job" }).first(),
  ).toHaveAttribute("href", /.+/u);
});
