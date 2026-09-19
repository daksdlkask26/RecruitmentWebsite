import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@/backend/generated/prisma/client";
import { prisma } from "@/backend/database/prisma";
import type {
  AiEvaluationResult,
  AutomaticMatchingResult,
} from "@/backend/scoring-engine/scoring-contracts";
import {
  AI_WEIGHT,
  AUTOMATIC_WEIGHT,
} from "@/backend/scoring-engine/hybrid-score-policy";

type PrivateDatabase = typeof prisma | Prisma.TransactionClient;

const checkReadInclude = {
  currentAttempt: {
    include: {
      deterministicResultByAttempt: {
        include: {
          evidence: true,
          attempt: { select: { id: true, checkId: true } },
        },
      },
      deterministicResult: {
        include: {
          evidence: true,
          attempt: { select: { id: true, checkId: true } },
        },
      },
      aiResultByAttempt: true,
    },
  },
  attempts: {
    orderBy: [{ attemptNumber: "desc" as const }, { id: "desc" as const }],
    include: {
      deterministicResultByAttempt: {
        include: {
          evidence: true,
          attempt: { select: { id: true, checkId: true } },
        },
      },
      deterministicResult: {
        include: {
          evidence: true,
          attempt: { select: { id: true, checkId: true } },
        },
      },
      aiResultByAttempt: true,
    },
  },
};

const checkListReadInclude = {
  currentAttempt: {
    include: {
      deterministicResultByAttempt: true,
      deterministicResult: true,
      aiResultByAttempt: true,
    },
  },
} as const;

export type PrivateCheckRecord = Prisma.PrivateCvMatchCheckGetPayload<{
  include: typeof checkReadInclude;
}>;

export type PrivateCheckListRecord = Prisma.PrivateCvMatchCheckGetPayload<{
  include: typeof checkListReadInclude;
}>;

export type ClaimedPrivateAttempt = Prisma.PrivateCvMatchAttemptGetPayload<{
  include: {
    check: true;
    deterministicResultByAttempt: { include: { evidence: true } };
    aiResultByAttempt: true;
  };
}>;

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function availableWhere(candidateUserId: string, checkId: string, now: Date) {
  return {
    id: checkId,
    candidateUserId,
    inaccessibleAt: null,
    deletedAt: null,
    expiresAt: { gt: now },
  } as const;
}

export class PrivateCvMatchRepository {
  constructor(private readonly database: PrivateDatabase = prisma) {}

  async withTransaction<T>(
    operation: (repository: PrivateCvMatchRepository) => Promise<T>,
  ) {
    if ("$transaction" in this.database) {
      return (this.database as typeof prisma).$transaction((transaction) =>
        operation(new PrivateCvMatchRepository(transaction)),
      );
    }
    return operation(this);
  }

  async findOwnedCheck(
    candidateUserId: string,
    checkId: string,
    now: Date,
  ): Promise<PrivateCheckRecord | null> {
    return this.database.privateCvMatchCheck.findFirst({
      where: availableWhere(candidateUserId, checkId, now),
      include: checkReadInclude,
    });
  }

