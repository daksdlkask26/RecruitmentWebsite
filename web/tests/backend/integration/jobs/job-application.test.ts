import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCvWorkerStorage } from "@/backend/cv/workers/cv-worker-resources";
import { seedCleanJobApplicationCv } from "../../../helpers/job-application-cv-fixture";

const databaseAvailable = Boolean(process.env.DATABASE_URL);

async function installFailureTrigger(
  prisma: {
    $executeRawUnsafe: (query: string) => Promise<number>;
  },
  table: string,
  name: string,
) {
  const functionName = '"' + name + '_function"';
  const triggerName = '"' + name + '_trigger"';
  await prisma.$executeRawUnsafe(
    "CREATE OR REPLACE FUNCTION " +
      functionName +
      "() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'CF301_INJECTED_FAILURE'; RETURN NEW; END; $$;",
  );
  await prisma.$executeRawUnsafe(
    "CREATE TRIGGER " +
      triggerName +
      ' BEFORE INSERT ON "' +
      table +
      '" FOR EACH ROW EXECUTE FUNCTION ' +
      functionName +
      "();",
  );
  return async () => {
    await prisma.$executeRawUnsafe(
      "DROP TRIGGER IF EXISTS " + triggerName + ' ON "' + table + '";',
    );
    await prisma.$executeRawUnsafe(
      "DROP FUNCTION IF EXISTS " + functionName + "();",
    );
  };
}

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
  let secondSecureCv: Awaited<ReturnType<typeof seedCleanJobApplicationCv>>;
  let faultJob: { id: string };

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
    secondSecureCv = await seedCleanJobApplicationCv({
      candidateUserId: fixture.userIds[1]!,
      now: fixture.now,
      label: "transactional-second-candidate",
    });
    const sourceJob = fixture.jobs.activeSecond;
    faultJob = await (
      await import("@/backend/database/prisma")
    ).prisma.jobPosting.create({
      data: {
        id: "job-cf301-fault-" + fixture.suffix,
        companyId: sourceJob.companyId,
        industryId: sourceJob.industryId,
        subIndustryId: sourceJob.subIndustryId,
        industryCode: sourceJob.industryCode,
        subIndustryCode: sourceJob.subIndustryCode,
        slug: "cf301-fault-" + fixture.suffix,
        title: "CF-301 Fault Injection Job",
        normalizedTitle: sourceJob.normalizedTitle,
        summary: sourceJob.summary,
        description: sourceJob.description,
        responsibilities: sourceJob.responsibilities,
        requirements: sourceJob.requirements,
        benefits: sourceJob.benefits,
        education: sourceJob.education,
        numberOfHires: sourceJob.numberOfHires,
        age: sourceJob.age,
        location: sourceJob.location,
        normalizedLocation: sourceJob.normalizedLocation,
        employmentType: sourceJob.employmentType,
        experienceLevel: sourceJob.experienceLevel,
        workArrangement: sourceJob.workArrangement,
        salaryMin: sourceJob.salaryMin,
        salaryMax: sourceJob.salaryMax,
        salaryCurrency: sourceJob.salaryCurrency,
        salaryPeriod: sourceJob.salaryPeriod,
        searchDocumentNormalized: sourceJob.searchDocumentNormalized,
        status: "ACTIVE",
        approvedAt: fixture.now,
        publishedAt: fixture.now,
        applicationDeadline: new Date(fixture.now.getTime() + 7 * 86_400_000),
        version: 1,
      },
    });
  });
  afterAll(async () => {
    if (secureCv) {
      const storage = createCvWorkerStorage();
      await storage.assertReady();
      await storage.delete(secureCv.storageLocator);
      await storage.delete(secondSecureCv.storageLocator);
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

  it("rejects a changed command that reuses a committed Candidate key", async () => {
    await expect(
      repository.submit({
        candidateUserId: fixture.userIds[0]!,
        sessionId: "session-1",
        jobId: fixture.jobs.active.id,
        idempotencyKey: "application-key-00000001",
        submissionBindingDigest: "d".repeat(64),
        command: {
          cvId: secureCv.candidateCvId,
          answers: [],
          coverLetter: null,
          consentVersion: "2026-08-01",
          consentAccepted: true,
        },
        activeConsentVersion: "2026-08-01",
        occurredAt: fixture.now,
        correlationId: "correlation-application-rebound",
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

    const prisma = (await import("@/backend/database/prisma")).prisma;
    await expect(
      prisma.jobApplication.count({
        where: {
          candidateUserId: fixture.userIds[0]!,
          jobPostingId: fixture.jobs.active.id,
        },
      }),
    ).resolves.toBe(1);
  });

  it("converges concurrent same-key and different-key submissions without cross-Candidate receipt reuse", async () => {
    const input = (overrides: {
      candidateUserId: string;
      cvId: string;
      jobId: string;
      idempotencyKey: string;
      correlationId: string;
    }) => ({
      candidateUserId: overrides.candidateUserId,
      sessionId: `session-${overrides.candidateUserId}`,
      jobId: overrides.jobId,
      idempotencyKey: overrides.idempotencyKey,
      submissionBindingDigest: "e".repeat(64),
      command: {
        cvId: overrides.cvId,
        answers:
          overrides.jobId === fixture.jobs.active.id
            ? fixture.jobs.active.questions.map((question) => ({
                questionId: question.id,
                value: question.kind === "BOOLEAN" ? true : "Five years",
              }))
            : [],
        coverLetter: null,
        consentVersion: "2026-08-01",
        consentAccepted: true as const,
      },
      activeConsentVersion: "2026-08-01",
      occurredAt: fixture.now,
      correlationId: overrides.correlationId,
    });

    const sameKeyInput = input({
      candidateUserId: fixture.userIds[0]!,
      cvId: secureCv.candidateCvId,
      jobId: fixture.jobs.activeSecond.id,
      idempotencyKey: "application-same-key-0001",
      correlationId: "correlation-application-same-key",
    });
    const [firstSameKey, secondSameKey] = await Promise.all([
      repository.submit(sameKeyInput),
      repository.submit(sameKeyInput),
    ]);
    expect(firstSameKey.application.applicationId).toBe(
      secondSameKey.application.applicationId,
    );

    const foreignKeyInput = input({
      candidateUserId: fixture.userIds[1]!,
      cvId: secondSecureCv.candidateCvId,
      jobId: fixture.jobs.active.id,
      idempotencyKey: "application-key-00000001",
      correlationId: "correlation-application-foreign-key",
    });
    const foreignCandidate = await repository.submit(foreignKeyInput);
    expect(foreignCandidate.created).toBe(true);
    expect(foreignCandidate.application.applicationId).not.toBe(
      firstSameKey.application.applicationId,
    );

    const firstDifferentKey = input({
      candidateUserId: fixture.userIds[1]!,
      cvId: secondSecureCv.candidateCvId,
      jobId: fixture.jobs.activeSecond.id,
      idempotencyKey: "application-different-key-1",
      correlationId: "correlation-application-different-key-1",
    });
    const secondDifferentKey = {
      ...firstDifferentKey,
      idempotencyKey: "application-different-key-2",
      correlationId: "correlation-application-different-key-2",
    };
    const [firstDifferent, secondDifferent] = await Promise.all([
      repository.submit(firstDifferentKey),
      repository.submit(secondDifferentKey),
    ]);
    expect(firstDifferent.application.applicationId).toBe(
      secondDifferent.application.applicationId,
    );
    expect([firstDifferent.created, secondDifferent.created]).toContain(true);

    const prisma = (await import("@/backend/database/prisma")).prisma;
    await expect(
      prisma.jobApplication.count({
        where: {
          candidateUserId: fixture.userIds[1]!,
          jobPostingId: fixture.jobs.activeSecond.id,
        },
      }),
    ).resolves.toBe(1);
  });

  it("rolls back an invalid pre-commit submission without a partial application", async () => {
    const prisma = (await import("@/backend/database/prisma")).prisma;
    await expect(
      repository.submit({
        candidateUserId: fixture.userIds[1]!,
        sessionId: "session-rollback",
        jobId: fixture.jobs.future.id,
        idempotencyKey: "application-rollback-key-0001",
        submissionBindingDigest: "f".repeat(64),
        command: {
          cvId: secondSecureCv.candidateCvId,
          answers: [],
          coverLetter: null,
          consentVersion: "2026-08-01",
          consentAccepted: true,
        },
        activeConsentVersion: "2026-08-01",
        occurredAt: fixture.now,
        correlationId: "correlation-application-rollback",
      }),
    ).rejects.toMatchObject({ code: "JOB_NO_LONGER_ACCEPTING_APPLICATIONS" });
    await expect(
      prisma.jobApplication.count({
        where: {
          candidateUserId: fixture.userIds[1]!,
          jobPostingId: fixture.jobs.future.id,
        },
      }),
    ).resolves.toBe(0);
  });

  for (const boundary of [
    ["application creation", "JobApplication", "cf301_application_create"],
    ["stage-event append", "ApplicationStageEvent", "cf301_stage_event"],
    [
      "notification-work enqueue",
      "RecruitmentNotificationWork",
      "cf301_notification_work",
    ],
    ["audit append", "AuditEvent", "cf301_audit_append"],
  ] as const) {
    it(
      "rolls back all earlier writes when " + boundary[0] + " fails",
      async () => {
        const prisma = (await import("@/backend/database/prisma")).prisma;
        let removeFailureTrigger: (() => Promise<void>) | undefined;
        const correlationId = "correlation-" + boundary[2];
        try {
          removeFailureTrigger = await installFailureTrigger(
            prisma,
            boundary[1],
            boundary[2],
          );
          await expect(
            repository.submit({
              candidateUserId: fixture.userIds[0]!,
              sessionId: "session-fault-injection",
              jobId: faultJob.id,
              idempotencyKey: boundary[2] + "-key",
              submissionBindingDigest: "1".repeat(64),
              command: {
                cvId: secureCv.candidateCvId,
                answers: [],
                coverLetter: null,
                consentVersion: "2026-08-01",
                consentAccepted: true,
              },
              activeConsentVersion: "2026-08-01",
              occurredAt: fixture.now,
              correlationId,
            }),
          ).rejects.toThrow("CF301_INJECTED_FAILURE");

          const applicationWhere = {
            candidateUserId: fixture.userIds[0]!,
            jobPostingId: faultJob.id,
          };
          const [
            applications,
            attemptCounters,
            stageEvents,
            intakes,
            documents,
            publicUpdates,
            notificationPreferences,
            notificationWork,
            inAppNotifications,
            audits,
            cv,
          ] = await Promise.all([
            prisma.jobApplication.count({ where: applicationWhere }),
            prisma.jobApplicationAttemptCounter.count({
              where: applicationWhere,
            }),
            prisma.applicationStageEvent.count({
              where: { application: applicationWhere },
            }),
            prisma.applicationIntake.count({
              where: { application: applicationWhere },
            }),
            prisma.applicationDocument.count({
              where: { application: applicationWhere },
            }),
            prisma.applicationPublicUpdate.count({
              where: { application: applicationWhere },
            }),
            prisma.applicationNotificationPreference.count({
              where: { application: applicationWhere },
            }),
            prisma.recruitmentNotificationWork.count({
              where: { application: applicationWhere },
            }),
            prisma.inAppNotification.count({ where: { correlationId } }),
            prisma.auditEvent.count({ where: { correlationId } }),
            prisma.candidateCv.findUnique({
              where: { id: secureCv.candidateCvId },
              select: { archivedAt: true },
            }),
          ]);
          expect({
            applications,
            attemptCounters,
            stageEvents,
            intakes,
            documents,
            publicUpdates,
            notificationPreferences,
            notificationWork,
            inAppNotifications,
            audits,
            cvArchivedAt: cv?.archivedAt ?? null,
          }).toEqual({
            applications: 0,
            attemptCounters: 0,
            stageEvents: 0,
            intakes: 0,
            documents: 0,
            publicUpdates: 0,
            notificationPreferences: 0,
            notificationWork: 0,
            inAppNotifications: 0,
            audits: 0,
            cvArchivedAt: null,
          });
        } finally {
          await removeFailureTrigger?.();
        }
      },
    );
  }
});
