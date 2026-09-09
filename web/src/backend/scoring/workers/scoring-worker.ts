import "server-only";

import { randomUUID } from "node:crypto";
import { prisma } from "@/backend/database/prisma";
import { logCvScoringFailure } from "@/backend/cv/upload-observability";

const positiveInteger = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
};

export const scoringWorkerConfig = Object.freeze({
  // The worker deadline is deliberately bounded even if an extractor or
  // provider ignores its own cancellation signal.
  timeoutMilliseconds: Math.min(
    60_000,
    positiveInteger("SCORING_WORK_TIMEOUT_MS", 60_000),
  ),
  maxAttempts: Math.min(3, positiveInteger("SCORING_WORK_MAX_ATTEMPTS", 3)),
});

export type ScoringWorkerOptions = Readonly<{
  timeoutMilliseconds?: number;
  maxAttempts?: number;
  leaseMilliseconds?: number;
  retryDelayMilliseconds?: number;
}>;
const databaseTimestamp = (value: Date) =>
  new Date(value.getTime() - value.getTimezoneOffset() * 60_000);

export type ScoringWorkOutcome = "SCORED" | "DETERMINISTIC_ONLY";
export type ScoringWorkInput = Readonly<{
  workItemId: string;
  operationId: string;
  applicationId: string;
  expectedGeneration: number;
  attemptNumber: number;
  workerId?: string;
}>;

export type ScoringWorkProcessor = (
  input: ScoringWorkInput,
) => Promise<ScoringWorkOutcome>;

/**
 * Coordinates leased scoring work. Calculation and provider calls stay behind
 * the injected processor; this class owns leases, counters, retries, and the
 * terminal operation state so late workers cannot publish stale work silently.
 */
export class ScoringWorker {
  private readonly config: Readonly<{
    timeoutMilliseconds: number;
    maxAttempts: number;
    leaseMilliseconds: number;
    retryDelayMilliseconds: number;
  }>;

  constructor(
    private readonly db: typeof prisma = prisma,
    private readonly processor?: ScoringWorkProcessor,
    options: ScoringWorkerOptions = {},
  ) {
    const timeoutMilliseconds = Math.min(
      60_000,
      options.timeoutMilliseconds && options.timeoutMilliseconds > 0
        ? options.timeoutMilliseconds
        : scoringWorkerConfig.timeoutMilliseconds,
    );
    const maxAttempts = Math.min(
      3,
      options.maxAttempts && options.maxAttempts > 0
        ? Math.floor(options.maxAttempts)
        : scoringWorkerConfig.maxAttempts,
    );
    this.config = Object.freeze({
      timeoutMilliseconds,
      maxAttempts,
      leaseMilliseconds: Math.max(
        90_000,
        timeoutMilliseconds + 15_000,
        options.leaseMilliseconds ?? 0,
      ),
      retryDelayMilliseconds:
        options.retryDelayMilliseconds && options.retryDelayMilliseconds > 0
          ? options.retryDelayMilliseconds
          : 1_000,
    });
  }

