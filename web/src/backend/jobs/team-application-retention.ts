import "server-only";

import { prisma } from "@/backend/database/prisma";
import { createCvWorkerStorage } from "@/backend/cv/workers/cv-worker-resources";
import { CvStorageError } from "@/backend/cv/storage/private-cv-storage";
import { teamApplicationCvDeleteAfter } from "@/backend/services/company-members/team-application-retention-policy";

const terminalStatuses = ["REJECTED", "WITHDRAWN", "JOINED"] as const;

function safeFailureCode(error: unknown) {
  if (error instanceof CvStorageError) return error.code;
  return "TEAM_CV_DELETE_FAILED";
}

/**
 * Makes expired team invitations terminal for CV-retention purposes and
 * deletes only evidence that is no longer needed. The database tombstone is
 * written after the physical delete, so a retry remains safe when a provider
 * or database operation fails halfway through the cycle.
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

  const rows = await prisma.teamApplication.findMany({
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
    select: { id: true, companyId: true, cvStorageKey: true },
  });

  if (!rows.length) {
    return { scanned: 0, deleted: 0, failed: 0 };
  }

  const storage = createCvWorkerStorage();
  await storage.assertReady();
  let deleted = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await storage.delete(row.cvStorageKey);
      await prisma.$transaction(async (tx) => {
        const changed = await tx.teamApplication.updateMany({
          where: { id: row.id, cvDeletedAt: null },
          data: { cvDeletedAt: now, cvDeletionFailureCode: null },
        });
        if (changed.count !== 1) return;
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
            context: { companyId: row.companyId },
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
