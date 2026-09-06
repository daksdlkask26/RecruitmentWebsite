import { describe, expect, it, vi } from "vitest";

const { transaction, prisma } = vi.hoisted(() => {
  const transaction = {
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
  return {
    transaction,
    prisma: {
      cvUpload: {
        findMany: vi.fn().mockResolvedValue([
          { id: "expired-upload", accountId: "candidate-account" },
        ]),
      },
      $transaction: vi.fn(
        async (callback: (client: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    },
  };
});

vi.mock("@/backend/database/prisma", () => ({ prisma }));

import { CvRetentionService } from "@/backend/services/cv-import/cv-retention-service";

describe("CV retention worker row race", () => {
  it("skips a candidate deleted after discovery without crashing the worker", async () => {
    await expect(
      new CvRetentionService().expireDue({ now: new Date("2026-09-06T00:00:00.000Z") }),
    ).resolves.toBe(0);
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