  async listOwnedChecks(
    candidateUserId: string,
    now: Date,
    limit = 50,
  ): Promise<PrivateCheckListRecord[]> {
    return this.database.privateCvMatchCheck.findMany({
      where: {
        candidateUserId,
        inaccessibleAt: null,
        deletedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: Math.max(1, Math.min(50, limit)),
      include: checkListReadInclude,
    });
  }

  async findActiveByDedupeKey(
    candidateUserId: string,
    creationDedupeKey: string,
    now: Date,
  ): Promise<PrivateCheckRecord | null> {
    return this.database.privateCvMatchCheck.findFirst({
      where: {
        candidateUserId,
        creationDedupeKey,
        inaccessibleAt: null,
        deletedAt: null,
        expiresAt: { gt: now },
      },
      include: checkReadInclude,
    });
  }

  async findCommandReceipt(input: {
    candidateUserId: string;
    idempotencyKey: string;
    commandKind: string;
  }) {
    return this.database.privateCvMatchCommandReceipt.findFirst({
      where: {
        candidateUserId: input.candidateUserId,
        idempotencyKey: input.idempotencyKey,
        commandKind: input.commandKind,
      },
      select: { id: true, requestDigest: true, checkId: true },
    });
  }

  async createCheck(input: {
    id: string;
    candidateUserId: string;
    cvVersionId: string;
    cvVersion: number;
    cvDigest: string;
    jobPostingId: string;
    jdVersion: number;
    jdDigest: string;
    scoringConfigVersion: string;
    creationDedupeKey: string;
    cvSnapshot: unknown;
    jdSnapshot: unknown;
    expiresAt: Date;
    createdAt: Date;
  }) {
    return this.database.privateCvMatchCheck.create({
      data: {
        id: input.id,
        candidateUserId: input.candidateUserId,
        cvVersionId: input.cvVersionId,
        cvVersion: input.cvVersion,
        cvDigest: input.cvDigest,
        jobPostingId: input.jobPostingId,
        jdVersion: input.jdVersion,
        jdDigest: input.jdDigest,
        scoringConfigVersion: input.scoringConfigVersion,
        creationDedupeKey: input.creationDedupeKey,
        cvSnapshot: jsonValue(input.cvSnapshot),
        jdSnapshot: jsonValue(input.jdSnapshot),
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
        attempts: {
          create: {
            id: randomUUID(),
            attemptNumber: 1,
            trigger: "INITIAL",
            state: "QUEUED",
            scoringPolicyVersion: input.scoringConfigVersion,
          },
        },
      },
      include: checkReadInclude,
    });
  }

  async createCommandReceipt(input: {
    candidateUserId: string;
    idempotencyKey: string;
    commandKind: string;
    requestDigest: string;
    checkId: string;
  }) {
    return this.database.privateCvMatchCommandReceipt.create({
      data: input,
      select: { id: true, requestDigest: true, checkId: true },
    });
  }

  async setCvTextSnapshot(
    checkId: string,
    cvTextSnapshot: string,
  ): Promise<boolean> {
    const updated = await this.database.privateCvMatchCheck.updateMany({
      where: { id: checkId, inaccessibleAt: null, cvTextSnapshot: null },
      data: { cvTextSnapshot },
    });
    return updated.count === 1;
  }

  async setCheckAnalyzing(checkId: string, now: Date): Promise<boolean> {
    const updated = await this.database.privateCvMatchCheck.updateMany({
      where: {
        id: checkId,
        state: { in: ["QUEUED", "ANALYZING"] },
        inaccessibleAt: null,
        deletedAt: null,
        expiresAt: { gt: now },
      },
      data: { state: "ANALYZING" },
    });
    return updated.count === 1;
  }

  async claimNextAttempt(
    workerId: string,
    now: Date,
    leaseMilliseconds = 30_000,
  ): Promise<ClaimedPrivateAttempt | null> {
    const candidate = await this.database.privateCvMatchAttempt.findFirst({
      where: {
        state: {
          in: ["QUEUED", "AUTOMATIC_RUNNING", "AUTOMATIC_READY", "AI_RUNNING"],
        },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
        check: {
          inaccessibleAt: null,
          deletedAt: null,
          expiresAt: { gt: now },
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, trigger: true, state: true },
    });
    if (!candidate) return null;
    const state =
      candidate.state === "QUEUED" && candidate.trigger === "INITIAL"
        ? "AUTOMATIC_RUNNING"
        : "AI_RUNNING";
    const claimed = await this.database.privateCvMatchAttempt.updateMany({
      where: {
        id: candidate.id,
        state: candidate.state,
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
      },
      data: {
        state,
        leaseOwner: workerId,
        leaseExpiresAt: new Date(now.getTime() + leaseMilliseconds),
        startedAt: now,
      },
    });
    if (claimed.count !== 1) return null;
    return this.database.privateCvMatchAttempt.findUnique({
      where: { id: candidate.id },
      include: {
        check: true,
        deterministicResultByAttempt: { include: { evidence: true } },
        aiResultByAttempt: true,
      },
    });
  }

  async saveAutomaticResult(input: {
    attemptId: string;
    workerId: string;
    result: AutomaticMatchingResult;
    calculatedAt: Date;
    leaseMilliseconds?: number;
  }) {
    return this.withTransaction(async (repository) => {
      const attempt = await repository.database.privateCvMatchAttempt.findFirst(
        {
          where: {
            id: input.attemptId,
            state: "AUTOMATIC_RUNNING",
            leaseOwner: input.workerId,
            leaseExpiresAt: { gt: input.calculatedAt },
          },
          select: { id: true },
        },
      );
      if (!attempt) throw new Error("PRIVATE_ATTEMPT_LEASE_LOST");
      const result =
        await repository.database.privateAutomaticMatchResult.create({
          data: {
            id: input.result.resultId,
            attemptId: input.attemptId,
            score: input.result.score,
            weight: AUTOMATIC_WEIGHT,
            weightedContribution: input.result.weightedContribution,
            matchedRequirements: jsonValue(
              input.result.matchedRequirements.slice(0, 200),
            ),
            gaps: jsonValue(input.result.gaps.slice(0, 200)),
            requiredExperience: input.result.requiredExperience,
            detectedExperience: input.result.detectedExperience,
            evidenceCoverage: input.result.evidenceCoverage,
            parserProvenance: jsonValue({
              ...input.result.parserProvenance,
              cvVersion: input.result.cvVersion,
              jdVersion: input.result.jdVersion,
              configVersion: input.result.configVersion,
            }),
            calculatedAt: input.calculatedAt,
            mayBeIncomplete: input.result.mayBeIncomplete,
            evidence: {
              create: input.result.evidence.slice(0, 500).map((evidence) => ({
                id: randomUUID(),
                criterionId: evidence.criterionId,
                criterionVersion: evidence.criterionVersion,
                classification: evidence.classification,
                quote: evidence.quote.slice(0, 1_000),
                location: jsonValue(evidence.location),
                confidenceMetadata: jsonValue({
                  confidence: evidence.confidence,
                }),
                exclusionFlags: jsonValue(evidence.exclusionFlags),
              })),
            },
          },
          include: { evidence: true },
        });
      await repository.database.privateCvMatchAttempt.update({
        where: { id: input.attemptId },
        data: {
          deterministicResultId: result.id,
          state: "AUTOMATIC_READY",
          leaseExpiresAt: new Date(
            input.calculatedAt.getTime() + (input.leaseMilliseconds ?? 30_000),
          ),
        },
      });
      return result;
    });
  }

  async beginAi(input: {
    attemptId: string;
    workerId: string;
    now: Date;
    leaseMilliseconds?: number;
  }) {
    const updated = await this.database.privateCvMatchAttempt.updateMany({
      where: {
        id: input.attemptId,
        leaseOwner: input.workerId,
        state: { in: ["AUTOMATIC_READY", "AI_RUNNING"] },
        leaseExpiresAt: { gt: input.now },
      },
      data: {
        state: "AI_RUNNING",
        leaseExpiresAt: new Date(
          input.now.getTime() + (input.leaseMilliseconds ?? 60_000),
        ),
      },
    });
    if (updated.count !== 1) throw new Error("PRIVATE_ATTEMPT_LEASE_LOST");
  }

  async findAutomaticResult(resultId: string, candidateUserId: string) {
    return this.database.privateAutomaticMatchResult.findFirst({
      where: {
        id: resultId,
        attempt: { check: { candidateUserId } },
      },
      include: { evidence: true },
    });
  }

  async publishHybrid(input: {
    attemptId: string;
    workerId: string;
    result: AiEvaluationResult;
    hybridScore: number;
    matchBand: string;
    completedAt: Date;
  }) {
    return this.withTransaction(async (repository) => {
      const attempt = await repository.database.privateCvMatchAttempt.findFirst(
        {
          where: {
            id: input.attemptId,
            state: "AI_RUNNING",
            leaseOwner: input.workerId,
            leaseExpiresAt: { gt: input.completedAt },
            check: {
              inaccessibleAt: null,
              deletedAt: null,
              expiresAt: { gt: input.completedAt },
            },
          },
          select: { id: true, checkId: true, deterministicResultId: true },
        },
      );
      if (!attempt || !attempt.deterministicResultId)
        throw new Error("PRIVATE_ATTEMPT_PUBLISH_BLOCKED");
      const ai = await repository.database.privateAiEvaluationResult.create({
        data: {
          id: input.result.resultId,
          attemptId: input.attemptId,
          score: input.result.score,
          weight: AI_WEIGHT,
          weightedContribution: input.result.weightedContribution,
          summary: input.result.summary.slice(0, 1_000),
          strengths: jsonValue(
            input.result.strengths.slice(0, 4).map((strength) => ({
              title: strength.title.slice(0, 160),
              evidence: strength.evidence.slice(0, 1_000),
            })),
          ),
          mainGap: input.result.mainGap?.slice(0, 1_000) ?? null,
          actions: jsonValue(
            input.result.actions
              .slice(0, 4)
              .map((action) => action.slice(0, 500)),
          ),
          evidenceConfidence: input.result.evidenceConfidence,
          evidenceLevel: input.result.evidenceLevel,
          provider: input.result.provider,
          model: input.result.model,
          promptVersion: input.result.promptVersion,
          policyVersion: input.result.policyVersion,
          durationMs: input.result.durationMs,
          completedAt: input.completedAt,
        },
      });
      await repository.database.privateCvMatchAttempt.update({
        where: { id: input.attemptId },
        data: {
          aiResultId: ai.id,
          hybridScore: input.hybridScore,
          matchBand: input.matchBand,
          state: "READY",
          completedAt: input.completedAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          failureCode: null,
          provider: input.result.provider,
          model: input.result.model,
          promptVersion: input.result.promptVersion,
          inputPolicyVersion: input.result.policyVersion,
        },
      });
      const published =
        await repository.database.privateCvMatchCheck.updateMany({
          where: {
            id: attempt.checkId,
            inaccessibleAt: null,
            deletedAt: null,
            expiresAt: { gt: input.completedAt },
          },
          data: { currentAttemptId: input.attemptId, state: "READY" },
        });
      if (published.count !== 1)
        throw new Error("PRIVATE_ATTEMPT_PUBLISH_BLOCKED");
      return ai;
    });
  }

  async publishLimited(input: {
    attemptId: string;
    workerId: string;
    failureCode: string;
    completedAt: Date;
  }) {
    return this.withTransaction(async (repository) => {
      const attempt = await repository.database.privateCvMatchAttempt.findFirst(
        {
          where: {
            id: input.attemptId,
            state: "AI_RUNNING",
            leaseOwner: input.workerId,
            leaseExpiresAt: { gt: input.completedAt },
            check: {
              inaccessibleAt: null,
              deletedAt: null,
              expiresAt: { gt: input.completedAt },
            },
          },
          select: {
            id: true,
            checkId: true,
            check: { select: { currentAttemptId: true } },
          },
        },
      );
      if (!attempt) throw new Error("PRIVATE_ATTEMPT_PUBLISH_BLOCKED");
      await repository.database.privateCvMatchAttempt.update({
        where: { id: input.attemptId },
        data: {
          state: "LIMITED",
          completedAt: input.completedAt,
          failureCode: input.failureCode.slice(0, 80),
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      // A failed manual re-run must not replace a safely published hybrid
      // report. Only the first failed attempt promotes the check to limited
      // mode; later failures remain in immutable attempt history.
      if (!attempt.check.currentAttemptId) {
        await repository.database.privateCvMatchCheck.updateMany({
          where: { id: attempt.checkId, inaccessibleAt: null, deletedAt: null },
          data: { state: "LIMITED", currentAttemptId: input.attemptId },
        });
      }
      return attempt;
    });
  }

  async markFailed(input: {
    attemptId: string;
    workerId: string;
    failureCode: string;
    completedAt: Date;
  }) {
    return this.withTransaction(async (repository) => {
      const attempt = await repository.database.privateCvMatchAttempt.findFirst(
        {
          where: { id: input.attemptId, leaseOwner: input.workerId },
          select: { id: true, checkId: true, trigger: true },
        },
      );
      if (!attempt) return false;
      await repository.database.privateCvMatchAttempt.update({
        where: { id: attempt.id },
        data: {
          state: "FAILED",
          failureCode: input.failureCode.slice(0, 80),
          completedAt: input.completedAt,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      if (attempt.trigger === "INITIAL") {
        await repository.database.privateCvMatchCheck.updateMany({
          where: {
            id: attempt.checkId,
            currentAttemptId: null,
            inaccessibleAt: null,
          },
          // A failed automatic attempt must be retryable with a fresh
          // idempotency key. Keep the failed check for history, but release
          // the creation dedupe slot so the setup flow's Try again action can
          // create a new immutable attempt.
          data: { state: "FAILED", creationDedupeKey: null },
        });
      }
      return true;
    });
  }

  async createAiRetryAttempt(input: {
    candidateUserId: string;
    checkId: string;
    now: Date;
    scoringPolicyVersion: string;
  }) {
    const check = await this.database.privateCvMatchCheck.findFirst({
      where: availableWhere(input.candidateUserId, input.checkId, input.now),
      include: {
        currentAttempt: {
          select: { id: true, state: true, deterministicResultId: true },
        },
        attempts: {
          where: {
            trigger: "AI_RETRY",
            state: { in: ["QUEUED", "AI_RUNNING"] },
          },
          select: { id: true, state: true, leaseExpiresAt: true },
        },
        _count: { select: { attempts: true } },
      },
    });
    if (!check) throw new Error("PRIVATE_CHECK_UNAVAILABLE");
    if (
      !check.currentAttempt ||
      !["LIMITED", "READY"].includes(check.currentAttempt.state) ||
      !check.currentAttempt.deterministicResultId
    ) {
      throw new Error("PRIVATE_RETRY_NOT_ALLOWED");
    }

    const activeRetry = check.attempts.find(
      (attempt) =>
        attempt.state === "QUEUED" ||
        (attempt.state === "AI_RUNNING" &&
          attempt.leaseExpiresAt !== null &&
          attempt.leaseExpiresAt > input.now),
    );
    if (activeRetry) {
      // A repeated click, another tab, or a request recovered after a
      // timeout should continue the already accepted retry. The service will
      // record the new idempotency receipt and kick the worker again instead
      // of turning a safe duplicate into a user-visible conflict.
      return activeRetry;
    }

    const staleRetry = check.attempts.find(
      (attempt) =>
        attempt.state === "AI_RUNNING" &&
        (attempt.leaseExpiresAt === null ||
          attempt.leaseExpiresAt <= input.now),
    );
    if (staleRetry) {
      // A worker can disappear after claiming an AI retry. Requeue only when
      // the lease is still expired so a newly reclaimed worker cannot be
      // overwritten by this request.
      const recovered = await this.database.privateCvMatchAttempt.updateMany({
        where: {
          id: staleRetry.id,
          state: "AI_RUNNING",
          OR: [
            { leaseExpiresAt: null },
            { leaseExpiresAt: { lte: input.now } },
          ],
        },
        data: {
          state: "QUEUED",
          completedAt: null,
          failureCode: null,
          hybridScore: null,
          matchBand: null,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      if (recovered.count === 1) {
        return this.database.privateCvMatchAttempt.findUnique({
          where: { id: staleRetry.id },
        });
      }
      throw new Error("PRIVATE_RETRY_NOT_ALLOWED");
    }

    return this.database.privateCvMatchAttempt.create({
      data: {
        id: randomUUID(),
        checkId: input.checkId,
        attemptNumber: check._count.attempts + 1,
        trigger: "AI_RETRY",
        state: "QUEUED",
        deterministicResultId: check.currentAttempt.deterministicResultId,
        scoringPolicyVersion: input.scoringPolicyVersion,
      },
    });
  }

  async revokeOwnedCheck(candidateUserId: string, checkId: string, now: Date) {
    return this.withTransaction(async (repository) => {
      const updated = await repository.database.privateCvMatchCheck.updateMany({
        where: availableWhere(candidateUserId, checkId, now),
        data: {
          state: "INACCESSIBLE",
          inaccessibleAt: now,
          deleteAfter: new Date(now.getTime() + 30 * 86_400_000),
          currentAttemptId: null,
          creationDedupeKey: null,
        },
      });
      if (updated.count !== 1) return false;
      await repository.database.privateCvMatchAttempt.updateMany({
        where: { checkId },
        data: { leaseOwner: null, leaseExpiresAt: now },
      });
      return true;
    });
  }

  async expireDueChecks(now: Date, limit = 50) {
    const checks = await this.database.privateCvMatchCheck.findMany({
      where: { expiresAt: { lte: now }, inaccessibleAt: null, deletedAt: null },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      take: Math.max(1, Math.min(100, limit)),
      select: { id: true },
    });
    for (const check of checks) {
      await this.withTransaction(async (repository) => {
        await repository.database.privateCvMatchCheck.updateMany({
          where: { id: check.id, inaccessibleAt: null, deletedAt: null },
          data: {
            state: "INACCESSIBLE",
            inaccessibleAt: now,
            deleteAfter: new Date(now.getTime() + 30 * 86_400_000),
            currentAttemptId: null,
            creationDedupeKey: null,
          },
        });
        await repository.database.privateCvMatchAttempt.updateMany({
          where: { checkId: check.id },
          data: { leaseOwner: null, leaseExpiresAt: now },
        });
      });
    }
    return checks.length;
  }

  async claimCleanup(workerId: string, now: Date, leaseMilliseconds = 30_000) {
    const candidate = await this.database.privateCvMatchCheck.findFirst({
      where: {
        inaccessibleAt: { not: null },
        deletedAt: null,
        deleteAfter: { lte: now },
        OR: [
          { deleteLeaseExpiresAt: null },
          { deleteLeaseExpiresAt: { lte: now } },
        ],
      },
      orderBy: [{ deleteAfter: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (!candidate) return null;
    const claimed = await this.database.privateCvMatchCheck.updateMany({
      where: {
        id: candidate.id,
        deletedAt: null,
        OR: [
          { deleteLeaseExpiresAt: null },
          { deleteLeaseExpiresAt: { lte: now } },
        ],
      },
      data: {
        deleteLeaseOwner: workerId,
        deleteLeaseExpiresAt: new Date(now.getTime() + leaseMilliseconds),
        deleteAttempts: { increment: 1 },
      },
    });
    return claimed.count === 1 ? candidate.id : null;
  }

  async physicallyDeleteClaimed(checkId: string, workerId: string, now: Date) {
    return this.withTransaction(async (repository) => {
      const marked = await repository.database.privateCvMatchCheck.updateMany({
        where: {
          id: checkId,
          deletedAt: null,
          deleteLeaseOwner: workerId,
          deleteLeaseExpiresAt: { gt: now },
        },
        data: { deletedAt: now },
      });
      if (marked.count !== 1) return false;
      const deleted = await repository.database.privateCvMatchCheck.deleteMany({
        where: { id: checkId, deletedAt: now, deleteLeaseOwner: workerId },
      });
      return deleted.count === 1;
    });
  }

  async recordCleanupFailure(
    checkId: string,
    workerId: string,
    now: Date,
    failureCode = "PRIVATE_CLEANUP_FAILED",
  ) {
    const updated = await this.database.privateCvMatchCheck.updateMany({
      where: { id: checkId, deletedAt: null, deleteLeaseOwner: workerId },
      data: {
        deleteFailureCode: failureCode.slice(0, 80),
        deleteLeaseExpiresAt: new Date(now.getTime() + 60_000),
      },
    });
    return updated.count === 1;
  }
}