  async claim(workerId = `scoring-worker-${randomUUID()}`, now = new Date()) {
    const databaseNow = databaseTimestamp(now);
    const candidate = await this.db.scoringWorkItem.findFirst({
      where: {
        OR: [
          { state: "QUEUED", nextAttemptAt: { lte: databaseNow } },
          { state: "LEASED", leaseExpiresAt: { lte: databaseNow } },
        ],
      },
      orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
      select: { id: true, attemptCount: true },
    });
    if (!candidate) return null;
    if (candidate.attemptCount >= this.config.maxAttempts) {
      logCvScoringFailure({
        reason: "SCORING_RETRY_LIMIT_REACHED",
        workItemId: candidate.id,
      });
      await this.db.$transaction(async (tx) => {
        const changed = await tx.scoringWorkItem.updateMany({
          where: {
            id: candidate.id,
            state: { in: ["QUEUED", "LEASED"] },
            attemptCount: { gte: this.config.maxAttempts },
          },
          data: {
            state: "FAILED",
            leaseOwner: null,
            leaseExpiresAt: null,
            completedAt: databaseNow,
            lastSafeFailureCode: "SCORING_RETRY_LIMIT_REACHED",
          },
        });
        if (changed.count !== 1) return;
        const item = await tx.scoringWorkItem.findUnique({
          where: { id: candidate.id },
          select: { operationId: true, jobApplicationId: true },
        });
        if (item) {
          await tx.jobApplication.updateMany({
            where: {
              id: item.jobApplicationId,
              scoringStatus: { in: ["PROCESSING", "PENDING"] },
            },
            data: { scoringStatus: "FAILED" },
          });
          await this.reconcileInTransaction(tx, item.operationId, now);
        }
      });
      return null;
    }
    const leaseExpiresAt = new Date(
      databaseNow.getTime() + this.config.leaseMilliseconds,
    );
    const claimed = await this.db.$transaction(async (tx) => {
      const changed = await tx.scoringWorkItem.updateMany({
        where: {
          id: candidate.id,
          OR: [
            { state: "QUEUED" },
            { state: "LEASED", leaseExpiresAt: { lte: databaseNow } },
          ],
        },
        data: {
          state: "LEASED",
          leaseOwner: workerId,
          leaseExpiresAt,
          startedAt: databaseNow,
          attemptCount: { increment: 1 },
        },
      });
      if (changed.count !== 1) return null;
      const item = await tx.scoringWorkItem.findUnique({
        where: { id: candidate.id },
        select: {
          id: true,
          operationId: true,
          jobApplicationId: true,
          attemptCount: true,
          application: { select: { scoringGeneration: true } },
        },
      });
      if (!item) return null;
      await tx.scoringOperation.updateMany({
        where: { id: item.operationId, state: "QUEUED" },
        data: { state: "RUNNING", startedAt: databaseNow },
      });
      return {
        workItemId: item.id,
        operationId: item.operationId,
        applicationId: item.jobApplicationId,
        expectedGeneration: item.application.scoringGeneration,
        attemptNumber: item.attemptCount,
        workerId,
      };
    });
    return claimed;
  }

  async runOnce(workerId?: string, now = new Date()) {
    const claimed = await this.claim(workerId, now);
    if (!claimed) return { state: "IDLE" as const };
    if (!this.processor) {
      await this.fail(claimed, "SCORING_PROCESSOR_NOT_CONFIGURED", now, false);
      return { state: "FAILED" as const, workItemId: claimed.workItemId };
    }
    try {
      const outcome = await withTimeout(
        this.processor(claimed),
        this.config.timeoutMilliseconds,
      );
      const completedAt = new Date();
      await this.complete(claimed, outcome, completedAt);
      return { state: outcome, workItemId: claimed.workItemId } as const;
    } catch (error) {
      const code =
        error instanceof Error
          ? error.message.slice(0, 120)
          : "SCORING_WORK_FAILED";
      const safeCode = /^[A-Z][A-Z0-9_]{0,119}$/u.test(code)
        ? code
        : "SCORING_WORK_FAILED";
      logCvScoringFailure({
        reason: safeCode,
        workItemId: claimed.workItemId,
      });
      const retryable = !permanentScoringFailure(safeCode);
      const terminal = await this.fail(
        claimed,
        safeCode,
        new Date(),
        retryable,
      );
      return {
        state: terminal ? ("FAILED" as const) : ("RETRYING" as const),
        workItemId: claimed.workItemId,
      };
    }
  }

  private async complete(
    input: ScoringWorkInput,
    outcome: ScoringWorkOutcome,
    now: Date,
  ) {
    await this.db.$transaction(async (tx) => {
      const changed = await tx.scoringWorkItem.updateMany({
        where: {
          id: input.workItemId,
          state: "LEASED",
          ...(input.workerId ? { leaseOwner: input.workerId } : {}),
        },
        data: {
          state: outcome === "SCORED" ? "PUBLISHED" : "DETERMINISTIC_ONLY",
          leaseOwner: null,
          leaseExpiresAt: null,
          completedAt: now,
        },
      });
      if (changed.count !== 1) return;
      // A work item can fail before an automatic result is published (for
      // example when the CV artifact is missing). Do not leave that
      // application in PROCESSING forever. Existing scores remain visible for
      // rescore failures, so only reset applications without a current result.
      await tx.jobApplication.updateMany({
        where: {
          id: input.applicationId,
          currentScoringResultId: null,
          scoringStatus: { in: ["PROCESSING", "PENDING"] },
        },
        data: { scoringStatus: "FAILED" },
      });
      await this.reconcileInTransaction(tx, input.operationId, now);
    });
  }

