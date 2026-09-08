import "server-only";

import { randomUUID } from "node:crypto";

import { cvConfiguration } from "@/backend/cv/config";
import type {
  IntegrityVerifiedArtifact,
  IntegrityVerifiedReader,
} from "@/backend/cv/encryption/integrity-verified-reader";
import { ClamAvScanner } from "@/backend/cv/scanning/clamav";
import type { PrivateCvStorage } from "@/backend/cv/storage/private-cv-storage";
import { prisma } from "@/backend/database/prisma";
import {
  assertCvStageResultCommitAllowed,
  PrismaCvWorkRepository,
  type CvStageResultCommitGuard,
  type CvWorkClaim,
} from "@/backend/repositories/cv-import/prisma-cv-work-repository";
import {
  cvStageCurrentTime,
  type CvStageOutcome,
  type CvStageProcessContext,
} from "./pipeline";
import {
  CV_SECURITY_POLICY_VERSION,
  CV_SOURCE_MAX_BYTES,
} from "@/shared/contracts/cv-import/common";
import {
  createCvWorkerCryptor,
  createCvWorkerIntegrityReader,
  createCvWorkerStorage,
  cvWorkerDatabaseTimestamp,
  readCvWorkerArtifactBytes,
} from "./cv-worker-resources";

const REJECTED_CONTENT_RETENTION_MS = 24 * 60 * 60_000;
const AUTOMATIC_SCAN_CYCLE_LIMIT_MS = 5 * 60_000;
const AUTOMATIC_SCAN_COMPLETION_BUDGET_MS = 30_000;

type Dependencies = Readonly<{
  storage: PrivateCvStorage;
  reader: IntegrityVerifiedReader;
  scanner: ClamAvScanner;
}>;

function defaults(): Dependencies {
  const storage = createCvWorkerStorage();
  const cryptor = createCvWorkerCryptor();
  return {
    storage,
    reader: createCvWorkerIntegrityReader(storage, cryptor),
    scanner: new ClamAvScanner({
      socketPath: cvConfiguration.scanner.socketPath,
      timeoutMs: 20_000,
      maximumBytes: 6 * 1024 * 1024,
      signatureMaximumAgeMs:
        cvConfiguration.scanner.signatureMaximumAgeHours * 60 * 60 * 1000,
    }),
  };
}

function expectedMagic(kind: "PDF" | "DOC" | "DOCX", leading: Buffer) {
  if (kind === "PDF") return leading.toString("latin1").startsWith("%PDF-");
  if (kind === "DOC") {
    return (
      leading[0] === 0xd0 &&
      leading[1] === 0xcf &&
      leading[2] === 0x11 &&
      leading[3] === 0xe0 &&
      leading[4] === 0xa1 &&
      leading[5] === 0xb1 &&
      leading[6] === 0x1a &&
      leading[7] === 0xe1
    );
  }
  return (
    leading[0] === 0x50 &&
    leading[1] === 0x4b &&
    leading[2] === 0x03 &&
    leading[3] === 0x04
  );
}

async function firstBytes(source: AsyncIterable<Uint8Array>, maximum = 8) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of source) {
    const remaining = maximum - bytes;
    if (remaining <= 0) break;
    const value = Buffer.from(chunk).subarray(0, remaining);
    chunks.push(value);
    bytes += value.byteLength;
    if (bytes >= maximum) break;
  }
  return Buffer.concat(chunks);
}

function errorCode(error: unknown): string {
  if (error instanceof Error && "code" in error) return String(error.code);
  return error instanceof Error ? error.message : "";
}

function isIntegrityFailure(error: unknown): boolean {
  return errorCode(error) === "ARTIFACT_INTEGRITY_FAILED";
}

