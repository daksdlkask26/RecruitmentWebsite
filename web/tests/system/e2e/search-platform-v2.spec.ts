import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  runHomeE2EControl,
  type HomeE2EFixture,
} from "../../helpers/home/home-e2e-control";
import { signInHomeUser } from "./home/home-e2e-fixture";

let fixture: HomeE2EFixture;
const axePath = resolve(
  process.cwd(),
  "..",
  "node_modules",
  "axe-core",
  "axe.min.js",
);

async function expectNoSeriousAxeViolations(
  page: import("@playwright/test").Page,
) {
  await page.addScriptTag({ path: axePath });
  const result = await page.evaluate(async () => {
    const axe = (
      window as typeof window & {
        axe?: {
          run: (context: Document) => Promise<{
            violations: Array<{ impact?: string | null }>;
          }>;
        };
      }
    ).axe;
    return axe ? await axe.run(document) : null;
  });
  expect(result).not.toBeNull();
  expect(
    result?.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
}

test.beforeAll(async () => {
  fixture = await runHomeE2EControl<HomeE2EFixture>("create", {
    label: "search-platform-v2",
    now: new Date().toISOString(),
  });
});

test.afterAll(async () => {
  if (fixture) {
    await runHomeE2EControl("delete", {
      databaseFixture: fixture.databaseFixture,
    });
  }
});

test("searches Jobs with an exact fixture title and keeps the result usable", async ({
  page,
}) => {
  const jobs = fixture.databaseFixture.jobs;
  await page.goto(`/jobs?q=${encodeURIComponent(jobs.active.title)}`);
  await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();
  await expect(page.getByRole("list", { name: "matching jobs" })).toContainText(
    jobs.active.title,
  );
  await expectNoSeriousAxeViolations(page);
  await expect(
    page.getByRole("link", { name: jobs.pending.title }),
  ).toHaveCount(0);
});

test("searches Company Search by name and preserves a usable mobile layout", async ({
  page,
}) => {
  await signInHomeUser(page, fixture.candidate.email);
  await page.goto("/company");
  await expect(page.getByRole("heading", { name: "Companies" })).toBeVisible();

  const search = page.getByRole("combobox", { name: "Search companies" });
  await search.fill(fixture.databaseFixture.company.displayName);
  await search.press("Enter");
  await expect(page).toHaveURL(/q=/u);

  const companies = page.getByRole("list", { name: "Companies" });
  await expect(companies).toContainText(
    fixture.databaseFixture.company.displayName,
  );
  await expectNoSeriousAxeViolations(page);
  await expect(page.getByRole("listitem").first()).toBeVisible();
  await expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
