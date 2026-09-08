import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import sharp from "sharp";

import type {
  IntegrityVerifiedArtifact,
  IntegrityVerifiedReader,
} from "@/backend/cv/encryption/integrity-verified-reader";
import { IsolatedDocumentExtractor } from "@/backend/cv/extraction/document-extractor";
import { ExtractedSegmentStore } from "@/backend/cv/extraction/extracted-segment-store";
import { mergeHybridCvSegments } from "@/backend/cv/extraction/hybrid-segments";
import { PrivateRasterWorkspace } from "@/backend/cv/extraction/private-raster-workspace";
import type { PrivateCvStorage } from "@/backend/cv/storage/private-cv-storage";
import { prisma } from "@/backend/database/prisma";
import {
  OCR_EXPECTED_ENGINE_VERSION,
  OCR_EXPECTED_MODEL_MANIFEST_SHA256,
} from "@/backend/image-search/config";
import type { OcrEngine } from "@/backend/ocr/ocr-engine";
import { UnixOcrEngine } from "@/backend/ocr/unix-ocr-engine";
import { PrismaOcrProcessingRepository } from "@/backend/repositories/cv-import/prisma-ocr-processing-repository";
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
  createCvWorkerCryptor,
  createCvWorkerIntegrityReader,
  createCvWorkerStorage,
  cvWorkerDatabaseTimestamp,
  readCvWorkerArtifactBytes,
} from "./cv-worker-resources";
import { CV_SECURITY_POLICY_VERSION } from "@/shared/contracts/cv-import/common";

const REJECTED_CONTENT_RETENTION_MS = 24 * 60 * 60_000;

type Dependencies = Readonly<{
  storage: PrivateCvStorage;
  reader: IntegrityVerifiedReader;
  extractor: IsolatedDocumentExtractor;
  segments: ExtractedSegmentStore;
  ocr: OcrEngine;
  ocrRepository: PrismaOcrProcessingRepository;
}>;

function defaults(): Dependencies {
  const storage = createCvWorkerStorage();
  const cryptor = createCvWorkerCryptor();
  return {
    storage,
    reader: createCvWorkerIntegrityReader(storage, cryptor),
    extractor: new IsolatedDocumentExtractor(),
    segments: new ExtractedSegmentStore({ storage, cryptor }),
    ocr: new UnixOcrEngine({
      socketPath: "/run/smarthire-ocr/ocr.sock",
      expectedEngineName: "paddleocr-onnx",
      expectedEngineVersion: OCR_EXPECTED_ENGINE_VERSION,
      expectedModelName: "PP-OCRv6-medium",
    }),
    ocrRepository: new PrismaOcrProcessingRepository(),
  };
}

const OCR_REQUIRED_CLASSIFICATIONS = new Set([
  "OCR_REQUIRED_EMPTY",
  "OCR_REQUIRED_SPARSE",
  "OCR_REQUIRED_SUSPICIOUS",
  "ELIGIBLE_BODY_IMAGE",
]);