async function persistRejectedContent(input: {
  uploadId: string;
  accountId: string;
  assessmentId?: string;
  failureCode: string;
  now: Date;
  commitGuard: CvStageResultCommitGuard;
}) {
  const contentInaccessibleAt = cvWorkerDatabaseTimestamp(input.now);
  const deleteAfter = cvWorkerDatabaseTimestamp(
    new Date(input.now.getTime() + REJECTED_CONTENT_RETENTION_MS),
  );
  await prisma.$transaction(async (transaction) => {
    await assertCvStageResultCommitAllowed(transaction, input.commitGuard);
    if (input.assessmentId) {
      await transaction.cvScanAssessment.update({
        where: { id: input.assessmentId },
        data: {
          status: "INDETERMINATE",
          failureCode: input.failureCode,
          leaseOwner: null,
          leaseExpiresAt: null,
          completedAt: cvWorkerDatabaseTimestamp(input.now),
        },
      });
    }
    await transaction.cvStoredArtifact.updateMany({
      where: {
        uploadId: input.uploadId,
        accountId: input.accountId,
        deletedAt: null,
        status: {
          in: ["QUARANTINED", "AVAILABLE", "DELETE_PENDING", "DELETE_FAILED"],
        },
      },
      data: {
        status: "DELETE_PENDING",
        contentInaccessibleAt,
        deleteAfter,
        deleteFailureCode: input.failureCode,
      },
    });
    await transaction.cvUpload.updateMany({
      where: { id: input.uploadId, accountId: input.accountId },
      data: {
        status: "VALIDATION_FAILED",
        failureCode: input.failureCode,
        contentInaccessibleAt,
        deleteAfter,
      },
    });
  });
}

async function persistIndeterminateScanFailure(input: {
  uploadId: string;
  accountId: string;
  assessmentId?: string;
  failureCode: "SCANNER_UNAVAILABLE" | "SCANNER_DEFINITIONS_STALE";
  now: Date;
  commitGuard: CvStageResultCommitGuard;
}) {
  await prisma.$transaction(async (transaction) => {
    await assertCvStageResultCommitAllowed(transaction, input.commitGuard);
    if (input.assessmentId) {
      await transaction.cvScanAssessment.update({
        where: { id: input.assessmentId },
        data: {
          status: "INDETERMINATE",
          failureCode: input.failureCode,
          leaseOwner: null,
          leaseExpiresAt: null,
          completedAt: cvWorkerDatabaseTimestamp(input.now),
        },
      });
    }
    await transaction.cvUpload.updateMany({
      where: {
        id: input.uploadId,
        accountId: input.accountId,
        status: { in: ["VALIDATION_QUEUED", "SCAN_QUEUED", "SCANNING"] },
        expiresAt: { gt: input.now },
        contentInaccessibleAt: null,
        deletedAt: null,
      },
      data: { status: "SCAN_FAILED", failureCode: input.failureCode },
    });
  });
}

export class ScanStageProcessor {
  constructor(
    private readonly dependencies: Dependencies = defaults(),
    private readonly workRepository: Pick<
      PrismaCvWorkRepository,
      "assertStageResultCommitAllowed"
    > = new PrismaCvWorkRepository(),
  ) {}

