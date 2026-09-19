import { expect, type Page } from "@playwright/test";
import { clearSuccessfulLoginRateLimit } from "../fixtures/rate-limit";
import {
  runHomeE2EControl,
  type HomeE2EFixture,
} from "../../../helpers/home/home-e2e-control";

const password = "Home candidate 2026!";

export async function createHomeE2EFixture(label: string) {
  // Keep the disposable publication window relative to the runtime clock so
  // production E2E checks do not silently expire the fixture as the calendar
  // moves past the fixture's historical default date.
  return runHomeE2EControl<HomeE2EFixture>("create", {
    label,
    now: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
  });
}

export async function deleteHomeE2EFixture(
  fixture: Awaited<ReturnType<typeof createHomeE2EFixture>>,
) {
  await runHomeE2EControl("delete", fixture);
}

export async function signInHomeUser(page: Page, email: string) {
  await page.goto("/login");
  // The login form is server-rendered. Wait for the client bundle to hydrate
  // before submitting so a cold development harness cannot fall back to the
  // browser's native GET form submission.
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/u, { timeout: 30_000 });
  await clearSuccessfulLoginRateLimit(email);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

export async function openHomeNavigationIfCompact(page: Page) {
  if ((page.viewportSize()?.width ?? Number.POSITIVE_INFINITY) > 1120) return;
  const menu = page.getByRole("button", {
    name: /^(?:Open navigation menu|Mở menu điều hướng)$/u,
  });
  if ((await menu.getAttribute("aria-expanded")) !== "true") await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
}

export async function setHomeLocale(page: Page, locale: "en" | "vi") {
  // The selector is server-rendered before the Home client hydrates. Waiting
  // for the initial request burst prevents selectOption from changing only the
  // native value without dispatching React's locale handler.
  await page.waitForLoadState("networkidle");
  await page
    .getByLabel(/^(?:Home language|Ngôn ngữ trang chủ)$/u)
    .selectOption(locale);
  // The native control changes before React's external-store subscriber has
  // committed the translated tree. The root layout always starts with
  // `lang="en"`, so wait for the selector's translated accessible name rather
  // than the document attribute.
  const languageSelect = page.getByRole("combobox").first();
  if (locale === "en") {
    await expect(languageSelect).toHaveAttribute("aria-label", "Home language");
  } else {
    await expect(languageSelect).not.toHaveAttribute(
      "aria-label",
      "Home language",
    );
  }
}
