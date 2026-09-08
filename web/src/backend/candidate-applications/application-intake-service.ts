import "server-only";

import { randomUUID } from "node:crypto";
import { prisma } from "@/backend/database/prisma";
import { createApplicationDocumentStorage } from "@/backend/applications/storage/factory";
import { OpenSafeCvArtifactService } from "@/backend/services/cv-admission/open-safe-cv-artifact-service";
import { CandidateApplicationError } from "./candidate-application-errors";

const LEASE_MS = 60_000;

type ClaimedIntake = {
  intakeId: string;
  applicationId: string;
  workerId: string;
  version: number;
};

export class ApplicationIntakeService {
  async claim(
    workerId = randomUUID(),
    now = new Date(),
  ): Promise<ClaimedIntake | null> {
    const candidate = await prisma.applicationIntake.findFirst({
      where: {
        state: { in: ["RECEIVED", "CHECKING_FILES"] },
        application: { activeProcessingStoppedAt: null },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        applicationId: true,
        version: true,
        progressPercent: true,
      },
    });
    if (!candidate) return null;

    const claimed = await prisma.applicationIntake.updateMany({
      where: {
        id: candidate.id,
        version: candidate.version,
        state: { in: ["RECEIVED", "CHECKING_FILES"] },
        application: { activeProcessingStoppedAt: null },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
      },
      data: {
        state: "CHECKING_FILES",
        progressPercent: Math.max(candidate.progressPercent, 10),
        checkingStartedAt: now,
        leaseOwner: workerId,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        attemptCount: { increment: 1 },
        version: { increment: 1 },
      },
    });
    if (claimed.count !== 1) return null;
    return {
      intakeId: candidate.id,
      applicationId: candidate.applicationId,
      workerId,
      version: candidate.version + 1,
    };
  }

  async advance(
    work: ClaimedIntake,
    progressPercent: number,
    now = new Date(),
  ) {
    const progress = Math.min(Math.max(Math.trunc(progressPercent), 0), 99);
    await prisma.applicationIntake.updateMany({
      where: {
        id: work.intakeId,
        applicationId: work.applicationId,
        state: "CHECKING_FILES",
        leaseOwner: work.workerId,
        leaseExpiresAt: { gt: now },
        version: work.version,
        application: { activeProcessingStoppedAt: null },
        progressPercent: { lt: progress },
      },
      data: {
        progressPercent: progress,
        version: { increment: 1 },
        updatedAt: now,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      },
    });
    // The worker owns the lease while progress is advanced. Read the current
    // version so a late completion cannot overwrite a newer worker's state.
    const current = await prisma.applicationIntake.findUnique({
      where: { id: work.intakeId },
      select: {
        version: true,
        state: true,
        leaseOwner: true,
        application: { select: { activeProcessingStoppedAt: true } },
      },
    });
    if (
      !current ||
      current.state !== "CHECKING_FILES" ||
      current.leaseOwner !== work.workerId ||
      current.application.activeProcessingStoppedAt
    ) {
      throw new CandidateApplicationError(
        409,
        "APPLICATION_INTAKE_LEASE_LOST",
        "The intake check was claimed by another worker.",
      );
    }
    work.version = current.version;
  }

  async complete(work: ClaimedIntake, now = new Date()) {
    const result = await prisma.applicationIntake.updateMany({
      where: {
        id: work.intakeId,
        applicationId: work.applicationId,
        state: "CHECKING_FILES",
        leaseOwner: work.workerId,
        leaseExpiresAt: { gt: now },
        version: work.version,
        application: { activeProcessingStoppedAt: null },
      },
      data: {
        state: "SENT_TO_RECRUITER",
        progressPercent: 100,
        sentAt: now,
        failureCode: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        version: { increment: 1 },
        updatedAt: now,
      },
    });
    if (result.count === 1) return "SENT_TO_RECRUITER" as const;
    const current = await prisma.applicationIntake.findUnique({
      where: { id: work.intakeId },
      select: { state: true },
    });
    return current?.state ?? "ATTENTION_REQUIRED";
  }

