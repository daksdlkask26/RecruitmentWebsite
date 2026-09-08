import "server-only";

import { createHash, createHmac, randomUUID } from "node:crypto";
import { PassThrough, type Writable } from "node:stream";
import { S3Client } from "@aws-sdk/client-s3";

import { cvConfiguration } from "@/backend/cv/config";
import {
  createArtifactCryptor,
  type CvArtifactEnvelope,
} from "@/backend/cv/encryption/artifact-cryptor";
import { FilesystemPrivateCvStorage } from "@/backend/cv/storage/filesystem";
import {
  sensitiveStorageLocator,
  type PrivateCvStorage,
  type PrivateCvStorageItem,
} from "@/backend/cv/storage/private-cv-storage";
import { S3PrivateCvStorage } from "@/backend/cv/storage/s3";
import { prisma } from "@/backend/database/prisma";
import { serverEnvironment } from "@/backend/env/runtime";
import {
  CvFileValidationError,
  validateCvFileBytes,
} from "@/shared/cv-file-validation";
import { CV_SOURCE_MAX_BYTES } from "@/shared/contracts/cv-import/common";
import { CvImportServiceError } from "./cv-http-errors";
import { logCvUploadRejection } from "@/backend/cv/upload-observability";

type Reservation = Readonly<{
  uploadId: string;
  accountId: string;
  artifactId: string;
  /** Reserved before storage so an ambiguous write remains reconcilable. */
  storageLocator?: string;
  documentKind: "PDF" | "DOC" | "DOCX";
  declaredMediaType: string;
  declaredBytes: number;
  status: "AWAITING_CONTENT" | "VALIDATION_QUEUED";
  sourceSha256?: string | null;
}>;

type CiphertextSink =
  | Writable
  | Readonly<{
      writable: Writable;
      complete(): Promise<PrivateCvStorageItem>;
      delete?(locator: string): Promise<void>;
    }>;

type Dependencies = Readonly<{
  findReservation(
    accountId: string,
    uploadId: string,
    idempotencyKey: string,
  ): Promise<Reservation | null>;
  cryptor: ReturnType<typeof createArtifactCryptor>;
  createCiphertextSink(reservation: Reservation): Promise<CiphertextSink>;
  finalize(input: {
    reservation: Reservation;
    envelope: CvArtifactEnvelope;
    sha256: Buffer;
    storage: PrivateCvStorageItem | null;
    now: Date;
  }): Promise<boolean>;
  scheduleForDeletion(input: {
    uploadId: string;
    artifactId?: string;
    locator?: string;
    reason: string;
  }): Promise<void>;
  now(): Date;
}>;

function contentKeyDigest(value: string): string {
  return createHmac("sha256", serverEnvironment.TOKEN_SECRET)
    .update("smarthire:cv-import:reservation-key:v1\0", "utf8")
    .update(value, "utf8")
    .digest("hex");
}

function createStorage(): PrivateCvStorage {
  if (cvConfiguration.storage.adapter === "filesystem") {
    if (!cvConfiguration.storage.localRoot) {
      throw new Error("CV_STORAGE_CONFIGURATION_INVALID");
    }
    return new FilesystemPrivateCvStorage({
      root: cvConfiguration.storage.localRoot,
    });
  }
  const s3 = cvConfiguration.storage.s3;
  if (!s3) throw new Error("CV_STORAGE_CONFIGURATION_INVALID");
  return new S3PrivateCvStorage({
    client: new S3Client({ region: s3.region }),
    bucket: s3.bucket,
    region: s3.region,
    kmsKeyId: s3.kmsKeyId,
  });
}

