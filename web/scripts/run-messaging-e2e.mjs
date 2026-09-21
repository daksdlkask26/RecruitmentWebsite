import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { config as loadEnvironment } from "dotenv";

loadEnvironment({ path: resolve(process.cwd(), ".env.local"), quiet: true });

if (process.env.MESSAGING_E2E_READY === "0") {
  console.info(
    "Messaging E2E skipped because MESSAGING_E2E_READY=0 was explicitly configured.",
  );
  process.exit(0);
}

const { assertTestDatabaseEnvironment } =
  await import("../tests/helpers/test-database-guard.ts");
assertTestDatabaseEnvironment();

const { hashPassword } = await import("better-auth/crypto");
const { prisma } = await import("../src/backend/database/prisma.ts");
const { cleanupMessagingFixture, seedMessagingFixture } =
  await import("../tests/backend/integration/messaging/fixtures.ts");
const staleCandidates = await prisma.userAccount.findMany({
  where: { id: { startsWith: "messaging-", endsWith: "-candidate" } },
  select: { id: true },
});
for (const stale of staleCandidates) {
  await cleanupMessagingFixture(stale.id.slice(0, -"-candidate".length));
}
const playwrightCli = fileURLToPath(
  new URL("../../node_modules/@playwright/test/cli.js", import.meta.url),
);
const requestedTests = process.argv.slice(2);
const retries = process.env.MESSAGING_E2E_RETRIES ?? "1";
const reporter = process.env.MESSAGING_E2E_REPORTER ?? "line";
const timeout = process.env.MESSAGING_E2E_TIMEOUT;
const nextDistDir = ".next-phase6a-revocation";
const targets = requestedTests.length
  ? requestedTests
  : [
      "tests/system/e2e/messaging/first-conversation-usability.spec.ts",
      "tests/system/e2e/messaging/messaging-safety.spec.ts",
      "tests/system/e2e/messaging/two-user-messaging.spec.ts",
    ];

function waitForServer(child) {
  return new Promise((resolveReady, rejectReady) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let readyProbe;
    const timeoutHandle = setTimeout(() => {
      if (settled) return;
      settle(rejectReady, new Error("MESSAGING_E2E_SERVER_TIMEOUT"));
    }, 90_000);
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      if (readyProbe) clearInterval(readyProbe);
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
            `MESSAGING_E2E_SERVER_EXIT_${code ?? "unknown"}: ${stderr
              .trim()
              .slice(-2_000)}`,
          ),
        );
      }
    });
    readyProbe = setInterval(() => {
      void fetch("http://127.0.0.1:3001/")
        .then((response) => {
          if (response.status < 500) settle(resolveReady);
        })
        .catch(() => undefined);
    }, 250);
  });
}

async function stopServer(server) {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  await new Promise((resolveExit) => {
    const timeoutHandle = setTimeout(() => {
      if (server.exitCode === null) server.kill("SIGKILL");
      resolveExit();
    }, 10_000);
    server.once("exit", () => {
      clearTimeout(timeoutHandle);
      resolveExit();
    });
  });
}

let exitStatus = 0;
try {
  for (const target of targets) {
    const password = `Messaging E2E ${crypto.randomUUID()}!`;
    const fixture = await seedMessagingFixture();
    let server = null;
    let result;
    try {
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
      for (const userId of [fixture.candidateId, fixture.recruiterId]) {
        await prisma.accountPreferences.upsert({
          where: { userId },
          create: { userId, language: "VI" },
          update: { language: "VI" },
        });
      }
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
          cwd: resolve(process.cwd()),
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
      const users = await prisma.userAccount.findMany({
        where: { id: { in: [fixture.candidateId, fixture.recruiterId] } },
        select: { id: true, email: true },
      });
      const emailById = new Map(users.map((user) => [user.id, user.email]));
      result = spawnSync(
        process.execPath,
        [
          playwrightCli,
          "test",
          target,
          "--project=desktop-chromium",
          `--retries=${retries}`,
          `--reporter=${reporter}`,
          ...(timeout ? [`--timeout=${timeout}`] : []),
        ],
        {
          cwd: new URL("../", import.meta.url),
          env: {
            ...process.env,
            MESSAGING_E2E_READY: "1",
            PLAYWRIGHT_APP_ONLY: "1",
            PLAYWRIGHT_PRODUCTION: "1",
            PLAYWRIGHT_REUSE_SERVER: "1",
            PLAYWRIGHT_PORT: "3001",
            MESSAGING_E2E_CANDIDATE_EMAIL: emailById.get(fixture.candidateId),
            MESSAGING_E2E_CANDIDATE_PASSWORD: password,
            MESSAGING_E2E_RECRUITER_EMAIL: emailById.get(fixture.recruiterId),
            MESSAGING_E2E_RECRUITER_PASSWORD: password,
          },
          stdio: "inherit",
        },
      );
    } finally {
      await stopServer(server);
      await cleanupMessagingFixture(fixture.prefix);
    }
    if (result.error) throw result.error;
    if (result.status !== 0) {
      exitStatus = result.status ?? 1;
      break;
    }
  }
} finally {
  await prisma.$disconnect();
}
process.exit(exitStatus);