  async markAttention(
    work: ClaimedIntake,
    failureCode: string,
    now = new Date(),
  ) {
    await prisma.applicationIntake.updateMany({
      where: {
        id: work.intakeId,
        applicationId: work.applicationId,
        state: "CHECKING_FILES",
        leaseOwner: work.workerId,
        leaseExpiresAt: { gt: now },
        version: work.version,
        application: { activeProcessingStoppedAt: null },
      },
      data: {
        state: "ATTENTION_REQUIRED",
        failureCode: failureCode.slice(0, 80),
        leaseOwner: null,
        leaseExpiresAt: null,
        version: { increment: 1 },
        updatedAt: now,
      },
    });
  }

  async retry(actorUserId: string, applicationId: string, now = new Date()) {
    const result = await prisma.applicationIntake.updateMany({
      where: {
        applicationId,
        state: "ATTENTION_REQUIRED",
        application: {
          candidateUserId: actorUserId,
          activeProcessingStoppedAt: null,
        },
      },
      data: {
        state: "CHECKING_FILES",
        checkingStartedAt: now,
        failureCode: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        version: { increment: 1 },
        updatedAt: now,
      },
    });
    if (result.count !== 1) {
      throw new CandidateApplicationError(
        409,
        "APPLICATION_INTAKE_RETRY_UNAVAILABLE",
        "This intake check cannot be retried right now.",
      );
    }
  }

  async processOne(workerId = randomUUID(), now = new Date()) {
    const work = await this.claim(workerId, now);
    if (!work) return null;
    try {
      const documents = await prisma.applicationDocument.findMany({
        where: {
          jobApplicationId: work.applicationId,
          committedAt: { not: null },
          deletedAt: null,
        },
        select: {
          kind: true,
          storageKeyEncrypted: true,
          byteLength: true,
          mediaType: true,
          contentDigestHmac: true,
          sourceArtifactId: true,
          scanAssessmentId: true,
          sourceArtifact: { select: { uploadId: true } },
          application: { select: { candidateUserId: true } },
        },
      });
      if (documents.length === 0) throw new Error("NO_APPLICATION_FILES");
      const storage = createApplicationDocumentStorage();
      if (documents.some((document) => document.kind !== "CV")) {
        await storage.assertReady();
      }
      await this.advance(work, 35, now);
      for (const document of documents) {
        let bytes = 0;
        if (document.kind === "CV") {
          if (
            !document.sourceArtifactId ||
            !document.scanAssessmentId ||
            !document.sourceArtifact?.uploadId
          ) {
            throw new Error("CV_SAFETY_EVIDENCE_MISSING");
          }
          const opened = await new OpenSafeCvArtifactService().open({
            candidateUserId: document.application.candidateUserId,
            uploadId: document.sourceArtifact.uploadId,
            artifactId: document.sourceArtifactId,
            assessmentId: document.scanAssessmentId,
            allowedPurposes: [
              "PROFILE_IMPORT",
              "PROFILE_DIRECT",
              "JOB_APPLICATION_DIRECT",
            ],
          });
          try {
            if (
              opened.byteLength !== document.byteLength ||
              opened.evidence.checksumSha256.toLowerCase() !==
                document.contentDigestHmac.toLowerCase()
            ) {
              throw new Error("CV_SAFETY_EVIDENCE_MISMATCH");
            }
            for await (const chunk of opened.openStream()) {
              bytes += chunk.byteLength;
              if (bytes > document.byteLength)
                throw new Error("FILE_LENGTH_MISMATCH");
            }
          } finally {
            await opened.dispose();
          }
        } else {
          for await (const chunk of storage.open(
            document.storageKeyEncrypted,
            document.byteLength,
          )) {
            bytes += chunk.byteLength;
            if (bytes > document.byteLength)
              throw new Error("FILE_LENGTH_MISMATCH");
          }
        }
        if (bytes !== document.byteLength)
          throw new Error("FILE_LENGTH_MISMATCH");
        if (!document.mediaType) throw new Error("FILE_TYPE_MISSING");
        await this.advance(
          work,
          Math.min(85, 35 + Math.ceil((bytes / document.byteLength) * 40)),
          now,
        );
      }
      await this.advance(work, 95, now);
      return await this.complete(work, new Date());
    } catch (error) {
      await this.markAttention(
        work,
        error instanceof CandidateApplicationError
          ? error.code
          : "APPLICATION_FILE_CHECK_FAILED",
        new Date(),
      );
      return "ATTENTION_REQUIRED" as const;
    }
  }
}
