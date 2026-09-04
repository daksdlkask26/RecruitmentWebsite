import { resolve } from "node:path";
import { config as loadEnvironment } from "dotenv";
import { expect, test } from "@playwright/test";
import {
  runHomeE2EControl,
  type HomeE2EDatabaseFixture,
} from "../../../helpers/home/home-e2e-control";

loadEnvironment({ path: resolve(process.cwd(), ".env.local"), quiet: true });

let fixture: HomeE2EDatabaseFixture;

test.beforeAll(async () => {
  fixture = (
    await runHomeE2EControl<{ databaseFixture: HomeE2EDatabaseFixture }>(
      "create",
      {
        label: "e2e-discovery",
        now: new Date().toISOString(),
      },
    )
  ).databaseFixture;
});

test.afterAll(async () => {
  if (fixture) await runHomeE2EControl("delete", { databaseFixture: fixture });
});

test("browses, filters, opens public details, and remains usable at the project viewport", async ({
  page,
}) => {
  await page.goto("/jobs");
  await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();
  const isMobile =
    (page.viewportSize()?.width ?? Number.POSITIVE_INFINITY) <= 320;
  await page
    .getByRole("combobox", {
      name: "Search jobs, skills, or companies",
    })
    .fill(fixture.jobs.active.title);
  if (!isMobile)
    await page.getByLabel("Work arrangement").selectOption("HYBRID");
  await page.getByRole("button", { name: "Search jobs" }).click();
  await expect(page).toHaveURL(/q=/u);
  await expect(
    page.getByRole("link", { name: fixture.jobs.active.title }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: fixture.jobs.pending.title }),
  ).toHaveCount(0);

  await page.getByRole("link", { name: fixture.jobs.active.title }).click();
  await expect(
    page.getByRole("heading", { name: fixture.jobs.active.title }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Requirements" }).click();
  await expect(
    page.getByRole("heading", { name: "Must-have requirements" }),
  ).toBeVisible();
  await expect(page.getByLabel("Job status: Active")).toBeVisible();
  const overflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.clientWidth,
    body: Math.round(document.body.getBoundingClientRect().width),
    workspace: Math.round(
      document
        .querySelector<HTMLElement>(".workspace-content")
        ?.getBoundingClientRect().width ?? 0,
    ),
    detail: Math.round(
      document
        .querySelector<HTMLElement>(".job-detail-board-page")
        ?.getBoundingClientRect().width ?? 0,
    ),
    elements: [...document.querySelectorAll<HTMLElement>("*")]
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        className: element.className,
        left: Math.round(element.getBoundingClientRect().left),
        width: Math.round(element.getBoundingClientRect().width),
        right: Math.round(element.getBoundingClientRect().right),
      }))
      .filter(({ right }) => right > window.innerWidth + 1)
      .slice(0, 8),
  }));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    JSON.stringify(overflow),
  ).toBe(true);
});
