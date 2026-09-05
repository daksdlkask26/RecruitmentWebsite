import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/backend/database/prisma";

const execute = promisify(execFile);
const suffix = randomUUID();
const userId = `operator-command-${suffix}`;
const email = `${userId}@example.test`;
const companyId = `operator-company-${suffix}`;
const aggregateId = `operator-review-aggregate-${suffix}`;
const reviewId = `operator-review-version-${suffix}`;
const jobId = `operator-review-job-${suffix}`;
let grantId: string | undefined;

async function runOperatorScript(script: string) {
  const { stdout } = await execute(
    process.execPath,
    ["--conditions=react-server", "--import", "tsx", script, email],
    { cwd: process.cwd(), env: process.env },
  );
  return JSON.parse(stdout.trim()) as {
    grantId: string;
    userId: string;
    state: "ACTIVE" | "REVOKED";
    releasedPendingReviewAssignments?: number;
    assignedPendingReviews?: number;
    reassignedPendingReviews?: number;
  };
}

afterAll(async () => {
  await prisma.jobPostReviewAggregate.updateMany({
    where: { id: aggregateId },
    data: { pendingVersionId: null, approvedVersionId: null },
  });
  await prisma.jobPostReviewHistory.deleteMany({
    where: { reviewVersion: { reviewAggregateId: aggregateId } },
  });
  await prisma.jobPostReviewPrivateNote.deleteMany({
    where: { reviewVersion: { reviewAggregateId: aggregateId } },
  });
  await prisma.jobPostReviewVersion.deleteMany({
    where: { reviewAggregateId: aggregateId },
  });
  await prisma.jobPostReviewAggregate.deleteMany({
    where: { id: aggregateId },
  });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.platformAdministratorGrant.deleteMany({ where: { userId } });
  await prisma.authenticationChallenge.deleteMany({ where: { userId } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.userAccount.deleteMany({ where: { id: userId } });
});

describe("administrator grant operator commands", () => {
  it("provisions, revokes, and safely reactivates a retained grant", async () => {
    await prisma.userAccount.create({
      data: {
        id: userId,
        name: "Operator Command Fixture",
        email,
        normalizedEmail: email,
        state: "ACTIVE",
        emailVerified: true,
        twoFactorEnabled: true,
      },
    });

    const provisioned = await runOperatorScript(
      "scripts/provision-platform-administrator.mjs",
    );
    grantId = provisioned.grantId;
    expect(provisioned).toMatchObject({
      userId,
      state: "ACTIVE",
      assignedPendingReviews: 0,
    });

    const sessionId = `operator-session-${suffix}`;
    await prisma.session.create({
      data: {
        id: sessionId,
        token: `operator-session-token-${suffix}`,
        userId,
        expiresAt: new Date(Date.now() + 86_400_000),
        absoluteExpiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await prisma.administratorSessionPolicy.create({
      data: {
        grantId,
        designatedSessionId: sessionId,
        initialTwoFactorAt: new Date(),
        latestTwoFactorProofAt: new Date(),
        designationVersion: 1,
      },
    });

    await prisma.company.create({
      data: {
        id: companyId,
        slug: `operator-company-${suffix}`,
        legalName: "Operator Review Fixture Company",
        displayName: "Operator Review Fixture Company",
      },
    });
    await prisma.jobPostReviewAggregate.create({
      data: {
        id: aggregateId,
        jobId,
        companyId,
        latestSequence: 1,
      },
    });
    await prisma.jobPostReviewVersion.create({
      data: {
        id: reviewId,
        reviewAggregateId: aggregateId,
        sequence: 1,
        snapshot: { id: jobId, title: "Pending operator review fixture" },
        snapshotSchemaVersion: "test-v1",
        snapshotSha256: "a".repeat(64),
        importedBaseline: true,
        assignedAdminUserId: userId,
        assignedAt: new Date(),
      },
    });
    await prisma.jobPostReviewAggregate.update({
      where: { id: aggregateId },
      data: { pendingVersionId: reviewId },
    });

    const revoked = await runOperatorScript(
      "scripts/revoke-platform-administrator.mjs",
    );
    expect(revoked).toMatchObject({
      grantId,
      userId,
      state: "REVOKED",
      releasedPendingReviewAssignments: 1,
      reassignedPendingReviews: 0,
    });
    expect(
      await prisma.userAccount.findUniqueOrThrow({ where: { id: userId } }),
    ).toMatchObject({ state: "ACTIVE" });
    expect(
      await prisma.session.findUniqueOrThrow({ where: { id: sessionId } }),
    ).toMatchObject({
      revocationReason: "administrator_grant_revoked",
    });
    expect(
      await prisma.administratorSessionPolicy.findUniqueOrThrow({
        where: { grantId },
      }),
    ).toMatchObject({
      designatedSessionId: null,
      initialTwoFactorAt: null,
      latestTwoFactorProofAt: null,
    });
    expect(
      await prisma.jobPostReviewVersion.findUniqueOrThrow({
        where: { id: reviewId },
      }),
    ).toMatchObject({
      state: "PENDING_REVIEW",
      assignedAdminUserId: null,
      assignedAt: null,
    });
    expect(
      await prisma.jobPostReviewAggregate.findUniqueOrThrow({
        where: { id: aggregateId },
      }),
    ).toMatchObject({ pendingVersionId: reviewId });

    const reactivated = await runOperatorScript(
      "scripts/provision-platform-administrator.mjs",
    );
    expect(reactivated).toMatchObject({
      grantId,
      userId,
      state: "ACTIVE",
      assignedPendingReviews: 1,
    });
    expect(
      await prisma.administratorSessionPolicy.findUniqueOrThrow({
        where: { grantId },
      }),
    ).toMatchObject({ designatedSessionId: null });
    expect(
      await prisma.jobPostReviewVersion.findUniqueOrThrow({
        where: { id: reviewId },
      }),
    ).toMatchObject({
      state: "PENDING_REVIEW",
      assignedAdminUserId: userId,
    });
    expect(
      await prisma.auditEvent.count({
        where: {
          targetType: "platform_administrator_grant",
          targetId: grantId,
          action: {
            in: ["admin.grant_provisioned", "admin.grant_revoked"],
          },
        },
      }),
    ).toBe(3);
  });
});
