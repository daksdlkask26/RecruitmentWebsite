import "server-only";

import { prisma } from "@/backend/database/prisma";
import { createCvWorkerStorage } from "@/backend/cv/workers/cv-worker-resources";
import { CvStorageError } from "@/backend/cv/storage/private-cv-storage";
import { teamApplicationCvDeleteAfter } from "@/backend/services/company-members/team-application-retention-policy";

const terminalStatuses = ["REJECTED", "WITHDRAWN", "JOINED"] as const;

const secureArtifactStatuses = [
  "AVAILABLE",
  "DELETE_PENDING",
  "DELETE_FAILED",
] as const;

class TeamCvRetentionError extends Error {
  readonly name = "TeamCvRetentionError";

  constructor(readonly code: string) {
    super(code);
  }
}

function safeFailureCode(error: unknown) {
  if (error instanceof TeamCvRetentionError) return error.code;
  if (error instanceof CvStorageError) return error.code;
  return "TEAM_CV_DELETE_FAILED";
}

type RetentionRow = {
  id: string;
  companyId: string;
  candidateUserId: string;
  cvByteSize: number;
  cvStorageKey: string;
  cvChecksumSha256: string;
  cvSourceArtifactId: string | null;
};

type SecureArtifactRetentionPlan = Readonly<{
  storageLocator: string | null;
  markArtifactDeleted: boolean;
  preservedBecauseReferenced: boolean;
}>;

async function proveSecureArtifactRetentionPlan(
  row: RetentionRow,
): Promise<SecureArtifactRetentionPlan> {
  if (!row.cvSourceArtifactId) {
    return {
      storageLocator: row.cvStorageKey,
      markArtifactDeleted: false,
      preservedBecauseReferenced: false,
    };
  }

  let artifact: {
    id: string;
    uploadId: string;
    accountId: string;
    kind: string;
    status: string;
    storageLocator: string;
    plaintextBytes: number;
    plaintextSha256: Uint8Array;
    contentInaccessibleAt: Date | null;
    deletedAt: Date | null;
    upload: { accountId: string; purpose: string };
    candidateCvs: Array<{ id: string }>;
    applicationDocuments: Array<{ id: string }>;
    teamApplications: Array<{ id: string }>;
  } | null;

  try {
    artifact = await prisma.cvStoredArtifact.findUnique({
      where: { id: row.cvSourceArtifactId },
      select: {
        id: true,
        uploadId: true,
        accountId: true,
        kind: true,
        status: true,
        storageLocator: true,
        plaintextBytes: true,
        plaintextSha256: true,
        contentInaccessibleAt: true,
        deletedAt: true,
        upload: { select: { accountId: true, purpose: true } },
        // Do not delete a source object while any durable projection still
        // points at it. This intentionally counts archived/legacy pointers;
        // reconciliation must clear an inconsistent pointer explicitly.
        candidateCvs: { select: { id: true } },
        applicationDocuments: { select: { id: true } },
        teamApplications: {
          where: { cvDeletedAt: null },
          select: { id: true },
        },
      },
    });
  } catch {
    throw new TeamCvRetentionError(
      "TEAM_CV_RETENTION_RECONCILIATION_UNKNOWN",
    );
  }

  if (!artifact) {
    throw new TeamCvRetentionError("TEAM_CV_RETENTION_ARTIFACT_MISSING");
  }
  if (
    artifact.kind !== "SOURCE_DOCUMENT" ||
    artifact.accountId !== row.candidateUserId ||
    artifact.upload.accountId !== row.candidateUserId ||
    artifact.upload.purpose !== "TEAM_APPLICATION_DIRECT" ||
    artifact.storageLocator !== row.cvStorageKey ||
    artifact.plaintextBytes !== row.cvByteSize ||
    Buffer.from(artifact.plaintextSha256).toString("hex").toLowerCase() !==
      row.cvChecksumSha256.toLowerCase()
  ) {
    throw new TeamCvRetentionError("TEAM_CV_RETENTION_ARTIFACT_MISMATCH");
  }

  if (artifact.deletedAt || artifact.status === "DELETED") {
    return {
      storageLocator: null,
      markArtifactDeleted: false,
      preservedBecauseReferenced: false,
    };
  }
  if (
    !secureArtifactStatuses.includes(
      artifact.status as (typeof secureArtifactStatuses)[number],
    ) ||
    (artifact.status === "AVAILABLE" && artifact.contentInaccessibleAt)
  ) {
    throw new TeamCvRetentionError(
      "TEAM_CV_RETENTION_ARTIFACT_STATE_UNKNOWN",
    );
  }

  const referencedElsewhere =
    artifact.candidateCvs.length > 0 ||
    artifact.applicationDocuments.length > 0 ||
    artifact.teamApplications.some((application) => application.id !== row.id);

  if (referencedElsewhere) {
    return {
      storageLocator: null,
      markArtifactDeleted: false,
      preservedBecauseReferenced: true,
    };
  }

  return {
    storageLocator: artifact.storageLocator,
    markArtifactDeleted: true,
    preservedBecauseReferenced: false,
  };
}

