import "server-only";

import { Prisma } from "@/backend/generated/prisma/client";
import { prisma } from "@/backend/database/prisma";
import { createApplicationDocumentStorage } from "@/backend/applications/storage/factory";
import type { ApplicationDocumentStoragePort } from "@/backend/applications/storage/application-document-storage";
import { acquireCompanyDeletionObjectLock } from "./company-deletion-object-lock";
import { findActiveCompanyDeletionRetentionBlock } from "./company-deletion-retention";

type PurgeStatus =
  | "COMPLETED"
  | "RETRY_REQUIRED"
  | "BLOCKED_BY_LEGAL_HOLD"
  | "NOT_FOUND";

export type CompanyDeletionPurgeResult = Readonly<{
  requestId: string;
  status: PurgeStatus;
  deletedObjects: number;
  alreadyAbsentObjects: number;
  retainedSharedObjects: number;
  retryableObjects: number;
  conflictingObjects: number;
}>;

type PurgeInput = Readonly<{
  now?: Date;
  storage?: ApplicationDocumentStoragePort;
}>;

export type CompanyDeletionReceiptStatus =
  | "BLOCKED"
  | "PENDING"
  | "RETRY_REQUIRED"
  | "COMPLETED";

export type CompanyDeletionReceipt = Readonly<{
  requestId: string;
  status: CompanyDeletionReceiptStatus;
  holdState: "NOT_EVALUATED" | "CLEAR" | "ACTIVE" | "RELEASED";
  purgeState: "NOT_STARTED" | "BLOCKED" | "PENDING" | "RETRYABLE" | "COMPLETE";
  requestedAt: string;
  retentionEligibleAt: string;
  completedAt: string | null;
  manifest: Readonly<{
    total: number;
    databaseRecords: number;
    objects: number;
    pending: number;
    deleted: number;
    retainedShared: number;
    blocked: number;
    retryable: number;
    conflicts: number;
  }>;
}>;

function receiptStatus(
  state:
    | "REQUESTED"
    | "ELIGIBLE"
    | "BLOCKED_BY_LEGAL_HOLD"
    | "PURGING"
    | "RETRY_REQUIRED"
    | "COMPLETED",
): CompanyDeletionReceiptStatus {
  if (state === "BLOCKED_BY_LEGAL_HOLD") return "BLOCKED";
  if (state === "RETRY_REQUIRED") return "RETRY_REQUIRED";
  if (state === "COMPLETED") return "COMPLETED";
  return "PENDING";
}

function emptyPurgeResult(requestId: string, status: PurgeStatus) {
  return {
    requestId,
    status,
    deletedObjects: 0,
    alreadyAbsentObjects: 0,
    retainedSharedObjects: 0,
    retryableObjects: 0,
    conflictingObjects: 0,
  } satisfies CompanyDeletionPurgeResult;
}

/**
 * Returns only the owner-scoped deletion receipt. Object locators, company
 * identifiers, report details, and actor identities are intentionally absent
 * from this projection so a status refresh cannot become a data disclosure.
 */
export async function getCompanyDeletionReceipt(
  requestId: string,
  requestedByUserId: string,
): Promise<CompanyDeletionReceipt | null> {
  const request = await prisma.companyDeletionRequest.findFirst({
    where: { id: requestId, requestedByUserId },
    select: {
      id: true,
      state: true,
      holdState: true,
      purgeState: true,
      requestedAt: true,
      retentionEligibleAt: true,
      completedAt: true,
      manifestEntries: {
        select: { resourceKind: true, state: true },
      },
    },
  });
  if (!request) return null;

  const manifest = {
    total: request.manifestEntries.length,
    databaseRecords: 0,
    objects: 0,
    pending: 0,
    deleted: 0,
    retainedShared: 0,
    blocked: 0,
    retryable: 0,
    conflicts: 0,
  };
  for (const entry of request.manifestEntries) {
    if (entry.resourceKind === "DATABASE_RECORD") manifest.databaseRecords++;
    else manifest.objects++;
    if (entry.state === "PENDING") manifest.pending++;
    else if (entry.state === "DELETED") manifest.deleted++;
    else if (entry.state === "RETAINED_SHARED") manifest.retainedShared++;
    else if (entry.state === "BLOCKED_BY_LEGAL_HOLD") manifest.blocked++;
    else if (entry.state === "RETRYABLE") manifest.retryable++;
    else if (entry.state === "CONFLICT") manifest.conflicts++;
  }

  return {
    requestId: request.id,
    status: receiptStatus(request.state),
    holdState: request.holdState,
    purgeState: request.purgeState,
    requestedAt: request.requestedAt.toISOString(),
    retentionEligibleAt: request.retentionEligibleAt.toISOString(),
    completedAt: request.completedAt?.toISOString() ?? null,
    manifest,
  };
}

function failureCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code.slice(0, 160);
  }
  return "APPLICATION_STORAGE_DELETE_FAILED";
}

async function markPendingObjectsRetryable(
  requestId: string,
  now: Date,
  code: string,
) {
  await prisma.companyDeletionManifestEntry.updateMany({
    where: {
      requestId,
      resourceKind: "OBJECT",
      state: { in: ["PENDING", "RETRYABLE"] },
    },
    data: {
      state: "RETRYABLE",
      outcomeCode: code,
      attemptCount: { increment: 1 },
      lastAttemptAt: now,
    },
  });
  await prisma.companyDeletionRequest.update({
    where: { id: requestId },
    data: {
      state: "RETRY_REQUIRED",
      purgeState: "RETRYABLE",
      lastFailureCode: code,
    },
  });
}

async function objectHasNewLiveReference(
  database: typeof prisma | Prisma.TransactionClient,
  objectKeyEncrypted: string,
) {
  const [document, promotion] = await Promise.all([
    database.applicationDocument.findFirst({
      where: { storageKeyEncrypted: objectKeyEncrypted, deletedAt: null },
      select: { id: true },
    }),
    database.applicationArtifactPromotion.findFirst({
      where: { storageKeyEncrypted: objectKeyEncrypted, deletedAt: null },
      select: { id: true },
    }),
  ]);
  return Boolean(document || promotion);
}

/**
 * Purges object entries from a durable company deletion manifest. The object
 * reference check and storage delete run under a transaction-scoped advisory
 * lock with a manifest-row CAS, so a retry cannot remove a newly-created
 * application object that reused a stale locator. Missing objects are
 * terminal and idempotent outcomes.
 */
