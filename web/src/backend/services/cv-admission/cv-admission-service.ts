import "server-only";

import { createHash, createHmac, randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";

import { cvConfiguration } from "@/backend/cv/config";
import { createMetadataCryptor } from "@/backend/cv/encryption/metadata-cryptor";
import {
  createCvWorkerCryptor,
  createCvWorkerStorage,
} from "@/backend/cv/workers/cv-worker-resources";
import { prisma } from "@/backend/database/prisma";
import { serverEnvironment } from "@/backend/env/runtime";
import {
  CV_ACCOUNT_MAX_IMPORTS,
  CV_ACCOUNT_MAX_STORED_BYTES,
  CV_EXTRACTED_TEXT_MAX_BYTES,
  CV_SECURITY_POLICY_VERSION,
  CV_SOURCE_MAX_BYTES,
  CV_UPLOAD_ATTEMPTS_PER_ROLLING_HOUR,
} from "@/shared/contracts/cv-import/common";
import {
  CvFileValidationError,
  validateCvFileBytes,
} from "@/shared/cv-file-validation";
import { logCvUploadRejection } from "@/backend/cv/upload-observability";

export type CvAdmissionPurpose =
  | "PROFILE_IMPORT"
  | "PROFILE_DIRECT"
  | "JOB_APPLICATION_DIRECT"
  | "TEAM_APPLICATION_DIRECT";

export type CvAdmissionProcessingMode = "IMPORT_AND_PARSE" | "SCAN_ONLY";

export class CvAdmissionError extends Error {
  readonly name = "CvAdmissionError";

  constructor(
    readonly code:
      | "AUTHENTICATION_REQUIRED"
      | "VALIDATION_ERROR"
      | "PAYLOAD_TOO_LARGE"
      | "CONTENT_LENGTH_MISMATCH"
      | "UNSUPPORTED_MEDIA_TYPE"
      | "DOCUMENT_REJECTED"
      | "UPLOAD_RATE_LIMITED"
      | "CV_QUOTA_EXCEEDED"
      | "IDEMPOTENCY_KEY_REUSED"
      | "INTERNAL_ERROR",
    readonly userMessage?: string,
  ) {
    super(code);
  }
}

export type CvAdmissionInput = Readonly<{
  candidateUserId: string;
  purpose: CvAdmissionPurpose;
  fileName: string;
  contentType: string;
  contentLength: number;
  body: AsyncIterable<Uint8Array>;
  idempotencyKey: string;
  processingMode?: CvAdmissionProcessingMode;
  now?: Date;
}>;

export type CvAdmissionResult = Readonly<{
  uploadId: string;
  status: "SCAN_QUEUED" | "VALIDATION_QUEUED";
  replayed: boolean;
  sha256: string;
  retryAfterSeconds: number;
}>;

function computeIdempotencyDigest(secret: string, key: string): Uint8Array {
  return Uint8Array.from(
    createHmac("sha256", secret)
      .update("smarthire:cv-admission:idempotency:v1\0", "utf8")
      .update(key, "utf8")
      .digest(),
  );
}

function sanitizeFileName(value: string): string {
  const normalized = value
    .replace(/[\\/]/gu, "_")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .trim()
    .slice(0, 255);
  return normalized || "uploaded-cv";
}

function encryptFilename(
  filename: string,
  context: { accountId: string; uploadId: string },
): string {
  const keys = Object.fromEntries(
    Object.entries(cvConfiguration.encryption.encodedKeys).map(
      ([version, key]) => [Number(version), Buffer.from(key, "base64")],
    ),
  );
  const metadata = createMetadataCryptor({
    activeKeyVersion: cvConfiguration.encryption.activeKeyVersion,
    keys,
  });
  return metadata.encryptDisplayFilename(filename, context);
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "P2002",
  );
}

function replayAdmissionResult(
  existing: { id: string; status: string },
  sha256: string,
): CvAdmissionResult {
  return Object.freeze({
    uploadId: existing.id,
    status:
      existing.status === "VALIDATION_QUEUED"
        ? "VALIDATION_QUEUED"
        : "SCAN_QUEUED",
    replayed: true,
    sha256,
    retryAfterSeconds: 2,
  });
}

export class CvAdmissionService {
  constructor(
    private readonly storage = createCvWorkerStorage(),
    private readonly cryptor = createCvWorkerCryptor(),
  ) {}

