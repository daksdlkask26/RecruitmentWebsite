import { expect, test, type Page } from "@playwright/test";
import { messagingE2eUsers } from "../fixtures/messaging";

const browserLocale = process.env.PHASE6A_BROWSER_LOCALE === "vi" ? "vi" : "en";
const copy =
  browserLocale === "vi"
    ? {
        connected: "Đang kết nối trực tuyến",
        messageButton: /^Nhắn tin cho /u,
        message: "Tin nhắn",
        send: "Gửi",
        deliverySent: "Đã gửi",
        darkMode: "Chuyển sang giao diện tối",
      }
    : {
        connected: "Realtime connected",
        messageButton: /^Message /u,
        message: "Message",
        send: "Send",
        deliverySent: "Sent",
        darkMode: "Switch to dark mode",
      };

async function signIn(page: Page, email: string, password: string) {
  const response = await page.request.post("/api/identity/login", {
    headers: {
      origin: "http://localhost:3001",
      "sec-fetch-site": "same-origin",
    },
    data: { email, password, returnTo: "/messages" },
  });
  expect(response.ok(), `Login failed with status ${response.status()}.`).toBe(
    true,
  );
}

async function waitForRealtime(page: Page) {
  await expect(
    page.getByRole("status").filter({ hasText: copy.connected }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("html")).toHaveAttribute("lang", browserLocale);
}

test("Candidate-first Phase 6A survives two tabs, reconnect, recovery, and runtime modes", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const candidateContext = await browser.newContext();
  const recruiterContext = await browser.newContext();
  try {
    const candidate = await candidateContext.newPage();
    const candidateSecondTab = await candidateContext.newPage();
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
      candidateSecondTab.goto("/messages"),
      recruiter.goto("/messages"),
    ]);
    await Promise.all([
      waitForRealtime(candidate),
      waitForRealtime(candidateSecondTab),
      waitForRealtime(recruiter),
    ]);

    const openResponse = candidate.waitForResponse(
      (response) =>
        response.url().endsWith("/api/messaging/conversations") &&
        response.request().method() === "POST",
    );
    await candidate
      .getByRole("button", { name: copy.messageButton })
      .first()
      .click();
    const opened = await openResponse;
    expect(
      opened.ok(),
      `Conversation open failed with status ${opened.status()}.`,
    ).toBe(true);
    const openedConversation = (await opened.json()) as { id: string };
    const conversationUrl = `/messages?conversation=${encodeURIComponent(openedConversation.id)}`;
    await expect(
      candidate.getByRole("textbox", { name: copy.message }),
    ).toBeVisible();

    await recruiter.goto(conversationUrl);
    await waitForRealtime(recruiter);
    await expect(
      recruiter.getByRole("textbox", { name: copy.message }),
    ).toBeVisible();
    await candidateSecondTab.goto(conversationUrl);
    await waitForRealtime(candidateSecondTab);
    await expect(
      candidateSecondTab.getByRole("textbox", { name: copy.message }),
    ).toBeVisible();

    const firstContent = `phase6a durable ${Date.now()}`;
    await candidate
      .getByRole("textbox", { name: copy.message })
      .fill(firstContent);
    await candidate.getByRole("button", { name: copy.send }).click();
    await expect(
      candidate.getByRole("status").filter({ hasText: copy.deliverySent }),
    ).toBeVisible();
    await expect(
      recruiter.getByText(firstContent, { exact: true }),
    ).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      candidateSecondTab.getByText(firstContent, { exact: true }),
    ).toBeVisible({
      timeout: 10_000,
    });

    await recruiterContext.setOffline(true);
    const recoveryContent = `phase6a recovery ${Date.now()}`;
    await candidate
      .getByRole("textbox", { name: copy.message })
      .fill(recoveryContent);
    await candidate.getByRole("button", { name: copy.send }).click();
    await expect(
      candidate.getByText(recoveryContent, { exact: true }),
    ).toBeVisible();
    await recruiterContext.setOffline(false);
    await recruiter.reload();
    await waitForRealtime(recruiter);
    await expect(
      recruiter.getByText(recoveryContent, { exact: true }),
    ).toBeVisible({
      timeout: 15_000,
    });

    await candidate.emulateMedia({
      colorScheme: "dark",
      reducedMotion: "reduce",
    });
    await candidate.getByRole("button", { name: copy.darkMode }).click();
    await expect(candidate.locator("html")).toHaveAttribute(
      "data-theme",
      "dark",
    );
    await candidate.setViewportSize({ width: 320, height: 720 });
    await candidate.goto(conversationUrl);
    await waitForRealtime(candidate);
    await expect(candidate.locator("html")).toHaveAttribute(
      "data-theme",
      "dark",
    );
    await expect
      .poll(() =>
        candidate.evaluate(
          () =>
            window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
            document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await expect(
      candidate.getByRole("textbox", { name: copy.message }),
    ).toBeVisible();
  } finally {
    await Promise.all([candidateContext.close(), recruiterContext.close()]);
  }
});
