import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { prisma } from "@/backend/database/prisma";
import type { Prisma } from "@/backend/generated/prisma/client";
import { CV_SECURITY_POLICY_VERSION } from "@/shared/contracts/cv-import/common";

export type CvWorkStage = "SCAN" | "EXTRACTION" | "PARSE" | "DELETE";
export type CvProcessingWorkStage = Exclude<CvWorkStage, "DELETE">;

export type CvWorkClaim = Readonly<{
  id: string;
  uploadId: string;
  accountId: string;
  attemptNumber: number;
  leaseOwner: string;
  leaseExpiresAt: Date;
}>;

type ClaimInput = Readonly<{
  stage: CvWorkStage;
  owner: string;
  now: Date;
  limit: number;
  leaseMs: number;
}>;

type FinalizeInput = Readonly<{
  stage: CvWorkStage;
  id: string;
  owner: string;
  status: string;
  failureCode?: string;
  now: Date;
}>;

export type CvStageResultCommitGuard = Readonly<{
  stage: CvProcessingWorkStage;
  id: string;
  uploadId: string;
  accountId: string;
  owner: string;
  now: Date;
}>;

type CvWorkDatabase = Pick<Prisma.TransactionClient, "$queryRaw">;

const AUTOMATIC_ATTEMPT_LIMIT = 3;
const SECOND_ATTEMPT_BACKOFF_MS = 2_000;
const THIRD_ATTEMPT_BACKOFF_MS = 5_000;
const SCAN_AUTOMATIC_CYCLE_LIMIT_MS = 5 * 60_000;
const SCAN_ATTEMPT_COMPLETION_MARGIN_MS = 30_000;

function assertStageResultGuardInput(input: CvStageResultCommitGuard): void {
  if (
    !input.id ||
    !input.uploadId ||
    !input.accountId ||
    !input.owner ||
    input.id.length > 512 ||
    input.uploadId.length > 512 ||
    input.accountId.length > 512 ||
    input.owner.length > 512 ||
    Number.isNaN(input.now.getTime())
  ) {
    throw new Error("CV_STAGE_RESULT_GUARD_INVALID");
  }
}

/**
 * Locks and revalidates every authority needed to commit a processing result.
 * Callers that persist content pass their transaction so cancellation, expiry,
 * account deactivation, lease recovery, and cleanup cannot race the commit.
 */
