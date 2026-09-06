import "server-only";

import { createHash } from "node:crypto";
import { prisma } from "@/backend/database/prisma";

const DAY_MS = 24 * 60 * 60 * 1000;

export const CANDIDATE_CV_ARTIFACT_SCOPE = {
  PROFILE_CV: "PROFILE_CV",
  TEAM_APPLICATION: "TEAM_APPLICATION",
} as const;

export type CandidateCvArtifactScope =
  (typeof CANDIDATE_CV_ARTIFACT_SCOPE)[keyof typeof CANDIDATE_CV_ARTIFACT_SCOPE];

type PromotionIdentity = Readonly<{
  id: string;
  candidateUserId: string;
  scope: CandidateCvArtifactScope;
  targetId: string;
  storageKey: string;
  contentDigestSha256: string;
  byteSize: number;
}>;

function promotionId(scope: CandidateCvArtifactScope, targetId: string) {
  const suffix = createHash("sha256")
    .update(`${scope}:${targetId}`, "utf8")
    .digest("hex")
    .slice(0, 40);
  return `candidate-cv-artifact-${suffix}`;
}

function assertDigest(value: string) {
  if (!/^[a-f0-9]{64}$/iu.test(value)) {
    throw new Error("CANDIDATE_CV_ARTIFACT_DIGEST_INVALID");
  }
  return value.toLowerCase();
}

function samePromotion(
  row: Readonly<{
    candidateUserId: string;
    scope: CandidateCvArtifactScope;
    targetId: string;
    storageKey: string;
    contentDigestSha256: string;
    byteSize: number;
  }>,
  input: PromotionIdentity,
) {
  return (
    row.candidateUserId === input.candidateUserId &&
    row.scope === input.scope &&
    row.targetId === input.targetId &&
    row.storageKey === input.storageKey &&
    row.contentDigestSha256.toLowerCase() === input.contentDigestSha256 &&
    row.byteSize === input.byteSize
  );
}

/**
 * Records ownership before the target transaction starts. The id is derived
 * from scope and target so a retry can safely observe an already-written row
 * after a connection error instead of creating a second ledger entry.
 */
export async function stageCandidateCvArtifact(
  input: Omit<PromotionIdentity, "id"> & { occurredAt: Date },
  db: typeof prisma = prisma,
) {
  const identity: PromotionIdentity = {
    ...input,
    id: promotionId(input.scope, input.targetId),
    contentDigestSha256: assertDigest(input.contentDigestSha256),
  };
  const data = {
    id: identity.id,
    candidateUserId: identity.candidateUserId,
    scope: identity.scope,
    targetId: identity.targetId,
    storageKey: identity.storageKey,
    contentDigestSha256: identity.contentDigestSha256,
    byteSize: identity.byteSize,
    state: "PROMOTED" as const,
    orphanDeleteAfter: new Date(input.occurredAt.getTime() + DAY_MS),
  };
  try {
    await db.candidateCvArtifactPromotion.create({ data });
  } catch (error) {
    // A unique violation or an acknowledged timeout may mean that the row was
    // committed. Verify the complete identity before treating the stage as a
    // successful idempotent replay; a locator collision is never merged.
    try {
      const existing = await db.candidateCvArtifactPromotion.findUnique({
        where: { id: identity.id },
        select: {
          candidateUserId: true,
          scope: true,
          targetId: true,
          storageKey: true,
          contentDigestSha256: true,
          byteSize: true,
        },
      });
      if (existing && samePromotion(existing, identity)) return identity.id;
      if (existing) {
        throw new Error("CANDIDATE_CV_ARTIFACT_LEDGER_CONFLICT", { cause: error });
      }
    } catch (probeError) {
      if (probeError instanceof Error && probeError.message.includes("CONFLICT")) {
        throw probeError;
      }
      // The original write error is more useful to callers and preserves the
      // UNKNOWN ownership path when the database cannot be read.
    }
    throw error;
  }
  return identity.id;
}

export async function markCandidateCvArtifactCommitted(
  promotionIdValue: string,
  db: typeof prisma = prisma,
) {
  const changed = await db.candidateCvArtifactPromotion.updateMany({
    where: {
      id: promotionIdValue,
      state: { in: ["PROMOTED", "COMMITTED", "DELETE_FAILED"] },
      deletedAt: null,
    },
    data: { state: "COMMITTED", lastSafeFailureCode: null },
  });
  if (changed.count === 1) return;
  const existing = await db.candidateCvArtifactPromotion.findUnique({
    where: { id: promotionIdValue },
    select: { state: true, deletedAt: true },
  });
  if (existing?.state === "COMMITTED" && !existing.deletedAt) return;
  throw new Error("CANDIDATE_CV_ARTIFACT_LEDGER_COMMIT_CONFLICT");
}

export async function markCandidateCvArtifactDeleted(
  promotionIdValue: string,
  occurredAt: Date,
  db: typeof prisma = prisma,
) {
  const changed = await db.candidateCvArtifactPromotion.updateMany({
    where: {
      id: promotionIdValue,
      state: { in: ["PROMOTED", "DELETE_FAILED"] },
      deletedAt: null,
    },
    data: {
      state: "DELETED",
      deletedAt: occurredAt,
      lastSafeFailureCode: null,
      attemptCount: { increment: 1 },
    },
  });
  if (changed.count === 1) return;
  const existing = await db.candidateCvArtifactPromotion.findUnique({
    where: { id: promotionIdValue },
    select: { state: true, deletedAt: true },
  });
  if (existing?.state === "DELETED" && existing.deletedAt) return;
  throw new Error("CANDIDATE_CV_ARTIFACT_LEDGER_DELETE_CONFLICT");
}

export async function markCandidateCvArtifactFailure(
  promotionIdValue: string,
  code: string,
  db: typeof prisma = prisma,
) {
  await db.candidateCvArtifactPromotion
    .updateMany({
      where: { id: promotionIdValue, deletedAt: null },
      data: {
        state: "DELETE_FAILED",
        attemptCount: { increment: 1 },
        lastSafeFailureCode: code,
      },
    })
    .catch(() => undefined);
}

export const candidateCvArtifactPromotionRetentionMs = DAY_MS;
