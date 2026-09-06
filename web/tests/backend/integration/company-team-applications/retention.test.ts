import { beforeEach, describe, expect, it, vi } from "vitest";
import { runTeamApplicationRetentionCycle } from "@/backend/jobs/team-application-retention";

const {
  invitationUpdateMany,
  applicationUpdateMany,
  applicationFindMany,
  transaction,
  txApplicationUpdateMany,
  txPromotionUpdateMany,
  auditCreate,
  storageAssertReady,
  storageDelete,
} = vi.hoisted(() => ({
  invitationUpdateMany: vi.fn(),
  applicationUpdateMany: vi.fn(),
  applicationFindMany: vi.fn(),
  transaction: vi.fn(),
  txApplicationUpdateMany: vi.fn(),
  txPromotionUpdateMany: vi.fn(),
  auditCreate: vi.fn(),
  storageAssertReady: vi.fn(),
  storageDelete: vi.fn(),
}));

const tx = {
  teamApplication: { updateMany: txApplicationUpdateMany },
  candidateCvArtifactPromotion: { updateMany: txPromotionUpdateMany },
  auditEvent: { create: auditCreate },
};

vi.mock("@/backend/database/prisma", () => ({
  prisma: {
    companyInvitation: { updateMany: invitationUpdateMany },
    teamApplication: {
      updateMany: applicationUpdateMany,
      findMany: applicationFindMany,
    },
    $transaction: transaction,
  },
}));
vi.mock("@/backend/cv/workers/cv-worker-resources", () => ({
  createCvWorkerStorage: () => ({
    assertReady: storageAssertReady,
    delete: storageDelete,
  }),
}));

describe("Team Application CV retention worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invitationUpdateMany.mockResolvedValue({ count: 0 });
    applicationUpdateMany.mockResolvedValue({ count: 0 });
    txApplicationUpdateMany.mockResolvedValue({ count: 1 });
    txPromotionUpdateMany.mockResolvedValue({ count: 1 });
    auditCreate.mockResolvedValue({});
    transaction.mockImplementation(
      async (callback: (value: typeof tx) => unknown) => callback(tx),
    );
    storageAssertReady.mockResolvedValue(undefined);
    storageDelete.mockResolvedValue(undefined);
  });

  it("deletes due terminal CV evidence and records a minimal audit event", async () => {
    applicationFindMany.mockResolvedValue([
      {
        id: "application-1",
        companyId: "company-1",
        cvStorageKey: "team-cv/application-1",
      },
    ]);

    const result = await runTeamApplicationRetentionCycle(
      new Date("2026-08-27T00:00:00.000Z"),
    );

    expect(result).toEqual({ scanned: 1, deleted: 1, failed: 0 });
    expect(storageAssertReady).toHaveBeenCalledOnce();
    expect(storageDelete).toHaveBeenCalledWith("team-cv/application-1");
    expect(txApplicationUpdateMany).toHaveBeenCalledWith({
      where: { id: "application-1", cvDeletedAt: null },
      data: { cvDeletedAt: expect.any(Date), cvDeletionFailureCode: null },
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "team_application.cv_deleted",
        targetId: "application-1",
      }),
    });
  });

  it("keeps a failed deletion retryable and stores only a safe failure code", async () => {
    applicationFindMany.mockResolvedValue([
      {
        id: "application-1",
        companyId: "company-1",
        cvStorageKey: "team-cv/application-1",
      },
    ]);
    storageDelete.mockRejectedValue(new Error("provider detail"));

    const result = await runTeamApplicationRetentionCycle(
      new Date("2026-08-27T00:00:00.000Z"),
    );

    expect(result).toEqual({ scanned: 1, deleted: 0, failed: 1 });
    expect(applicationUpdateMany).toHaveBeenCalledWith({
      where: { id: "application-1", cvDeletedAt: null },
      data: { cvDeletionFailureCode: "TEAM_CV_DELETE_FAILED" },
    });
    expect(auditCreate).not.toHaveBeenCalled();
  });
});
