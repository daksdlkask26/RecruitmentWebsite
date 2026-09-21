import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const candidateOrigin = "http://localhost:3001";
const adminOrigin = "http://console.admin.localhost:3001";
const copy = {
  connected: "Realtime connected",
  offline: "Offline",
  messageButton: /^Message /u,
  message: "Message",
};

async function signIn(page: Page, email: string, password: string) {
  const response = await page.request.post("/api/identity/login", {
    headers: {
      origin: candidateOrigin,
      "sec-fetch-site": "same-origin",
    },
    data: { email, password, returnTo: "/messages" },
  });
  expect(response.ok(), `Login failed with status ${response.status()}.`).toBe(
    true,
  );
}

async function waitForConnected(page: Page) {
  await expect(
    page.getByRole("status").filter({ hasText: copy.connected }),
  ).toBeVisible({ timeout: 20_000 });
}

async function waitForDisconnected(page: Page) {
  await expect
    .poll(
      async () =>
        (await page.getByRole("status").allTextContents()).some(
          (value) =>
            value.includes(copy.offline) || value.includes("Reconnecting"),
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
  return page.getByRole("status").allTextContents();
}

async function waitForPresence(page: Page, value: "online" | "offline") {
  await expect
    .poll(() => page.locator(`[data-presence="${value}"]`).count(), {
      timeout: 10_000,
    })
    .toBeGreaterThan(0);
  return value.toUpperCase();
}

async function protectedMessagingRead(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/messaging/conversations", {
      cache: "no-store",
    });
    return response.status;
  });
}

async function revokeOneSession(page: Page) {
  return page.evaluate(async () => {
    const sessionsResponse = await fetch("/api/identity/sessions", {
      cache: "no-store",
    });
    const payload = (await sessionsResponse.json()) as {
      sessions?: Array<{ reference: string; current: boolean }>;
      csrfProof?: string;
    };
    const target = payload.sessions?.find((session) => !session.current);
    if (!target || !payload.csrfProof) return { status: 0, targetFound: false };
    const response = await fetch(
      `/api/identity/sessions/${encodeURIComponent(target.reference)}`,
      {
        method: "DELETE",
        headers: { "x-csrf-token": payload.csrfProof },
      },
    );
    return { status: response.status, targetFound: true };
  });
}

async function adminSuspend(
  page: Page,
  accountReference: string,
  category: "SECURITY_COMPROMISE" | "POLICY_VIOLATION",
  expectedVersion: number,
) {
  return page.evaluate(
    async ({
      accountReference: target,
      category: reasonCategory,
      expected,
    }) => {
      const sessionsResponse = await fetch("/api/identity/sessions", {
        cache: "no-store",
      });
      const sessions = (await sessionsResponse.json()) as {
        csrfProof?: string;
      };
      if (!sessions.csrfProof) return { status: 0 };
      const response = await fetch(
        `/api/admin/accounts/${encodeURIComponent(target)}/suspend`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": sessions.csrfProof,
            "if-match": `"${expected}"`,
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            category: reasonCategory,
            reason:
              reasonCategory === "POLICY_VIOLATION"
                ? "Confirmed moderation policy violation for realtime access."
                : "Confirmed account security investigation for realtime access.",
          }),
        },
      );
      return { status: response.status };
    },
    { accountReference, category, expected: expectedVersion },
  );
}

