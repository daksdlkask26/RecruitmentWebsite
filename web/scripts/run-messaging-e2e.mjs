import { spawnSync } from "node:child_process";
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

const { assertTestDatabaseEnvironment } = await import(
  "../tests/helpers/test-database-guard.ts"
);
assertTestDatabaseEnvironment();

const { hashPassword } = await import("better-auth/crypto");
const { prisma } = await import("../src/backend/database/prisma.ts");
const { cleanupMessagingFixture, seedMessagingFixture } = await import(
  "../tests/backend/integration/messaging/fixtures.ts"
);
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
const targets = requestedTests.length
  ? requestedTests
  : [
      "tests/system/e2e/messaging/first-conversation-usability.spec.ts",
      "tests/system/e2e/messaging/messaging-safety.spec.ts",
      "tests/system/e2e/messaging/two-user-messaging.spec.ts",
    ];
let exitStatus = 0;
try {
  for (const target of targets) {
    const password = `Messaging E2E ${crypto.randomUUID()}!`;
    const fixture = await seedMessagingFixture();
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
          "--retries=1",
        ],
        {
          cwd: new URL("../", import.meta.url),
          env: {
            ...process.env,
            MESSAGING_E2E_READY: "1",
            PLAYWRIGHT_APP_ONLY: "1",
            PLAYWRIGHT_PRODUCTION: "1",
            MESSAGING_E2E_CANDIDATE_EMAIL: emailById.get(fixture.candidateId),
            MESSAGING_E2E_CANDIDATE_PASSWORD: password,
            MESSAGING_E2E_RECRUITER_EMAIL: emailById.get(fixture.recruiterId),
            MESSAGING_E2E_RECRUITER_PASSWORD: password,
          },
          stdio: "inherit",
        },
      );
    } finally {
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