  private async fail(
    input: ScoringWorkInput,
    safeFailureCode: string,
    now: Date,
    retryable: boolean,
  ): Promise<boolean> {
    await this.db.$transaction(async (tx) => {
      const terminal =
        !retryable || input.attemptNumber >= this.config.maxAttempts;
      const changed = await tx.scoringWorkItem.updateMany({
        where: {
          id: input.workItemId,
          state: "LEASED",
          ...(input.workerId ? { leaseOwner: input.workerId } : {}),
        },
        data: {
          state: terminal ? "FAILED" : "QUEUED",
          leaseOwner: null,
          leaseExpiresAt: null,
          completedAt: terminal ? now : null,
          lastSafeFailureCode: safeFailureCode,
          consecutiveAiFailureCount: { increment: 1 },
          ...(terminal
            ? {}
            : {
                nextAttemptAt: new Date(
                  now.getTime() +
                    this.config.retryDelayMilliseconds * input.attemptNumber,
                ),
              }),
        },
      });
      if (changed.count !== 1) return;
      if (terminal) {
        await tx.jobApplication.updateMany({
          where: {
            id: input.applicationId,
            scoringStatus: { in: ["PROCESSING", "PENDING"] },
          },
          data: { scoringStatus: "FAILED" },
        });
      }
      await this.reconcileInTransaction(tx, input.operationId, now);
      return terminal;
    });
    return !retryable || input.attemptNumber >= this.config.maxAttempts;
  }

  async reconcile(operationId: string, now = new Date()) {
    return this.db.$transaction((tx) =>
      this.reconcileInTransaction(tx, operationId, now),
    );
  }

  private async reconcileInTransaction(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    operationId: string,
    now: Date,
  ) {
    const [total, scored, deterministicOnly, failed, active] =
      await Promise.all([
        tx.scoringWorkItem.count({ where: { operationId } }),
        tx.scoringWorkItem.count({
          where: { operationId, state: "PUBLISHED" },
        }),
        tx.scoringWorkItem.count({
          where: { operationId, state: "DETERMINISTIC_ONLY" },
        }),
        tx.scoringWorkItem.count({ where: { operationId, state: "FAILED" } }),
        tx.scoringWorkItem.count({
          where: {
            operationId,
            state: {
              in: ["QUEUED", "LEASED", "AUTOMATIC_READY", "AI_PENDING"],
            },
          },
        }),
      ]);
    const state =
      active > 0
        ? "RUNNING"
        : failed > 0
          ? "COMPLETED_WITH_FAILURES"
          : "COMPLETED";
    return tx.scoringOperation.update({
      where: { id: operationId },
      data: {
        totalCount: total,
        succeededCount: scored,
        deterministicOnlyCount: deterministicOnly,
        failedCount: failed,
        state,
        ...(active === 0 ? { completedAt: now } : {}),
      },
    });
  }
}

function permanentScoringFailure(code: string): boolean {
  return new Set([
    "SCORING_INPUT_UNAVAILABLE",
    "SCORING_CV_TEXT_UNAVAILABLE",
    "CV_TEXT_UNAVAILABLE",
    "CV_TEXT_TOO_SHORT",
    "CV_TEXT_INVALID",
    "CV_NOT_RECOGNIZED_AS_CV",
    "APPLICATION_CV_INELIGIBLE",
    "APPLICATION_CV_LENGTH_MISMATCH",
  ]).has(code);
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("SCORING_TIMEOUT")),
      milliseconds,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