export async function assertCvStageResultCommitAllowed(
  database: CvWorkDatabase,
  input: CvStageResultCommitGuard,
): Promise<void> {
  assertStageResultGuardInput(input);
  let rows: readonly Readonly<{ id: string }>[];
  if (input.stage === "SCAN") {
    rows = await database.$queryRaw<Array<{ id: string }>>`
      SELECT work."id"
        FROM "CvScanAssessment" work
        JOIN "CvUpload" upload ON upload."id" = work."uploadId"
        JOIN "user" account ON account."id" = upload."accountId"
        JOIN "CvStoredArtifact" source ON source."id" = work."sourceArtifactId"
       WHERE work."id" = ${input.id}
         AND work."uploadId" = ${input.uploadId}
         AND work."accountId" = ${input.accountId}
         AND work."status" = 'PROCESSING'
         AND work."leaseOwner" = ${input.owner}
         AND work."leaseExpiresAt" > ${input.now}
         AND upload."accountId" = ${input.accountId}
         AND upload."status" IN ('VALIDATION_QUEUED', 'SCAN_QUEUED', 'SCANNING')
         AND upload."expiresAt" > ${input.now}
         AND upload."contentInaccessibleAt" IS NULL
         AND upload."deletedAt" IS NULL
         AND account."state" = 'ACTIVE'
         AND account."deletedAt" IS NULL
         AND source."accountId" = ${input.accountId}
         AND source."uploadId" = ${input.uploadId}
         AND source."kind" = 'SOURCE_DOCUMENT'
         AND source."status" IN ('QUARANTINED', 'AVAILABLE')
         AND source."contentInaccessibleAt" IS NULL
         AND source."deletedAt" IS NULL
       FOR UPDATE OF work, upload, account, source
    `;
  } else if (input.stage === "EXTRACTION") {
    rows = await database.$queryRaw<Array<{ id: string }>>`
      SELECT work."id"
        FROM "CvExtraction" work
        JOIN "CvUpload" upload ON upload."id" = work."uploadId"
        JOIN "user" account ON account."id" = upload."accountId"
        JOIN "CvScanAssessment" scan ON scan."id" = work."scanAssessmentId"
        JOIN "CvStoredArtifact" source ON source."id" = work."sourceArtifactId"
       WHERE work."id" = ${input.id}
         AND work."uploadId" = ${input.uploadId}
         AND work."accountId" = ${input.accountId}
         AND work."status" = 'PROCESSING'
         AND work."leaseOwner" = ${input.owner}
         AND work."leaseExpiresAt" > ${input.now}
         AND upload."accountId" = ${input.accountId}
         AND upload."purpose" = 'PROFILE_IMPORT'
         AND upload."processingMode" = 'IMPORT_AND_PARSE'
         AND upload."policyVersion" = ${CV_SECURITY_POLICY_VERSION}
         AND upload."status" IN ('EXTRACTION_QUEUED', 'EXTRACTING')
         AND upload."expiresAt" > ${input.now}
         AND upload."contentInaccessibleAt" IS NULL
         AND upload."deletedAt" IS NULL
         AND account."state" = 'ACTIVE'
         AND account."deletedAt" IS NULL
         AND scan."status" = 'CLEAN'
         AND scan."completedAt" IS NOT NULL
         AND scan."policyVersion" = ${CV_SECURITY_POLICY_VERSION}
         AND scan."sourceArtifactId" = source."id"
         AND source."accountId" = ${input.accountId}
         AND source."uploadId" = ${input.uploadId}
         AND source."kind" = 'SOURCE_DOCUMENT'
         AND source."status" = 'AVAILABLE'
         AND source."contentInaccessibleAt" IS NULL
         AND source."deletedAt" IS NULL
       FOR UPDATE OF work, upload, account, scan, source
    `;
  } else {
    rows = await database.$queryRaw<Array<{ id: string }>>`
      SELECT work."id"
        FROM "CvParseJob" work
        JOIN "CvUpload" upload ON upload."id" = work."uploadId"
        JOIN "user" account ON account."id" = upload."accountId"
        JOIN "CvExtraction" extraction ON extraction."id" = work."extractionId"
        JOIN "CvStoredArtifact" output ON output."id" = extraction."outputArtifactId"
       WHERE work."id" = ${input.id}
         AND work."uploadId" = ${input.uploadId}
         AND work."accountId" = ${input.accountId}
         AND work."status" = 'PROCESSING'
         AND work."leaseOwner" = ${input.owner}
         AND work."leaseExpiresAt" > ${input.now}
         AND upload."accountId" = ${input.accountId}
         AND upload."policyVersion" = ${CV_SECURITY_POLICY_VERSION}
         AND upload."status" IN ('PARSE_QUEUED', 'PARSING')
         AND upload."expiresAt" > ${input.now}
         AND upload."contentInaccessibleAt" IS NULL
         AND upload."deletedAt" IS NULL
         AND account."state" = 'ACTIVE'
         AND account."deletedAt" IS NULL
         AND extraction."status" = 'SUCCEEDED'
         AND extraction."accountId" = ${input.accountId}
         AND extraction."uploadId" = ${input.uploadId}
         AND output."accountId" = ${input.accountId}
         AND output."uploadId" = ${input.uploadId}
         AND output."kind" = 'EXTRACTED_TEXT'
         AND output."status" = 'AVAILABLE'
         AND output."contentInaccessibleAt" IS NULL
         AND output."deletedAt" IS NULL
       FOR UPDATE OF work, upload, account, extraction, output
    `;
  }
  if (!rows[0]) throw new Error("CV_STAGE_RESULT_DISCARDED");
}

function workerAuditId(namespace: string, stage: string, workId: string) {
  const digest = createHash("sha256")
    .update(`smarthire:cv-worker:${namespace}:v1\0`, "utf8")
    .update(stage, "utf8")
    .update("\0", "utf8")
    .update(workId, "utf8")
    .digest("hex")
    .slice(0, 40);
  return `cvw_${digest}`;
}

