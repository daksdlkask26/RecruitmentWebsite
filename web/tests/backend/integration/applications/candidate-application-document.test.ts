import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/backend/database/prisma";
import { createApplicationDocumentStorage } from "@/backend/applications/storage/factory";
import { OpenApplicationDocumentService } from "@/backend/applications/services/open-application-document";
import { UpdateContactConsentService } from "@/backend/applications/services/update-contact-consent";
import { CandidateApplicationTrackingService } from "@/backend/candidate-applications/candidate-application-tracking-service";
import { PrismaJobApplicationRepository } from "@/backend/repositories/jobs/prisma-job-application-repository";
import { PrismaCandidateApplicationRepository } from "@/backend/repositories/candidate-applications/prisma-candidate-application-repository";
import { createJobBoardDatabaseFixture } from "../../../helpers/job-board-database-fixture";
import { seedCleanJobApplicationCv } from "../../../helpers/job-application-cv-fixture";
import { assertTestDatabaseEnvironment } from "../../../helpers/test-database-guard";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const now = new Date("2026-09-10T12:00:00.000Z");

describe.skipIf(!databaseAvailable)(
  "Candidate-owned submitted application documents",
  () => {
    let fixture: Awaited<ReturnType<typeof createJobBoardDatabaseFixture>>;
    let applicationId: string;
    let candidateUserId: string;
    let otherUserId: string;
    let secureCv: Awaited<ReturnType<typeof seedCleanJobApplicationCv>>;
    let documentId: string;
    let originalDocument: {
      contentDigestHmac: string;
      byteLength: number;
      ordinaryAccessDeniedAt: Date | null;
      deleteAfter: Date | null;
      deletedAt: Date | null;
      scanAssessmentId: string | null;
    };
    let originalArtifact: {
      storageLocator: string;
      status: "AVAILABLE" | "QUARANTINED";
      contentInaccessibleAt: Date | null;
      deletedAt: Date | null;
    };

    const service = () => new OpenApplicationDocumentService();
    const candidateDocument = (kind: "cv" | "cover-letter" = "cv") =>
      service().executeForCandidate({
        candidateUserId,
        applicationId,
        kind,
        preview: false,
        now,
      });

    async function readStream(stream: AsyncIterable<Uint8Array> | null) {
      if (!stream) return Buffer.alloc(0);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    }

    async function restoreCvDocument() {
      await prisma.applicationDocument.update({
        where: { id: documentId },
        data: originalDocument,
      });
      await prisma.cvStoredArtifact.updateMany({
        where: { id: secureCv.artifactId },
        data: originalArtifact,
      });
      await prisma.applicationDocumentLegalHold.deleteMany({
        where: { jobApplicationId: applicationId },
      });
    }

    beforeAll(async () => {
      assertTestDatabaseEnvironment();
      fixture = await createJobBoardDatabaseFixture(
        "cf302-document-access",
        now,
      );
      candidateUserId = fixture.userIds[0]!;
      otherUserId = fixture.userIds[1]!;
      secureCv = await seedCleanJobApplicationCv({
        candidateUserId,
        now,
        label: "cf302-document-access",
      });
      const repository = new PrismaJobApplicationRepository();
      const submitted = await repository.submit({
        candidateUserId,
        sessionId: "cf302-document-session",
        jobId: fixture.jobs.active.id,
        idempotencyKey: "cf302-document-access-key",
        submissionBindingDigest: "d".repeat(64),
        command: {
          cvId: secureCv.candidateCvId,
          contactSnapshot: {
            fullName: "Submitted Candidate",
            email: "submitted-candidate@example.test",
            phone: "0901234567",
            location: "Submitted location",
          },
          shareContactWithRecruiter: false,
          answers: fixture.jobs.active.questions.map((question) => ({
            questionId: question.id,
            value: question.kind === "BOOLEAN" ? true : "Five years",
          })),
          coverLetter: "Submitted text cover letter.",
          consentVersion: "2026-08-01",
          consentAccepted: true as const,
        },
        activeConsentVersion: "2026-08-01",
        occurredAt: now,
        correlationId: "cf302-document-access-correlation",
      });
      applicationId = submitted.application.applicationId;
      const document = await prisma.applicationDocument.findFirstOrThrow({
        where: { jobApplicationId: applicationId, kind: "CV" },
        select: {
          id: true,
          contentDigestHmac: true,
          byteLength: true,
          ordinaryAccessDeniedAt: true,
          deleteAfter: true,
          deletedAt: true,
          scanAssessmentId: true,
        },
      });
      documentId = document.id;
      originalDocument = {
        contentDigestHmac: document.contentDigestHmac,
        byteLength: document.byteLength,
        ordinaryAccessDeniedAt: document.ordinaryAccessDeniedAt,
        deleteAfter: document.deleteAfter,
        deletedAt: document.deletedAt,
        scanAssessmentId: document.scanAssessmentId,
      };
      const artifact = await prisma.cvStoredArtifact.findUniqueOrThrow({
        where: { id: secureCv.artifactId },
        select: {
          storageLocator: true,
          status: true,
          contentInaccessibleAt: true,
          deletedAt: true,
        },
      });
      originalArtifact = {
        storageLocator: artifact.storageLocator,
        status: artifact.status as "AVAILABLE" | "QUARANTINED",
        contentInaccessibleAt: artifact.contentInaccessibleAt,
        deletedAt: artifact.deletedAt,
      };
    });

    beforeEach(async () => {
      await restoreCvDocument();
    });

    afterAll(async () => {
      if (secureCv) {
        const storage = createApplicationDocumentStorage();
        await storage.assertReady();
        await storage.delete(secureCv.storageLocator).catch(() => undefined);
      }
      if (fixture) {
        const { deleteJobBoardDatabaseFixture } =
          await import("../../../helpers/job-board-database-fixture");
        await deleteJobBoardDatabaseFixture(fixture);
      }
    });

    it("opens the exact CLEAN CV and text cover letter for its Candidate only", async () => {
      const opened = await candidateDocument();
      const bytes = await readStream(opened.stream);
      expect(bytes.byteLength).toBe(secureCv.byteSize);
      expect(bytes.subarray(0, 8).toString()).toBe("%PDF-1.7");
      expect(opened.document).toMatchObject({
        applicationId,
        candidateUserId,
        sourceArtifactId: secureCv.artifactId,
        scanAssessmentId: secureCv.assessmentId,
        scanStatus: "CLEAN",
        byteLength: secureCv.byteSize,
      });

      const cover = await candidateDocument("cover-letter");
      expect(cover.stream).toBeNull();
      expect(cover.document).toMatchObject({
        kind: "cover-letter",
        text: "Submitted text cover letter.",
        mediaType: "text/plain",
        storageKey: null,
      });

      const tracker = await new CandidateApplicationTrackingService(
        new PrismaCandidateApplicationRepository(),
      ).get(
        { userId: candidateUserId, sessionId: "cf302-tracker" },
        applicationId,
      );
      expect(tracker.submission).toMatchObject({
        profile: {
          status: "AVAILABLE",
          fullName: "Job Candidate 1",
          headline: "TypeScript Engineer",
        },
        contact: {
          status: "AVAILABLE",
          fullName: "Submitted Candidate",
          email: "submitted-candidate@example.test",
          phone: "0901234567",
          location: "Submitted location",
        },
        consent: {
          status: "AVAILABLE",
          version: "2026-08-01",
          consentedAt: now.toISOString(),
        },
        cv: { availability: "AVAILABLE", file: { version: 1 } },
        coverLetter: { kind: "TEXT", text: "Submitted text cover letter." },
        answers: [
          {
            question: "How many years of relevant experience do you have?",
            answer: "Five years",
          },
          { question: "Can you work in a hybrid arrangement?", answer: true },
        ],
      });
    });

    it("keeps persisted submission snapshots after live profile and CV edits", async () => {
      const before = await prisma.jobApplication.findUniqueOrThrow({
        where: { id: applicationId },
        select: {
          profileSnapshot: true,
          contactSnapshot: true,
          cvSnapshot: true,
          consentVersion: true,
          consentedAt: true,
        },
      });
      const profile = await prisma.candidateProfile.findUniqueOrThrow({
        where: { candidateUserId },
        select: { headline: true, location: true, summary: true, phone: true },
      });
      const account = await prisma.userAccount.findUniqueOrThrow({
        where: { id: candidateUserId },
        select: { name: true, email: true, normalizedEmail: true },
      });
      const cv = await prisma.candidateCv.findUniqueOrThrow({
        where: { id: secureCv.candidateCvId },
        select: { displayName: true, fileName: true, version: true },
      });

      try {
        await prisma.candidateProfile.update({
          where: { candidateUserId },
          data: {
            headline: "Changed live profile",
            location: "Changed live location",
            summary: "Changed live summary",
            phone: "0987654321",
          },
        });
        await prisma.userAccount.update({
          where: { id: candidateUserId },
          data: {
            name: "Changed live candidate",
            email: `changed-${fixture.suffix}@example.test`,
            normalizedEmail: `changed-${fixture.suffix}@example.test`,
          },
        });
        await prisma.candidateCv.update({
          where: { id: secureCv.candidateCvId },
          data: {
            displayName: "Changed live CV",
            fileName: "changed-live-cv.pdf",
            version: cv.version + 1,
          },
        });

        const after = await prisma.jobApplication.findUniqueOrThrow({
          where: { id: applicationId },
          select: {
            profileSnapshot: true,
            contactSnapshot: true,
            cvSnapshot: true,
            consentVersion: true,
            consentedAt: true,
          },
        });
        expect(after).toEqual(before);

        const tracker = await new CandidateApplicationTrackingService(
          new PrismaCandidateApplicationRepository(),
        ).get(
          { userId: candidateUserId, sessionId: "cf302-tracker" },
          applicationId,
        );
        expect(tracker.submission.cv.file).toMatchObject({
          versionId: secureCv.candidateCvId,
          displayName: "Secure fixture CV",
          version: 1,
        });
      } finally {
        await prisma.candidateProfile.update({
          where: { candidateUserId },
          data: profile,
        });
        await prisma.userAccount.update({
          where: { id: candidateUserId },
          data: account,
        });
        await prisma.candidateCv.update({
          where: { id: secureCv.candidateCvId },
          data: cv,
        });
      }
    });

    it("streams an uploaded cover-letter document through the application storage contract", async () => {
      const storage = createApplicationDocumentStorage();
      await storage.assertReady();
      const bytes = Buffer.from("%PDF-1.7\ncover-letter\n", "utf8");
      const stored = await storage.put({
        expectedBytes: bytes.byteLength,
        source: (async function* () {
          yield bytes;
        })(),
      });
      try {
        await prisma.applicationDocument.create({
          data: {
            jobApplicationId: applicationId,
            kind: "COVER_LETTER",
            storageKeyEncrypted: stored.locator,
            originalFilenameEncrypted: "submitted-cover-letter.pdf",
            mediaType: "application/pdf",
            byteLength: bytes.byteLength,
            contentDigestHmac: createHash("sha256").update(bytes).digest("hex"),
            safetyAssessmentId: "cf302-cover-letter-safety",
            committedAt: now,
          },
        });
        const opened = await candidateDocument("cover-letter");
        expect(await readStream(opened.stream)).toEqual(bytes);
        expect(opened.document).toMatchObject({
          kind: "cover-letter",
          fileName: "cover-letter.pdf",
          mediaType: "application/pdf",
          byteLength: bytes.byteLength,
        });
      } finally {
        await prisma.applicationDocument.deleteMany({
          where: {
            jobApplicationId: applicationId,
            kind: "COVER_LETTER",
          },
        });
        await storage.delete(stored.locator).catch(() => undefined);
      }
    });

    it("does not rewrite historical contact evidence when current sharing changes", async () => {
      const before = await prisma.jobApplication.findUniqueOrThrow({
        where: { id: applicationId },
        select: { contactSnapshot: true, contactConsent: true },
      });
      try {
        await expect(
          new UpdateContactConsentService().execute({
            applicationId,
            userId: candidateUserId,
            sessionId: "cf302-contact-consent",
            shared: true,
            expectedVersion: before.contactConsent?.version ?? 1,
            now,
          }),
        ).resolves.toMatchObject({ kind: "UPDATED", shared: true });
        const after = await prisma.jobApplication.findUniqueOrThrow({
          where: { id: applicationId },
          select: { contactSnapshot: true, contactConsent: true },
        });
        expect(after.contactSnapshot).toEqual(before.contactSnapshot);
        expect(after.contactConsent).toMatchObject({
          sharedAt: now,
          withdrawnAt: null,
          version: (before.contactConsent?.version ?? 1) + 1,
        });
      } finally {
        if (before.contactConsent) {
          await prisma.jobApplicationContactConsent.update({
            where: { applicationId },
            data: {
              sharedAt: before.contactConsent.sharedAt,
              withdrawnAt: before.contactConsent.withdrawnAt,
              version: before.contactConsent.version,
            },
          });
        }
      }
    });

    it.each([
      [
        "ordinary access expiry",
        { ordinaryAccessDeniedAt: new Date("2026-09-10T11:59:59.000Z") },
      ],
      [
        "retention expiry",
        { deleteAfter: new Date("2026-09-10T11:59:59.000Z") },
      ],
      ["deleted evidence", { deletedAt: new Date("2026-09-10T11:59:59.000Z") }],
    ])("returns no bytes for %s", async (_label, changes) => {
      await prisma.applicationDocument.update({
        where: { id: documentId },
        data: changes,
      });
      await expect(candidateDocument()).rejects.toMatchObject({
        code: "UNAVAILABLE",
      });
    });

    it("returns no bytes while an active application legal hold is present", async () => {
      await prisma.applicationDocumentLegalHold.create({
        data: {
          jobApplicationId: applicationId,
          purposeCode: "CF302_TEST_HOLD",
          policyVersion: "cf302-test-v1",
          issuedByAdminUserId: otherUserId,
          startsAt: new Date("2026-09-10T11:00:00.000Z"),
          endsAt: null,
          releasedAt: null,
        },
      });
      await expect(candidateDocument()).rejects.toMatchObject({
        code: "UNAVAILABLE",
      });
      const tracker = await new CandidateApplicationTrackingService(
        new PrismaCandidateApplicationRepository(),
      ).get(
        { userId: candidateUserId, sessionId: "cf302-tracker" },
        applicationId,
      );
      expect(tracker.submission.cv.availability).toBe("HELD");
    });

    it("fails closed for stale assessment, inaccessible storage, digest and length mismatch", async () => {
      await prisma.applicationDocument.update({
        where: { id: documentId },
        data: { scanAssessmentId: null },
      });
      await expect(candidateDocument()).rejects.toMatchObject({
        code: "UNAVAILABLE",
      });

      await restoreCvDocument();
      await prisma.applicationDocument.update({
        where: { id: documentId },
        data: { contentDigestHmac: "b".repeat(64) },
      });
      await expect(candidateDocument()).rejects.toMatchObject({
        code: "UNAVAILABLE",
      });

      await restoreCvDocument();
      await prisma.applicationDocument.update({
        where: { id: documentId },
        data: { byteLength: originalDocument.byteLength + 1 },
      });
      await expect(candidateDocument()).rejects.toMatchObject({
        code: "UNAVAILABLE",
      });

      await restoreCvDocument();
      await prisma.cvStoredArtifact.updateMany({
        where: { id: secureCv.artifactId },
        data: {
          storageLocator: `cf302-missing-${secureCv.artifactId}`.slice(0, 128),
        },
      });
      await expect(candidateDocument()).rejects.toMatchObject({
        code: "UNAVAILABLE",
      });
    });

    it("uses one content-free result for unknown and foreign applications", async () => {
      await expect(
        service().executeForCandidate({
          candidateUserId,
          applicationId: "application-does-not-exist",
          kind: "cv",
          preview: false,
          now,
        }),
      ).rejects.toMatchObject({ code: "UNAVAILABLE" });
      await expect(
        service().executeForCandidate({
          candidateUserId: otherUserId,
          applicationId,
          kind: "cv",
          preview: false,
          now,
        }),
      ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    });
  },
);
