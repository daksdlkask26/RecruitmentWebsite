import { expect, test } from "@playwright/test";
import { setHomeLocale } from "./home-e2e-fixture";

for (const viewport of [
  { name: "desktop", width: 1366, height: 768 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const) {
  test(`keyboard flow and layout remain usable at ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await setHomeLocale(page, "en");
    if (viewport.width <= 1120) {
      const menu = page.getByRole("button", { name: "Open navigation menu" });
      await menu.focus();
      await page.keyboard.press("Enter");
      await expect(menu).toHaveAttribute("aria-expanded", "true");
      await expect(
        page
          .locator("#home-mobile-links")
          .getByRole("link", { name: "Career paths" }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(menu).toBeFocused();
    } else {
      await page
        .locator(".home-desktop-links")
        .getByRole("link", { name: "Opportunities" })
        .focus();
      await expect(
        page
          .locator(".home-desktop-links")
          .getByRole("link", { name: "Opportunities" }),
      ).toBeFocused();
    }
    await page.getByLabel("Home language").focus();
    await page.getByLabel("Home language").selectOption("vi");
    await page.getByLabel("Từ khóa").fill("frontend");
    await page.getByRole("button", { name: "Tìm việc" }).focus();
    await expect(page.getByRole("button", { name: "Tìm việc" })).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}

test("Home remains keyboard reachable without horizontal scrolling at 200% zoom", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 720 });
  await page.goto("/");
  await setHomeLocale(page, "en");
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await page.getByRole("button", { name: "Open navigation menu" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("link", { name: "Log in" }).last()).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
