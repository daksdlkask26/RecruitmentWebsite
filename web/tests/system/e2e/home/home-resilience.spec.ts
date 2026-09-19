import { expect, test } from "@playwright/test";
import {
  createHomeE2EFixture,
  deleteHomeE2EFixture,
  setHomeLocale,
} from "./home-e2e-fixture";
import { runHomeE2EControl } from "../../../helpers/home/home-e2e-control";

let fixture: Awaited<ReturnType<typeof createHomeE2EFixture>>;
test.beforeAll(async () => {
  fixture = await createHomeE2EFixture("resilience");
});
test.afterAll(async () => {
  if (fixture) await deleteHomeE2EFixture(fixture);
});

test("an empty company source does not disable header, Hero, search, or jobs", async ({
  page,
}) => {
  await runHomeE2EControl("deactivate-company", {
    companyId: fixture.databaseFixture.company.id,
  });
  await page.goto("/");
  await setHomeLocale(page, "en");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByLabel("Keyword")).toBeEnabled();
  await expect(page.getByRole("button", { name: "Search jobs" })).toBeEnabled();
  const trending = page.getByRole("region", { name: "Trending Opportunities" });
  await expect(trending).toBeVisible();
  await expect(trending.getByRole("link", { name: "View role" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("heading", {
      name: fixture.databaseFixture.company.displayName,
    }),
  ).toHaveCount(0);
});

test.fixme("provider-error recovery needs an existing supported fault-injection boundary; Home must not add a test API", async () => {
  // Kept explicitly open until the deployment test environment can make the
  // existing Job/Company provider fail independently without a Home endpoint.
});
