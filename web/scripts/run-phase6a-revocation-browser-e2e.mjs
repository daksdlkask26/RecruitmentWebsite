import { mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { config as loadEnvironment } from "dotenv";

loadEnvironment({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const { assertTestDatabaseEnvironment } =
  await import("../tests/helpers/test-database-guard.ts");
assertTestDatabaseEnvironment();

const { hashPassword } = await import("better-auth/crypto");
const { prisma } = await import("../src/backend/database/prisma.ts");
const { BetterAuthSessionGateway } =
  await import("../src/backend/auth/better-auth/better-auth-session-gateway.ts");
const { BetterAuthTwoFactorGateway } =
  await import("../src/backend/auth/better-auth/better-auth-two-factor-gateway.ts");
const { freshTotp, secretFromOtpAuthUri, totp } =
  await import("../tests/system/e2e/admin-management/admin-e2e-totp.ts");
const { createCredentialFixture } =
  await import("../tests/helpers/credential-fixture.ts");
const { PrismaMessagingConversationRepository } =
  await import("../src/backend/repositories/messaging/prisma-messaging-conversation-repository.ts");
const { cleanupMessagingFixture, seedMessagingFixture } =
  await import("../tests/backend/integration/messaging/fixtures.ts");

const workspace = resolve(process.cwd());
const playwrightCli = fileURLToPath(
  new URL("../../node_modules/@playwright/test/cli.js", import.meta.url),
);
const outputRoot = resolve(
  process.cwd(),
  "..",
  "docs/audits/candidate-first/phase-6a/evidence",
);
const runtimeProbePath = resolve(
  outputRoot,
  "cf604-account-moderation-runtime.jsonl",
);
const browserReportPath = resolve(
  outputRoot,
  "cf604-account-moderation-browser.json",
);
const nextDistDir = ".next-phase6a-revocation";
const password = `Phase 6A Revocation ${crypto.randomUUID()}!`;
const adminPassword = "Phase 6A Admin 2026!";
let fixture = null;
let admin = null;
let outsiderConversation = null;
let server = null;

function cookieLine(response) {
  return response.headers
    .getSetCookie()
    .find((value) =>
      /^(smarthire\.session|__Host-smarthire\.session)=/u.test(value),
    );
}

function waitForServer(child) {
  return new Promise((resolveReady, rejectReady) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      rejectReady(new Error("PHASE6A_REVOCATION_SERVER_TIMEOUT"));
    }, 90_000);
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.includes("SmartHire ready at")) settle(resolveReady);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => settle(rejectReady, error));
    child.once("exit", (code) => {
      if (code !== 0) {
        settle(
          rejectReady,
          new Error(
            `PHASE6A_REVOCATION_SERVER_EXIT_${code ?? "unknown"}: ${stderr
              .trim()
              .slice(-2_000)}`,
          ),
        );
      }
    });
  });
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  await new Promise((resolveExit) => {
    const timeout = setTimeout(() => {
      if (server && server.exitCode === null) server.kill("SIGKILL");
      resolveExit();
    }, 10_000);
    server?.once("exit", () => {
      clearTimeout(timeout);
      resolveExit();
    });
  });
}

async function seedAdmin() {
  const user = await createCredentialFixture({
    email: `phase6a-admin-${crypto.randomUUID()}@example.test`,
    password: adminPassword,
    name: "Phase 6A Administrator",
  });
  const login = await new BetterAuthSessionGateway().signIn(
    user.email,
    adminPassword,
    new Headers({ "x-forwarded-for": "phase6a-admin" }),
  );
  if (!login.ok) throw new Error("PHASE6A_REVOCATION_ADMIN_LOGIN_FAILED");
  const cookie = cookieLine(login);
  if (!cookie) throw new Error("PHASE6A_REVOCATION_ADMIN_COOKIE_MISSING");
  const headers = new Headers({ cookie: cookie.split(";", 1)[0] });
  const twoFactor = new BetterAuthTwoFactorGateway();
  const enrollment = await twoFactor.startEnrollment(headers, adminPassword);
  const secret = secretFromOtpAuthUri(enrollment.otpauthUri);
  const initialCode = totp(secret);
  const verified = await twoFactor.verifyInitialTotp(headers, initialCode);
  if (!verified.verified)
    throw new Error("PHASE6A_REVOCATION_ADMIN_2FA_FAILED");
  const grant = await prisma.platformAdministratorGrant.create({
    data: { id: `phase6a-grant-${crypto.randomUUID()}`, userId: user.id },
  });
  return {
    userId: user.id,
    email: user.email,
    password: adminPassword,
    totp: secret,
    loginTotp: await freshTotp(secret, initialCode),
    grantId: grant.id,
  };
}

async function cleanupAdmin() {
  if (!admin) return;
  await prisma.platformAdministratorGrant.deleteMany({
    where: { userId: admin.userId },
  });
  await prisma.userAccount.delete({ where: { id: admin.userId } });
}

