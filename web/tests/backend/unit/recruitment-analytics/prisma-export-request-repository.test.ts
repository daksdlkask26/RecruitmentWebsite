import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transactionClient = {
    exportRequest: { updateMany: vi.fn() },
    exportAuditObligation: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    $queryRawUnsafe: vi.fn(),
  };
  return {
    transactionClient,
    prisma: {
      exportRequest: { updateMany: vi.fn() },
      exportAuditObligation: { upsert: vi.fn() },
      $transaction: vi.fn(async (callback: (client: unknown) => unknown) =>
        callback(transactionClient),
      ),
    },
  };
});

vi.mock("@/backend/database/prisma", () => ({ prisma: mocks.prisma }));

import { PrismaExportRequestRepository } from "@/backend/repositories/analytics/prisma-export-request-repository";

describe("export completion transaction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records the audit obligation in the same transaction as completion", async () => {
    mocks.transactionClient.exportRequest.updateMany.mockResolvedValue({
      count: 1,
    });

    const completedAt = new Date("2026-09-21T01:00:00.000Z");
    const result = await new PrismaExportRequestRepository().succeed(
      "export-1",
      {
        workerId: "worker-1",
        storageLocator: "artifact-1",
        fileName: "candidates.csv",
        mediaType: "text/csv",
        byteCount: 12,
        checksum: "checksum-1",
        rowCount: 3,
        completedAt,
        expiresAt: new Date("2026-09-22T01:00:00.000Z"),
        auditObligation: {
          requesterUserId: "owner-1",
          format: "CSV",
          rowCount: 3,
          occurredAt: completedAt,
        },
      },
    );

    expect(result).toEqual({ count: 1 });
    expect(mocks.prisma.$transaction).toHaveBeenCalledOnce();
    expect(
      mocks.transactionClient.exportRequest.updateMany,
    ).toHaveBeenCalledOnce();
    expect(
      mocks.transactionClient.exportAuditObligation.upsert,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { exportRequestId: "export-1" },
        create: expect.objectContaining({
          exportRequestId: "export-1",
          requesterUserId: "owner-1",
          format: "CSV",
          rowCount: 3,
        }),
      }),
    );
  });

  it("claims due audit obligations with a fenced lease", async () => {
    mocks.transactionClient.$queryRawUnsafe.mockResolvedValue([
      { id: "audit-1" },
      { id: "audit-2" },
    ]);
    mocks.transactionClient.exportAuditObligation.updateMany.mockResolvedValue({
      count: 2,
    });
    mocks.transactionClient.exportAuditObligation.findMany.mockResolvedValue([
      { id: "audit-1", attemptCount: 1 },
      { id: "audit-2", attemptCount: 2 },
    ]);
    const now = new Date("2026-09-21T02:00:00.000Z");
    const leaseExpiresAt = new Date("2026-09-21T02:05:00.000Z");

    await expect(
      new PrismaExportRequestRepository().claimPendingAuditObligations(
        "audit-worker-1",
        now,
        leaseExpiresAt,
        25,
      ),
    ).resolves.toEqual([
      { id: "audit-1", attemptCount: 1 },
      { id: "audit-2", attemptCount: 2 },
    ]);
    expect(
      mocks.transactionClient.exportAuditObligation.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["audit-1", "audit-2"] } },
        data: expect.objectContaining({
          state: "LEASED",
          leaseOwner: "audit-worker-1",
          leaseExpiresAt,
          attemptCount: { increment: 1 },
        }),
      }),
    );
  });
});
