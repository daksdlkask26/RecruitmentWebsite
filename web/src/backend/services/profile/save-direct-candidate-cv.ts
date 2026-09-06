import "server-only";

import { prisma } from "@/backend/database/prisma";
import { candidateCvSummarySchema } from "@/shared/contracts/cv-import/candidate-cv";
import type { PreparedDirectApplicationCv } from "../jobs/prepare-direct-application-cv";
import {
  CANDIDATE_CV_ARTIFACT_SCOPE,
  markCandidateCvArtifactCommitted,
  markCandidateCvArtifactDeleted,
  markCandidateCvArtifactFailure,
  stageCandidateCvArtifact,
} from "@/backend/cv/candidate-cv-artifact-promotion";

export async function saveDirectCandidateCv(
  candidateUserId: string,
  prepared: PreparedDirectApplicationCv,
  occurredAt = new Date(),
) {
  let promotionId: string;
  try {
    promotionId = await stageCandidateCvArtifact({
      candidateUserId,
      scope: CANDIDATE_CV_ARTIFACT_SCOPE.PROFILE_CV,
      targetId: prepared.id,
      storageKey: prepared.storageKey,
      contentDigestSha256: prepared.checksumSha256,
      byteSize: prepared.byteSize,
      occurredAt,
    });
  } catch (error) {
    prepared.preserveOnUnknown();
    throw error;
  }

  // The promotion row is the durable owner of the yet-to-be-written object.
  // Complete the storage write only after that row exists, so a ledger outage
  // cannot leave an untracked profile CV behind.
  try {
    await prepared.ensureStored?.();
  } catch (error) {
    prepared.preserveOnUnknown();
    await markCandidateCvArtifactFailure(
      promotionId,
      "CANDIDATE_CV_ARTIFACT_STORAGE_WRITE_UNKNOWN",
    );
    throw error;
  }

  let row: Awaited<ReturnType<typeof prisma.candidateCv.create>>;
  try {
    row = await prisma.candidateCv.create({
      data: {
        id: prepared.id,
        candidateUserId,
        displayName: prepared.displayName,
        fileName: prepared.fileName,
        mimeType: prepared.mimeType,
        byteSize: prepared.byteSize,
        storageKey: prepared.storageKey,
        checksumSha256: prepared.checksumSha256,
        version: 1,
        confirmedAt: occurredAt,
      },
    });
  } catch (error) {
    // A failed write does not prove that the database rolled back.  Check the
    // durable row and keep the object when the outcome is committed or
    // indeterminate; only a successful absence check authorizes cleanup.
    try {
      const existing = await prisma.candidateCv.findUnique({
        where: { id: prepared.id },
        select: {
          candidateUserId: true,
          storageKey: true,
          checksumSha256: true,
          byteSize: true,
        },
      });
      if (
        existing?.candidateUserId === candidateUserId &&
        existing.storageKey === prepared.storageKey &&
        existing.checksumSha256 === prepared.checksumSha256 &&
        existing.byteSize === prepared.byteSize
      ) {
        prepared.claimOwnership();
        await markCandidateCvArtifactCommitted(promotionId).catch(() => {
          prepared.preserveOnUnknown();
        });
      } else if (!existing) {
        try {
          await prepared.cleanup();
          await markCandidateCvArtifactDeleted(promotionId, occurredAt);
        } catch {
          prepared.preserveOnUnknown();
          await markCandidateCvArtifactFailure(
            promotionId,
            "CANDIDATE_CV_ARTIFACT_CLEANUP_FAILED",
          );
        }
      } else {
        prepared.preserveOnUnknown();
        await markCandidateCvArtifactFailure(
          promotionId,
          "CANDIDATE_CV_ARTIFACT_TARGET_CONFLICT",
        );
      }
    } catch {
      prepared.preserveOnUnknown();
    }
    throw error;
  }

  // The target row now owns the bytes. Claim before the projection and ledger
  // acknowledgement so a response/serialization error cannot trigger cleanup.
  prepared.claimOwnership();
  try {
    await markCandidateCvArtifactCommitted(promotionId);
  } catch (error) {
    prepared.preserveOnUnknown();
    throw error;
  }
  return candidateCvSummarySchema.parse({
    id: row.id,
    displayName: row.displayName,
    fileName: row.fileName,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    version: row.version,
    confirmedAt: row.confirmedAt?.toISOString(),
  });
}