async function withDeadline<T>(input: {
  deadline: Date;
  parentSignal: AbortSignal;
  run(signal: AbortSignal): Promise<T>;
}) {
  const remaining = input.deadline.getTime() - Date.now();
  if (remaining <= 0) throw new Error("OCR_DEADLINE_EXCEEDED");
  const controller = new AbortController();
  const abort = () => controller.abort();
  input.parentSignal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), remaining);
  timer.unref();
  try {
    const result = await Promise.race([
      input.run(controller.signal),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => reject(new Error("OCR_DEADLINE_EXCEEDED")),
          { once: true },
        );
      }),
    ]);
    if (input.parentSignal.aborted) throw new Error("CV_WORKER_ABORTED");
    return result;
  } catch (error) {
    if (input.parentSignal.aborted)
      throw new Error("CV_WORKER_ABORTED", { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
    input.parentSignal.removeEventListener("abort", abort);
  }
}

function errorCode(error: unknown): string {
  if (error instanceof Error && "code" in error) return String(error.code);
  return error instanceof Error ? error.message : "";
}

function safeFailure(error: unknown) {
  const code = errorCode(error);
  const mapping: Record<string, string> = {
    ENCRYPTED: "DOCUMENT_ENCRYPTED",
    ACTIVE_CONTENT: "DOCUMENT_ACTIVE_CONTENT",
    EMBEDDED_CONTENT: "DOCUMENT_ACTIVE_CONTENT",
    PAGE_LIMIT: "DOCUMENT_LIMIT_EXCEEDED",
    ENTRY_LIMIT: "DOCUMENT_LIMIT_EXCEEDED",
    EXPANDED_LIMIT: "DOCUMENT_LIMIT_EXCEEDED",
    ZIP_BOMB: "DOCUMENT_LIMIT_EXCEEDED",
    OUTPUT_LIMIT: "DOCUMENT_LIMIT_EXCEEDED",
    IMAGE_ONLY: "EXTRACTION_EMPTY",
    EMPTY_TEXT: "EXTRACTION_EMPTY",
    EXTRACTION_TIMEOUT: "EXTRACTION_TIMEOUT",
    OCR_DEADLINE_EXCEEDED: "OCR_TIMEOUT",
    OCR_EMPTY: "OCR_LOW_CONFIDENCE",
    OCR_ENGINE_NOT_READY: "OCR_UNAVAILABLE",
    OCR_MODEL_MISMATCH: "OCR_OUTPUT_INVALID",
    OCR_INPUT_REJECTED: "OCR_OUTPUT_INVALID",
    OCR_OUTPUT_REJECTED: "OCR_OUTPUT_INVALID",
    OCR_RECOGNITION_FAILED: "OCR_OUTPUT_INVALID",
  };
  return mapping[code] ?? "EXTRACTION_FAILED";
}

function isIntegrityFailure(error: unknown): boolean {
  return errorCode(error) === "ARTIFACT_INTEGRITY_FAILED";
}

const RETRYABLE_OCR_FAILURE_CODES = new Set([
  "OCR_UNAVAILABLE",
  "OCR_TIMEOUT",
  "OCR_OUTPUT_INVALID",
  "OCR_LOW_CONFIDENCE",
]);

async function persistRetryableOcrFailure(input: {
  uploadId: string;
  accountId: string;
  failureCode: string;
  commitGuard: CvStageResultCommitGuard;
}) {
  await prisma.$transaction(async (transaction) => {
    await assertCvStageResultCommitAllowed(transaction, input.commitGuard);
    await transaction.cvUpload.updateMany({
      where: {
        id: input.uploadId,
        accountId: input.accountId,
        contentInaccessibleAt: null,
        deletedAt: null,
      },
      data: {
        status: "EXTRACTION_FAILED",
        failureCode: input.failureCode,
      },
    });
  });
}

async function persistInaccessibleFailure(input: {
  uploadId: string;
  accountId: string;
  uploadStatus: "VALIDATION_FAILED" | "EXTRACTION_FAILED";
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
        status: input.uploadStatus,
        failureCode: input.failureCode,
        contentInaccessibleAt,
        deleteAfter,
      },
    });
  });
}

