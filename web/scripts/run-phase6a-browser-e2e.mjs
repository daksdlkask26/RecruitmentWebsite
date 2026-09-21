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
const { cleanupMessagingFixture, seedMessagingFixture } =
  await import("../tests/backend/integration/messaging/fixtures.ts");

const workspace = resolve(process.cwd());
const playwrightCli = fileURLToPath(
  new URL("../../node_modules/@playwright/test/cli.js", import.meta.url),
);
const password = `Phase 6A E2E ${crypto.randomUUID()}!`;
const nextDistDir = ".next-phase6a-revocation";
let fixture = null;
let server = null;

function waitForServer(child) {
  return new Promise((resolveReady, rejectReady) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      rejectReady(new Error("PHASE6A_BROWSER_SERVER_TIMEOUT"));
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
            `PHASE6A_BROWSER_SERVER_EXIT_${code ?? "unknown"}: ${stderr
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

let exitCode;
try {
  fixture = await seedMessagingFixture();
  for (const userId of [fixture.candidateId, fixture.recruiterId]) {
    await prisma.authProviderAccount.create({
      data: {
        id: crypto.randomUUID(),
        accountId: userId,
        providerId: "credential",
        userId,
        password: await hashPassword(password),
      },
    });
  }
  const language = process.env.PHASE6A_BROWSER_LOCALE === "vi" ? "VI" : "EN";
  for (const userId of [fixture.candidateId, fixture.recruiterId]) {
    await prisma.accountPreferences.upsert({
      where: { userId },
      create: { userId, language },
      update: { language },
    });
  }
  const users = await prisma.userAccount.findMany({
    where: { id: { in: [fixture.candidateId, fixture.recruiterId] } },
    select: { id: true, email: true },
  });
  const emailById = new Map(users.map((user) => [user.id, user.email]));

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
        "tests/system/e2e/messaging/phase6a-runtime.spec.ts",
        "--project=desktop-chromium",
        "--retries=0",
        "--reporter=line",
      ],
      {
        cwd: workspace,
        env: {
          ...process.env,
          MESSAGING_E2E_READY: "1",
          MESSAGING_E2E_CANDIDATE_EMAIL: emailById.get(fixture.candidateId),
          MESSAGING_E2E_CANDIDATE_PASSWORD: password,
          MESSAGING_E2E_RECRUITER_EMAIL: emailById.get(fixture.recruiterId),
          MESSAGING_E2E_RECRUITER_PASSWORD: password,
          PLAYWRIGHT_APP_ONLY: "1",
          PLAYWRIGHT_PRODUCTION: "1",
          PLAYWRIGHT_REUSE_SERVER: "1",
          PLAYWRIGHT_PORT: "3001",
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
  await prisma.$disconnect();
}

process.exit(exitCode ?? 1);
