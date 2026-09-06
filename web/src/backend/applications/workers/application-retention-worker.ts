import "server-only";

import { prisma } from "@/backend/database/prisma";
import { createApplicationDocumentStorage } from "../storage/factory";

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
const ORPHAN_DEADLINE = 24 * 60 * 60 * 1000;

type PromotionRow = Readonly<{
  id: string;
  candidateUserId: string;
  jobPostingId: string;
  jobApplicationId: string | null;
  storageKeyEncrypted: string;
  contentDigestSha256: string | null;
}>;

async function markPromotionUnknown(
  id: string,
  code: string,
) {
  await prisma.applicationArtifactPromotion
    .update({
      where: { id },
      data: {
        state: "DELETE_FAILED",
        attemptCount: { increment: 1 },
        lastSafeFailureCode: code,
      },
    })
    .catch(() => undefined);
}

async function reconcileOrphanPromotion(
  orphan: PromotionRow,
  now: Date,
  storage: ReturnType<typeof createApplicationDocumentStorage>,
) {
  // A promotion row can be left in PROMOTED when the application transaction
  // committed but the acknowledgement was lost. Prove ownership from the
  // durable application row before considering deletion.
  if (orphan.jobApplicationId) {
    let application: {
      id: string;
      applicationDocuments: Array<{ contentDigestHmac: string }>;
    } | null;
    try {
      application = await prisma.jobApplication.findFirst({
        where: {
          id: orphan.jobApplicationId,
          candidateUserId: orphan.candidateUserId,
          jobPostingId: orphan.jobPostingId,
        },
        select: {
          id: true,
          applicationDocuments: {
            where: {
              storageKeyEncrypted: orphan.storageKeyEncrypted,
              deletedAt: null,
            },
            select: { contentDigestHmac: true },
          },
        },
      });
    } catch {
      await markPromotionUnknown(
        orphan.id,
        "APPLICATION_ARTIFACT_RECONCILIATION_UNKNOWN",
      );
      return "PRESERVED" as const;
    }
    if (application) {
      const document = application.applicationDocuments[0];
      if (!document) {
        await markPromotionUnknown(
          orphan.id,
          "APPLICATION_ARTIFACT_DOCUMENT_MISSING",
        );
        return "PRESERVED" as const;
      }
      if (
        !orphan.contentDigestSha256 ||
        document.contentDigestHmac !== orphan.contentDigestSha256
      ) {
        await markPromotionUnknown(
          orphan.id,
          "APPLICATION_ARTIFACT_DIGEST_MISMATCH",
        );
        return "PRESERVED" as const;
      }
      await prisma.applicationArtifactPromotion.update({
        where: { id: orphan.id },
        data: {
          state: "COMMITTED",
          lastSafeFailureCode: null,
        },
      });
      return "COMMITTED" as const;
    }
  }

  let linkedDocument: {
    jobApplicationId: string;
    application: { candidateUserId: string; jobPostingId: string };
    contentDigestHmac: string;
  } | null;
  try {
    linkedDocument = await prisma.applicationDocument.findFirst({
      where: {
        storageKeyEncrypted: orphan.storageKeyEncrypted,
        deletedAt: null,
      },
      select: {
        jobApplicationId: true,
        contentDigestHmac: true,
        application: { select: { candidateUserId: true, jobPostingId: true } },
      },
    });
  } catch {
    await markPromotionUnknown(
      orphan.id,
      "APPLICATION_ARTIFACT_RECONCILIATION_UNKNOWN",
    );
    return "PRESERVED" as const;
  }
  if (linkedDocument) {
    const sameScope =
      linkedDocument.application.candidateUserId === orphan.candidateUserId &&
      linkedDocument.application.jobPostingId === orphan.jobPostingId;
    if (sameScope && orphan.contentDigestSha256 === linkedDocument.contentDigestHmac) {
      await prisma.applicationArtifactPromotion.update({
        where: { id: orphan.id },
        data: {
          state: "COMMITTED",
          jobApplicationId: linkedDocument.jobApplicationId,
          lastSafeFailureCode: null,
        },
      });
      return "COMMITTED" as const;
    }
    if (sameScope) {
      await markPromotionUnknown(
        orphan.id,
        "APPLICATION_ARTIFACT_DIGEST_MISMATCH",
      );
      return "PRESERVED" as const;
    }
    await markPromotionUnknown(
      orphan.id,
      "APPLICATION_ARTIFACT_LOCATOR_CONFLICT",
    );
    return "PRESERVED" as const;
  }

  await storage.delete(orphan.storageKeyEncrypted);
  await prisma.applicationArtifactPromotion.update({
    where: { id: orphan.id },
    data: {
      state: "DELETED",
      deletedAt: now,
      lastSafeFailureCode: null,
      attemptCount: { increment: 1 },
    },
  });
  return "DELETED" as const;
}

