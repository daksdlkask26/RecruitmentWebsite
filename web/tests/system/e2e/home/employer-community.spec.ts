import { expect, test } from "@playwright/test";
import {
  createHomeE2EFixture,
  deleteHomeE2EFixture,
  openHomeNavigationIfCompact,
  setHomeLocale,
} from "./home-e2e-fixture";

let fixture: Awaited<ReturnType<typeof createHomeE2EFixture>>;
test.beforeAll(async () => {
  fixture = await createHomeE2EFixture("community");
});
test.afterAll(async () => {
  if (fixture) await deleteHomeE2EFixture(fixture);
});

test("public navigation keeps Home information sections display-only", async ({
  page,
}) => {
  await page.goto("/");
  await setHomeLocale(page, "en");
  for (const [name, hash] of [
    ["Career paths", "#career-paths"],
    ["Opportunities", "#jobs"],
    ["Smart Match", "#smart-match"],
    ["How it works", "#how-it-works"],
    ["Our commitment", "#candidate-trust"],
  ]) {
    await openHomeNavigationIfCompact(page);
    await page.getByRole("link", { name, exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`${hash}$`, "u"));
  }
  await expect(page.locator("#companies-hiring")).toHaveCount(1);
  for (const selector of [".home-process-list", ".home-candidate-trust-grid"])
    await expect(page.locator(`${selector} a, ${selector} button`)).toHaveCount(
      0,
    );
  await expect(page.locator(".home-path-grid a")).not.toHaveCount(0);
  await expect(page.locator(".home-companies-hiring-grid a")).toHaveCount(0);
  await page.getByLabel("Home language").selectOption("vi");
  await expect(
    page.getByRole("heading", { name: "Doanh nghiệp đang tuyển dụng" }),
  ).toBeVisible();
});