  async process(
    claim: CvWorkClaim,
    context: CvStageProcessContext,
  ): Promise<CvStageOutcome> {
    if (context.signal.aborted) throw new Error("CV_WORKER_ABORTED");
    const work = await prisma.cvScanAssessment.findFirst({
      where: {
        id: claim.id,
        uploadId: claim.uploadId,
        accountId: claim.accountId,
        status: "PROCESSING",
        leaseOwner: claim.leaseOwner,
        policyVersion: CV_SECURITY_POLICY_VERSION,
        upload: {
          is: {
            status: { in: ["VALIDATION_QUEUED", "SCAN_QUEUED", "SCANNING"] },
            expiresAt: { gt: context.now },
            contentInaccessibleAt: null,
            deletedAt: null,
          },
        },
        sourceArtifact: {
          is: {
            kind: "SOURCE_DOCUMENT",
            status: "QUARANTINED",
            contentInaccessibleAt: null,
            deletedAt: null,
          },
        },
      },
      select: {
        id: true,
        attemptNumber: true,
        candidateInitiated: true,
        startedAt: true,
        upload: {
          select: {
            id: true,
            accountId: true,
            status: true,
            actualBytes: true,
            declaredBytes: true,
            documentKind: true,
            declaredMediaType: true,
            expiresAt: true,
            purpose: true,
            processingMode: true,
            policyVersion: true,
          },
        },
        sourceArtifact: {
          select: {
            id: true,
            accountId: true,
            kind: true,
            storageLocator: true,
            encryptionKeyVersion: true,
            plaintextBytes: true,
            ciphertextBytes: true,
          },
        },
      },
    });
    if (!work) throw new Error("CV_LEASE_LOST");
    const { upload, sourceArtifact: artifact } = work;
    let automaticCycleDeadline: Date | null = null;
    if (!work.candidateInitiated) {
      await prisma.cvUpload.updateMany({
        where: {
          id: upload.id,
          accountId: upload.accountId,
          status: { in: ["VALIDATION_QUEUED", "SCAN_QUEUED", "SCANNING"] },
          expiresAt: { gt: context.now },
          contentInaccessibleAt: null,
          deletedAt: null,
          automaticScanAttemptsUsed: {
            lt: Math.min(work.attemptNumber, 3),
          },
        },
        data: {
          automaticScanAttemptsUsed: Math.min(work.attemptNumber, 3),
        },
      });
      const initialStartedAt =
        work.attemptNumber === 1
          ? work.startedAt
          : (
              await prisma.cvScanAssessment.findFirst({
                where: {
                  uploadId: upload.id,
                  accountId: upload.accountId,
                  attemptNumber: 1,
                  candidateInitiated: false,
                },
                select: { startedAt: true },
              })
            )?.startedAt;
      if (!initialStartedAt) throw new Error("CV_SCAN_CYCLE_STATE_INVALID");
      automaticCycleDeadline = new Date(
        initialStartedAt.getTime() + AUTOMATIC_SCAN_CYCLE_LIMIT_MS,
      );
      const completion = cvStageCurrentTime(context);
      if (
        completion.getTime() + AUTOMATIC_SCAN_COMPLETION_BUDGET_MS >
        automaticCycleDeadline.getTime()
      ) {
        await persistIndeterminateScanFailure({
          uploadId: upload.id,
          accountId: upload.accountId,
          assessmentId: work.id,
          failureCode: "SCANNER_UNAVAILABLE",
          now: completion,
          commitGuard: this.resultCommitGuard(claim, completion),
        });
        return {
          status: "INDETERMINATE",
          failureCode: "SCANNER_UNAVAILABLE",
        };
      }
    }
    const envelopeValid =
      upload.status === "VALIDATION_QUEUED" ||
      upload.status === "SCAN_QUEUED" ||
      upload.status === "SCANNING";
    const processingContractValid =
      (upload.purpose === "PROFILE_IMPORT" &&
        upload.processingMode === "IMPORT_AND_PARSE") ||
      (upload.purpose !== "PROFILE_IMPORT" &&
        upload.processingMode === "SCAN_ONLY");
    const metadataValid =
      upload.policyVersion === CV_SECURITY_POLICY_VERSION &&
      processingContractValid &&
      artifact.kind === "SOURCE_DOCUMENT" &&
      artifact.accountId === upload.accountId &&
      artifact.plaintextBytes === upload.actualBytes &&
      upload.actualBytes === upload.declaredBytes &&
      upload.declaredBytes <= CV_SOURCE_MAX_BYTES &&
      ((upload.documentKind === "PDF" &&
        upload.declaredMediaType === "application/pdf") ||
        (upload.documentKind === "DOC" &&
          upload.declaredMediaType === "application/msword") ||
        (upload.documentKind === "DOCX" &&
          upload.declaredMediaType ===
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
    if (!envelopeValid || !metadataValid) {
      const completion = cvStageCurrentTime(context);
      await persistRejectedContent({
        uploadId: upload.id,
        accountId: upload.accountId,
        assessmentId: work.id,
        failureCode: "CONTENT_LENGTH_MISMATCH",
        now: completion,
        commitGuard: this.resultCommitGuard(claim, completion),
      });
      return {
        status: "INDETERMINATE",
        failureCode: "CONTENT_LENGTH_MISMATCH",
      };
    }
    const artifactBytes = await readCvWorkerArtifactBytes({
      artifactId: artifact.id,
      uploadId: upload.id,
      accountId: upload.accountId,
    });
    if (
      !artifactBytes.sourceSha256 ||
      !artifactBytes.sourceSha256.equals(artifactBytes.plaintextSha256)
    ) {
      const completion = cvStageCurrentTime(context);
      await persistRejectedContent({
        uploadId: upload.id,
        accountId: upload.accountId,
        assessmentId: work.id,
        failureCode: "ARTIFACT_INTEGRITY_FAILED",
        now: completion,
        commitGuard: this.resultCommitGuard(claim, completion),
      });
      return {
        status: "INDETERMINATE",
        failureCode: "ARTIFACT_INTEGRITY_FAILED",
      };
    }
    await this.dependencies.storage.assertReady();
    let verified: IntegrityVerifiedArtifact | undefined;
    try {
      verified = await this.dependencies.reader.verify({
        locator: artifact.storageLocator,
        ciphertextBytes: artifact.ciphertextBytes,
        plaintextBytes: artifact.plaintextBytes,
        plaintextSha256: artifactBytes.plaintextSha256,
        context: {
          accountId: upload.accountId,
          uploadId: upload.id,
          artifactId: artifact.id,
          kind: "SOURCE_DOCUMENT",
        },
        envelope: {
          keyVersion: artifact.encryptionKeyVersion,
          iv: artifactBytes.encryptionIv,
          authenticationTag: artifactBytes.authenticationTag,
        },
      });
      if (
        !expectedMagic(upload.documentKind, await firstBytes(verified.open()))
      ) {
        const completion = cvStageCurrentTime(context);
        await persistRejectedContent({
          uploadId: upload.id,
          accountId: upload.accountId,
          assessmentId: work.id,
          failureCode: "UNSUPPORTED_DOCUMENT",
          now: completion,
          commitGuard: this.resultCommitGuard(claim, completion),
        });
        return { status: "INDETERMINATE", failureCode: "UNSUPPORTED_DOCUMENT" };
      }
      await prisma.cvUpload.updateMany({
        where: {
          id: upload.id,
          accountId: upload.accountId,
          status: { in: ["VALIDATION_QUEUED", "SCAN_QUEUED", "SCANNING"] },
          expiresAt: { gt: context.now },
          contentInaccessibleAt: null,
          deletedAt: null,
        },
        data: { status: "SCANNING" },
      });
      await this.assertResultCommitAllowed(claim, context);
      let result: Awaited<ReturnType<ClamAvScanner["scan"]>>;
      let metadata: ReturnType<ClamAvScanner["assessmentMetadata"]>;
      try {
        result = await this.dependencies.scanner.scan(verified.open());
        metadata = this.dependencies.scanner.assessmentMetadata();
        if (
          result.outcome === "CLEAN" &&
          (!metadata || result.engineVersion !== metadata.engineVersion)
        ) {
          throw Object.assign(new Error("CV_SCANNER_PROTOCOL_INVALID"), {
            code: "CV_SCANNER_PROTOCOL_INVALID",
          });
        }
      } catch (error) {
        const rawCode = errorCode(error);
        const failureCode =
          rawCode === "CV_SCANNER_DEFINITIONS_STALE"
            ? "SCANNER_DEFINITIONS_STALE"
            : "SCANNER_UNAVAILABLE";
        const completion = cvStageCurrentTime(context);
        await persistIndeterminateScanFailure({
          uploadId: upload.id,
          accountId: upload.accountId,
          assessmentId: work.id,
          failureCode,
          now: completion,
          commitGuard: this.resultCommitGuard(claim, completion),
        });
        return { status: "INDETERMINATE", failureCode };
      }
      if (result.outcome === "INFECTED") {
        const completion = cvStageCurrentTime(context);
        const contentInaccessibleAt = cvWorkerDatabaseTimestamp(completion);
        const deleteAfter = cvWorkerDatabaseTimestamp(
          new Date(completion.getTime() + REJECTED_CONTENT_RETENTION_MS),
        );
        await prisma.$transaction(async (transaction) => {
          await assertCvStageResultCommitAllowed(
            transaction,
            this.resultCommitGuard(claim, completion),
          );
          await transaction.cvScanAssessment.update({
            where: { id: work.id },
            data: {
              status: "INFECTED",
              failureCode: "MALWARE_DETECTED",
              leaseOwner: null,
              leaseExpiresAt: null,
              completedAt: cvWorkerDatabaseTimestamp(completion),
              ...(metadata
                ? {
                    engineName: "clamav",
                    engineVersion: metadata.engineVersion,
                    signatureVersion: metadata.signatureVersion,
                    signaturePublishedAt: cvWorkerDatabaseTimestamp(
                      metadata.publishedAt,
                    ),
                  }
                : { engineName: "clamav" }),
            },
            select: { id: true },
          });
          await transaction.cvStoredArtifact.updateMany({
            where: {
              uploadId: upload.id,
              accountId: upload.accountId,
              deletedAt: null,
              status: {
                in: [
                  "QUARANTINED",
                  "AVAILABLE",
                  "DELETE_PENDING",
                  "DELETE_FAILED",
                ],
              },
            },
            data: {
              status: "DELETE_PENDING",
              contentInaccessibleAt,
              deleteAfter,
              deleteFailureCode: "MALWARE_DETECTED",
            },
          });
          await transaction.cvUpload.updateMany({
            where: { id: upload.id, accountId: upload.accountId },
            data: {
              status: "INFECTED",
              failureCode: "MALWARE_DETECTED",
              contentInaccessibleAt,
              deleteAfter,
            },
          });
        });
        return { status: "INFECTED", failureCode: "MALWARE_DETECTED" };
      }
      if (!metadata) throw new Error("CV_SCANNER_PROTOCOL_INVALID");
      const completion = cvStageCurrentTime(context);
      if (
        automaticCycleDeadline &&
        completion.getTime() > automaticCycleDeadline.getTime()
      ) {
        await persistIndeterminateScanFailure({
          uploadId: upload.id,
          accountId: upload.accountId,
          assessmentId: work.id,
          failureCode: "SCANNER_UNAVAILABLE",
          now: completion,
          commitGuard: this.resultCommitGuard(claim, completion),
        });
        return {
          status: "INDETERMINATE",
          failureCode: "SCANNER_UNAVAILABLE",
        };
      }
      await prisma.$transaction(async (transaction) => {
        await assertCvStageResultCommitAllowed(
          transaction,
          this.resultCommitGuard(claim, completion),
        );
        await transaction.cvScanAssessment.update({
          where: { id: work.id },
          data: {
            status: "CLEAN",
            engineName: "clamav",
            engineVersion: result.engineVersion,
            signatureVersion: metadata.signatureVersion,
            signaturePublishedAt: cvWorkerDatabaseTimestamp(
              metadata.publishedAt,
            ),
            failureCode: null,
            leaseOwner: null,
            leaseExpiresAt: null,
            completedAt: cvWorkerDatabaseTimestamp(completion),
          },
          select: { id: true },
        });
        if (upload.processingMode === "IMPORT_AND_PARSE") {
          const existing = await transaction.cvExtraction.findFirst({
            where: { uploadId: upload.id, attemptNumber: work.attemptNumber },
            select: { id: true },
          });
          if (!existing)
            await transaction.cvExtraction.create({
              data: {
                id: randomUUID(),
                uploadId: upload.id,
                sourceArtifactId: artifact.id,
                scanAssessmentId: work.id,
                accountId: upload.accountId,
                attemptNumber: work.attemptNumber,
                status: "QUEUED",
              },
              select: { id: true },
            });
        }
        await transaction.cvStoredArtifact.update({
          where: { id: artifact.id },
          data: {
            status: "AVAILABLE",
            availableAt: cvWorkerDatabaseTimestamp(completion),
            // AVAILABLE artifacts are retained by their business projection.
            // Unclaimed admissions are scheduled by CvRetentionService when
            // the upload expires; a global timestamp here could delete an
            // active profile/application/team CV after the admission TTL.
            deleteAfter: null,
          },
          select: { id: true },
        });
        await transaction.cvUpload.update({
          where: { id: upload.id },
          data: {
            status:
              upload.processingMode === "IMPORT_AND_PARSE"
                ? "EXTRACTION_QUEUED"
                : "SECURITY_CLEAN",
            failureCode: null,
          },
          select: { id: true },
        });
      });
      return { status: "CLEAN" };
    } catch (error) {
      if (!isIntegrityFailure(error)) throw error;
      const completion = cvStageCurrentTime(context);
      await persistRejectedContent({
        uploadId: upload.id,
        accountId: upload.accountId,
        assessmentId: work.id,
        failureCode: "ARTIFACT_INTEGRITY_FAILED",
        now: completion,
        commitGuard: this.resultCommitGuard(claim, completion),
      });
      return {
        status: "INDETERMINATE",
        failureCode: "ARTIFACT_INTEGRITY_FAILED",
      };
    } finally {
      await verified?.dispose();
    }
  }

  private resultCommitGuard(
    claim: CvWorkClaim,
    now: Date,
  ): CvStageResultCommitGuard {
    return {
      stage: "SCAN",
      id: claim.id,
      uploadId: claim.uploadId,
      accountId: claim.accountId,
      owner: claim.leaseOwner,
      now,
    };
  }

  private async assertResultCommitAllowed(
    claim: CvWorkClaim,
    context: CvStageProcessContext,
  ): Promise<void> {
    await this.workRepository.assertStageResultCommitAllowed(
      this.resultCommitGuard(claim, cvStageCurrentTime(context)),
    );
  }
}