export async function runApplicationRetentionCycle(
  now = new Date(),
  limit = 100,
) {
  const storage = createApplicationDocumentStorage();
  await storage.assertReady();

  await prisma.jobApplication.updateMany({
    where: {
      documentAccessDeniedAt: null,
      documentRetentionDueAt: { lte: now },
    },
    data: {
      documentAccessDeniedAt: now,
      documentDeletionDueAt: new Date(now.getTime() + THIRTY_DAYS),
    },
  });
  await prisma.jobApplication.updateMany({
    where: {
      profileSnapshotAccessDeniedAt: null,
      profileSnapshotReviewDueAt: { lte: now },
      legalHolds: { none: { releasedAt: null, OR: [{ endsAt: null }, { endsAt: { gt: now } }] } },
    },
    data: { profileSnapshotAccessDeniedAt: now },
  });
  await prisma.applicationDocument.updateMany({
    where: {
      ordinaryAccessDeniedAt: null,
      application: { documentAccessDeniedAt: { lte: now } },
    },
    data: {
      ordinaryAccessDeniedAt: now,
      deleteAfter: new Date(now.getTime() + THIRTY_DAYS),
    },
  });

  const documents = await prisma.applicationDocument.findMany({
    where: { deleteAfter: { lte: now }, deletedAt: null },
    orderBy: [{ deleteAfter: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true, jobApplicationId: true, storageKeyEncrypted: true },
  });
  let deleted = 0;
  for (const document of documents) {
    try {
      await storage.delete(document.storageKeyEncrypted);
      await prisma.applicationDocument.update({
        where: { id: document.id },
        data: { deletedAt: now },
      });
      const remaining = await prisma.applicationDocument.count({
        where: { jobApplicationId: document.jobApplicationId, deletedAt: null },
      });
      if (remaining === 0) {
        await prisma.jobApplication.update({
          where: { id: document.jobApplicationId },
          data: { documentDeletedAt: now },
        });
      }
      deleted++;
    } catch {
      await prisma.applicationDocument.update({
        where: { id: document.id },
        data: { ordinaryAccessDeniedAt: { set: now } },
      }).catch(() => undefined);
    }
  }

  const textRows = await prisma.applicationCoverLetterText.findMany({
    where: {
      deletedAt: null,
      OR: [
        { deleteAfter: { lte: now } },
        { application: { documentAccessDeniedAt: { lte: now } } },
      ],
    },
    select: { jobApplicationId: true },
    take: limit,
  });
  if (textRows.length) {
    await prisma.applicationCoverLetterText.updateMany({
      where: { jobApplicationId: { in: textRows.map((row) => row.jobApplicationId) } },
      data: { deletedAt: now, deleteAfter: now },
    });
  }

  const orphanRows = await prisma.applicationArtifactPromotion.findMany({
    where: {
      state: { in: ["PROMOTED", "DELETE_PENDING", "DELETE_FAILED"] },
      orphanDeleteAfter: { lte: now },
      deletedAt: null,
    },
    orderBy: [{ orphanDeleteAfter: "asc" }, { id: "asc" }],
    take: limit,
    select: {
      id: true,
      candidateUserId: true,
      jobPostingId: true,
      jobApplicationId: true,
      storageKeyEncrypted: true,
      contentDigestSha256: true,
    },
  });
  let orphansDeleted = 0;
  for (const orphan of orphanRows) {
    try {
      const outcome = await reconcileOrphanPromotion(orphan, now, storage);
      if (outcome === "DELETED") orphansDeleted++;
    } catch {
      await markPromotionUnknown(
        orphan.id,
        "APPLICATION_STORAGE_DELETE_FAILED",
      );
    }
  }
  return { claimed: documents.length, deleted, orphans: orphanRows.length, orphansDeleted };
}

export async function applicationRetentionProbe() {
  return { worker: "application-retention", orphanDeadlineHours: ORPHAN_DEADLINE / 3_600_000, cleanupEnabled: true };
}