async function appendWorkerStageAudit(
  transaction: Prisma.TransactionClient,
  input: {
    namespace: "finalize" | "automatic-retry";
    stage: CvWorkStage;
    workId: string;
    uploadId: string;
    state: string;
    failureCode?: string;
    now: Date;
  },
) {
  await transaction.auditEvent.createMany({
    data: [
      {
        id: workerAuditId(input.namespace, input.stage, input.workId),
        occurredAt: input.now,
        actorType: "system",
        action: "cv_import.stage_completed",
        targetType: "cv_import",
        targetId: input.uploadId,
        result: input.failureCode ? "FAILURE" : "SUCCESS",
        correlationId: workerAuditId(
          `${input.namespace}-correlation`,
          input.stage,
          input.workId,
        ),
        context: {
          stage: input.stage,
          state: input.state,
          ...(input.failureCode ? { failureCode: input.failureCode } : {}),
        },
      },
    ],
    skipDuplicates: true,
  });
}

async function finalizedWorkUploadId(
  transaction: Prisma.TransactionClient,
  stage: CvWorkStage,
  id: string,
): Promise<string> {
  let rows: readonly Readonly<{ uploadId: string }>[];
  if (stage === "PARSE") {
    rows = await transaction.$queryRaw<Array<{ uploadId: string }>>`
      SELECT "uploadId" FROM "CvParseJob" WHERE "id" = ${id} LIMIT 1
    `;
  } else if (stage === "SCAN") {
    rows = await transaction.$queryRaw<Array<{ uploadId: string }>>`
      SELECT "uploadId" FROM "CvScanAssessment" WHERE "id" = ${id} LIMIT 1
    `;
  } else if (stage === "EXTRACTION") {
    rows = await transaction.$queryRaw<Array<{ uploadId: string }>>`
      SELECT "uploadId" FROM "CvExtraction" WHERE "id" = ${id} LIMIT 1
    `;
  } else {
    rows = await transaction.$queryRaw<Array<{ uploadId: string }>>`
      SELECT "uploadId" FROM "CvStoredArtifact" WHERE "id" = ${id} LIMIT 1
    `;
  }
  const uploadId = rows[0]?.uploadId;
  if (!uploadId) throw new Error("CV_FINALIZED_WORK_NOT_FOUND");
  return uploadId;
}

function assertRetryInput(input: {
  uploadId: string;
  priorAttemptId: string;
  now: Date;
}): void {
  if (
    !input.uploadId ||
    input.uploadId.length > 80 ||
    !input.priorAttemptId ||
    input.priorAttemptId.length > 80 ||
    Number.isNaN(input.now.getTime())
  ) {
    throw new Error("CV_AUTOMATIC_RETRY_INPUT_INVALID");
  }
}

function automaticBackoffMs(priorAttemptNumber: number): number {
  return priorAttemptNumber === 1
    ? SECOND_ATTEMPT_BACKOFF_MS
    : THIRD_ATTEMPT_BACKOFF_MS;
}

function assertBackoffElapsed(
  completedAt: Date | null,
  priorAttemptNumber: number,
  now: Date,
): void {
  if (!completedAt) throw new Error("CV_AUTOMATIC_RETRY_STATE_INVALID");
  if (
    now.getTime() <
    completedAt.getTime() + automaticBackoffMs(priorAttemptNumber)
  ) {
    throw new Error("CV_RETRY_BACKOFF_PENDING");
  }
}

function assertClaimInput(input: ClaimInput): void {
  if (
    !input.owner ||
    input.owner.length > 200 ||
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 100 ||
    !Number.isSafeInteger(input.leaseMs) ||
    input.leaseMs < 1_000 ||
    input.leaseMs > 15 * 60_000 ||
    Number.isNaN(input.now.getTime())
  ) {
    throw new Error("CV_WORK_CLAIM_INVALID");
  }
}

export class PrismaCvWorkRepository {
  async assertStageResultCommitAllowed(
    input: CvStageResultCommitGuard,
  ): Promise<void> {
    await assertCvStageResultCommitAllowed(prisma, input);
  }

