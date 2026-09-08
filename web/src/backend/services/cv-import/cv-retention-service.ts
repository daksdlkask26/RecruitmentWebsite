import "server-only";

import { prisma } from "@/backend/database/prisma";
import type { Prisma } from "@/backend/generated/prisma/client";
import { systemClock, type Clock } from "@/backend/time/clock";
import {
  CV_CANDIDATE_DELETE_RETENTION_MS,
  cvDeletionOutcomeSchema,
  type CvDeletionOutcome,
} from "@/shared/contracts/cv-import/consent-retention";
import { CvImportServiceError } from "./cv-http-errors";

type LockedUpload = Readonly<{
  id: string;
  accountId: string;
  status: string;
  quotaReservationRemaining: number;
  contentInaccessibleAt: Date | null;
  deleteAfter: Date | null;
  deletedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
}>;

const candidateDeletableStates = new Set([
  "AWAITING_CONTENT",
  "VALIDATION_QUEUED",
  "SCAN_QUEUED",
  "SCANNING",
  "EXTRACTION_QUEUED",
  "EXTRACTING",
  "AWAITING_CONSENT",
  "PARSE_QUEUED",
  "PARSING",
  "REVIEW_READY",
  "VALIDATION_FAILED",
  "INFECTED",
  "SCAN_FAILED",
  "EXTRACTION_FAILED",
  "PARSE_FAILED",
  "CANCELLED",
  "DELETED",
]);

function validNow(now: Date): void {
  if (Number.isNaN(now.getTime()))
    throw new CvImportServiceError("VALIDATION_ERROR");
}

function deletionOutcome(upload: LockedUpload): CvDeletionOutcome {
  if (!upload.contentInaccessibleAt || !upload.deleteAfter) {
    throw new CvImportServiceError("CV_PROCESSING_UNAVAILABLE");
  }
  return cvDeletionOutcomeSchema.parse({
    uploadId: upload.id,
    status: upload.status === "DELETED" ? "DELETED" : "CANCELLED",
    contentInaccessibleAt: upload.contentInaccessibleAt.toISOString(),
    deleteAfter: upload.deleteAfter.toISOString(),
    deletedAt: upload.deletedAt?.toISOString() ?? null,
    statusUrl: `/api/account/cv-imports/${upload.id}`,
  });
}

async function lockUpload(
  transaction: Prisma.TransactionClient,
  accountId: string,
  uploadId: string,
  requireActiveAccount: boolean,
): Promise<LockedUpload> {
  const rows = await transaction.$queryRaw<LockedUpload[]>`
    SELECT upload."id", upload."accountId", upload."status"::text AS "status",
           upload."quotaReservationRemaining", upload."contentInaccessibleAt",
           upload."deleteAfter", upload."deletedAt", upload."expiresAt",
           upload."createdAt"
      FROM "user" account
      JOIN "CvUpload" upload ON upload."accountId" = account."id"
     WHERE account."id" = ${accountId}
       AND upload."id" = ${uploadId}
       AND (${requireActiveAccount} = FALSE OR
            (account."state" = 'ACTIVE' AND account."deletedAt" IS NULL))
     FOR UPDATE OF account, upload
  `;
  const upload = rows[0];
  if (!upload) throw new CvImportServiceError("CV_IMPORT_NOT_FOUND");
  return upload;
}

