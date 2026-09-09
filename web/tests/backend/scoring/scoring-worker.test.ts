import { describe, expect, it, vi } from "vitest";
import { ScoringWorker } from "@/backend/scoring/workers/scoring-worker";

describe("scoring worker publication", () => {
  it("publishes a score without changing the recruitment stage", async () => {
    const tx = {
      scoringWorkItem: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({
          id: "work-1",
          operationId: "operation-1",
          jobApplicationId: "application-1",
          attemptCount: 1,
          application: { scoringGeneration: 3 },
        }),
        count: vi.fn().mockImplementation(async ({ where }) => {
          if (where?.state === "PUBLISHED") return 1;
          return 0;
        }),
      },
      scoringOperation: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({}),
      },
      jobApplication: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const db = {
      scoringWorkItem: {
        findFirst: vi.fn().mockResolvedValue({ id: "work-1" }),
      },
      $transaction: vi
        .fn()
        .mockImplementation(async (callback: (value: typeof tx) => unknown) =>
          callback(tx),
        ),
    };
    const worker = new ScoringWorker(
      db as never,
      vi.fn().mockResolvedValue("SCORED"),
    );

    await expect(
      worker.runOnce("worker-1", new Date("2026-08-18T12:00:00Z")),
    ).resolves.toMatchObject({ state: "SCORED", workItemId: "work-1" });
    expect(tx.jobApplication.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stage: expect.anything() }),
      }),
    );
  });

  it("moves a hung scoring attempt to a terminal failure after the deadline", async () => {
    vi.useFakeTimers();
    try {
      const tx = {
        scoringWorkItem: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue({
            id: "work-timeout",
            operationId: "operation-timeout",
            jobApplicationId: "application-timeout",
            attemptCount: 1,
            application: { scoringGeneration: 1 },
          }),
          count: vi.fn().mockResolvedValue(0),
        },
        scoringOperation: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          update: vi.fn().mockResolvedValue({}),
        },
        jobApplication: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      };
      const db = {
        scoringWorkItem: {
          findFirst: vi.fn().mockResolvedValue({
            id: "work-timeout",
            attemptCount: 0,
          }),
        },
        $transaction: vi
          .fn()
          .mockImplementation(async (callback: (value: typeof tx) => unknown) =>
            callback(tx),
          ),
      };
      const worker = new ScoringWorker(
        db as never,
        () => new Promise<"SCORED">(() => undefined),
        { timeoutMilliseconds: 25, maxAttempts: 1 },
      );

      const pending = worker.runOnce("timeout-worker", new Date());
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(25);

      await expect(pending).resolves.toMatchObject({
        state: "FAILED",
        workItemId: "work-timeout",
      });
      expect(tx.scoringWorkItem.updateMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            state: "FAILED",
            lastSafeFailureCode: "SCORING_TIMEOUT",
          }),
        }),
      );
      expect(tx.jobApplication.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { scoringStatus: "FAILED" },
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