/**
 * Makes expired team invitations terminal for CV-retention purposes and
 * deletes only evidence that is no longer needed. A legacy object is tombstoned
 * after physical deletion, while a secure shared source is retained and only
 * the Team projection is tombstoned. Retries remain safe when a provider or
 * database operation fails halfway through the cycle.
 */
export async function runTeamApplicationRetentionCycle(
  now = new Date(),
  limit = 100,
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error("TEAM_CV_RETENTION_LIMIT_INVALID");
  }

  await prisma.companyInvitation.updateMany({
    where: {
      state: "PENDING",
      expiresAt: { lte: now },
      teamApplication: { is: { status: "INVITATION_SENT" } },
    },
    data: { state: "EXPIRED", version: { increment: 1 } },
  });

  await prisma.teamApplication.updateMany({
    where: {
      status: "INVITATION_SENT",
      cvDeleteAfter: null,
      invitation: {
        is: { state: { in: ["REVOKED", "DECLINED", "EXPIRED"] } },
      },
    },
    data: { cvDeleteAfter: teamApplicationCvDeleteAfter(now) },
  });

  // This also protects against rows created by an older deployment before
  // the transition code started scheduling retention explicitly.
  await prisma.teamApplication.updateMany({
    where: {
      status: { in: [...terminalStatuses] },
      cvDeleteAfter: null,
    },
    data: { cvDeleteAfter: teamApplicationCvDeleteAfter(now) },
  });

  const rows = (await prisma.teamApplication.findMany({
    where: {
      cvDeleteAfter: { lte: now },
      cvDeletedAt: null,
      OR: [
        { status: { in: [...terminalStatuses] } },
        {
          status: "INVITATION_SENT",
          invitation: {
            is: { state: { in: ["REVOKED", "DECLINED", "EXPIRED"] } },
          },
        },
      ],
    },
    orderBy: [{ cvDeleteAfter: "asc" }, { id: "asc" }],
    take: limit,
    select: {
      id: true,
      companyId: true,
      candidateUserId: true,
      cvByteSize: true,
      cvStorageKey: true,
      cvChecksumSha256: true,
      cvSourceArtifactId: true,
    },
  })) as RetentionRow[];

  if (!rows.length) {
    return { scanned: 0, deleted: 0, failed: 0 };
  }

  let storage: ReturnType<typeof createCvWorkerStorage> | null = null;
  const deleteStorage = async (locator: string) => {
    if (!storage) {
      storage = createCvWorkerStorage();
      await storage.assertReady();
    }
    return storage.delete(locator);
  };
  let deleted = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const retentionPlan = await proveSecureArtifactRetentionPlan(row);
      if (retentionPlan.storageLocator) {
        await deleteStorage(retentionPlan.storageLocator);
      }
      await prisma.$transaction(async (tx) => {
        const changed = await tx.teamApplication.updateMany({
          where: { id: row.id, cvDeletedAt: null },
          data: { cvDeletedAt: now, cvDeletionFailureCode: null },
        });
        if (changed.count !== 1) return;
        if (row.cvSourceArtifactId && retentionPlan.markArtifactDeleted) {
          await tx.cvStoredArtifact.updateMany({
            where: {
              id: row.cvSourceArtifactId,
              deletedAt: null,
              status: { in: ["AVAILABLE", "DELETE_PENDING", "DELETE_FAILED"] },
            },
            data: {
              status: "DELETED",
              contentInaccessibleAt: now,
              deletedAt: now,
              deleteAfter: now,
              deleteFailureCode: null,
            },
          });
        }
        await tx.candidateCvArtifactPromotion.updateMany({
          where: {
            scope: "TEAM_APPLICATION",
            targetId: row.id,
            state: { in: ["PROMOTED", "COMMITTED", "DELETE_FAILED"] },
            deletedAt: null,
          },
          data: {
            state: "DELETED",
            deletedAt: now,
            lastSafeFailureCode: null,
            attemptCount: { increment: 1 },
          },
        });
        await tx.auditEvent.create({
          data: {
            actorType: "system",
            action: "team_application.cv_deleted",
            targetType: "team_application",
            targetId: row.id,
            result: "SUCCESS",
            correlationId: row.id,
            occurredAt: now,
            context: {
              companyId: row.companyId,
              cvSourceArtifactId: row.cvSourceArtifactId,
              sourceArtifactPreserved:
                retentionPlan.preservedBecauseReferenced,
            },
          },
        });
      });
      deleted++;
    } catch (error) {
      failed++;
      await prisma.teamApplication
        .updateMany({
          where: { id: row.id, cvDeletedAt: null },
          data: { cvDeletionFailureCode: safeFailureCode(error) },
        })
        .catch(() => undefined);
    }
  }

  return { scanned: rows.length, deleted, failed };
}

export function teamApplicationRetentionProbe() {
  return { worker: "team-application-retention", cleanupEnabled: true };
}