  async claimStage(input: ClaimInput): Promise<readonly CvWorkClaim[]> {
    assertClaimInput(input);
    const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs);
    if (input.stage === "PARSE") {
      return prisma.$queryRaw<CvWorkClaim[]>`
        WITH claimable AS (
          SELECT job."id"
            FROM "CvParseJob" job
           WHERE (job."status" = 'QUEUED' AND job."createdAt" <= ${input.now})
              OR (job."status" = 'PROCESSING' AND job."leaseExpiresAt" <= ${input.now})
           ORDER BY job."createdAt", job."id"
           FOR UPDATE SKIP LOCKED
           LIMIT ${input.limit}
        )
        UPDATE "CvParseJob" job
           SET "status" = 'PROCESSING',
               "leaseOwner" = ${input.owner},
               "leaseExpiresAt" = ${leaseExpiresAt},
               "startedAt" = COALESCE(job."startedAt", ${input.now})
          FROM claimable
         WHERE job."id" = claimable."id"
        RETURNING job."id", job."uploadId", job."accountId", job."attemptNumber",
                  job."leaseOwner", job."leaseExpiresAt"
      `;
    }
    if (input.stage === "SCAN") {
      return prisma.$queryRaw<CvWorkClaim[]>`
        WITH claimable AS (
          SELECT work."id"
            FROM "CvScanAssessment" work
           WHERE (work."status" = 'QUEUED' AND work."createdAt" <= ${input.now})
              OR (work."status" = 'PROCESSING' AND work."leaseExpiresAt" <= ${input.now})
           ORDER BY work."createdAt", work."id"
           FOR UPDATE SKIP LOCKED
           LIMIT ${input.limit}
        )
        UPDATE "CvScanAssessment" work
           SET "status" = 'PROCESSING', "leaseOwner" = ${input.owner},
               "leaseExpiresAt" = ${leaseExpiresAt},
               "startedAt" = COALESCE(work."startedAt", ${input.now})
          FROM claimable
         WHERE work."id" = claimable."id"
        RETURNING work."id", work."uploadId", work."accountId", work."attemptNumber",
                  work."leaseOwner", work."leaseExpiresAt"
      `;
    }
    if (input.stage === "EXTRACTION") {
      return prisma.$queryRaw<CvWorkClaim[]>`
        WITH claimable AS (
          SELECT work."id"
            FROM "CvExtraction" work
           WHERE (work."status" = 'QUEUED' AND work."createdAt" <= ${input.now})
              OR (work."status" = 'PROCESSING' AND work."leaseExpiresAt" <= ${input.now})
           ORDER BY work."createdAt", work."id"
           FOR UPDATE SKIP LOCKED
           LIMIT ${input.limit}
        )
        UPDATE "CvExtraction" work
           SET "status" = 'PROCESSING', "leaseOwner" = ${input.owner},
               "leaseExpiresAt" = ${leaseExpiresAt},
               "startedAt" = COALESCE(work."startedAt", ${input.now})
          FROM claimable
         WHERE work."id" = claimable."id"
        RETURNING work."id", work."uploadId", work."accountId", work."attemptNumber",
                  work."leaseOwner", work."leaseExpiresAt"
      `;
    }
    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        uploadId: string;
        accountId: string;
        leaseOwner: string;
        leaseExpiresAt: Date;
      }>
    >`
      WITH claimable AS (
        SELECT artifact."id"
          FROM "CvStoredArtifact" artifact
         WHERE ((artifact."status" IN ('DELETE_PENDING', 'DELETE_FAILED')
                 AND artifact."deleteAfter" IS NOT NULL
                 AND artifact."deleteAfter" <= ${input.now})
             OR (artifact."status" = 'DELETING'
                 AND artifact."deleteLeaseExpiresAt" <= ${input.now}))
           AND artifact."deleteAttempts" < 100
         ORDER BY artifact."deleteAfter" NULLS FIRST, artifact."createdAt", artifact."id"
         FOR UPDATE SKIP LOCKED
         LIMIT ${input.limit}
      )
      UPDATE "CvStoredArtifact" artifact
         SET "status" = 'DELETING', "deleteLeaseOwner" = ${input.owner},
             "deleteLeaseExpiresAt" = ${leaseExpiresAt},
             "deleteAttempts" = artifact."deleteAttempts" + 1
        FROM claimable
       WHERE artifact."id" = claimable."id"
      RETURNING artifact."id", artifact."uploadId", artifact."accountId",
                artifact."deleteLeaseOwner" AS "leaseOwner",
                artifact."deleteLeaseExpiresAt" AS "leaseExpiresAt"
    `;
    return rows.map((row) => ({ ...row, attemptNumber: 0 }));
  }

  async finalizeStage(input: FinalizeInput): Promise<boolean> {
    if (input.stage === "PARSE") {
      if (!["SUCCEEDED", "FAILED", "CANCELLED"].includes(input.status)) {
        throw new Error("CV_WORK_FINALIZE_INVALID");
      }
      return prisma.$transaction(async (transaction) => {
        const count = await transaction.$executeRaw`
          UPDATE "CvParseJob"
             SET "status" = ${input.status}::"CvParseStatus",
                 "failureCode" = ${input.failureCode ?? null},
                 "completedAt" = ${input.now},
                 "leaseOwner" = NULL,
                 "leaseExpiresAt" = NULL
           WHERE "id" = ${input.id}
             AND "status" = 'PROCESSING'
             AND "leaseOwner" = ${input.owner}
             AND "leaseExpiresAt" > ${input.now}
        `;
        if (count !== 1) return false;
        const uploadId = await finalizedWorkUploadId(
          transaction,
          input.stage,
          input.id,
        );
        await appendWorkerStageAudit(transaction, {
          namespace: "finalize",
          stage: input.stage,
          workId: input.id,
          uploadId,
          state: input.status,
          ...(input.failureCode ? { failureCode: input.failureCode } : {}),
          now: input.now,
        });
        return true;
      });
    }
    if (input.stage === "SCAN") {
      if (
        !["CLEAN", "INFECTED", "INDETERMINATE", "CANCELLED"].includes(
          input.status,
        )
      ) {
        throw new Error("CV_WORK_FINALIZE_INVALID");
      }
      return prisma.$transaction(async (transaction) => {
        const count = await transaction.$executeRaw`
          UPDATE "CvScanAssessment"
             SET "status" = ${input.status}::"CvScanStatus",
                 "failureCode" = ${input.failureCode ?? null},
                 "completedAt" = ${input.now}, "leaseOwner" = NULL,
                 "leaseExpiresAt" = NULL
           WHERE "id" = ${input.id} AND "status" = 'PROCESSING'
             AND "leaseOwner" = ${input.owner} AND "leaseExpiresAt" > ${input.now}
        `;
        if (count !== 1) {
          // ScanStageProcessor commits guarded terminal outcomes atomically;
          // runtime finalization remains an idempotent audit boundary.
          // Accept only the exact terminal result with no active lease.
          const terminalRows = await transaction.$queryRaw<
            Array<{
              status: string;
              failureCode: string | null;
              completedAt: Date | null;
              leaseOwner: string | null;
              leaseExpiresAt: Date | null;
            }>
          >`
            SELECT "status"::text AS "status", "failureCode", "completedAt",
                   "leaseOwner", "leaseExpiresAt"
              FROM "CvScanAssessment"
             WHERE "id" = ${input.id}
             LIMIT 1
          `;
          const terminal = terminalRows[0];
          if (
            terminal?.status !== input.status ||
            terminal.failureCode !== (input.failureCode ?? null) ||
            terminal.completedAt === null ||
            terminal.leaseOwner !== null ||
            terminal.leaseExpiresAt !== null
          ) {
            return false;
          }
        }
        const uploadId = await finalizedWorkUploadId(
          transaction,
          input.stage,
          input.id,
        );
        await appendWorkerStageAudit(transaction, {
          namespace: "finalize",
          stage: input.stage,
          workId: input.id,
          uploadId,
          state: input.status,
          ...(input.failureCode ? { failureCode: input.failureCode } : {}),
          now: input.now,
        });
        return true;
      });
    }
    if (input.stage === "EXTRACTION") {
      if (!["SUCCEEDED", "FAILED", "CANCELLED"].includes(input.status)) {
        throw new Error("CV_WORK_FINALIZE_INVALID");
      }
      return prisma.$transaction(async (transaction) => {
        const count = await transaction.$executeRaw`
          UPDATE "CvExtraction"
             SET "status" = ${input.status}::"CvExtractionStatus",
                 "failureCode" = ${input.failureCode ?? null},
                 "completedAt" = ${input.now}, "leaseOwner" = NULL,
                 "leaseExpiresAt" = NULL
           WHERE "id" = ${input.id} AND "status" = 'PROCESSING'
             AND "leaseOwner" = ${input.owner} AND "leaseExpiresAt" > ${input.now}
        `;
        if (count !== 1) return false;
        const uploadId = await finalizedWorkUploadId(
          transaction,
          input.stage,
          input.id,
        );
        await appendWorkerStageAudit(transaction, {
          namespace: "finalize",
          stage: input.stage,
          workId: input.id,
          uploadId,
          state: input.status,
          ...(input.failureCode ? { failureCode: input.failureCode } : {}),
          now: input.now,
        });
        return true;
      });
    }
    if (!["DELETED", "DELETE_FAILED"].includes(input.status)) {
      throw new Error("CV_WORK_FINALIZE_INVALID");
    }
    return prisma.$transaction(async (transaction) => {
      const count = await transaction.$executeRaw`
        UPDATE "CvStoredArtifact"
           SET "status" = ${input.status}::"CvArtifactStatus",
               "deleteFailureCode" = ${input.failureCode ?? null},
               "deletedAt" = CASE WHEN ${input.status} = 'DELETED' THEN ${input.now} ELSE "deletedAt" END,
               "deleteLeaseOwner" = NULL, "deleteLeaseExpiresAt" = NULL
         WHERE "id" = ${input.id} AND "status" = 'DELETING'
           AND "deleteLeaseOwner" = ${input.owner}
           AND "deleteLeaseExpiresAt" > ${input.now}
      `;
      if (count !== 1) return false;
      const uploadId = await finalizedWorkUploadId(
        transaction,
        input.stage,
        input.id,
      );
      await appendWorkerStageAudit(transaction, {
        namespace: "finalize",
        stage: input.stage,
        workId: input.id,
        uploadId,
        state: input.status,
        ...(input.failureCode ? { failureCode: input.failureCode } : {}),
        now: input.now,
      });
      return true;
    });
  }

  async releaseWorkerLeases(owner: string, now = new Date()): Promise<number> {
    return prisma.$transaction(async (transaction) => {
      const parse = await transaction.$executeRaw`
        UPDATE "CvParseJob" SET "status" = 'QUEUED', "leaseOwner" = NULL,
          "leaseExpiresAt" = NULL
        WHERE "status" = 'PROCESSING' AND "leaseOwner" = ${owner}
      `;
      const scan = await transaction.$executeRaw`
        UPDATE "CvScanAssessment" SET "status" = 'QUEUED', "leaseOwner" = NULL,
          "leaseExpiresAt" = NULL
        WHERE "status" = 'PROCESSING' AND "leaseOwner" = ${owner}
      `;
      const extraction = await transaction.$executeRaw`
        UPDATE "CvExtraction" SET "status" = 'QUEUED', "leaseOwner" = NULL,
          "leaseExpiresAt" = NULL
        WHERE "status" = 'PROCESSING' AND "leaseOwner" = ${owner}
      `;
      const deletion = await transaction.$executeRaw`
        UPDATE "CvStoredArtifact" SET "status" = 'DELETE_PENDING',
          "deleteLeaseOwner" = NULL, "deleteLeaseExpiresAt" = NULL,
          "deleteAfter" = LEAST(COALESCE("deleteAfter", ${now}), ${now})
        WHERE "status" = 'DELETING' AND "deleteLeaseOwner" = ${owner}
      `;
      return parse + scan + extraction + deletion;
    });
  }

  async scheduleAutomaticParseRetry(input: {
    uploadId: string;
    priorJobId: string;
    now: Date;
  }): Promise<Readonly<{ id: string; attemptNumber: number }>> {
    assertRetryInput({
      uploadId: input.uploadId,
      priorAttemptId: input.priorJobId,
      now: input.now,
    });
    return prisma.$transaction(async (transaction) => {
      const priorRows = await transaction.$queryRaw<
        Array<{
          id: string;
          uploadId: string;
          extractionId: string;
          accountId: string;
          attemptNumber: number;
          trigger: string;
          status: string;
          failureCode: string | null;
          parserClass: string;
          provider: string;
          model: string;
          purposeVersion: string;
          inputVersion: string;
          instructionVersion: string;
          schemaVersion: string;
          consentEventId: string | null;
          completedAt: Date | null;
        }>
      >`
        SELECT job."id", job."uploadId", job."extractionId", job."accountId",
               job."attemptNumber", job."trigger", job."status", job."failureCode",
               job."parserClass", job."provider", job."model", job."purposeVersion",
               job."inputVersion", job."instructionVersion", job."schemaVersion",
               job."consentEventId", job."completedAt"
          FROM "CvParseJob" job
         WHERE job."id" = ${input.priorJobId}
           AND job."uploadId" = ${input.uploadId}
         FOR UPDATE
      `;
      const prior = priorRows[0];
      if (!prior || prior.status !== "FAILED") {
        throw new Error("CV_PARSE_RETRY_STATE_INVALID");
      }
      const existing = await transaction.cvParseJob.findFirst({
        where: { previousAttemptId: prior.id },
        select: { id: true, attemptNumber: true, trigger: true },
      });
      if (existing?.trigger === "AUTOMATIC_RETRY") {
        return Object.freeze({
          id: existing.id,
          attemptNumber: existing.attemptNumber,
        });
      }
      if (existing) throw new Error("CV_PARSE_RETRY_STATE_INVALID");
      if (prior.trigger === "CANDIDATE_RETRY") {
        throw new Error("CV_CANDIDATE_RETRY_HAS_NO_AUTOMATIC_CYCLE");
      }
      if (prior.attemptNumber >= AUTOMATIC_ATTEMPT_LIMIT) {
        throw new Error("CV_PARSE_RETRY_LIMIT_REACHED");
      }
      if (
        prior.failureCode !== "PARSER_TIMEOUT" &&
        prior.failureCode !== "PARSER_UNAVAILABLE"
      ) {
        throw new Error("CV_PARSE_RETRY_STATE_INVALID");
      }
      assertBackoffElapsed(prior.completedAt, prior.attemptNumber, input.now);
      const authorizedUpload = await transaction.$queryRaw<
        Array<{ id: string }>
      >`
        SELECT upload."id"
          FROM "CvUpload" upload
          JOIN "user" account ON account."id" = upload."accountId"
         WHERE upload."id" = ${input.uploadId}
           AND upload."accountId" = ${prior.accountId}
            AND upload."status" IN ('PARSE_QUEUED', 'PARSING', 'PARSE_FAILED')
           AND upload."expiresAt" > ${input.now}
           AND upload."contentInaccessibleAt" IS NULL
           AND upload."deletedAt" IS NULL
           AND account."state" = 'ACTIVE'
           AND account."deletedAt" IS NULL
         FOR UPDATE OF upload, account
      `;
      if (!authorizedUpload[0]) {
        throw new Error("CV_STAGE_RESULT_DISCARDED");
      }
      const id = randomUUID();
      const attemptNumber = prior.attemptNumber + 1;
      await transaction.cvParseJob.create({
        data: {
          id,
          uploadId: prior.uploadId,
          extractionId: prior.extractionId,
          accountId: prior.accountId,
          consentEventId: prior.consentEventId,
          previousAttemptId: prior.id,
          attemptNumber,
          trigger: "AUTOMATIC_RETRY",
          status: "QUEUED",
          parserClass:
            prior.parserClass === "EXTERNAL_OPENAI"
              ? "EXTERNAL_OPENAI"
              : "DETERMINISTIC_INTERNAL",
          provider: prior.provider,
          model: prior.model,
          purposeVersion: prior.purposeVersion,
          inputVersion: prior.inputVersion,
          instructionVersion: prior.instructionVersion,
          schemaVersion: prior.schemaVersion,
          createdAt: input.now,
        },
      });
      await transaction.cvUpload.update({
        where: { id: input.uploadId },
        data: {
          status: "PARSE_QUEUED",
          automaticParseAttemptsUsed: attemptNumber,
        },
        select: { id: true },
      });
      await appendWorkerStageAudit(transaction, {
        namespace: "automatic-retry",
        stage: "PARSE",
        workId: id,
        uploadId: input.uploadId,
        state: "AUTOMATIC_RETRY_QUEUED",
        now: input.now,
      });
      return Object.freeze({ id, attemptNumber });
    });
  }

  async scheduleAutomaticScanRetry(input: {
    uploadId: string;
    priorAssessmentId: string;
    now: Date;
  }): Promise<Readonly<{ id: string; attemptNumber: number }>> {
    assertRetryInput({
      uploadId: input.uploadId,
      priorAttemptId: input.priorAssessmentId,
      now: input.now,
    });
    return prisma.$transaction(async (transaction) => {
      const priorRows = await transaction.$queryRaw<
        Array<{
          id: string;
          uploadId: string;
          sourceArtifactId: string;
          accountId: string;
          attemptNumber: number;
          candidateInitiated: boolean;
          status: string;
          failureCode: string | null;
          completedAt: Date | null;
        }>
      >`
        SELECT assessment."id", assessment."uploadId", assessment."sourceArtifactId",
               assessment."accountId", assessment."attemptNumber",
               assessment."candidateInitiated", assessment."status",
               assessment."failureCode", assessment."completedAt"
          FROM "CvScanAssessment" assessment
         WHERE assessment."id" = ${input.priorAssessmentId}
           AND assessment."uploadId" = ${input.uploadId}
         FOR UPDATE
      `;
      const prior = priorRows[0];
      if (!prior || prior.status !== "INDETERMINATE") {
        throw new Error("CV_SCAN_RETRY_STATE_INVALID");
      }
      const existing = await transaction.cvScanAssessment.findFirst({
        where: {
          uploadId: prior.uploadId,
          attemptNumber: prior.attemptNumber + 1,
        },
        select: { id: true, attemptNumber: true, candidateInitiated: true },
      });
      if (existing && !existing.candidateInitiated) {
        return Object.freeze({
          id: existing.id,
          attemptNumber: existing.attemptNumber,
        });
      }
      if (existing) throw new Error("CV_SCAN_RETRY_STATE_INVALID");
      if (prior.candidateInitiated) {
        throw new Error("CV_CANDIDATE_RETRY_HAS_NO_AUTOMATIC_CYCLE");
      }
      if (prior.attemptNumber >= AUTOMATIC_ATTEMPT_LIMIT) {
        throw new Error("CV_SCAN_RETRY_LIMIT_REACHED");
      }
      if (
        prior.failureCode !== "SCANNER_UNAVAILABLE" &&
        prior.failureCode !== "SCANNER_DEFINITIONS_STALE"
      ) {
        throw new Error("CV_SCAN_RETRY_STATE_INVALID");
      }
      assertBackoffElapsed(prior.completedAt, prior.attemptNumber, input.now);
      const initial = await transaction.cvScanAssessment.findFirst({
        where: {
          uploadId: prior.uploadId,
          attemptNumber: 1,
          candidateInitiated: false,
        },
        select: { startedAt: true },
      });
      if (!initial?.startedAt) throw new Error("CV_SCAN_RETRY_STATE_INVALID");
      if (
        input.now.getTime() + SCAN_ATTEMPT_COMPLETION_MARGIN_MS >
        initial.startedAt.getTime() + SCAN_AUTOMATIC_CYCLE_LIMIT_MS
      ) {
        throw new Error("CV_SCAN_RETRY_WINDOW_EXHAUSTED");
      }
      const authorizedUpload = await transaction.$queryRaw<
        Array<{ id: string }>
      >`
        SELECT upload."id"
          FROM "CvUpload" upload
          JOIN "user" account ON account."id" = upload."accountId"
         WHERE upload."id" = ${input.uploadId}
           AND upload."accountId" = ${prior.accountId}
            AND upload."status" IN ('SCAN_QUEUED', 'SCANNING', 'SCAN_FAILED')
           AND upload."expiresAt" > ${input.now}
           AND upload."contentInaccessibleAt" IS NULL
           AND upload."deletedAt" IS NULL
           AND account."state" = 'ACTIVE'
           AND account."deletedAt" IS NULL
         FOR UPDATE OF upload, account
      `;
      if (!authorizedUpload[0]) {
        throw new Error("CV_STAGE_RESULT_DISCARDED");
      }
      const id = randomUUID();
      const attemptNumber = prior.attemptNumber + 1;
      await transaction.cvScanAssessment.create({
        data: {
          id,
          uploadId: prior.uploadId,
          sourceArtifactId: prior.sourceArtifactId,
          accountId: prior.accountId,
          attemptNumber,
          candidateInitiated: false,
          status: "QUEUED",
          createdAt: input.now,
        },
      });
      await transaction.cvUpload.update({
        where: { id: input.uploadId },
        data: {
          status: "SCAN_QUEUED",
          automaticScanAttemptsUsed: attemptNumber,
        },
        select: { id: true },
      });
      await appendWorkerStageAudit(transaction, {
        namespace: "automatic-retry",
        stage: "SCAN",
        workId: id,
        uploadId: input.uploadId,
        state: "AUTOMATIC_RETRY_QUEUED",
        now: input.now,
      });
      return Object.freeze({ id, attemptNumber });
    });
  }
}