let exitCode;
try {
  await mkdir(outputRoot, { recursive: true });
  await rm(runtimeProbePath, { force: true });
  await rm(browserReportPath, { force: true });
  fixture = await seedMessagingFixture();
  for (const userId of [
    fixture.candidateId,
    fixture.recruiterId,
    fixture.outsiderId,
  ]) {
    await prisma.authProviderAccount.create({
      data: {
        id: crypto.randomUUID(),
        accountId: userId,
        providerId: "credential",
        userId,
        password: await hashPassword(password),
      },
    });
    await prisma.accountPreferences.upsert({
      where: { userId },
      create: { userId, language: "EN" },
      update: { language: "EN" },
    });
  }
  const outsiderConnectionId = `${fixture.prefix}-outsider-connection`;
  await prisma.professionalConnection.create({
    data: {
      id: outsiderConnectionId,
      participantLowId: [fixture.outsiderId, fixture.recruiterId].sort()[0],
      participantHighId: [fixture.outsiderId, fixture.recruiterId].sort()[1],
      acceptedAt: new Date(),
    },
  });
  const conversationRepository = new PrismaMessagingConversationRepository();
  outsiderConversation = await conversationRepository.open({
    actorUserId: fixture.recruiterId,
    targetUserId: fixture.outsiderId,
    context: {
      type: "PROFESSIONAL_CONNECTION",
      reference: outsiderConnectionId,
      professionalConnectionId: outsiderConnectionId,
      label: "Professional connection",
      companyName: null,
      jobTitle: null,
    },
    now: new Date(),
  });
  admin = await seedAdmin();
  server = spawn(
    process.execPath,
    [
      "--import",
      "./scripts/register-server-runtime.mjs",
      "--import",
      "tsx",
      "scripts/run-phase6a-production-server.mjs",
    ],
    {
      cwd: workspace,
      env: {
        ...process.env,
        EMAIL_ADAPTER: "capture",
        NODE_ENV: "production",
        PORT: "3001",
        HOSTNAME: "::",
        CANDIDATE_ORIGIN: "http://localhost:3001",
        ADMIN_ORIGIN: "http://console.admin.localhost:3001",
        RECRUITER_ORIGIN: "http://console.recruiter.localhost:3001",
        PHASE6A_REVOCATION_EVIDENCE_FILE: runtimeProbePath,
        PHASE5_NEXT_DIST_DIR: nextDistDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await waitForServer(server);
  const result = await new Promise((resolveResult, rejectResult) => {
    const child = spawn(
      process.execPath,
      [
        playwrightCli,
        "test",
        "tests/system/e2e/messaging/phase6a-revocation-runtime.spec.ts",
        "--project=desktop-chromium",
        "--retries=0",
        "--reporter=line",
      ],
      {
        cwd: workspace,
        env: {
          ...process.env,
          MESSAGING_E2E_READY: "1",
          PLAYWRIGHT_APP_ONLY: "1",
          PLAYWRIGHT_PRODUCTION: "1",
          PLAYWRIGHT_REUSE_SERVER: "1",
          PLAYWRIGHT_PORT: "3001",
          PHASE6A_REVOCATION_CANDIDATE_EMAIL: `${fixture.candidateId}@example.test`,
          PHASE6A_REVOCATION_CANDIDATE_PASSWORD: password,
          PHASE6A_REVOCATION_CANDIDATE_ID: fixture.candidateId,
          PHASE6A_REVOCATION_RECRUITER_EMAIL: `${fixture.recruiterId}@example.test`,
          PHASE6A_REVOCATION_RECRUITER_PASSWORD: password,
          PHASE6A_REVOCATION_RECRUITER_ID: fixture.recruiterId,
          PHASE6A_REVOCATION_OUTSIDER_EMAIL: `${fixture.outsiderId}@example.test`,
          PHASE6A_REVOCATION_OUTSIDER_PASSWORD: password,
          PHASE6A_REVOCATION_OUTSIDER_CONVERSATION_ID:
            outsiderConversation.conversationId,
          PHASE6A_REVOCATION_ADMIN_EMAIL: admin.email,
          PHASE6A_REVOCATION_ADMIN_PASSWORD: admin.password,
          PHASE6A_REVOCATION_ADMIN_TOTP: admin.loginTotp,
          PHASE6A_REVOCATION_REPORT_FILE: browserReportPath,
          PHASE6A_REVOCATION_EVIDENCE_FILE: runtimeProbePath,
        },
        stdio: "inherit",
      },
    );
    child.once("error", rejectResult);
    child.once("exit", (code) => resolveResult(code ?? 1));
  });
  exitCode = result;
} finally {
  await stopServer();
  if (fixture) await cleanupMessagingFixture(fixture.prefix);
  await cleanupAdmin();
  await prisma.$disconnect();
}

process.exit(exitCode ?? 1);