export async function purgeCompanyDeletionRequest(
  requestId: string,
  input: PurgeInput = {},
): Promise<CompanyDeletionPurgeResult> {
  const now = input.now ?? new Date();
  const request = await prisma.companyDeletionRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      companyId: true,
      state: true,
      purgeState: true,
      retentionEligibleAt: true,
      manifestEntries: {
        where: { resourceKind: "DATABASE_RECORD" },
        select: { resourceType: true, recordId: true },
      },
    },
  });
  if (!request) {
    return emptyPurgeResult(requestId, "NOT_FOUND");
  }
  if (request.state === "BLOCKED_BY_LEGAL_HOLD") {
    return emptyPurgeResult(requestId, "BLOCKED_BY_LEGAL_HOLD");
  }
  if (request.retentionEligibleAt > now) {
    return emptyPurgeResult(requestId, "RETRY_REQUIRED");
  }

  const databaseEntries = Array.isArray(request.manifestEntries)
    ? request.manifestEntries
    : [];
  const retentionBlock = request.companyId
    ? await findActiveCompanyDeletionRetentionBlock(prisma, {
        companyId: request.companyId,
        jobIds: databaseEntries
          .filter((entry) => entry.resourceType === "JOB_POSTING")
          .flatMap((entry) => (entry.recordId ? [entry.recordId] : [])),
        applicationIds: databaseEntries
          .filter((entry) => entry.resourceType === "JOB_APPLICATION")
          .flatMap((entry) => (entry.recordId ? [entry.recordId] : [])),
        threadIds: databaseEntries
          .filter((entry) => entry.resourceType === "RECRUITMENT_THREAD")
          .flatMap((entry) => (entry.recordId ? [entry.recordId] : [])),
        conversationIds: databaseEntries
          .filter((entry) => entry.resourceType === "MESSAGING_CONVERSATION")
          .flatMap((entry) => (entry.recordId ? [entry.recordId] : [])),
        now,
      })
    : null;
  if (retentionBlock) {
    await prisma.companyDeletionManifestEntry.updateMany({
      where: {
        requestId,
        state: { in: ["PENDING", "RETRYABLE"] },
      },
      data: {
        state: "BLOCKED_BY_LEGAL_HOLD",
        outcomeCode: retentionBlock.code,
        lastAttemptAt: now,
      },
    });
    await prisma.companyDeletionRequest.update({
      where: { id: requestId },
      data: {
        state: "BLOCKED_BY_LEGAL_HOLD",
        holdState: "ACTIVE",
        purgeState: "BLOCKED",
        holdEvaluatedAt: now,
        lastFailureCode: retentionBlock.code,
      },
    });
    return emptyPurgeResult(requestId, "BLOCKED_BY_LEGAL_HOLD");
  }

  const entries = await prisma.companyDeletionManifestEntry.findMany({
    where: {
      requestId,
      resourceKind: "OBJECT",
      state: { in: ["PENDING", "RETRYABLE"] },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      objectKeyEncrypted: true,
      objectVersion: true,
    },
  });
  const retainedSharedObjects = await prisma.companyDeletionManifestEntry.count(
    {
      where: {
        requestId,
        resourceKind: "OBJECT",
        state: "RETAINED_SHARED",
      },
    },
  );
  const existingConflicts = await prisma.companyDeletionManifestEntry.count({
    where: {
      requestId,
      resourceKind: "OBJECT",
      state: "CONFLICT",
    },
  });
  if (!entries.length) {
    if (existingConflicts > 0) {
      await prisma.companyDeletionRequest.update({
        where: { id: requestId },
        data: {
          state: "RETRY_REQUIRED",
          purgeState: "RETRYABLE",
          lastFailureCode: "OBJECT_REUSED_AFTER_REQUEST",
        },
      });
      return {
        requestId,
        status: "RETRY_REQUIRED",
        deletedObjects: 0,
        alreadyAbsentObjects: 0,
        retainedSharedObjects,
        retryableObjects: 0,
        conflictingObjects: existingConflicts,
      };
    }
    await prisma.companyDeletionRequest.update({
      where: { id: requestId },
      data: {
        state: "COMPLETED",
        purgeState: "COMPLETE",
        completedAt: now,
        lastFailureCode: null,
      },
    });
    return {
      requestId,
      status: "COMPLETED",
      deletedObjects: 0,
      alreadyAbsentObjects: 0,
      retainedSharedObjects,
      retryableObjects: 0,
      conflictingObjects: 0,
    };
  }

  await prisma.companyDeletionRequest.update({
    where: { id: requestId },
    data: {
      state: "PURGING",
      purgeState: "PENDING",
      physicalPurgeStartedAt: now,
    },
  });

  let storage = input.storage;
  try {
    storage ??= createApplicationDocumentStorage();
    await storage.assertReady();
  } catch (error) {
    const code = failureCode(error);
    await markPendingObjectsRetryable(requestId, now, code);
    return {
      requestId,
      status: "RETRY_REQUIRED",
      deletedObjects: 0,
      alreadyAbsentObjects: 0,
      retainedSharedObjects,
      retryableObjects: entries.length,
      conflictingObjects: 0,
    };
  }

  let deletedObjects = 0;
  let alreadyAbsentObjects = 0;
  let retryableObjects = 0;
  let conflictingObjects = 0;
  for (const entry of entries) {
    const objectKeyEncrypted = entry.objectKeyEncrypted;
    if (!objectKeyEncrypted) {
      retryableObjects++;
      await prisma.companyDeletionManifestEntry.update({
        where: { id: entry.id },
        data: {
          state: "RETRYABLE",
          outcomeCode: "OBJECT_KEY_MISSING",
          attemptCount: { increment: 1 },
          lastAttemptAt: now,
        },
      });
      continue;
    }
    try {
      const outcome = await prisma.$transaction(
        async (transaction) => {
          // The lock and the reference read stay in the same transaction as
          // the storage delete. Reference writers use the same lock, so a
          // writer cannot commit a new live reference between these steps.
          await acquireCompanyDeletionObjectLock(
            transaction,
            objectKeyEncrypted,
          );
          const claimed = await transaction.companyDeletionManifestEntry.updateMany({
            where: {
              id: entry.id,
              resourceKind: "OBJECT",
              state: { in: ["PENDING", "RETRYABLE"] },
              objectKeyEncrypted,
              objectVersion: entry.objectVersion ?? null,
            },
            data: {
              state: "RETRYABLE",
              outcomeCode: "PURGE_CLAIMED",
              attemptCount: { increment: 1 },
              lastAttemptAt: now,
            },
          });
          if (claimed.count !== 1) return { kind: "CLAIM_LOST" } as const;

          if (
            await objectHasNewLiveReference(transaction, objectKeyEncrypted)
          ) {
            await transaction.companyDeletionManifestEntry.update({
              where: { id: entry.id },
              data: {
                state: "CONFLICT",
                outcomeCode: "OBJECT_REUSED_AFTER_REQUEST",
              },
            });
            return { kind: "CONFLICT" } as const;
          }

          try {
            const result = await storage.delete(objectKeyEncrypted);
            const outcomeCode = result.deleted
              ? "OBJECT_DELETED"
              : "OBJECT_ALREADY_ABSENT";
            await transaction.companyDeletionManifestEntry.update({
              where: { id: entry.id },
              data: {
                state: "DELETED",
                outcomeCode,
                deletedAt: now,
              },
            });
            return { kind: "DELETED", deleted: result.deleted } as const;
          } catch (error) {
            await transaction.companyDeletionManifestEntry.update({
              where: { id: entry.id },
              data: { state: "RETRYABLE", outcomeCode: failureCode(error) },
            });
            return { kind: "RETRYABLE" } as const;
          }
        },
        // READ COMMITTED is intentional here: the advisory lock waits for a
        // concurrent reference writer to commit, and the reference query must
        // then use a fresh snapshot that includes that commit.
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
      if (outcome.kind === "CONFLICT") conflictingObjects++;
      else if (outcome.kind === "DELETED") {
        if (outcome.deleted) deletedObjects++;
        else alreadyAbsentObjects++;
      } else if (outcome.kind === "RETRYABLE") retryableObjects++;
    } catch (error) {
      retryableObjects++;
      await prisma.companyDeletionManifestEntry.update({
        where: { id: entry.id },
        data: {
          state: "RETRYABLE",
          outcomeCode: failureCode(error),
          lastAttemptAt: now,
        },
      });
    }
  }

  const remaining = await prisma.companyDeletionManifestEntry.count({
    where: {
      requestId,
      resourceKind: "OBJECT",
      state: { in: ["PENDING", "RETRYABLE"] },
    },
  });
  const retryRequired = remaining > 0 || conflictingObjects > 0;
  await prisma.companyDeletionRequest.update({
    where: { id: requestId },
    data: retryRequired
      ? {
          state: "RETRY_REQUIRED",
          purgeState: "RETRYABLE",
          lastFailureCode:
            conflictingObjects > 0
              ? "OBJECT_REUSED_AFTER_REQUEST"
              : "APPLICATION_STORAGE_DELETE_FAILED",
        }
      : {
          state: "COMPLETED",
          purgeState: "COMPLETE",
          completedAt: now,
          lastFailureCode: null,
        },
  });
  return {
    requestId,
    status: retryRequired ? "RETRY_REQUIRED" : "COMPLETED",
    deletedObjects,
    alreadyAbsentObjects,
    retainedSharedObjects,
    retryableObjects,
    conflictingObjects,
  };
}

