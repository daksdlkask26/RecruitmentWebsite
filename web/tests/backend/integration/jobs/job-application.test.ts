import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCvWorkerStorage } from "@/backend/cv/workers/cv-worker-resources";
import { seedCleanJobApplicationCv } from "../../../helpers/job-application-cv-fixture";

const databaseAvailable = Boolean(process.env.DATABASE_URL);

describe.skipIf(!databaseAvailable)("transactional job application", () => {
  let fixture: Awaited<
    ReturnType<
      typeof import("../../../helpers/job-board-database-fixture").createJobBoardDatabaseFixture
    >
  >;
  let repository: InstanceType<
    typeof import("@/backend/repositories/jobs/prisma-job-application-repository").PrismaJobApplicationRepository
  >;
  let secureCv: Awaited<ReturnType<typeof seedCleanJobApplicationCv>>;

  beforeAll(async () => {
    fixture = await (
      await import("../../../helpers/job-board-database-fixture")
    ).createJobBoardDatabaseFixture("application");
    repository = new (
      await import("@/backend/repositories/jobs/prisma-job-application-repository")
    ).PrismaJobApplicationRepository();
    secureCv = await seedCleanJobApplicationCv({
      candidateUserId: fixture.userIds[0]!,
      now: fixture.now,
      label: "transactional",
    });
  });
  afterAll(async () => {
    if (secureCv) {
      const storage = createCvWorkerStorage();
      await storage.assertReady();
      await storage.delete(secureCv.storageLocator);
    }
    if (fixture)
      await (
        await import("../../../helpers/job-board-database-fixture")
      ).deleteJobBoardDatabaseFixture(fixture);
  });

  it("commits one Applied application, history, audit, and unified notifications", async () => {
    const prisma = (await import("@/backend/database/prisma")).prisma;
    await prisma.companyMembership.create({
      data: {
        companyId: fixture.company.id,
        userId: fixture.userIds[1]!,
        role: "RECRUITER",
        priorApprovedRole: "RECRUITER",
      },
    });
    const input = {
      candidateUserId: fixture.userIds[0]!,
      sessionId: "session-1",
      jobId: fixture.jobs.active.id,
      idempotencyKey: "application-key-00000001",
      submissionBindingDigest: "b".repeat(64),
      command: {
        cvId: secureCv.candidateCvId,
        answers: fixture.jobs.active.questions.map((question) => ({
          questionId: question.id,
          value: question.kind === "BOOLEAN" ? true : "Five years",
        })),
        coverLetter: null,
        consentVersion: "2026-08-01",
        consentAccepted: true as const,
      },
      activeConsentVersion: "2026-08-01",
      occurredAt: fixture.now,
      correlationId: "correlation-application-1",
    };
    const first = await repository.submit(input);
    const second = await repository.submit(input);
    expect(first.created).toBe(true);
    expect(second).toMatchObject({
      created: false,
      application: { applicationId: first.application.applicationId },
    });
    expect(
      await prisma.jobApplication.count({
        where: {
          candidateUserId: fixture.userIds[0],
          jobPostingId: fixture.jobs.active.id,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.recruitmentNotificationWork.count({
        where: { applicationId: first.application.applicationId },
      }),
    ).toBe(1);
    expect(
      await prisma.inAppNotification.count({
        where: {
          recipientUserId: fixture.userIds[0]!,
          kind: "APPLICATION_SUBMITTED",
          contextType: "APPLICATION",
          contextId: first.application.applicationId,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.inAppNotification.count({
        where: {
          kind: "APPLICATION_RECEIVED",
          contextType: "APPLICATION",
          contextId: first.application.applicationId,
        },
      }),
    ).toBeGreaterThan(0);
    expect(
      await prisma.applicationStageEvent.findMany({
        where: { applicationId: first.application.applicationId },
        select: {
          fromStage: true,
          toStage: true,
          actorType: true,
          applicationVersion: true,
        },
      }),
    ).toEqual([
      {
        fromStage: null,
        toStage: "APPLIED",
        actorType: "CANDIDATE",
        applicationVersion: 1,
      },
    ]);
    expect(
      await prisma.auditEvent.count({
        where: {
          action: "job.application.submitted",
          targetId: first.application.applicationId,
        },
      }),
    ).toBe(1);
    await expect(
      prisma.applicationDocument.findUniqueOrThrow({
        where: {
          jobApplicationId_kind: {
            jobApplicationId: first.application.applicationId,
            kind: "CV",
          },
        },
      }),
    ).resolves.toMatchObject({
      sourceArtifactId: secureCv.artifactId,
      scanAssessmentId: secureCv.assessmentId,
      safetyAssessmentId: secureCv.assessmentId,
    });
  });
});
