import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { config as loadEnvironment } from "dotenv";

loadEnvironment({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const [command, encoded = "bnVsbA"] = process.argv.slice(2);
const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
const { prisma } = await import("../../../src/backend/database/prisma.ts");
const { createJobBoardDatabaseFixture, deleteJobBoardDatabaseFixture } =
  await import("../job-board-database-fixture.ts");

let result;
try {
  if (command === "create") {
    const fixtureNow = payload?.now ? new Date(payload.now) : undefined;
    const databaseFixture = await createJobBoardDatabaseFixture(
      `home-${payload.label}`,
      fixtureNow,
    );
    const { hashPassword } = await import("better-auth/crypto");
    const passwordHash = await hashPassword("Home candidate 2026!");
    await prisma.company.update({
      where: { id: databaseFixture.company.id },
      data: { verificationState: "ACTIVE" },
    });
    for (const userId of databaseFixture.userIds) {
      await prisma.authProviderAccount.create({
        data: {
          id: randomUUID(),
          accountId: userId,
          providerId: "credential",
          userId,
          password: passwordHash,
        },
      });
    }
    await prisma.companyMembership.create({
      data: {
        id: `home-membership-${databaseFixture.suffix}`,
        companyId: databaseFixture.company.id,
        userId: databaseFixture.userIds[1],
        role: "RECRUITER",
        status: "ACTIVE",
      },
    });
    const accounts = await prisma.userAccount.findMany({
      where: { id: { in: databaseFixture.userIds } },
      select: { id: true, email: true, name: true },
    });
    result = {
      databaseFixture,
      candidate: accounts.find(
        (account) => account.id === databaseFixture.userIds[0],
      ),
      employer: accounts.find(
        (account) => account.id === databaseFixture.userIds[1],
      ),
    };
  } else if (command === "delete") {
    await deleteJobBoardDatabaseFixture(payload.databaseFixture);
    result = { deleted: true };
  } else if (command === "expire-user") {
    result = {
      deleted: (
        await prisma.session.deleteMany({ where: { userId: payload.userId } })
      ).count,
    };
  } else if (command === "deactivate-company") {
    await prisma.company.update({
      where: { id: payload.companyId },
      data: {
        verificationState: "INACTIVE",
        verificationInactiveAt: new Date(),
      },
    });
    result = { updated: true };
  } else if (command === "set-language") {
    if (!payload?.userId || !["EN", "VI"].includes(payload.language)) {
      throw new Error("set-language requires userId and EN/VI language");
    }
    await prisma.accountPreferences.upsert({
      where: { userId: payload.userId },
      create: { userId: payload.userId, language: payload.language },
      update: { language: payload.language },
    });
    result = { updated: true, language: payload.language };
  } else if (command === "public-job-count") {
    const now = new Date();
    result = {
      count: await prisma.jobPosting.count({
        where: {
          status: "ACTIVE",
          approvedAt: { not: null },
          publishedAt: { not: null, lte: now },
          OR: [
            { applicationDeadline: null },
            { applicationDeadline: { gt: now } },
          ],
          company: { verifiedAt: { not: null } },
        },
      }),
    };
  } else {
    throw new Error(`Unsupported Home E2E control command: ${command}`);
  }
  process.stdout.write(JSON.stringify(result));
} finally {
  await prisma.$disconnect();
}