async function cancelWork(
  transaction: Prisma.TransactionClient,
  uploadId: string,
  now: Date,
  failureCode: "IMPORT_DELETED" | "IMPORT_EXPIRED",
): Promise<void> {
  await transaction.cvScanAssessment.updateMany({
    where: { uploadId, status: { in: ["QUEUED", "PROCESSING"] } },
    data: {
      status: "CANCELLED",
      failureCode,
      completedAt: now,
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  });
  await transaction.cvExtraction.updateMany({
    where: { uploadId, status: { in: ["QUEUED", "PROCESSING"] } },
    data: {
      status: "CANCELLED",
      failureCode,
      completedAt: now,
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  });
  await transaction.cvParseJob.updateMany({
    where: { uploadId, status: { in: ["QUEUED", "PROCESSING"] } },
    data: {
      status: "CANCELLED",
      failureCode,
      completedAt: now,
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  });
}

async function releaseRemainingReservation(
  transaction: Prisma.TransactionClient,
  upload: LockedUpload,
  now: Date,
): Promise<void> {
  if (upload.quotaReservationRemaining <= 0) return;
  await transaction.$queryRaw`
    SELECT "accountId" FROM "CvAccountQuota"
     WHERE "accountId" = ${upload.accountId} FOR UPDATE
  `;
  await transaction.cvUpload.update({
    where: { id: upload.id },
    data: { quotaReservationRemaining: 0 },
    select: { id: true },
  });
  await transaction.$executeRaw`
    UPDATE "CvAccountQuota"
       SET "reservedBytes" = GREATEST(0, "reservedBytes" - ${upload.quotaReservationRemaining}),
           "updatedAt" = ${now}
     WHERE "accountId" = ${upload.accountId}
  `;
}

async function scheduleContentPurge(
  transaction: Prisma.TransactionClient,
  upload: LockedUpload,
  inaccessibleAt: Date,
  deleteAfter: Date,
  draftStatus: "DELETED" | "EXPIRED",
): Promise<void> {
  await transaction.cvStoredArtifact.updateMany({
    where: {
      uploadId: upload.id,
      accountId: upload.accountId,
      status: { in: ["QUARANTINED", "AVAILABLE", "DELETE_FAILED"] },
      deletedAt: null,
    },
    data: {
      status: "DELETE_PENDING",
      contentInaccessibleAt: inaccessibleAt,
      deleteAfter,
      deleteFailureCode: null,
    },
  });
  await transaction.cvStoredArtifact.updateMany({
    where: {
      uploadId: upload.id,
      accountId: upload.accountId,
      status: "DELETING",
    },
    data: { contentInaccessibleAt: inaccessibleAt, deleteAfter },
  });
  await transaction.cvDraft.updateMany({
    where: { uploadId: upload.id, accountId: upload.accountId },
    data: {
      status: draftStatus,
      contentInaccessibleAt: inaccessibleAt,
      payloadDeleteAfter: deleteAfter,
    },
  });
}

export class CvRetentionService {
  constructor(private readonly clock: Clock = systemClock) {}

  async deleteOwnedImport(input: {
    accountId: string;
    uploadId: string;
    now?: Date;
  }): Promise<CvDeletionOutcome> {
    if (!input.accountId)
      throw new CvImportServiceError("AUTHENTICATION_REQUIRED");
    if (!input.uploadId) throw new CvImportServiceError("CV_IMPORT_NOT_FOUND");
    const now = input.now ?? this.clock.now();
    validNow(now);
    return prisma.$transaction(
      async (transaction) => {
        const upload = await lockUpload(
          transaction,
          input.accountId,
          input.uploadId,
          true,
        );
        if (!candidateDeletableStates.has(upload.status))
          throw new CvImportServiceError("IMPORT_STATE_CONFLICT");
        if (upload.status === "CANCELLED" || upload.status === "DELETED")
          return deletionOutcome(upload);
        const inaccessibleAt = now;
        const candidateDeadline = new Date(
          now.getTime() + CV_CANDIDATE_DELETE_RETENTION_MS,
        );
        const deleteAfter =
          upload.deleteAfter && upload.deleteAfter < candidateDeadline
            ? upload.deleteAfter
            : candidateDeadline;
        await cancelWork(transaction, upload.id, now, "IMPORT_DELETED");
        await scheduleContentPurge(
          transaction,
          upload,
          inaccessibleAt,
          deleteAfter,
          "DELETED",
        );
        await releaseRemainingReservation(transaction, upload, now);
        await transaction.cvUpload.update({
          where: { id: upload.id },
          data: {
            status: "CANCELLED",
            failureCode: "IMPORT_DELETED",
            contentInaccessibleAt: inaccessibleAt,
            deleteAfter,
          },
          select: { id: true },
        });
        await transaction.auditEvent.createMany({
          data: [
            {
              id: `cv_delete_${upload.id}`.slice(0, 80),
              occurredAt: now,
              actorType: "user",
              actorUserId: upload.accountId,
              action: "cv_import.deleted",
              targetType: "cv_import",
              targetId: upload.id,
              result: "SUCCESS",
              correlationId: `cv_delete_${upload.id}`.slice(0, 128),
              context: { state: "CANCELLED" },
            },
          ],
          skipDuplicates: true,
        });
        return deletionOutcome({
          ...upload,
          status: "CANCELLED",
          quotaReservationRemaining: 0,
          contentInaccessibleAt: inaccessibleAt,
          deleteAfter,
        });
      },
      { isolationLevel: "Serializable" },
    );
  }

  async expireDue(input: { now?: Date; limit?: number } = {}): Promise<number> {
    const now = input.now ?? this.clock.now();
    const limit = input.limit ?? 50;
    validNow(now);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error("CV_RETENTION_BATCH_INVALID");
    const candidates = await prisma.cvUpload.findMany({
      where: {
        expiresAt: { lte: now },
        status: {
          notIn: ["CONFIRMED", "CANCELLED", "DELETED", "EXPIRED"],
        },
        // The upload expiry is an admission/finalization deadline, not the
        // retention deadline of a CV already claimed by a business record.
        artifacts: {
          none: {
            OR: [
              { candidateCvs: { some: { archivedAt: null } } },
              { applicationDocuments: { some: { deletedAt: null } } },
              { teamApplications: { some: { cvDeletedAt: null } } },
            ],
          },
        },
      },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      take: limit,
      select: { id: true, accountId: true },
    });
    let expired = 0;
    for (const candidate of candidates) {
      let changed = false;
      try {
        changed = await prisma.$transaction(async (transaction) => {
          const upload = await lockUpload(
            transaction,
            candidate.accountId,
            candidate.id,
            false,
          );
          if (
            upload.expiresAt > now ||
            ["CONFIRMED", "CANCELLED", "DELETED", "EXPIRED"].includes(
              upload.status,
            )
          )
            return false;
          const inaccessibleAt = now;
          const deleteAfter = upload.expiresAt;
          await cancelWork(transaction, upload.id, now, "IMPORT_EXPIRED");
          await scheduleContentPurge(
            transaction,
            upload,
            inaccessibleAt,
            deleteAfter,
            "EXPIRED",
          );
          await releaseRemainingReservation(transaction, upload, now);
          await transaction.cvUpload.update({
            where: { id: upload.id },
            data: {
              status: "EXPIRED",
              failureCode: "IMPORT_EXPIRED",
              contentInaccessibleAt: inaccessibleAt,
              deleteAfter,
            },
            select: { id: true },
          });
          await transaction.auditEvent.createMany({
            data: [
              {
                id: `cv_expire_${upload.id}`.slice(0, 80),
                occurredAt: now,
                actorType: "system",
                action: "cv_import.expired",
                targetType: "cv_import",
                targetId: upload.id,
                result: "SUCCESS",
                correlationId: `cv_expire_${upload.id}`.slice(0, 128),
                context: { state: "EXPIRED" },
              },
            ],
            skipDuplicates: true,
          });
          return true;
        });
      } catch (error) {
        // A worker may observe a candidate between the initial scan and its
        // row lock. Another retention/delete worker winning that race is a
        // normal no-op; an explicit user deletion still surfaces NOT_FOUND
        // through deleteOwnedImport above.
        if (
          !(error instanceof CvImportServiceError) ||
          error.code !== "CV_IMPORT_NOT_FOUND"
        )
          throw error;
      }
      if (changed) expired += 1;
    }
    return expired;
  }
}
