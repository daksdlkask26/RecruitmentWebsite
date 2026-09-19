import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { config as loadEnvironment } from "dotenv";

loadEnvironment({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const [command, encoded = "bnVsbA"] = process.argv.slice(2);
const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
const { assertTestDatabaseEnvironment } =
  await import("../test-database-guard.ts");
assertTestDatabaseEnvironment();
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
    // Production search keeps the JobSearchProjection table authoritative.
    // The database fixture creates jobs directly, so materialize the same
    // projection rows before the browser reads them; this is fixture setup,
    // not a replacement for any exercised mutation route.
    const { buildJobSearchProfile } =
      await import("../../../src/backend/services/search/job-search-profile.ts");
    const { jobSearchProjectionData } =
      await import("../../../src/backend/services/search/job-search-profile-projection.ts");
    const { jobSearchCatalogIndex } =
      await import("../../../src/backend/services/search/catalogs/job-search-catalog-index.ts");
    for (const job of Object.values(databaseFixture.jobs)) {
      if (job.status !== "ACTIVE") continue;
      const profile = buildJobSearchProfile(
        {
          title: job.title,
          industryCode: job.industryCode ?? job.industryId,
          categoryIds: [job.subIndustryCode, job.subIndustryId],
          skills: job.skills.map((skill) => skill.displayName),
        },
        { index: jobSearchCatalogIndex },
      );
      const projection = jobSearchProjectionData(job.id, profile);
      await prisma.jobSearchProjection.upsert({
        where: { jobPostingId: job.id },
        create: projection,
        update: projection,
      });
    }
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
  } else if (command === "close-authoritative-job") {
    const { closeManagedJobPost } =
      await import("../../../src/backend/jobs/review/job-post-review-service.ts");
    const closed = await closeManagedJobPost({
      jobId: payload.jobId,
      companyId: payload.companyId,
      actorUserId: payload.actorUserId,
    });
    if (closed) {
      result = { closed: true, source: "review-aggregate" };
    } else {
      // The shared job-board fixture intentionally creates lightweight public
      // postings without review aggregates. Keep this state transition
      // task-owned while still exercising the real candidate apply read.
      const updated = await prisma.jobPosting.updateMany({
        where: {
          id: payload.jobId,
          companyId: payload.companyId,
          status: "ACTIVE",
        },
        data: { status: "CLOSED", closedAt: new Date() },
      });
      result = {
        closed: updated.count === 1,
        source: "fixture-public-posting",
      };
    }
  } else if (command === "ban-authoritative-company") {
    const { CompanyModerationService } =
      await import("../../../src/backend/admin/companies/company-moderation-service.ts");
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: payload.companyId },
      select: { moderationVersion: true },
    });
    result = await new CompanyModerationService().ban(
      {
        userId: payload.actorUserId,
        sessionId: "cf405-" + payload.companyId,
        grantId: "cf405-grant-" + payload.companyId,
        proofAt: new Date(),
      },
      payload.companyId,
      {
        expectedVersion: company.moderationVersion,
        idempotencyKey: "cf405-ban-" + payload.companyId + "-" + Date.now(),
        reasonCategory: "POLICY_VIOLATION",
        explanation: "CF405 navigation-race safety fixture.",
      },
    );
  } else if (command === "unban-authoritative-company") {
    const { CompanyModerationService } =
      await import("../../../src/backend/admin/companies/company-moderation-service.ts");
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: payload.companyId },
      select: { moderationVersion: true },
    });
    result = await new CompanyModerationService().unban(
      {
        userId: payload.actorUserId,
        sessionId: "cf405-" + payload.companyId,
        grantId: "cf405-grant-" + payload.companyId,
        proofAt: new Date(),
      },
      payload.companyId,
      {
        expectedVersion: company.moderationVersion,
        idempotencyKey: "cf405-unban-" + payload.companyId + "-" + Date.now(),
        reasonCategory: "INCIDENT_RESOLVED",
        explanation: "CF405 navigation-race restoration fixture.",
      },
    );
  } else if (command === "expire-job-for-race") {
    // Fixture clock mutation only: the lifecycle worker owns archival in
    // production, while this browser race needs a deterministic deadline
    // transition between request interception and the authoritative read.
    const deadline = new Date(Date.now() - 60_000);
    const updated = await prisma.jobPosting.updateMany({
      where: { id: payload.jobId, status: "ACTIVE" },
      data: { applicationDeadline: deadline },
    });
    if (updated.count !== 1) throw new Error("JOB_RACE_FIXTURE_UNAVAILABLE");
    result = { jobId: payload.jobId, state: "EXPIRED", deadline };
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
