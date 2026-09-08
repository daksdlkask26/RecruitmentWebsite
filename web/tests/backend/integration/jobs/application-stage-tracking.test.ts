import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createCvWorkerStorage } from "@/backend/cv/workers/cv-worker-resources";
import { OpenSafeCvArtifactService } from "@/backend/services/cv-admission/open-safe-cv-artifact-service";
import { seedCleanJobApplicationCv } from "../../../helpers/job-application-cv-fixture";

const databaseAvailable = Boolean(process.env.DATABASE_URL);

describe.skipIf(!databaseAvailable)(
  "canonical application stage tracking",
  () => {
    let fixture: Awaited<
      ReturnType<
        typeof import("../../../helpers/job-board-database-fixture").createJobBoardDatabaseFixture
      >
    >;
    let applicationId: string;
    let documentLocator: string | undefined;
    let directCvId: string;
    let contentDigest: string;
    let secureCv: Awaited<ReturnType<typeof seedCleanJobApplicationCv>>;

    beforeAll(async () => {
      fixture = await (
        await import("../../../helpers/job-board-database-fixture")
      ).createJobBoardDatabaseFixture("stage-tracking");
      const repository = new (
        await import("@/backend/repositories/jobs/prisma-job-application-repository")
      ).PrismaJobApplicationRepository();
      secureCv = await seedCleanJobApplicationCv({
        candidateUserId: fixture.userIds[0]!,
        now: fixture.now,
        label: "stage-tracking",
      });
      documentLocator = secureCv.storageLocator;
      directCvId = secureCv.candidateCvId;
      contentDigest = secureCv.checksumSha256;
      const submissionInput = {
        candidateUserId: fixture.userIds[0]!,
        sessionId: "candidate-session",
        jobId: fixture.jobs.active.id,
        idempotencyKey: "stage-tracking-key-0001",
        submissionBindingDigest: "c".repeat(64),
        command: {
          cvId: directCvId,
          answers: fixture.jobs.active.questions.map((question) => ({
            questionId: question.id,
            value: question.kind === "BOOLEAN" ? true : "Five years",
          })),
          coverLetter: "A candidate-visible cover letter.",
          consentVersion: "2026-08-01",
          consentAccepted: true as const,
        },
        activeConsentVersion: "2026-08-01",
        occurredAt: fixture.now,
        correlationId: "correlation-stage-tracking",
      };
      const submitted = await repository.submit(submissionInput);
      applicationId = submitted.application.applicationId;
      expect(await repository.submit(submissionInput)).toMatchObject({
        created: false,
        application: { applicationId },
      });

      const prisma = (await import("@/backend/database/prisma")).prisma;
      await prisma.companyMembership.create({
        data: {
          companyId: fixture.company.id,
          userId: fixture.userIds[1]!,
          role: "RECRUITER",
          priorApprovedRole: "RECRUITER",
        },
      });
    });

    afterAll(async () => {
      if (documentLocator) {
        const storage = createCvWorkerStorage();
        await storage.assertReady();
        await storage.delete(documentLocator);
      }
      if (fixture) {
        await (
          await import("../../../helpers/job-board-database-fixture")
        ).deleteJobBoardDatabaseFixture(fixture);
      }
    });

    it("binds a scanned upload to the concrete CV and preserves its evidence on replay", async () => {
      const prisma = (await import("@/backend/database/prisma")).prisma;
      const application = await prisma.jobApplication.findUniqueOrThrow({
        where: { id: applicationId },
        include: { applicationDocuments: true },
      });
      expect(application.selectedCvId).toBe(directCvId);
      expect(application.applicationDocuments).toHaveLength(1);
      expect(application.applicationDocuments[0]).toMatchObject({
        sourceCandidateCvId: directCvId,
        storageKeyEncrypted: documentLocator,
        contentDigestHmac: contentDigest,
        sourceArtifactId: secureCv.artifactId,
        scanAssessmentId: secureCv.assessmentId,
        safetyAssessmentId: secureCv.assessmentId,
      });
      expect(
        await prisma.jobApplication.count({
          where: {
            candidateUserId: fixture.userIds[0]!,
            jobPostingId: fixture.jobs.active.id,
          },
        }),
      ).toBe(1);
      const chunks: Uint8Array[] = [];
      const opened = await new OpenSafeCvArtifactService().open({
        candidateUserId: fixture.userIds[0]!,
        uploadId: secureCv.uploadId,
        artifactId: secureCv.artifactId,
        assessmentId: secureCv.assessmentId,
        allowedPurposes: [
          "PROFILE_IMPORT",
          "PROFILE_DIRECT",
          "JOB_APPLICATION_DIRECT",
        ],
      });
      for await (const chunk of opened.openStream())
        chunks.push(chunk);
      await opened.dispose();
      expect(
        createHash("sha256").update(Buffer.concat(chunks)).digest("hex"),
      ).toBe(contentDigest);
    });

    it("returns only candidate-owned applications and candidate-visible history", async () => {
      const repository = new (
        await import("@/backend/repositories/jobs/prisma-application-tracking-repository")
      ).PrismaApplicationTrackingRepository();
      const list = await repository.listCandidateApplications({
        candidateUserId: fixture.userIds[0]!,
        limit: 50,
      });
      const otherCandidate = await repository.listCandidateApplications({
        candidateUserId: fixture.userIds[1]!,
        limit: 50,
      });
      const detail = await repository.getCandidateApplication(
        fixture.userIds[0]!,
        applicationId,
      );

      expect(list.applications).toHaveLength(1);
      expect(list.applications[0]).toMatchObject({
        applicationId,
        stage: "APPLIED",
        stageVersion: 1,
      });
      expect(otherCandidate.applications).toEqual([]);
      expect(detail?.history).toHaveLength(1);
      expect(detail).not.toHaveProperty("recruiterNote");
    });

    it("updates stage, history, audit, and notification atomically", async () => {
      const service = new (
        await import("@/backend/services/jobs/application-stage-service")
      ).ApplicationStageService();
      const result = await service.transition(
        {
          userId: fixture.userIds[1]!,
          sessionId: "recruiter-session",
        },
        applicationId,
        {
          targetStage: "SHORTLISTED",
          expectedVersion: 1,
          candidateVisibleReason: "Your application is moving forward.",
        },
        new Date(fixture.now.getTime() + 60_000),
      );

      expect(result).toMatchObject({
        fromStage: "APPLIED",
        stage: "SHORTLISTED",
        stageVersion: 2,
      });
      const prisma = (await import("@/backend/database/prisma")).prisma;
      expect(
        await prisma.applicationStageEvent.count({
          where: { applicationId },
        }),
      ).toBe(2);
      expect(
        await prisma.recruitmentNotificationWork.count({
          where: {
            applicationId,
            kind: "APPLICATION_STAGE_CHANGED",
          },
        }),
      ).toBe(0);
      expect(
        await prisma.inAppNotification.count({
          where: {
            recipientUserId: fixture.userIds[0]!,
            kind: "APPLICATION_STAGE_CHANGED",
            contextType: "APPLICATION",
            contextId: applicationId,
          },
        }),
      ).toBe(1);
      expect(
        await prisma.emailOutbox.count({
          where: {
            userId: fixture.userIds[0]!,
            kind: "APPLICATION_STAGE_CHANGED",
            templateVersion: "application-stage-changed.v1",
          },
        }),
      ).toBe(1);
      expect(
        await prisma.auditEvent.count({
          where: {
            targetId: applicationId,
            action: "job.application.stage_changed",
          },
        }),
      ).toBe(1);
    });

    it("rejects a stale version without appending another event", async () => {
      const service = new (
        await import("@/backend/services/jobs/application-stage-service")
      ).ApplicationStageService();
      await expect(
        service.transition(
          {
            userId: fixture.userIds[1]!,
            sessionId: "recruiter-session",
          },
          applicationId,
          { targetStage: "INTERVIEWING", expectedVersion: 1 },
        ),
      ).rejects.toMatchObject({ status: 409 });
      const prisma = (await import("@/backend/database/prisma")).prisma;
      expect(
        await prisma.applicationStageEvent.count({ where: { applicationId } }),
      ).toBe(2);
    });
  },
);
