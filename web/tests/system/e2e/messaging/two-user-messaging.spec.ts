import { expect, test, type Page } from "@playwright/test";
import { messagingE2eUsers } from "../fixtures/messaging";

test.skip(
  process.env.MESSAGING_E2E_READY !== "1",
  "Requires the documented two-user messaging fixture",
);

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

test("Candidate and Recruiter exchange a durable message across two real browsers", async ({
  browser,
}) => {
  test.setTimeout(120_000);
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
    await Promise.all([
      candidate.goto("/messages"),
      recruiter.goto("/messages"),
    ]);
    await expect(
      candidate
        .getByRole("status")
        .filter({ hasText: "Đang kết nối trực tuyến" }),
    ).toBeVisible();
    let recruiterConversationListRefetches = 0;
    recruiter.on("request", (request) => {
      if (
        request.method() === "GET" &&
        new URL(request.url()).pathname === "/api/messaging/conversations"
      ) {
        recruiterConversationListRefetches += 1;
      }
    });
    const refetchesBeforeSend = recruiterConversationListRefetches;
    const openResponse = candidate.waitForResponse(
      (response) =>
        response.url().endsWith("/api/messaging/conversations") &&
        response.request().method() === "POST",
    );
    await candidate
      .getByRole("button", { name: /^Nhắn tin cho / })
      .first()
      .click();
    const opened = await openResponse;
    expect(
      opened.ok(),
      `Conversation open failed with status ${opened.status()}.`,
    ).toBe(true);
    await expect(candidate.getByLabel("Soạn tin nhắn")).toBeVisible({
      timeout: 10_000,
    });
    const content = `Realtime E2E ${Date.now()}`;
    await candidate.getByRole("textbox", { name: "Tin nhắn" }).fill(content);
    await candidate.getByRole("button", { name: "Gửi" }).click();
    await expect(
      candidate.getByText("Đã gửi", { exact: true }).first(),
    ).toBeVisible();
    await expect
      .poll(() => recruiterConversationListRefetches)
      .toBeGreaterThan(refetchesBeforeSend);
    const recruiterConversation = recruiter
      .getByRole("button")
      .filter({ hasText: "Messaging Candidate" })
      .first();
    await expect(recruiterConversation).toBeVisible({ timeout: 10_000 });
    await recruiterConversation.click();
    await expect(recruiter.getByLabel("Soạn tin nhắn")).toBeVisible();
    await expect(
      candidate
        .getByRole("list", { name: "Tin nhắn", exact: true })
        .getByRole("listitem")
        .filter({ hasText: content }),
    ).toContainText("Đã xem", { timeout: 10_000 });

    await recruiterContext.setOffline(true);
    const offlineContent = `Offline recovery ${Date.now()}`;
    await candidate
      .getByRole("textbox", { name: "Tin nhắn" })
      .fill(offlineContent);
    await candidate.getByRole("button", { name: "Gửi" }).click();
    await expect(candidate.getByText(offlineContent)).toBeVisible();
    await recruiterContext.setOffline(false);
    await recruiter.goto("/messages");
    await expect(
      recruiter
        .getByRole("status")
        .filter({ hasText: "Đang kết nối trực tuyến" }),
    ).toBeVisible({
      timeout: 20_000,
    });
    await recruiter
      .getByRole("navigation", { name: "Cuộc trò chuyện gần đây" })
      .getByRole("button")
      .first()
      .click();
    await expect(recruiter.getByLabel("Soạn tin nhắn")).toBeVisible({
      timeout: 10_000,
    });
    const thread = recruiter.getByRole("list", {
      name: "Tin nhắn",
      exact: true,
    });
    await expect(thread.getByText(content, { exact: true })).toBeVisible();
    await expect(
      thread.getByText(offlineContent, { exact: true }),
    ).toBeVisible();
    await expect(
      recruiter
        .getByRole("status")
        .filter({ hasText: "Đang kết nối trực tuyến" }),
    ).toBeVisible({
      timeout: 10_000,
    });
  } finally {
    await Promise.all([candidateContext.close(), recruiterContext.close()]);
  }
});