function defaultDependencies(): Dependencies {
  const keys = Object.fromEntries(
    Object.entries(cvConfiguration.encryption.encodedKeys).map(
      ([version, key]) => [Number(version), Buffer.from(key, "base64")],
    ),
  );
  const cryptor = createArtifactCryptor({
    activeKeyVersion: cvConfiguration.encryption.activeKeyVersion,
    keys,
  });
  const storage = createStorage();
  return {
    async findReservation(accountId, uploadId, idempotencyKey) {
      const rows = await prisma.$queryRaw<
        Array<{
          uploadId: string;
          accountId: string;
          documentKind: "PDF" | "DOC" | "DOCX";
          declaredMediaType: string;
          declaredBytes: number;
          status: "AWAITING_CONTENT" | "VALIDATION_QUEUED";
          sourceSha256: string | null;
          idempotencyHex: string;
          existingArtifactId: string | null;
          existingStorageLocator: string | null;
        }>
      >`
        SELECT upload."id" AS "uploadId", upload."accountId", upload."documentKind",
               upload."declaredMediaType", upload."declaredBytes", upload."status",
               encode(upload."sourceSha256", 'hex') AS "sourceSha256",
               encode(upload."idempotencyDigest", 'hex') AS "idempotencyHex",
               artifact."id" AS "existingArtifactId",
               artifact."storageLocator" AS "existingStorageLocator"
          FROM "CvUpload" upload
          JOIN "user" account ON account."id" = upload."accountId"
     LEFT JOIN LATERAL (
           SELECT artifact."id", artifact."storageLocator"
             FROM "CvStoredArtifact" artifact
            WHERE artifact."uploadId" = upload."id"
              AND artifact."accountId" = upload."accountId"
              AND artifact."kind" = 'SOURCE_DOCUMENT'
            ORDER BY artifact."createdAt" DESC, artifact."id" DESC
            LIMIT 1
         ) artifact ON TRUE
         WHERE upload."id" = ${uploadId} AND upload."accountId" = ${accountId}
           AND upload."status" IN ('AWAITING_CONTENT', 'VALIDATION_QUEUED')
           AND account."state" = 'ACTIVE' AND account."deletedAt" IS NULL
         LIMIT 1
      `;
      const row = rows[0];
      if (!row || row.idempotencyHex !== contentKeyDigest(idempotencyKey))
        return null;
      return Object.freeze({
        ...row,
        artifactId: row.existingArtifactId ?? randomUUID(),
        storageLocator: row.existingStorageLocator ?? row.uploadId,
      });
    },
    cryptor,
    async createCiphertextSink(reservation) {
      await storage.assertReady();
      const stream = new PassThrough();
      const result = storage.put({
        source: stream,
        expectedBytes: reservation.declaredBytes,
        locator: reservation.storageLocator ?? reservation.uploadId,
      });
      return {
        writable: stream,
        async complete() {
          stream.end();
          return result;
        },
        async delete(locator) {
          await storage.delete(locator);
        },
      };
    },
    async finalize(input) {
      if (!input.storage) return false;
      const storageItem = input.storage;
      return prisma.$transaction(async (transaction) => {
        const locked = await transaction.$queryRaw<
          Array<{
            accountId: string;
            reservationBytes: number;
            remainingBytes: number;
          }>
        >`
          SELECT "accountId", "quotaReservationBytes" AS "reservationBytes",
                 "quotaReservationRemaining" AS "remainingBytes"
            FROM "CvUpload" WHERE "id" = ${input.reservation.uploadId}
             AND "accountId" = ${input.reservation.accountId}
             AND "status" = 'AWAITING_CONTENT' FOR UPDATE
        `;
        const upload = locked[0];
        if (!upload || upload.remainingBytes !== upload.reservationBytes)
          return false;
        await transaction.$queryRaw`
          SELECT "accountId" FROM "CvAccountQuota"
           WHERE "accountId" = ${upload.accountId} FOR UPDATE
        `;
        await transaction.cvStoredArtifact.create({
          data: {
            id: input.reservation.artifactId,
            uploadId: input.reservation.uploadId,
            accountId: input.reservation.accountId,
            kind: "SOURCE_DOCUMENT",
            status: "QUARANTINED",
            storageAdapter: cvConfiguration.storage.adapter,
            storageLocator: storageItem.locator,
            encryptionKeyVersion: input.envelope.keyVersion,
            encryptionIv: Uint8Array.from(input.envelope.iv),
            authenticationTag: Uint8Array.from(
              input.envelope.authenticationTag,
            ),
            plaintextBytes: input.envelope.plaintextBytes,
            ciphertextBytes: input.envelope.ciphertextBytes,
            plaintextSha256: Uint8Array.from(input.sha256),
          },
          select: { id: true },
        });
        await transaction.cvScanAssessment.create({
          data: {
            id: randomUUID(),
            uploadId: input.reservation.uploadId,
            sourceArtifactId: input.reservation.artifactId,
            accountId: input.reservation.accountId,
            attemptNumber: 1,
            status: "QUEUED",
          },
          select: { id: true },
        });
        const changed = await transaction.cvUpload.updateMany({
          where: {
            id: input.reservation.uploadId,
            accountId: input.reservation.accountId,
            status: "AWAITING_CONTENT",
          },
          data: {
            status: "VALIDATION_QUEUED",
            actualBytes: input.envelope.plaintextBytes,
            sourceSha256: Uint8Array.from(input.sha256),
            contentReceivedAt: input.now,
            quotaReservationRemaining: {
              decrement: input.envelope.plaintextBytes,
            },
          },
        });
        if (changed.count !== 1) throw new Error("CV_UPLOAD_FINALIZE_CONFLICT");
        await transaction.cvAccountQuota.update({
          where: { accountId: input.reservation.accountId },
          data: {
            reservedBytes: { decrement: input.envelope.plaintextBytes },
            retainedBytes: { increment: input.envelope.plaintextBytes },
          },
          select: { accountId: true },
        });
        return true;
      });
    },
    async scheduleForDeletion(input) {
      if (input.artifactId) {
        await prisma.cvStoredArtifact
          .updateMany({
            where: { id: input.artifactId, deletedAt: null },
            data: {
              status: "DELETE_PENDING",
              contentInaccessibleAt: new Date(),
              deleteAfter: new Date(),
              deleteFailureCode: input.reason.slice(0, 100),
            },
          })
          .catch(() => undefined);
      }
      if (input.locator)
        await storage.delete(input.locator).catch(() => undefined);
    },
    now: () => new Date(),
  };
}

