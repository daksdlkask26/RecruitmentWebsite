import "server-only";

import { prisma } from "@/backend/database/prisma";
import { createCvWorkerStorage } from "@/backend/cv/workers/cv-worker-resources";
import {
  CANDIDATE_CV_ARTIFACT_SCOPE,
  markCandidateCvArtifactCommitted,
  markCandidateCvArtifactDeleted,
  markCandidateCvArtifactFailure,
} from "./candidate-cv-artifact-promotion";

const MAX_LIMIT = 1_000;

type CandidateCvArtifactPromotionRow = Readonly<{
  id: string;
  candidateUserId: string;
  scope: "PROFILE_CV" | "TEAM_APPLICATION";
  targetId: string;
  storageKey: string;
  contentDigestSha256: string;
  byteSize: number;
}>;

type TargetRow = Readonly<{
  candidateUserId: string;
  storageKey: string;
  contentDigestSha256: string;
  byteSize: number;
}>;

function matchesTarget(
  row: CandidateCvArtifactPromotionRow,
  target: TargetRow,
) {
  return (
    target.candidateUserId === row.candidateUserId &&
    target.storageKey === row.storageKey &&
    target.contentDigestSha256 === row.contentDigestSha256 &&
    target.byteSize === row.byteSize
  );
}

async function markUnknown(id: string, code: string) {
  await markCandidateCvArtifactFailure(id, code).catch(() => undefined);
}

/**
 * Reconciles Profile CV and Team Application CV artifacts staged before their
 * target transaction. A target is claimed only when owner, locator, length and
 * plaintext digest all agree. Missing or conflicting targets are retained for
 * investigation unless the staged row has aged beyond the orphan deadline and
 * no other durable target references the locator.
 */
export async function runCandidateCvArtifactReconciliationCycle(
  now = new Date(),
  limit = 100,
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error("CANDIDATE_CV_ARTIFACT_RECONCILIATION_LIMIT_INVALID");
  }

  const rows = await prisma.candidateCvArtifactPromotion.findMany({
    where: {
      state: { in: ["PROMOTED", "DELETE_FAILED"] },
      orphanDeleteAfter: { lte: now },
      deletedAt: null,
    },
    orderBy: [{ orphanDeleteAfter: "asc" }, { id: "asc" }],
    take: limit,
    select: {
      id: true,
      candidateUserId: true,
      scope: true,
      targetId: true,
      storageKey: true,
      contentDigestSha256: true,
      byteSize: true,
    },
  });
  if (!rows.length) return { scanned: 0, committed: 0, deleted: 0, failed: 0 };

  const storage = createCvWorkerStorage();
  await storage.assertReady();
  let committed = 0;
  let deleted = 0;
  let failed = 0;

  for (const row of rows as CandidateCvArtifactPromotionRow[]) {
    try {
      const target =
        row.scope === CANDIDATE_CV_ARTIFACT_SCOPE.PROFILE_CV
          ? await prisma.candidateCv.findUnique({
              where: { id: row.targetId },
              select: {
                candidateUserId: true,
                storageKey: true,
                checksumSha256: true,
                byteSize: true,
              },
            }).then((value) =>
              value
                ? {
                    candidateUserId: value.candidateUserId,
                    storageKey: value.storageKey,
                    contentDigestSha256: value.checksumSha256,
                    byteSize: value.byteSize,
                  }
                : null,
            )
          : await prisma.teamApplication.findUnique({
              where: { id: row.targetId },
              select: {
                candidateUserId: true,
                cvStorageKey: true,
                cvChecksumSha256: true,
                cvByteSize: true,
              },
            }).then((value) =>
              value
                ? {
                    candidateUserId: value.candidateUserId,
                    storageKey: value.cvStorageKey,
                    contentDigestSha256: value.cvChecksumSha256,
                    byteSize: value.cvByteSize,
                  }
                : null,
            );

      if (target) {
        if (matchesTarget(row, target)) {
          await markCandidateCvArtifactCommitted(row.id);
          committed++;
        } else {
          await markUnknown(row.id, "CANDIDATE_CV_ARTIFACT_DIGEST_MISMATCH");
          failed++;
        }
        continue;
      }

      // A missing target can be a rolled-back transaction. Before deleting,
      // detect a locator reused by a different target and preserve it as a
      // conflict instead of deleting another candidate's bytes.
      const [profilePeer, teamPeer] = await Promise.all([
        prisma.candidateCv.findFirst({
          where: { storageKey: row.storageKey },
          select: { id: true },
        }),
        prisma.teamApplication.findFirst({
          where: { cvStorageKey: row.storageKey },
          select: { id: true },
        }),
      ]);
      if (profilePeer || teamPeer) {
        await markUnknown(row.id, "CANDIDATE_CV_ARTIFACT_LOCATOR_CONFLICT");
        failed++;
        continue;
      }

      await storage.delete(row.storageKey);
      await markCandidateCvArtifactDeleted(row.id, now);
      deleted++;
    } catch {
      failed++;
      await markUnknown(row.id, "CANDIDATE_CV_ARTIFACT_RECONCILIATION_UNKNOWN");
    }
  }

  return { scanned: rows.length, committed, deleted, failed };
}

export function candidateCvArtifactReconciliationProbe() {
  return {
    worker: "candidate-cv-artifact-reconciliation",
    cleanupEnabled: true,
    digestRequired: true,
  } as const;
}
