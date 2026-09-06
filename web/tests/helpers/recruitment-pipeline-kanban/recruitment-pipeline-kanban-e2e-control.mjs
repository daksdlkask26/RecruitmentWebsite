import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { config as loadEnvironment } from "dotenv";

loadEnvironment({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const [command, encoded = "bnVsbA"] = process.argv.slice(2);
const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
const { assertTestDatabaseEnvironment } = await import(
  "../test-database-guard.ts"
);
assertTestDatabaseEnvironment();
const { prisma } = await import("../../../src/backend/database/prisma.ts");

const catalogue = Object.freeze({
  companyTaxCode: "1751829749",
  activeJobId: "job-000021",
  activeJobTitle: "Sales Intern",
  closedJobId: "job-000408",
  closedJobTitle: "B2B Sales Manager",
});
const password = "Feature 019 recruiter 2026!";
const checksum = (value) =>
  createHash("sha256").update(value, "utf8").digest("hex");

async function deleteCompanyFixture(companyId) {
  const jobs = await prisma.jobPosting.findMany({
    where: { companyId },
    select: { id: true },
  });
  const jobIds = jobs.map((job) => job.id);
  const applications = await prisma.jobApplication.findMany({
    where: { jobPostingId: { in: jobIds } },
    select: { id: true, candidateUserId: true },
  });
  const memberships = await prisma.companyMembership.findMany({
    where: { companyId },
    select: { userId: true },
  });
  const applicationIds = applications.map((application) => application.id);
  const userIds = [
    ...new Set([
      ...applications.map((application) => application.candidateUserId),
      ...memberships.map((membership) => membership.userId),
    ]),
  ];

  await prisma.emailOutbox.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.inAppNotification.deleteMany({
    where: { recipientUserId: { in: userIds } },
  });
  await prisma.recruitmentNotificationWork.deleteMany({
    where: { applicationId: { in: applicationIds } },
  });
  await prisma.jobApplication.deleteMany({ where: { id: { in: applicationIds } } });
  await prisma.jobPostReviewAggregate.deleteMany({ where: { companyId } });
  await prisma.applicationQuestion.deleteMany({
    where: { jobPostingId: { in: jobIds } },
  });
  await prisma.jobPostingSkill.deleteMany({
    where: { jobPostingId: { in: jobIds } },
  });
  await prisma.applicationArtifactPromotion.deleteMany({
    where: { jobPostingId: { in: jobIds } },
  });
  await prisma.jobPosting.deleteMany({ where: { id: { in: jobIds } } });
  await prisma.companyMembership.deleteMany({ where: { companyId } });
  await prisma.candidateCv.deleteMany({
    where: { candidateUserId: { in: userIds } },
  });
  await prisma.candidateIdentity.deleteMany({
    where: { userId: { in: userIds } },
  });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.userAccount.deleteMany({ where: { id: { in: userIds } } });
}

async function deleteStaleFixtures() {
  const stale = await prisma.company.findMany({
    where: { slug: { startsWith: "feature-019-e2e-" } },
    select: { id: true },
  });
  for (const company of stale) await deleteCompanyFixture(company.id);
}

async function createCandidate(suffix, index, name) {
  const userId = `feature-019-candidate-${index}-${suffix}`;
  const cvId = `feature-019-cv-${index}-${suffix}`;
  const email = `${userId}@example.test`;
  await prisma.userAccount.create({
    data: {
      id: userId,
      name,
      email,
      normalizedEmail: email,
      emailVerified: true,
      state: "ACTIVE",
      candidateIdentity: {
        create: {
          profile: {
            create: {
              headline: "Feature 019 candidate",
              location: "Ho Chi Minh City",
              summary: "Disposable browser-test candidate.",
            },
          },
          cvs: {
            create: {
              id: cvId,
              displayName: "Feature 019 CV",
              fileName: "feature-019-candidate.pdf",
              mimeType: "application/pdf",
              byteSize: 16_384,
              storageKey: `fixtures/feature-019/${suffix}/${index}.pdf`,
              checksumSha256: checksum(`${suffix}:${index}`),
              confirmedAt: new Date(),
            },
          },
        },
      },
    },
  });
  return { userId, cvId, name };
}

async function createApplication({ suffix, key, candidate, jobId, jobTitle, stage, submittedAt }) {
  const id = `feature-019-${key}-${suffix}`;
  await prisma.jobApplication.create({
    data: {
      id,
      candidateUserId: candidate.userId,
      jobPostingId: jobId,
      selectedCvId: candidate.cvId,
      profileSnapshot: { v: 1, candidateName: candidate.name },
      cvSnapshot: { v: 1, cvId: candidate.cvId },
      jobSnapshot: { v: 1, jobId, title: jobTitle },
      consentVersion: "feature-019-e2e-v1",
      consentedAt: submittedAt,
      idempotencyKey: `feature-019-submit-${key}-${suffix}`,
      submissionBindingDigest: checksum(`application:${key}:${suffix}`),
      submittedAt,
      stage,
      stageVersion: 1,
      lastStageChangedAt: submittedAt,
    },
  });
  return { id, candidateName: candidate.name };
}

let result;
try {
  if (command === "create") {
    await deleteStaleFixtures();
    const { createJobBoardDatabaseFixture } = await import(
      "../job-board-database-fixture.ts"
    );
    const databaseFixture = await createJobBoardDatabaseFixture("feature-019-e2e");
    const suffix = databaseFixture.suffix;
    const now = new Date();
    const recruiterUserId = `feature-019-recruiter-${suffix}`;
    const recruiterEmail = `${recruiterUserId}@example.test`;
    const recruiterName = "Feature 019 Recruiter";
    const membershipId = `feature-019-membership-${suffix}`;

    await prisma.company.update({
      where: { id: databaseFixture.company.id },
      data: {
        slug: `feature-019-e2e-${suffix}`,
        legalName: "Anchor Digital Test Company Limited",
        displayName: "Anchor Digital",
        normalizedTaxIdentifier: catalogue.companyTaxCode,
        verificationState: "ACTIVE",
        verifiedAt: new Date(now.getTime() - 86_400_000),
        verificationInactiveAt: null,
      },
    });
    await prisma.jobPosting.update({
      where: { id: databaseFixture.jobs.active.id },
      data: { title: catalogue.activeJobTitle, status: "ACTIVE", removedAt: null },
    });
    await prisma.jobPosting.update({
      where: { id: databaseFixture.jobs.closed.id },
      data: {
        title: catalogue.closedJobTitle,
        status: "CLOSED",
        closedAt: now,
        removedAt: null,
      },
    });

    const { hashPassword } = await import("better-auth/crypto");
    await prisma.userAccount.create({
      data: {
        id: recruiterUserId,
        name: recruiterName,
        email: recruiterEmail,
        normalizedEmail: recruiterEmail,
        emailVerified: true,
        state: "ACTIVE",
        accounts: {
          create: {
            id: randomUUID(),
            accountId: recruiterUserId,
            providerId: "credential",
            password: await hashPassword(password),
          },
        },
      },
    });
    await prisma.companyMembership.create({
      data: {
        id: membershipId,
        companyId: databaseFixture.company.id,
        userId: recruiterUserId,
        role: "RECRUITER",
        priorApprovedRole: "RECRUITER",
        status: "ACTIVE",
      },
    });
    await prisma.jobPostReviewAggregate.createMany({
      data: [
        {
          id: `feature-019-active-map-${suffix}`,
          jobId: catalogue.activeJobId,
          companyId: databaseFixture.company.id,
          publicJobPostingId: databaseFixture.jobs.active.id,
        },
        {
          id: `feature-019-closed-map-${suffix}`,
          jobId: catalogue.closedJobId,
          companyId: databaseFixture.company.id,
          publicJobPostingId: databaseFixture.jobs.closed.id,
          closedAt: now,
          closedByUserId: recruiterUserId,
        },
      ],
    });

    const names = [
      "Avery Ordinary",
      "Riley Rejection",
      "Morgan Stale",
      "Casey Unavailable",
      "Jordan Hired",
    ];
    const candidates = [];
    for (const [index, name] of names.entries()) {
      candidates.push(await createCandidate(suffix, index, name));
    }
    const applications = {
      ordinary: await createApplication({
        suffix,
        key: "ordinary",
        candidate: candidates[0],
        jobId: databaseFixture.jobs.active.id,
        jobTitle: catalogue.activeJobTitle,
        stage: "APPLIED",
        submittedAt: new Date(now.getTime() - 1_000),
      }),
      rejection: await createApplication({
        suffix,
        key: "rejection",
        candidate: candidates[1],
        jobId: databaseFixture.jobs.active.id,
        jobTitle: catalogue.activeJobTitle,
        stage: "SHORTLISTED",
        submittedAt: new Date(now.getTime() - 2_000),
      }),
      stale: await createApplication({
        suffix,
        key: "stale",
        candidate: candidates[2],
        jobId: databaseFixture.jobs.active.id,
        jobTitle: catalogue.activeJobTitle,
        stage: "APPLIED",
        submittedAt: new Date(now.getTime() - 3_000),
      }),
      unavailable: await createApplication({
        suffix,
        key: "unavailable",
        candidate: candidates[3],
        jobId: databaseFixture.jobs.active.id,
        jobTitle: catalogue.activeJobTitle,
        stage: "APPLIED",
        submittedAt: new Date(now.getTime() - 4_000),
      }),
      hired: await createApplication({
        suffix,
        key: "hired",
        candidate: candidates[4],
        jobId: databaseFixture.jobs.closed.id,
        jobTitle: catalogue.closedJobTitle,
        stage: "OFFERED",
        submittedAt: new Date(now.getTime() - 5_000),
      }),
    };

    result = {
      companyId: databaseFixture.company.id,
      membershipId,
      recruiter: { userId: recruiterUserId, email: recruiterEmail, name: recruiterName },
      jobs: {
        active: {
          requestedId: catalogue.activeJobId,
          canonicalId: databaseFixture.jobs.active.id,
          title: catalogue.activeJobTitle,
        },
        closed: {
          requestedId: catalogue.closedJobId,
          canonicalId: databaseFixture.jobs.closed.id,
          title: catalogue.closedJobTitle,
        },
      },
      applications,
    };
  } else if (command === "delete") {
    await deleteCompanyFixture(payload.companyId);
    result = { deleted: true };
  } else if (command === "advance-stale") {
    const { ApplicationStageService } = await import(
      "../../../src/backend/services/jobs/application-stage-service.ts"
    );
    result = await new ApplicationStageService().transition(
      { userId: payload.recruiterUserId, sessionId: "feature-019-concurrent-session" },
      payload.applicationId,
      { targetStage: "VIEWED", expectedStageVersion: 1 },
      new Date(),
      {
        requestedJobId: payload.requestedJobId,
        idempotencyKey: `feature-019-concurrent-${payload.applicationId}`,
        source: "KANBAN",
      },
    );
  } else if (command === "revoke-membership") {
    await prisma.companyMembership.update({
      where: { id: payload.membershipId },
      data: { status: "REMOVED", removedAt: new Date(), version: { increment: 1 } },
    });
    result = { revoked: true };
  } else {
    throw new Error(`Unsupported Feature 019 E2E control command: ${command}`);
  }
  process.stdout.write(`\n__FEATURE_019_RESULT__${JSON.stringify(result)}\n`);
} finally {
  await prisma.$disconnect();
}