export class ExtractionStageProcessor {
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
    const work = await prisma.cvExtraction.findFirst({
      where: {
        id: claim.id,
        uploadId: claim.uploadId,
        accountId: claim.accountId,
        status: "PROCESSING",
        leaseOwner: claim.leaseOwner,
        upload: {
          is: {
            purpose: "PROFILE_IMPORT",
            processingMode: "IMPORT_AND_PARSE",
            policyVersion: CV_SECURITY_POLICY_VERSION,
            status: { in: ["EXTRACTION_QUEUED", "EXTRACTING"] },
            expiresAt: { gt: context.now },
            contentInaccessibleAt: null,
            deletedAt: null,
          },
        },
        sourceArtifact: {
          is: {
            kind: "SOURCE_DOCUMENT",
            status: "AVAILABLE",
            contentInaccessibleAt: null,
            deletedAt: null,
          },
        },
        scanAssessment: {
          is: {
            status: "CLEAN",
            completedAt: { not: null },
            policyVersion: CV_SECURITY_POLICY_VERSION,
            engineName: "clamav",
            engineVersion: { not: null },
            signatureVersion: { not: null },
            signaturePublishedAt: { not: null },
          },
        },
      },
      select: {
        id: true,
        uploadId: true,
        accountId: true,
        upload: {
          select: {
            documentKind: true,
            parserClass: true,
            purpose: true,
            processingMode: true,
          },
        },
        sourceArtifact: {
          select: {
            id: true,
            storageLocator: true,
            encryptionKeyVersion: true,
            plaintextBytes: true,
            ciphertextBytes: true,
          },
        },
        scanAssessment: {
          select: {
            status: true,
            sourceArtifactId: true,
          },
        },
      },
    });
    if (!work) throw new Error("CV_LEASE_LOST");
    if (
      work.scanAssessment.status !== "CLEAN" ||
      work.scanAssessment.sourceArtifactId !== work.sourceArtifact.id
    )
      throw new Error("CV_EXTRACTION_REQUIRES_CLEAN_SCAN");
    const artifact = work.sourceArtifact;
    const artifactBytes = await readCvWorkerArtifactBytes({
      artifactId: artifact.id,
      uploadId: work.uploadId,
      accountId: work.accountId,
    });
    if (
      !artifactBytes.sourceSha256 ||
      !artifactBytes.sourceSha256.equals(artifactBytes.plaintextSha256)
    ) {
      const completion = cvStageCurrentTime(context);
      await persistInaccessibleFailure({
        uploadId: work.uploadId,
        accountId: work.accountId,
        uploadStatus: "VALIDATION_FAILED",
        failureCode: "ARTIFACT_INTEGRITY_FAILED",
        now: completion,
        commitGuard: this.resultCommitGuard(claim, completion),
      });
      return {
        status: "FAILED",
        failureCode: "ARTIFACT_INTEGRITY_FAILED",
      };
    }
    await this.dependencies.storage.assertReady();
    let verified: IntegrityVerifiedArtifact | undefined;
    let rasterWorkspacePath: string | undefined;
    let ocrAttemptId: string | undefined;
    try {
      verified = await this.dependencies.reader.verify({
        locator: artifact.storageLocator,
        ciphertextBytes: artifact.ciphertextBytes,
        plaintextBytes: artifact.plaintextBytes,
        plaintextSha256: artifactBytes.plaintextSha256,
        context: {
          accountId: work.accountId,
          uploadId: work.uploadId,
          artifactId: artifact.id,
          kind: "SOURCE_DOCUMENT",
        },
        envelope: {
          keyVersion: artifact.encryptionKeyVersion,
          iv: artifactBytes.encryptionIv,
          authenticationTag: artifactBytes.authenticationTag,
        },
      });
      await prisma.cvUpload.updateMany({
        where: {
          id: work.uploadId,
          accountId: work.accountId,
          status: { in: ["EXTRACTION_QUEUED", "EXTRACTING"] },
          expiresAt: { gt: context.now },
          contentInaccessibleAt: null,
          deletedAt: null,
        },
        data: { status: "EXTRACTING" },
      });
      const extracted = await this.dependencies.extractor.extract({
        kind: work.upload.documentKind,
        // The query above requires the current assessment to be CLEAN. Pass
        // that evidence through instead of manufacturing a scan result at the
        // extraction boundary.
        scanStatus: work.scanAssessment.status,
        source: verified.open(),
      });
      rasterWorkspacePath = extracted.privateRasterWorkspacePath ?? undefined;
      await this.assertResultCommitAllowed(claim, context);
      let segments = extracted.segments;
      let hybrid: ReturnType<typeof mergeHybridCvSegments> | undefined;
      if (extracted.manifest) {
        if (process.env.OCR_ENGINE_ENABLED !== "true")
          throw new Error("OCR_ENGINE_NOT_READY");
        const manifest = extracted.manifest;
        const attempt = await this.dependencies.ocrRepository.beginCvAttempt({
          extractionId: work.id,
          uploadId: work.uploadId,
          accountId: work.accountId,
          leaseOwner: claim.leaseOwner,
          now: cvStageCurrentTime(context),
          manifest,
          engineName: "paddleocr-onnx",
          engineVersion: OCR_EXPECTED_ENGINE_VERSION,
          modelName: "PP-OCRv6-medium",
          modelManifestSha256: OCR_EXPECTED_MODEL_MANIFEST_SHA256,
          runtimeName: "onnxruntime",
          runtimeVersion: "1.27.0",
        });
        ocrAttemptId = attempt.id;
        const startedAt = attempt.startedAt ?? cvStageCurrentTime(context);
        const aggregateDeadline = new Date(startedAt.getTime() + 180_000);
        if (aggregateDeadline.getTime() <= Date.now())
          throw new Error("OCR_DEADLINE_EXCEEDED");
        await this.dependencies.ocr.assertReady(
          OCR_EXPECTED_MODEL_MANIFEST_SHA256,
        );
        const requiredUnits = manifest.units.filter((unit) =>
          OCR_REQUIRED_CLASSIFICATIONS.has(unit.classification),
        );
        const recognized = new Map<
          string,
          Awaited<ReturnType<OcrEngine["recognize"]>>
        >();
        let nextUnit = 0;
        const runUnit = async () => {
          while (nextUnit < requiredUnits.length) {
            const unit = requiredUnits[nextUnit++];
            if (!unit?.privateNormalizedPngPath)
              throw new Error("CV_RASTER_PATH_INVALID");
            await this.assertResultCommitAllowed(claim, context);
            const bytes = await readFile(unit.privateNormalizedPngPath);
            if (bytes.byteLength > 25 * 1024 * 1024)
              throw new Error("OCR_INPUT_REJECTED");
            const metadata = await sharp(bytes, {
              animated: true,
              failOn: "error",
              limitInputPixels: 20_000_000,
            }).metadata();
            const width = metadata.width ?? 0;
            const height = metadata.height ?? 0;
            if (
              width < 1 ||
              height < 1 ||
              width * height > 20_000_000 ||
              (metadata.pages ?? 1) !== 1
            )
              throw new Error("OCR_INPUT_REJECTED");
            const unitDeadline = new Date(
              Math.min(Date.now() + 20_000, aggregateDeadline.getTime()),
            );
            const result = await withDeadline({
              deadline: unitDeadline,
              parentSignal: context.signal,
              run: (signal) =>
                this.dependencies.ocr.recognize({
                  attemptId: `${attempt.id}-${unit.ordinal}`,
                  purpose: "CV_IMPORT",
                  image: {
                    bytes,
                    width,
                    height,
                    decodedPixels: width * height,
                    sha256: createHash("sha256").update(bytes).digest(),
                  },
                  deadline: unitDeadline,
                  computeDeadline: unitDeadline,
                  expectedModelManifestSha256:
                    OCR_EXPECTED_MODEL_MANIFEST_SHA256,
                  signal,
                }),
            });
            if (Date.now() > aggregateDeadline.getTime())
              throw new Error("OCR_DEADLINE_EXCEEDED");
            recognized.set(unit.unitKey, result);
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(2, requiredUnits.length) }, runUnit),
        );
        await this.assertResultCommitAllowed(claim, context);
        hybrid = mergeHybridCvSegments({
          manifest,
          recognizedUnits: recognized,
          maximumUtf8Bytes: 512 * 1024,
        });
        if (!hybrid.segments.length) throw new Error("OCR_EMPTY");
        segments = hybrid.segments;
      }
      const stored = await this.dependencies.segments.writeEncrypted({
        accountId: work.accountId,
        uploadId: work.uploadId,
        extractionId: work.id,
        segments,
        ...(hybrid
          ? {
              schemaVersion: "cv-segments-v2" as const,
              hybridMetrics: {
                nativeSegmentCount: hybrid.nativeSegmentCount,
                ocrSegmentCount: hybrid.ocrSegmentCount,
                accountedUnitCount: hybrid.units.length,
                lowConfidenceUnitCount: hybrid.lowConfidenceUnitCount,
                conflictUnitCount: hybrid.conflictUnitCount,
              },
            }
          : {}),
        commitGuard: {
          stage: "EXTRACTION",
          id: claim.id,
          uploadId: claim.uploadId,
          accountId: claim.accountId,
          owner: claim.leaseOwner,
          currentTime: () => cvStageCurrentTime(context),
        },
      });
      if (hybrid && extracted.manifest && ocrAttemptId) {
        await this.dependencies.ocrRepository.completeCvAttempt({
          extractionId: work.id,
          uploadId: work.uploadId,
          accountId: work.accountId,
          leaseOwner: claim.leaseOwner,
          now: cvStageCurrentTime(context),
          attemptId: ocrAttemptId,
          manifest: extracted.manifest,
          outcomes: hybrid.units,
          outputUtf8Bytes: hybrid.utf8Bytes,
        });
      }
      await prisma.$transaction(async (transaction) => {
        const completion = cvStageCurrentTime(context);
        await assertCvStageResultCommitAllowed(
          transaction,
          this.resultCommitGuard(claim, completion),
        );
        await transaction.cvExtraction.update({
          where: { id: work.id },
          data: {
            extractorName:
              work.upload.documentKind === "PDF"
                ? "pdfjs"
                : work.upload.documentKind === "DOC"
                  ? "legacy-doc"
                  : hybrid
                    ? "mammoth+docx-relations"
                    : "mammoth",
            extractorVersion: hybrid ? "feature-005-v2" : "feature-004-v1",
            rulesVersion: hybrid ? "cv-ocr-eligibility-v1" : "cv-structure-v1",
            pageCount: extracted.pageCount,
            entryCount: extracted.entryCount,
            expandedBytes: extracted.expandedBytes,
            segmentCount: stored.segmentCount,
            extractedUtf8Bytes: stored.utf8Bytes,
          },
          select: { id: true },
        });
        if (work.upload.parserClass === "EXTERNAL_OPENAI") {
          await transaction.cvUpload.update({
            where: { id: work.uploadId },
            data: {
              status: "AWAITING_CONSENT",
              failureCode: "CONSENT_REQUIRED",
            },
            select: { id: true },
          });
          return;
        }
        const active = await transaction.cvParseJob.findFirst({
          where: {
            accountId: work.accountId,
            uploadId: work.uploadId,
            status: { in: ["QUEUED", "PROCESSING"] },
          },
          select: { id: true },
        });
        if (!active)
          await transaction.cvParseJob.create({
            data: {
              id: randomUUID(),
              uploadId: work.uploadId,
              extractionId: work.id,
              accountId: work.accountId,
              attemptNumber: 1,
              trigger: "INITIAL",
              status: "QUEUED",
              parserClass: "DETERMINISTIC_INTERNAL",
              provider: "smarthire",
              model: "deterministic-v1",
              purposeVersion: "cv-draft-purpose-v1",
              inputVersion: hybrid ? "cv-segments-v2" : "cv-segments-v1",
              instructionVersion: hybrid ? "cv-extract-v2" : "cv-extract-v1",
              schemaVersion: hybrid ? "cv-draft-v2" : "cv-draft-v1",
            },
            select: { id: true },
          });
        await transaction.cvUpload.update({
          where: { id: work.uploadId },
          data: { status: "PARSE_QUEUED", failureCode: null },
          select: { id: true },
        });
      });
      return { status: "SUCCEEDED" };
    } catch (error) {
      if (errorCode(error) === "CV_WORKER_ABORTED") throw error;
      if (errorCode(error) === "CV_STAGE_RESULT_DISCARDED") throw error;
      const integrityFailure = isIntegrityFailure(error);
      const failureCode = safeFailure(error);
      const completion = cvStageCurrentTime(context);
      if (ocrAttemptId) {
        await this.dependencies.ocrRepository
          .failCvAttempt({
            extractionId: work.id,
            uploadId: work.uploadId,
            accountId: work.accountId,
            leaseOwner: claim.leaseOwner,
            now: completion,
            attemptId: ocrAttemptId,
            failureCode,
          })
          .catch(() => undefined);
      }
      if (!integrityFailure && RETRYABLE_OCR_FAILURE_CODES.has(failureCode))
        await persistRetryableOcrFailure({
          uploadId: work.uploadId,
          accountId: work.accountId,
          failureCode,
          commitGuard: this.resultCommitGuard(claim, completion),
        });
      else
        await persistInaccessibleFailure({
          uploadId: work.uploadId,
          accountId: work.accountId,
          uploadStatus: integrityFailure
            ? "VALIDATION_FAILED"
            : "EXTRACTION_FAILED",
          failureCode: integrityFailure
            ? "ARTIFACT_INTEGRITY_FAILED"
            : failureCode,
          now: completion,
          commitGuard: this.resultCommitGuard(claim, completion),
        });
      return {
        status: "FAILED",
        failureCode: integrityFailure
          ? "ARTIFACT_INTEGRITY_FAILED"
          : failureCode,
      };
    } finally {
      if (rasterWorkspacePath)
        await PrivateRasterWorkspace.disposeOwned(rasterWorkspacePath);
      await verified?.dispose();
    }
  }

  private resultCommitGuard(
    claim: CvWorkClaim,
    now: Date,
  ): CvStageResultCommitGuard {
    return {
      stage: "EXTRACTION",
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
