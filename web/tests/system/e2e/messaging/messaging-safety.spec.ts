import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
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

test("block and report remain safe across two browsers and multiple tabs", async ({
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
    await expect(
      candidate
        .getByRole("status")
        .filter({ hasText: "Đang kết nối trực tuyến" }),
    ).toBeVisible();
    await candidate
      .getByRole("button", { name: /^Nhắn tin cho / })
      .first()
      .click();
    await candidate.getByRole("button", { name: "Báo cáo" }).click();
    await candidate.getByRole("button", { name: "Gửi báo cáo" }).click();
    await expect(
      candidate.getByRole("status").filter({ hasText: "Đã nhận báo cáo" }),
    ).toBeVisible();
    await candidate.getByRole("button", { name: "Đóng" }).click();
    await candidate.getByRole("button", { name: /^Chặn / }).click();
    await candidate.getByRole("button", { name: "Xác nhận chặn" }).click();
    await candidate
      .getByRole("navigation", { name: "Cuộc trò chuyện" })
      .getByRole("button")
      .first()
      .click();
    await expect(candidate.getByText(/Bạn đã chặn nhắn tin/)).toBeVisible();
    await candidateSecondTab.close();
    await expect(
      candidate.getByLabel(/đang (trực tuyến|ngoại tuyến)/),
    ).toBeVisible();
    await candidate.getByRole("button", { name: /^Bỏ chặn / }).click();
    await candidate.getByRole("button", { name: "Xác nhận bỏ chặn" }).click();
    await expect(candidate.getByLabel("Soạn tin nhắn")).toBeEnabled();
  } finally {
    await Promise.all([candidateContext.close(), recruiterContext.close()]);
  }
});

test("revoking one session disconnects only sockets owned by that session", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const authorityContext = await browser.newContext();
  const revokedContext = await browser.newContext();
  try {
    const authority = await authorityContext.newPage();
    const revoked = await revokedContext.newPage();
    await signIn(
      authority,
      messagingE2eUsers.candidate.email,
      messagingE2eUsers.candidate.password,
    );
    await signIn(
      revoked,
      messagingE2eUsers.candidate.email,
      messagingE2eUsers.candidate.password,
    );
    await Promise.all([authority.goto("/messages"), revoked.goto("/messages")]);

    const [authoritySessionsResponse, revokedSessionsResponse] =
      await Promise.all([
        authority.request.get("/api/identity/sessions"),
        revoked.request.get("/api/identity/sessions"),
      ]);
    expect(authoritySessionsResponse.ok()).toBe(true);
    expect(revokedSessionsResponse.ok()).toBe(true);
    const authoritySessions = (await authoritySessionsResponse.json()) as {
      csrfProof: string;
      sessions: Array<{ reference: string; current: boolean }>;
    };
    const revokedSessions = (await revokedSessionsResponse.json()) as {
      sessions: Array<{ reference: string; current: boolean }>;
    };
    const target = revokedSessions.sessions.find((session) => session.current);
    expect(target).toBeDefined();
    const revoke = await authority.request.delete(
      `/api/identity/sessions/${encodeURIComponent(target!.reference)}`,
      {
        headers: {
          origin: "http://localhost:3001",
          "sec-fetch-site": "same-origin",
          "x-csrf-token": authoritySessions.csrfProof,
        },
      },
    );
    expect(revoke.ok()).toBe(true);
    await expect(
      revoked
        .getByRole("status")
        .filter({ hasText: /Đang kết nối lại|Ngoại tuyến/ }),
    ).toBeVisible({
      timeout: 10_000,
    });
    await expect
      .poll(async () =>
        (await revoked.request.get("/api/messaging/conversations")).status(),
      )
      .toBe(401);
    await expect(
      authority
        .getByRole("status")
        .filter({ hasText: "Đang kết nối trực tuyến" }),
    ).toBeVisible();
  } finally {
    await Promise.all([authorityContext.close(), revokedContext.close()]);
  }
});

test("membership loss removes the recruiter from the affected conversation", async ({
  browser,
}) => {
  const recruiterContext = await browser.newContext();
  let membershipId: string | null = null;
  const database = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await database.connect();
    const recruiter = await recruiterContext.newPage();
    await signIn(
      recruiter,
      messagingE2eUsers.recruiter.email,
      messagingE2eUsers.recruiter.password,
    );
    await recruiter.goto("/messages");
    await recruiter
      .getByRole("button", { name: /^Nhắn tin cho / })
      .first()
      .click();
    const membership = await database.query<{ id: string }>(
      `SELECT membership."id"
         FROM "CompanyMembership" membership
         JOIN "user" account ON account."id" = membership."userId"
         JOIN "MessagingConversation" conversation
           ON conversation."companyId" = membership."companyId"
        WHERE account."email" = $1
          AND membership."status" = 'ACTIVE'
          AND conversation."contextType" = 'APPLICATION'
        LIMIT 1`,
      [messagingE2eUsers.recruiter.email],
    );
    membershipId = membership.rows[0]?.id ?? null;
    expect(membershipId).not.toBeNull();
    await database.query(
      `UPDATE "CompanyMembership" SET "status" = 'SUSPENDED' WHERE "id" = $1`,
      [membershipId],
    );
    await recruiter.reload();
    await expect(
      recruiter.getByText(
        "Tin nhắn sẽ xuất hiện khi bạn ứng tuyển hoặc kết nối với nhà tuyển dụng.",
      ),
    ).toBeVisible({
      timeout: 10_000,
    });
    await expect(recruiter.getByLabel("Soạn tin nhắn")).toHaveCount(0);
  } finally {
    if (membershipId) {
      await database.query(
        `UPDATE "CompanyMembership" SET "status" = 'ACTIVE' WHERE "id" = $1`,
        [membershipId],
      );
    }
    await database.end().catch(() => undefined);
    await recruiterContext.close();
  }
});
