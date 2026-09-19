import { expect, test } from "@playwright/test";
import { setHomeLocale } from "./home-e2e-fixture";

for (const locale of ["en", "vi"] as const) {
  test(`guest discovery preserves concise hero filters in ${locale}`, async ({
    page,
  }) => {
    await page.goto("/");
    await setHomeLocale(page, locale);
    const labels =
      locale === "en" ? ["Keyword", "Location"] : ["Từ khóa", "Địa điểm"];
    const values = ["frontend", "Hà Nội"];
    await page.getByLabel(labels[0]!).fill(values[0]!);
    await page.getByLabel(labels[1]!).fill(values[1]!);
    await page
      .getByLabel(locale === "en" ? "Home language" : "Ngôn ngữ trang chủ")
      .selectOption(locale === "en" ? "vi" : "en");
    const switchedLabels =
      locale === "en" ? ["Từ khóa", "Địa điểm"] : ["Keyword", "Location"];
    for (const [index, label] of switchedLabels.entries())
      await expect(page.getByLabel(label!)).toHaveValue(values[index]!);
    await page
      .getByRole("button", {
        name: locale === "en" ? "Tìm việc" : "Search jobs",
      })
      .click();
    await page.waitForURL(/\/jobs\?/u);
    const url = new URL(page.url());
    expect([...url.searchParams.keys()]).toEqual(["q", "location"]);
    expect(url.pathname).toBe("/jobs");
  });
}

test("guest conversion actions show the candidate and employer paths", async ({
  page,
}) => {
  await page.goto("/");
  await setHomeLocale(page, "en");
  await expect(
    page.getByRole("link", { name: "Find jobs now" }),
  ).toHaveAttribute("href", "/jobs");
  await expect(
    page.getByRole("link", { name: "For employers →" }),
  ).toHaveAttribute(
    "href",
    "/login?returnTo=%2Fdashboard%2Femployer-verification",
  );
});
