import { expect, test } from "@playwright/test";
import { setHomeLocale } from "./home-e2e-fixture";

test.describe.configure({ mode: "serial" });

const viewports = [
  { name: "mobile-320", width: 320, height: 720 },
  { name: "mobile-375", width: 375, height: 812 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1280", width: 1280, height: 800 },
] as const;
const colorScheme: "light" | "dark" =
  process.env.CF405_COLOR_SCHEME === "dark" ? "dark" : "light";

for (const viewport of viewports) {
  test(`Home remains usable in EN/VI, ${colorScheme} mode, and reduced motion at ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.addInitScript(
      (theme) => window.localStorage.setItem("smarthire-theme", theme),
      colorScheme,
    );
    await page.goto("/");
    await setHomeLocale(page, "en");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByLabel("Home language")).toHaveValue("en");
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(() => ({
        dark: window.matchMedia("(prefers-color-scheme: dark)").matches,
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)")
          .matches,
      })),
    ).toEqual({ dark: colorScheme === "dark", reducedMotion: true });
    expect(
      await page.evaluate(() => ({
        appliedTheme: document.documentElement.dataset.theme,
        colorScheme: document.documentElement.style.colorScheme,
      })),
    ).toEqual({ appliedTheme: colorScheme, colorScheme });

    await setHomeLocale(page, "vi");
    await expect(page.getByLabel("Ngôn ngữ trang chủ")).toHaveValue("vi");
    await setHomeLocale(page, "en");

    if (viewport.width <= 768) {
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
      await expect(
        page
          .locator(".home-desktop-links")
          .getByRole("link", { name: "Opportunities" }),
      ).toBeVisible();
    }

    await testInfo.attach(`home-${viewport.name}`, {
      body: await page.screenshot({ fullPage: false }),
      contentType: "image/png",
    });
  });
}