export async function runCompanyDeletionManifestReconciliation(
  now = new Date(),
  limit = 50,
  resumeBlockedRequest?: (
    requestId: string,
    now: Date,
  ) => Promise<CompanyDeletionPurgeResult>,
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error("COMPANY_DELETION_BATCH_INVALID");
  const requests = await prisma.companyDeletionRequest.findMany({
    where: {
      retentionEligibleAt: { lte: now },
      state: {
        in: ["BLOCKED_BY_LEGAL_HOLD", "PURGING", "RETRY_REQUIRED"],
      },
    },
    orderBy: [{ retentionEligibleAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true, state: true },
  });
  let completed = 0;
  let retryRequired = 0;
  let blocked = 0;
  for (const request of requests) {
    const result =
      request.state === "BLOCKED_BY_LEGAL_HOLD" && resumeBlockedRequest
        ? await resumeBlockedRequest(request.id, now)
        : await purgeCompanyDeletionRequest(request.id, { now });
    if (result.status === "COMPLETED") completed++;
    else if (result.status === "RETRY_REQUIRED") retryRequired++;
    else if (result.status === "BLOCKED_BY_LEGAL_HOLD") blocked++;
  }
  return {
    claimed: requests.length,
    completed,
    retryRequired,
    blocked,
  };
}

export function companyDeletionManifestProbe() {
  return {
    worker: "company-deletion-manifest-reconciliation",
    legalHoldBlocking: true,
    blockedRequestReevaluation: true,
    objectReferenceConflictCheck: true,
    objectReferenceAtomicClaim: true,
    idempotentMissingObjectOutcome: true,
  } as const;
}
