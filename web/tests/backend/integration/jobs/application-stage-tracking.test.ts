import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DIRECT_APPLICATION_CV_ID } from "@/shared/contracts/jobs/actions";
import { prepareDirectApplicationCv } from "@/backend/services/jobs/prepare-direct-application-cv";
import { createCvWorkerStorage } from "@/backend/cv/workers/cv-worker-resources";
import { createSyntheticPdf } from "../../../helpers/cv-document-buffers";

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

    beforeAll(async () => {
      fixture = await (
        await import("../../../helpers/job-board-database-fixture")
      ).createJobBoardDatabaseFixture("stage-tracking");
      const repository = new (
        await import("@/backend/repositories/jobs/prisma-job-application-repository")
      ).PrismaJobApplicationRepository();
      // Stage tracking needs a real eligible document, not the generic job
      // fixture's metadata-only profile CV. Preserve the storage/ledger path.
      const bytes = createSyntheticPdf("application stage tracking");
      const prepared = await prepareDirectApplicationCv(
        {
          fileName: "stage-tracking.pdf",
          mimeType: "application/pdf",
          byteSize: bytes.length,
          source: (async function* () {
            yield bytes;
          })(),
        },
        { deferStorage: true },
      );
      documentLocator = prepared.storageKey;
      directCvId = prepared.id;
      contentDigest = prepared.checksumSha256;
      const submissionInput = {
        candidateUserId: fixture.userIds[0]!,
        sessionId: "candidate-session",
        jobId: fixture.jobs.active.id,
        idempotencyKey: "stage-tracking-key-0001",
        submissionBindingDigest: "c".repeat(64),
        command: {
          cvId: DIRECT_APPLICATION_CV_ID,
          answers: fixture.jobs.active.questions.map((question) => ({
            questionId: question.id,
            value: question.kind === "BOOLEAN" ? true : "Five years",
          })),
          coverLetter: "A candidate-visible cover letter.",
          consentVersion: "2026-08-01",
          consentAccepted: true as const,
        },
        directCv: prepared,
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

    it("binds a direct upload to the concrete CV and one committed digest ledger on replay", async () => {
      const prisma = (await import("@/backend/database/prisma")).prisma;
      const application = await prisma.jobApplication.findUniqueOrThrow({
        where: { id: applicationId },
        include: { applicationDocuments: true },
      });
      expect(directCvId).not.toBe(DIRECT_APPLICATION_CV_ID);
      expect(application.selectedCvId).toBe(directCvId);
      expect(application.applicationDocuments).toHaveLength(1);
      expect(application.applicationDocuments[0]).toMatchObject({
        sourceCandidateCvId: directCvId,
        storageKeyEncrypted: documentLocator,
        contentDigestHmac: contentDigest,
      });
      expect(
        await prisma.applicationArtifactPromotion.findMany({
          where: {
            candidateUserId: fixture.userIds[0]!,
            storageKeyEncrypted: documentLocator,
          },
        }),
      ).toEqual([
        expect.objectContaining({
          state: "COMMITTED",
          contentDigestSha256: contentDigest,
        }),
      ]);
      expect(
        await prisma.jobApplication.count({
          where: {
            candidateUserId: fixture.userIds[0]!,
            jobPostingId: fixture.jobs.active.id,
          },
        }),
      ).toBe(1);
      const storage = createCvWorkerStorage();
      await storage.assertReady();
      const chunks: Uint8Array[] = [];
      for await (const chunk of storage.open(
        documentLocator!,
        application.applicationDocuments[0]!.byteLength,
      ))
        chunks.push(chunk);
      const { createHash } = await import("node:crypto");
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
