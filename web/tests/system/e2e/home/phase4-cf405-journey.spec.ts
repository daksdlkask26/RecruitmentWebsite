import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  createHomeE2EFixture,
  deleteHomeE2EFixture,
  setHomeLocale,
  signInHomeUser,
} from "./home-e2e-fixture";
import { runHomeE2EControl } from "../../../helpers/home/home-e2e-control";

let fixture: Awaited<ReturnType<typeof createHomeE2EFixture>>;
const colorScheme: "light" | "dark" =
  process.env.CF405_COLOR_SCHEME === "dark" ? "dark" : "light";

test.beforeAll(async () => {
  fixture = await createHomeE2EFixture("cf405-journey");
});

test.afterAll(async () => {
  if (fixture) await deleteHomeE2EFixture(fixture);
});

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
  await page.addInitScript(
    (theme) => window.localStorage.setItem("smarthire-theme", theme),
    colorScheme,
  );
  expect([320, 375, 768, 1280]).toContain(page.viewportSize()?.width);
});

async function assertSeriousA11y(page: Page) {
  const axePath = resolve(process.cwd(), "../node_modules/axe-core/axe.min.js");
  await page.addScriptTag({ content: readFileSync(axePath, "utf8") });
  const violations = await page.evaluate(async () => {
    const result = await (
      window as unknown as Window & {
        axe: {
          run: (root: Document) => Promise<{
            violations: Array<{
              id: string;
              impact: string | null;
              nodes: Array<{
                target: string[];
                html: string;
                failureSummary?: string;
              }>;
            }>;
          }>;
        };
      }
    ).axe.run(document);
    return result.violations
      .filter(
        (violation) =>
          violation.impact === "critical" || violation.impact === "serious",
      )
      .map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.map((node) => ({
          target: node.target,
          html: node.html,
          failureSummary: node.failureSummary,
        })),
      }));
  });
  expect(violations, JSON.stringify(violations)).toEqual([]);
}

async function navigateAfterAuthoritativeMutation(
  page: Page,
  matcher: RegExp,
  path: string,
  mutate: () => Promise<unknown>,
) {
  let releaseNavigation!: () => void;
  const hold = new Promise<void>((resolve) => {
    releaseNavigation = resolve;
  });
  let intercepted = false;
  await page.route(matcher, async (route) => {
    intercepted = true;
    await hold;
    await route.continue();
  });
  const navigation = page.goto(path);
  await expect.poll(() => intercepted).toBe(true);
  const mutation = await mutate();
  releaseNavigation();
  await navigation;
  await page.unroute(matcher);
  return mutation;
}

test("guest can discover a job and is returned safely to the intended apply route", async ({
  page,
}) => {
  const job = fixture.databaseFixture.jobs.active;
  await page.goto("/");
  await setHomeLocale(page, "en");
  await page.getByRole("link", { name: "Find jobs now" }).click();
  await expect(page).toHaveURL(/\/jobs(?:\?|$)/u);
  await page
    .getByRole("link", { name: job.title, exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${job.slug}$`, "u"));
  await expect(
    page.getByRole("heading", { name: job.title, level: 1 }),
  ).toBeVisible();

  await page.getByRole("link", { name: /sign in to apply/i }).click();
  await expect(page).toHaveURL(
    new RegExp(
      `/login\\?returnTo=${encodeURIComponent(`/jobs/${job.slug}/apply`).replace("?", "\\?")}`,
      "u",
    ),
  );

  await page.goto("/company");
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fcompany/u);
});

test("candidate completes Home → Jobs → Company → Job → save/private-match/apply with responsive evidence", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const job = fixture.databaseFixture.jobs.active;
  const companyHref = `/company/${encodeURIComponent(fixture.databaseFixture.company.id)}`;

  await signInHomeUser(page, fixture.candidate.email);
  await setHomeLocale(page, "en");
  await expect(page).toHaveURL(/\/$/u);

  await page.goto("/jobs");
  await page
    .getByRole("link", { name: job.title, exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${job.slug}$`, "u"));
  await expect(
    page.getByRole("heading", { name: job.title, level: 1 }),
  ).toBeVisible();
  await assertSeriousA11y(page);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);

  const save = page.getByRole("button", { name: /save/i }).first();
  await expect(save).toBeVisible();
  await save.click();
  await expect(
    page.getByRole("button", { name: /remove|saved/i }).first(),
  ).toBeVisible();

  await page.getByRole("link", { name: /check cv fit privately/i }).click();
  await expect(page).toHaveURL(/\/cv-match-check\/new\?jobId=/u);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/jobs/${job.slug}$`, "u"));

  await page.getByRole("link", { name: /apply now/i }).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${job.slug}/apply$`, "u"));
  await expect(
    page.getByRole("heading", { name: job.title, level: 1 }),
  ).toBeVisible();

  await page.goto("/company");
  await expect(page.locator(`a[href="${companyHref}"]`).first()).toBeVisible();
  await page.locator(`a[href="${companyHref}"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`${companyHref}$`, "u"));
  await expect(
    page.getByRole("heading", {
      name: fixture.databaseFixture.company.displayName,
    }),
  ).toBeVisible();
  await assertSeriousA11y(page);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);

  await page
    .getByRole("link", { name: job.title, exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${job.slug}$`, "u"));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${companyHref}$`, "u"));
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/jobs/${job.slug}$`, "u"));
  await page.reload();
  await expect(
    page.getByRole("heading", { name: job.title, level: 1 }),
  ).toBeVisible();
});

test("revoked and expired jobs cannot apply or start private match during navigation races", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const job = fixture.databaseFixture.jobs.active;
  const companyId = fixture.databaseFixture.company.id;
  const actorUserId = fixture.employer.id;

  await signInHomeUser(page, fixture.candidate.email);
  await page.goto("/jobs/" + job.slug);
  await expect(
    page.getByRole("heading", { name: job.title, level: 1 }),
  ).toBeVisible();

  const applyPath = "/jobs/" + job.slug + "/apply";
  const applyMutation = await navigateAfterAuthoritativeMutation(
    page,
    new RegExp("/jobs/" + job.slug + "/apply(?:\\?|$)", "u"),
    applyPath,
    () =>
      runHomeE2EControl("ban-authoritative-company", {
        companyId,
        actorUserId,
      }),
  );
  expect(applyMutation).toMatchObject({ state: "BANNED" });
  await expect(
    page.getByRole("heading", { name: "This job is not available" }),
  ).toBeVisible();

  const restored = await runHomeE2EControl("unban-authoritative-company", {
    companyId,
    actorUserId,
  });
  expect(restored).toMatchObject({ state: "ACTIVE" });

  const privatePath = "/cv-match-check/new?jobId=" + encodeURIComponent(job.id);
  const privateMutation = await navigateAfterAuthoritativeMutation(
    page,
    new RegExp(
      "/cv-match-check/new\\?jobId=" + encodeURIComponent(job.id) + "(?:&|$)",
      "u",
    ),
    privatePath,
    () => runHomeE2EControl("expire-job-for-race", { jobId: job.id }),
  );
  expect(privateMutation).toMatchObject({ state: "EXPIRED" });
  await expect(
    page.getByRole("heading", {
      name: "This job is no longer available for a private check.",
    }),
  ).toBeVisible();
});