  async admit(input: CvAdmissionInput): Promise<CvAdmissionResult> {
    const now = input.now ?? new Date();

    if (
      !Number.isSafeInteger(input.contentLength) ||
      input.contentLength < 1 ||
      input.contentLength > CV_SOURCE_MAX_BYTES
    ) {
      logCvUploadRejection({
        reason: "PAYLOAD_TOO_LARGE",
        byteSize: input.contentLength,
        declaredMimeType: input.contentType,
      });
      throw new CvAdmissionError(
        "PAYLOAD_TOO_LARGE",
        "File size must not exceed 5MB.",
      );
    }

    if (!input.idempotencyKey || typeof input.idempotencyKey !== "string") {
      throw new CvAdmissionError(
        "VALIDATION_ERROR",
        "Idempotency-Key header is required.",
      );
    }

    const processingMode: CvAdmissionProcessingMode =
      input.processingMode ??
      (input.purpose === "PROFILE_IMPORT" ? "IMPORT_AND_PARSE" : "SCAN_ONLY");
    const requiredProcessingMode =
      input.purpose === "PROFILE_IMPORT" ? "IMPORT_AND_PARSE" : "SCAN_ONLY";
    if (processingMode !== requiredProcessingMode) {
      throw new CvAdmissionError(
        "VALIDATION_ERROR",
        "CV purpose and processing mode do not match.",
      );
    }

    // 1. Authorize candidate & get profile
    const profile = await prisma.candidateProfile.findFirst({
      where: {
        candidateUserId: input.candidateUserId,
        candidate: { user: { state: "ACTIVE", deletedAt: null } },
      },
      select: { id: true, candidateUserId: true },
    });

    if (!profile) {
      throw new CvAdmissionError(
        "AUTHENTICATION_REQUIRED",
        "Active candidate profile required.",
      );
    }

    const idempotencyDigest = computeIdempotencyDigest(
      serverEnvironment.TOKEN_SECRET,
      input.idempotencyKey,
    );

    // 2. Stream and buffer body with hard cutoff limits
    const chunks: Uint8Array[] = [];
    let received = 0;
    for await (const chunk of input.body) {
      const copy = Uint8Array.from(chunk);
      received += copy.byteLength;
      if (received > input.contentLength || received > CV_SOURCE_MAX_BYTES) {
        logCvUploadRejection({
          reason: "PAYLOAD_TOO_LARGE",
          byteSize: received,
          declaredMimeType: input.contentType,
        });
        throw new CvAdmissionError(
          "PAYLOAD_TOO_LARGE",
          "File size must not exceed 5MB.",
        );
      }
      chunks.push(copy);
    }

    if (received !== input.contentLength) {
      logCvUploadRejection({
        reason: "CONTENT_LENGTH_MISMATCH",
        byteSize: received,
        declaredMimeType: input.contentType,
      });
      throw new CvAdmissionError(
        "CONTENT_LENGTH_MISMATCH",
        "Uploaded byte length did not match declared length.",
      );
    }

    const sourceBytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      sourceBytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    // 3. Format and magic byte admission
    let detected;
    try {
      detected = validateCvFileBytes({
        bytes: sourceBytes,
        fileName: input.fileName,
        declaredMimeType: input.contentType,
      });
    } catch (error) {
      if (error instanceof CvFileValidationError) {
        logCvUploadRejection({
          reason: error.code,
          byteSize: sourceBytes.byteLength,
          declaredMimeType: input.contentType,
        });
        throw new CvAdmissionError("DOCUMENT_REJECTED", error.message);
      }
      throw error;
    }

    // Team Application accepts PDF and DOCX only
    if (
      input.purpose === "TEAM_APPLICATION_DIRECT" &&
      detected.kind !== "PDF" &&
      detected.kind !== "DOCX"
    ) {
      throw new CvAdmissionError(
        "UNSUPPORTED_MEDIA_TYPE",
        "Team applications only accept PDF and DOCX files.",
      );
    }

    const sha256Buffer = Uint8Array.from(
      createHash("sha256").update(sourceBytes).digest(),
    );
    const sha256Hex = Buffer.from(sha256Buffer).toString("hex");

    // 4. Check idempotency replay
    const existing = await prisma.cvUpload.findFirst({
      where: {
        accountId: input.candidateUserId,
        idempotencyDigest:
          idempotencyDigest as unknown as Uint8Array<ArrayBuffer>,
        deletedAt: null,
      },
      select: {
        id: true,
        status: true,
        sourceSha256: true,
        purpose: true,
        processingMode: true,
      },
    });

    if (existing) {
      const existingSha256 = existing.sourceSha256
        ? Buffer.from(existing.sourceSha256).toString("hex")
        : null;
      const sameAdmissionContract =
        (!existing.purpose || existing.purpose === input.purpose) &&
        (!existing.processingMode ||
          existing.processingMode === processingMode);
      if (existingSha256 === sha256Hex && sameAdmissionContract) {
        return replayAdmissionResult(existing, sha256Hex);
      }
      throw new CvAdmissionError(
        "IDEMPOTENCY_KEY_REUSED",
        "Idempotency key was reused with different payload contents.",
      );
    }

    // 5. Encrypt with AES-256-GCM envelope before durable storage
    await this.storage.assertReady();
    const uploadId = randomUUID();
    const artifactId = randomUUID();
    const safeName = sanitizeFileName(input.fileName);
    // Reserve the locator before starting the stream. If the storage provider
    // returns an error after committing the object, reconciliation can still
    // identify the only object belonging to this admission. Never guess a
    // locator after an unknown write outcome.
    const plannedStorageLocator = uploadId;

    const ciphertextStream = new PassThrough();
    let storedLocator: string | null = plannedStorageLocator;
    let storageOutcome: "UNKNOWN" | "COMMITTED" = "UNKNOWN";
    const storagePromise = this.storage.put({
      source: ciphertextStream,
      expectedBytes: input.contentLength,
      locator: plannedStorageLocator,
    });

    try {
      const envelope = await this.cryptor.encrypt({
        plaintext: (async function* () {
          yield sourceBytes;
        })(),
        ciphertext: ciphertextStream,
        context: {
          accountId: input.candidateUserId,
          uploadId,
          artifactId,
          kind: "SOURCE_DOCUMENT",
        },
      });
      ciphertextStream.end();

      const storedItem = await storagePromise;
      storageOutcome = "COMMITTED";
      storedLocator = storedItem.locator;
      if (storedLocator !== plannedStorageLocator) {
        throw new CvAdmissionError(
          "INTERNAL_ERROR",
          "Storage returned an unexpected admission locator.",
        );
      }

      const displayFilenameCiphertext = encryptFilename(safeName, {
        accountId: input.candidateUserId,
        uploadId,
      });

      // 6. Atomically persist CvUpload, CvStoredArtifact(QUARANTINED), and CvScanAssessment(QUEUED)
      await prisma.$transaction(
        async (tx) => {
          await tx.cvAccountQuota.upsert({
            where: { accountId: input.candidateUserId },
            update: {},
            create: {
              accountId: input.candidateUserId,
              reservedBytes: 0,
              retainedBytes: 0,
            },
          });
          await tx.$queryRaw`
          SELECT "accountId" FROM "CvAccountQuota"
           WHERE "accountId" = ${input.candidateUserId} FOR UPDATE
        `;
          const quota = await tx.cvAccountQuota.findUniqueOrThrow({
            where: { accountId: input.candidateUserId },
            select: { reservedBytes: true, retainedBytes: true },
          });
          const rollingAttempts = await tx.cvUpload.count({
            where: {
              accountId: input.candidateUserId,
              createdAt: { gt: new Date(now.getTime() - 60 * 60_000) },
            },
          });
          const activeUploads = await tx.cvUpload.count({
            where: {
              accountId: input.candidateUserId,
              deletedAt: null,
              expiresAt: { gt: now },
            },
          });
          if (rollingAttempts >= CV_UPLOAD_ATTEMPTS_PER_ROLLING_HOUR) {
            throw new CvAdmissionError(
              "UPLOAD_RATE_LIMITED",
              "Too many CV uploads. Try again later.",
            );
          }
          if (activeUploads >= CV_ACCOUNT_MAX_IMPORTS) {
            throw new CvAdmissionError(
              "CV_QUOTA_EXCEEDED",
              "The CV storage limit has been reached.",
            );
          }
          const extractionReservation =
            processingMode === "IMPORT_AND_PARSE"
              ? CV_EXTRACTED_TEXT_MAX_BYTES
              : 0;
          if (
            quota.reservedBytes +
              quota.retainedBytes +
              sourceBytes.byteLength +
              extractionReservation >
            CV_ACCOUNT_MAX_STORED_BYTES
          ) {
            throw new CvAdmissionError(
              "CV_QUOTA_EXCEEDED",
              "The CV storage limit has been reached.",
            );
          }
          await tx.cvUpload.create({
            data: {
              id: uploadId,
              accountId: input.candidateUserId,
              profileId: profile.id,
              purpose: input.purpose,
              processingMode,
              policyVersion: CV_SECURITY_POLICY_VERSION,
              documentKind: detected.kind,
              parserClass: "DETERMINISTIC_INTERNAL",
              status: "SCAN_QUEUED",
              declaredMediaType: detected.mimeType,
              declaredBytes: sourceBytes.byteLength,
              actualBytes: sourceBytes.byteLength,
              quotaReservationBytes:
                sourceBytes.byteLength + extractionReservation,
              quotaReservationRemaining: extractionReservation,
              sourceSha256: sha256Buffer as unknown as Uint8Array<ArrayBuffer>,
              displayFilenameCiphertext,
              idempotencyDigest:
                idempotencyDigest as unknown as Uint8Array<ArrayBuffer>,
              createBindingDigest:
                idempotencyDigest as unknown as Uint8Array<ArrayBuffer>,
              contentReceivedAt: now,
              expiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
            },
          });

          await tx.cvStoredArtifact.create({
            data: {
              id: artifactId,
              uploadId,
              accountId: input.candidateUserId,
              kind: "SOURCE_DOCUMENT",
              status: "QUARANTINED",
              storageAdapter: cvConfiguration.storage.adapter,
              storageLocator: storedItem.locator,
              encryptionKeyVersion: envelope.keyVersion,
              encryptionIv: Uint8Array.from(envelope.iv),
              authenticationTag: Uint8Array.from(envelope.authenticationTag),
              plaintextBytes: envelope.plaintextBytes,
              ciphertextBytes: envelope.ciphertextBytes,
              plaintextSha256: sha256Buffer,
            },
          });

          await tx.cvScanAssessment.create({
            data: {
              id: randomUUID(),
              uploadId,
              sourceArtifactId: artifactId,
              accountId: input.candidateUserId,
              attemptNumber: 1,
              policyVersion: CV_SECURITY_POLICY_VERSION,
              status: "QUEUED",
            },
          });
          await tx.cvAccountQuota.update({
            where: { accountId: input.candidateUserId },
            data: {
              retainedBytes: { increment: sourceBytes.byteLength },
              reservedBytes: { increment: extractionReservation },
            },
          });
        },
        { isolationLevel: "Serializable" },
      );

      return Object.freeze({
        uploadId,
        status: "SCAN_QUEUED" as const,
        replayed: false,
        sha256: sha256Hex,
        retryAfterSeconds: 2,
      });
    } catch (error) {
      // If failure happened after storage wrote, clean up the orphaned ciphertext
      ciphertextStream.destroy(
        error instanceof Error ? error : new Error("CV_ADMISSION_FAILED"),
      );
      await storagePromise.catch(() => undefined);
      if (storageOutcome === "COMMITTED" && storedLocator === plannedStorageLocator) {
        let safeToCleanup: boolean;
        try {
          const persistedArtifact = await prisma.cvStoredArtifact.findUnique({
            where: { id: artifactId },
            select: { id: true },
          });
          // A missing artifact proves that the transaction did not retain this
          // object. Any query failure is treated as an unknown outcome and the
          // ciphertext is preserved for reconciliation instead of risking a
          // delete against a committed or shared locator.
          safeToCleanup = !persistedArtifact;
        } catch {
          safeToCleanup = false;
        }
        if (safeToCleanup) {
          await this.storage.delete(storedLocator).catch(() => undefined);
        }
      }
      if (isUniqueConstraintError(error)) {
        try {
          const raced = await prisma.cvUpload.findFirst({
            where: {
              accountId: input.candidateUserId,
              idempotencyDigest:
                idempotencyDigest as unknown as Uint8Array<ArrayBuffer>,
              deletedAt: null,
            },
            select: {
              id: true,
              status: true,
              sourceSha256: true,
              purpose: true,
              processingMode: true,
            },
          });
          if (raced) {
            const racedSha256 = raced.sourceSha256
              ? Buffer.from(raced.sourceSha256).toString("hex")
              : null;
            const sameAdmissionContract =
              (!raced.purpose || raced.purpose === input.purpose) &&
              (!raced.processingMode ||
                raced.processingMode === processingMode);
            if (racedSha256 === sha256Hex && sameAdmissionContract) {
              return replayAdmissionResult(raced, sha256Hex);
            }
            throw new CvAdmissionError(
              "IDEMPOTENCY_KEY_REUSED",
              "Idempotency key was reused with different payload contents.",
            );
          }
        } catch (replayError) {
          if (replayError instanceof CvAdmissionError) throw replayError;
        }
      }
      throw error;
    }
  }
}
