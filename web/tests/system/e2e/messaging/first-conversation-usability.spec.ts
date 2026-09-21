import { expect, test, type Page } from "@playwright/test";
import { messagingE2eUsers } from "../fixtures/messaging";

async function signIn(page: Page, email: string, password: string) {
  const response = await page.request.post("/api/identity/login", {
    headers: {
      origin: "http://localhost:3001",
      "sec-fetch-site": "same-origin",
    },
    data: { email, password, returnTo: "/dashboard" },
  });
  expect(response.ok(), `Login failed with status ${response.status()}.`).toBe(
    true,
  );
}

async function executeFirstConversationRun(
  page: Page,
  run: number,
  inputMode: "pointer" | "keyboard",
) {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard$/);
  const startedAt = Date.now();
  const messagesLink = page.getByRole("link", {
    name: "Tin nhắn",
    exact: true,
  });
  if (inputMode === "keyboard") {
    await messagesLink.focus();
    await page.keyboard.press("Enter");
  } else {
    await messagesLink.click();
  }
  await expect(page).toHaveURL(/\/messages$/);
  await expect(
    page.getByRole("status").filter({ hasText: "Đang kết nối trực tuyến" }),
  ).toBeVisible();
  const openButton = page
    .getByRole("button", { name: /^Nhắn tin cho / })
    .first();
  const openResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/messaging/conversations") &&
      response.request().method() === "POST",
  );
  if (inputMode === "keyboard") {
    await openButton.focus();
    await page.keyboard.press("Enter");
  } else {
    await openButton.click();
  }
  const opened = await openResponse;
  expect(
    opened.ok(),
    `Conversation open failed with status ${opened.status()}.`,
  ).toBe(true);
  await expect(
    page.getByLabel("Soạn tin nhắn"),
    `Run ${run} (${inputMode}) did not render the opened thread.`,
  ).toBeVisible({ timeout: 10_000 });
  const content = `Usability protocol run ${run} ${Date.now()}`;
  const editor = page.getByRole("textbox", { name: "Tin nhắn" });
  if (inputMode === "keyboard") {
    await editor.focus();
    await page.keyboard.type(content);
    await page.getByRole("button", { name: "Gửi" }).focus();
    await page.keyboard.press("Enter");
  } else {
    await editor.fill(content);
    await page.getByRole("button", { name: "Gửi" }).click();
  }
  await expect(
    page.getByRole("status").filter({ hasText: "Đã gửi" }),
  ).toBeVisible();
  return Date.now() - startedAt;
}

test("ten representative engineering actors complete a first conversation without assistance", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const candidateContext = await browser.newContext();
  const recruiterContext = await browser.newContext();
  try {
    const candidate = await candidateContext.newPage();
    const recruiter = await recruiterContext.newPage();
    await Promise.all([
      signIn(
        candidate,
        messagingE2eUsers.candidate.email,
        messagingE2eUsers.candidate.password,
      ),
      signIn(
        recruiter,
        messagingE2eUsers.recruiter.email,
        messagingE2eUsers.recruiter.password,
      ),
    ]);
    const results: Array<{
      run: number;
      actor: "Candidate" | "Recruiter";
      elapsedMs: number;
    }> = [];
    for (let run = 1; run <= 10; run += 1) {
      const candidateFirst = run % 2 === 1;
      const actor = candidateFirst ? candidate : recruiter;
      results.push({
        run,
        actor: candidateFirst ? "Candidate" : "Recruiter",
        elapsedMs: await executeFirstConversationRun(
          actor,
          run,
          run === 3 || run === 4 ? "keyboard" : "pointer",
        ),
      });
    }
    expect(results).toHaveLength(10);
    expect(
      results.filter((result) => result.actor === "Candidate"),
    ).toHaveLength(5);
    expect(
      results.filter((result) => result.actor === "Recruiter"),
    ).toHaveLength(5);
    expect(results.every((result) => result.elapsedMs < 120_000)).toBe(true);
  } finally {
    await Promise.all([candidateContext.close(), recruiterContext.close()]);
  }
});