type NormalizedSink = Readonly<{
  writable: Writable;
  complete(): Promise<PrivateCvStorageItem | null>;
  delete?: (locator: string) => Promise<void>;
}>;

function normalizeSink(sink: CiphertextSink): NormalizedSink {
  if ("complete" in sink && typeof sink.complete === "function") return sink;
  return {
    writable: sink as Writable,
    complete: async () => null,
  };
}

export class ReceiveCvContentService {
  private readonly dependencies: Dependencies;

  constructor(
    dependencies?: Omit<Dependencies, "now"> &
      Partial<Pick<Dependencies, "now">>,
  ) {
    this.dependencies = dependencies
      ? { ...dependencies, now: dependencies.now ?? (() => new Date()) }
      : defaultDependencies();
  }

  async execute(input: {
    accountId: string;
    uploadId: string;
    contentType: string;
    contentLength: number;
    body: AsyncIterable<Uint8Array>;
    idempotencyKey: string;
  }): Promise<
    Readonly<{
      uploadId: string;
      status: "VALIDATION_QUEUED";
      replayed: boolean;
      sha256: string;
    }>
  > {
    let reservation: Reservation | null = null;
    let sink: ReturnType<typeof normalizeSink>;
    let stored: PrivateCvStorageItem | null = null;
    let envelope: CvArtifactEnvelope | null = null;
    let sha256: Buffer | null = null;
    let storageCompletionRejected = false;
    try {
      if (
        !Number.isSafeInteger(input.contentLength) ||
        input.contentLength < 1 ||
        input.contentLength > CV_SOURCE_MAX_BYTES
      ) {
        logCvUploadRejection({
          reason: "PAYLOAD_TOO_LARGE",
          byteSize: input.contentLength,
          declaredMimeType: input.contentType,
          uploadId: input.uploadId,
        });
        throw new CvImportServiceError("PAYLOAD_TOO_LARGE", {
          userMessage: "File size must not exceed 5MB.",
        });
      }
      reservation = await this.dependencies.findReservation(
        input.accountId,
        input.uploadId,
        input.idempotencyKey,
      );
      if (!reservation) throw new CvImportServiceError("CV_IMPORT_NOT_FOUND");
      if (input.contentType !== reservation.declaredMediaType) {
        logCvUploadRejection({
          reason: "UNSUPPORTED_MEDIA_TYPE",
          byteSize: input.contentLength,
          declaredMimeType: input.contentType,
          uploadId: input.uploadId,
        });
        throw new CvImportServiceError("UNSUPPORTED_MEDIA_TYPE");
      }
      if (input.contentLength !== reservation.declaredBytes) {
        logCvUploadRejection({
          reason: "CONTENT_LENGTH_MISMATCH",
          byteSize: input.contentLength,
          declaredMimeType: input.contentType,
          uploadId: input.uploadId,
        });
        throw new CvImportServiceError("DOCUMENT_REJECTED");
      }
      // Buffer only the already bounded upload so signature validation happens
      // before any ciphertext reaches durable storage. The maximum is 5 MB,
      // so this also keeps the validation path deterministic and replay-safe.
      const chunks: Uint8Array[] = [];
      let received = 0;
      for await (const sourceChunk of input.body) {
        const chunk = Uint8Array.from(sourceChunk);
        received += chunk.byteLength;
        if (received > input.contentLength || received > CV_SOURCE_MAX_BYTES) {
          logCvUploadRejection({
            reason: "PAYLOAD_TOO_LARGE",
            byteSize: received,
            declaredMimeType: input.contentType,
            uploadId: input.uploadId,
          });
          throw new CvImportServiceError("PAYLOAD_TOO_LARGE", {
            userMessage: "File size must not exceed 5MB.",
          });
        }
        chunks.push(chunk);
      }
      if (received !== input.contentLength) {
        logCvUploadRejection({
          reason: "CONTENT_LENGTH_MISMATCH",
          byteSize: received,
          declaredMimeType: input.contentType,
          uploadId: input.uploadId,
        });
        throw new CvImportServiceError("DOCUMENT_REJECTED");
      }
      const source = new Uint8Array(received);
      let sourceOffset = 0;
      for (const chunk of chunks) {
        source.set(chunk, sourceOffset);
        sourceOffset += chunk.byteLength;
      }
      try {
        validateCvFileBytes({
          bytes: source,
          declaredMimeType: reservation.declaredMediaType,
        });
      } catch (error) {
        if (error instanceof CvFileValidationError) {
          logCvUploadRejection({
            reason: error.code,
            byteSize: source.byteLength,
            declaredMimeType: reservation.declaredMediaType,
            uploadId: reservation.uploadId,
          });
          throw new CvImportServiceError("DOCUMENT_REJECTED", {
            userMessage: error.message,
          });
        }
        throw error;
      }

      sha256 = createHash("sha256").update(source).digest();
      if (reservation.status === "VALIDATION_QUEUED") {
        if (
          !reservation.sourceSha256 ||
          reservation.sourceSha256.toLowerCase() !== sha256.toString("hex")
        ) {
          throw new CvImportServiceError("IDEMPOTENCY_KEY_REUSED");
        }
        return Object.freeze({
          uploadId: reservation.uploadId,
          status: "VALIDATION_QUEUED" as const,
          replayed: true,
          sha256: sha256.toString("hex"),
        });
      }

      sink = normalizeSink(
        await this.dependencies.createCiphertextSink(reservation),
      );
      const plaintext = (async function* () {
        yield source;
      })();
      envelope = await this.dependencies.cryptor.encrypt({
        plaintext,
        ciphertext: sink.writable,
        context: {
          accountId: reservation.accountId,
          uploadId: reservation.uploadId,
          artifactId: reservation.artifactId,
          kind: "SOURCE_DOCUMENT",
        },
      });
      try {
        stored = await sink.complete();
      } catch (error) {
        storageCompletionRejected = true;
        throw error;
      }
      const finalized = await this.dependencies.finalize({
        reservation,
        envelope,
        sha256,
        storage: stored,
        now: this.dependencies.now(),
      });
      if (!finalized) throw new CvImportServiceError("IMPORT_STATE_CONFLICT");
      return Object.freeze({
        uploadId: reservation.uploadId,
        status: "VALIDATION_QUEUED",
        replayed: false,
        sha256: sha256.toString("hex"),
      });
    } catch (error) {
      const ambiguousStorageWrite = Boolean(
        reservation &&
          storageCompletionRejected &&
          !stored &&
          envelope &&
          sha256,
      );
      if (ambiguousStorageWrite && reservation && envelope && sha256) {
        // The provider may have committed the deterministic object while its
        // acknowledgement was lost. Materialize the immutable artifact
        // reference if the database is available, but never delete this
        // locator or mark it inaccessible from an UNKNOWN outcome.
        await this.dependencies
          .finalize({
            reservation,
            envelope,
            sha256,
            storage: {
              locator: sensitiveStorageLocator(
                reservation.storageLocator ?? reservation.uploadId,
              ),
              bytes: envelope.ciphertextBytes,
            },
            now: this.dependencies.now(),
          })
          .catch(() => false);
      } else {
        await this.dependencies.scheduleForDeletion({
          uploadId: input.uploadId,
          artifactId: reservation?.artifactId,
          locator: stored?.locator,
          reason:
            error instanceof CvImportServiceError
              ? error.code
              : "CV_CONTENT_RECEIVE_FAILED",
        });
      }
      throw error;
    }
  }
}