async function waitForProbeRows(expected: number) {
  const path = process.env.PHASE6A_REVOCATION_EVIDENCE_FILE;
  if (!path) return [];
  await expect
    .poll(
      async () => {
        try {
          return (await readFile(path, "utf8"))
            .trim()
            .split(/\r?\n/u)
            .filter(Boolean).length;
        } catch {
          return 0;
        }
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThanOrEqual(expected);
  return (await readFile(path, "utf8"))
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("account, session, and moderation revocation close browser access fail-closed", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const candidateEmail = process.env.PHASE6A_REVOCATION_CANDIDATE_EMAIL;
  const candidatePassword = process.env.PHASE6A_REVOCATION_CANDIDATE_PASSWORD;
  const recruiterEmail = process.env.PHASE6A_REVOCATION_RECRUITER_EMAIL;
  const recruiterPassword = process.env.PHASE6A_REVOCATION_RECRUITER_PASSWORD;
  const outsiderEmail = process.env.PHASE6A_REVOCATION_OUTSIDER_EMAIL;
  const outsiderPassword = process.env.PHASE6A_REVOCATION_OUTSIDER_PASSWORD;
  const adminEmail = process.env.PHASE6A_REVOCATION_ADMIN_EMAIL;
  const adminPassword = process.env.PHASE6A_REVOCATION_ADMIN_PASSWORD;
  const adminTotp = process.env.PHASE6A_REVOCATION_ADMIN_TOTP;
  if (
    !candidateEmail ||
    !candidatePassword ||
    !recruiterEmail ||
    !recruiterPassword ||
    !outsiderEmail ||
    !outsiderPassword ||
    !adminEmail ||
    !adminPassword ||
    !adminTotp
  ) {
    throw new Error("PHASE6A_REVOCATION_FIXTURE_ENV_MISSING");
  }
  const rows: Record<string, unknown>[] = [];
  const candidateContext = await browser.newContext();
  const candidateSecondContext = await browser.newContext();
  const recruiterContext = await browser.newContext();
  const outsiderContext = await browser.newContext();
  const adminContext = await browser.newContext();
  try {
    const candidateA = await candidateContext.newPage();
    const candidateB = await candidateSecondContext.newPage();
    const recruiterA = await recruiterContext.newPage();
    const recruiterB = await recruiterContext.newPage();
    const outsider = await outsiderContext.newPage();
    const admin = await adminContext.newPage();

    await Promise.all([
      signIn(candidateA, candidateEmail, candidatePassword),
      signIn(candidateB, candidateEmail, candidatePassword),
      signIn(recruiterA, recruiterEmail, recruiterPassword),
      signIn(recruiterB, recruiterEmail, recruiterPassword),
      signIn(outsider, outsiderEmail, outsiderPassword),
    ]);
    await admin.goto(adminOrigin);
    await admin.getByLabel("Email").fill(adminEmail);
    await admin.getByLabel("Password").fill(adminPassword);
    await admin.getByRole("button", { name: "Continue" }).click();
    await expect(
      admin.getByRole("heading", { name: "Two-factor verification" }),
    ).toBeVisible();
    await admin.getByLabel("Six-digit authenticator code").fill(adminTotp);
    await admin
      .getByRole("button", { name: "Verify and designate this session" })
      .click();
    await expect(
      admin.getByRole("heading", { name: "Platform administration" }),
    ).toBeVisible({ timeout: 20_000 });

    await Promise.all([
      candidateA.goto("/messages"),
      candidateB.goto("/messages"),
      recruiterA.goto("/messages"),
      recruiterB.goto("/messages"),
      outsider.goto("/messages"),
    ]);
    await Promise.all([
      waitForConnected(candidateA),
      waitForConnected(candidateB),
      waitForConnected(recruiterA),
      waitForConnected(recruiterB),
      waitForConnected(outsider),
    ]);

    const openResponse = candidateA.waitForResponse(
      (response) =>
        response.url().endsWith("/api/messaging/conversations") &&
        response.request().method() === "POST",
    );
    await candidateA
      .getByRole("button", { name: copy.messageButton })
      .first()
      .click();
    const opened = await openResponse;
    expect(opened.ok(), `Conversation open failed: ${opened.status()}.`).toBe(
      true,
    );
    const conversationId = ((await opened.json()) as { id: string }).id;
    const candidateConversationUrl = `/messages?conversation=${encodeURIComponent(conversationId)}`;
    await Promise.all([
      candidateA.goto(candidateConversationUrl),
      candidateB.goto(candidateConversationUrl),
      recruiterA.goto(candidateConversationUrl),
    ]);
    await Promise.all([
      waitForConnected(candidateA),
      waitForConnected(candidateB),
      waitForConnected(recruiterA),
      expect(
        candidateA.getByRole("textbox", { name: copy.message }),
      ).toBeVisible(),
      expect(
        candidateB.getByRole("textbox", { name: copy.message }),
      ).toBeVisible(),
      expect(
        recruiterA.getByRole("textbox", { name: copy.message }),
      ).toBeVisible(),
    ]);

    const sessionRevocation = await revokeOneSession(candidateA);
    expect(sessionRevocation).toMatchObject({ status: 200, targetFound: true });
    const sessionTargetSocketState = await waitForDisconnected(candidateB);
    await waitForConnected(candidateA);
    const sessionTargetRead = await protectedMessagingRead(candidateB);
    const sessionControlRead = await protectedMessagingRead(candidateA);
    expect(sessionTargetRead).toBe(401);
    expect(sessionControlRead).toBe(200);
    rows.push({
      case: "session-revocation-control",
      status: "PASS",
      target: "candidate-session-b",
      control: "candidate-session-a",
      socketBefore: { target: "CONNECTED", control: "CONNECTED" },
      socketAfter: {
        target: sessionTargetSocketState,
        control: "CONNECTED",
      },
      rest: { target: sessionTargetRead, control: sessionControlRead },
      presence: { remainingPeer: "UNCHANGED_BY_CONTROL_CASE" },
    });

    const accountCommand = await adminSuspend(
      admin,
      process.env.PHASE6A_REVOCATION_CANDIDATE_ID ?? "fixture-candidate",
      "SECURITY_COMPROMISE",
      1,
    );
    expect(accountCommand.status).toBe(200);
    const accountTargetSocketState = await waitForDisconnected(candidateA);
    await waitForConnected(recruiterA);
    const accountPeerPresence = await waitForPresence(recruiterA, "offline");
    const accountTargetRead = await protectedMessagingRead(candidateA);
    const accountControlRead = await protectedMessagingRead(recruiterA);
    expect(accountTargetRead).toBe(401);
    expect(accountControlRead).toBe(200);
    const staleReconnect = await candidateA.goto("/messages");
    void staleReconnect;
    await expect.poll(() => candidateA.url()).toMatch(/login/iu);
    rows.push({
      case: "account-suspension",
      status: "PASS",
      target: "candidate-account",
      control: "recruiter-account",
      socketBefore: { targetSockets: 1, controlSocket: "CONNECTED" },
      socketAfter: {
        targetSockets: accountTargetSocketState,
        controlSocket: "CONNECTED",
      },
      rest: { target: accountTargetRead, control: accountControlRead },
      presence: { remainingPeer: accountPeerPresence },
      staleReconnect: "rejected_and_redirected_to_login",
    });

    const outsiderConversationResponse = await recruiterB.goto(
      "/messages?conversation=" +
        encodeURIComponent(
          process.env.PHASE6A_REVOCATION_OUTSIDER_CONVERSATION_ID ??
            "fixture-outsider-conversation",
        ),
    );
    void outsiderConversationResponse;
    await outsider.goto(
      "/messages?conversation=" +
        encodeURIComponent(
          process.env.PHASE6A_REVOCATION_OUTSIDER_CONVERSATION_ID ??
            "fixture-outsider-conversation",
        ),
    );
    await Promise.all([
      waitForConnected(recruiterB),
      waitForConnected(outsider),
      expect(
        recruiterB.getByRole("textbox", { name: copy.message }),
      ).toBeVisible(),
      expect(
        outsider.getByRole("textbox", { name: copy.message }),
      ).toBeVisible(),
    ]);
    const moderationCommand = await adminSuspend(
      admin,
      process.env.PHASE6A_REVOCATION_RECRUITER_ID ?? "fixture-recruiter",
      "POLICY_VIOLATION",
      1,
    );
    expect(moderationCommand.status).toBe(200);
    const moderationTargetSocketStates = await Promise.all([
      waitForDisconnected(recruiterA),
      waitForDisconnected(recruiterB),
    ]);
    await waitForConnected(outsider);
    const moderationTargetRead = await protectedMessagingRead(recruiterB);
    const moderationControlRead = await protectedMessagingRead(outsider);
    const moderationPeerPresence = await waitForPresence(outsider, "offline");
    expect(moderationTargetRead).toBe(401);
    expect(moderationControlRead).toBe(200);
    rows.push({
      case: "moderation-account-restriction",
      status: "PASS",
      target: "recruiter-account",
      control: "outsider-account",
      socketBefore: { targetSockets: 2, controlSocket: "CONNECTED" },
      socketAfter: {
        targetSockets: moderationTargetSocketStates,
        controlSocket: "CONNECTED",
      },
      rest: { target: moderationTargetRead, control: moderationControlRead },
      presence: { remainingPeer: moderationPeerPresence },
      authoritativePath: "admin account suspension with POLICY_VIOLATION",
      revocationCause: "MODERATION",
    });
  } catch (error) {
    rows.push({
      case: "scenario",
      status: "FAIL",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    await Promise.all([
      candidateContext.close(),
      candidateSecondContext.close(),
      recruiterContext.close(),
      outsiderContext.close(),
      adminContext.close(),
    ]);
    const reportPath = process.env.PHASE6A_REVOCATION_REPORT_FILE;
    if (reportPath) {
      const probeRows = await waitForProbeRows(
        rows.filter((row) => row.status === "PASS").length,
      ).catch(() => []);
      await mkdir(dirname(reportPath), { recursive: true });
      await writeFile(
        reportPath,
        `${JSON.stringify(
          {
            schema: "candidate-first-phase6a-account-moderation-browser-v1",
            status: rows.every((row) => row.status === "PASS")
              ? "PASS"
              : "FAIL",
            passed: rows.filter((row) => row.status === "PASS").length,
            failed: rows.filter((row) => row.status === "FAIL").length,
            total: 3,
            fixtureIdentities: {
              candidate: "candidate-account",
              candidateSessions: ["candidate-session-a", "candidate-session-b"],
              recruiter: "recruiter-account",
              outsider: "outsider-account",
              adminActor: "redacted-platform-admin",
            },
            rows,
            serverRuntimeProbe: probeRows,
            noPrivateData: true,
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    }
  }
});
