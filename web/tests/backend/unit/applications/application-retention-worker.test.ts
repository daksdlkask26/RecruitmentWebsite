import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    jobApplication: {
      updateMany: vi.fn(),
      findFirst: vi.fn(),
    },
    applicationDocument: {
      updateMany: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    applicationCoverLetterText: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    applicationArtifactPromotion: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
  storage: {
    assertReady: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/backend/database/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/backend/applications/storage/factory", () => ({
  createApplicationDocumentStorage: () => mocks.storage,
}));

import { runApplicationRetentionCycle } from "@/backend/applications/workers/application-retention-worker";

const now = new Date("2026-09-06T08:00:00.000Z");

function orphan(
  overrides: Partial<{
    id: string;
    candidateUserId: string;
    jobPostingId: string;
    jobApplicationId: string | null;
    storageKeyEncrypted: string;
    contentDigestSha256: string;
  }> = {},
) {
  return {
    id: "promotion-1",
    candidateUserId: "candidate-1",
    jobPostingId: "job-1",
    jobApplicationId: null,
    storageKeyEncrypted: "application-storage-1",
    contentDigestSha256: "a".repeat(64),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.storage.assertReady.mockResolvedValue(undefined);
  mocks.storage.delete.mockResolvedValue({ deleted: true });
  mocks.prisma.jobApplication.updateMany.mockResolvedValue({ count: 0 });
  mocks.prisma.jobApplication.findFirst.mockResolvedValue(null);
  mocks.prisma.applicationDocument.updateMany.mockResolvedValue({ count: 0 });
  mocks.prisma.applicationDocument.findMany.mockResolvedValue([]);
  mocks.prisma.applicationDocument.findFirst.mockResolvedValue(null);
  mocks.prisma.applicationDocument.count.mockResolvedValue(0);
  mocks.prisma.applicationCoverLetterText.findMany.mockResolvedValue([]);
  mocks.prisma.applicationCoverLetterText.updateMany.mockResolvedValue({
    count: 0,
  });
  mocks.prisma.applicationArtifactPromotion.findMany.mockResolvedValue([]);
  mocks.prisma.applicationArtifactPromotion.update.mockResolvedValue({});
});

describe("application artifact promotion reconciliation", () => {
  it("deletes only an orphan with no durable application or document", async () => {
    mocks.prisma.applicationArtifactPromotion.findMany.mockResolvedValue([
      orphan(),
    ]);

    const result = await runApplicationRetentionCycle(now);

    expect(result.orphansDeleted).toBe(1);
    expect(mocks.storage.delete).toHaveBeenCalledWith("application-storage-1");
    expect(mocks.prisma.applicationArtifactPromotion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "promotion-1" },
        data: expect.objectContaining({ state: "DELETED", deletedAt: now }),
      }),
    );
  });

  it("retains and claims a promotion when its application row committed", async () => {
    mocks.prisma.applicationArtifactPromotion.findMany.mockResolvedValue([
      orphan({ jobApplicationId: "application-1" }),
    ]);
    mocks.prisma.jobApplication.findFirst.mockResolvedValue({
      id: "application-1",
      applicationDocuments: [{ contentDigestHmac: "a".repeat(64) }],
    });

    const result = await runApplicationRetentionCycle(now);

    expect(result.orphansDeleted).toBe(0);
    expect(mocks.storage.delete).not.toHaveBeenCalled();
    expect(mocks.prisma.applicationArtifactPromotion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: "COMMITTED",
          lastSafeFailureCode: null,
        }),
      }),
    );
  });

  it("relinks a matching document when the ledger lost its application id", async () => {
    mocks.prisma.applicationArtifactPromotion.findMany.mockResolvedValue([
      orphan(),
    ]);
    mocks.prisma.applicationDocument.findFirst.mockResolvedValue({
      jobApplicationId: "application-1",
      application: { candidateUserId: "candidate-1", jobPostingId: "job-1" },
      contentDigestHmac: "a".repeat(64),
    });

    const result = await runApplicationRetentionCycle(now);

    expect(result.orphansDeleted).toBe(0);
    expect(mocks.storage.delete).not.toHaveBeenCalled();
    expect(mocks.prisma.applicationArtifactPromotion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: "COMMITTED",
          jobApplicationId: "application-1",
        }),
      }),
    );
  });

  it("preserves a locator collision belonging to another application scope", async () => {
    mocks.prisma.applicationArtifactPromotion.findMany.mockResolvedValue([
      orphan(),
    ]);
    mocks.prisma.applicationDocument.findFirst.mockResolvedValue({
      jobApplicationId: "other-application",
      application: { candidateUserId: "other-candidate", jobPostingId: "job-2" },
      contentDigestHmac: "b".repeat(64),
    });

    const result = await runApplicationRetentionCycle(now);

    expect(result.orphansDeleted).toBe(0);
    expect(mocks.storage.delete).not.toHaveBeenCalled();
    expect(mocks.prisma.applicationArtifactPromotion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: "DELETE_FAILED",
          lastSafeFailureCode: "APPLICATION_ARTIFACT_LOCATOR_CONFLICT",
        }),
      }),
    );
  });

  it("preserves a same-scope relink when the document digest differs", async () => {
    mocks.prisma.applicationArtifactPromotion.findMany.mockResolvedValue([
      orphan(),
    ]);
    mocks.prisma.applicationDocument.findFirst.mockResolvedValue({
      jobApplicationId: "application-1",
      application: { candidateUserId: "candidate-1", jobPostingId: "job-1" },
      contentDigestHmac: "b".repeat(64),
    });

    const result = await runApplicationRetentionCycle(now);

    expect(result.orphansDeleted).toBe(0);
    expect(mocks.storage.delete).not.toHaveBeenCalled();
    expect(mocks.prisma.applicationArtifactPromotion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: "DELETE_FAILED",
          lastSafeFailureCode: "APPLICATION_ARTIFACT_DIGEST_MISMATCH",
        }),
      }),
    );
  });

  it("fails safe when reconciliation cannot read the database", async () => {
    mocks.prisma.applicationArtifactPromotion.findMany.mockResolvedValue([
      orphan(),
    ]);
    mocks.prisma.applicationDocument.findFirst.mockRejectedValue(
      new Error("database unavailable"),
    );

    const result = await runApplicationRetentionCycle(now);

    expect(result.orphansDeleted).toBe(0);
    expect(mocks.storage.delete).not.toHaveBeenCalled();
    expect(mocks.prisma.applicationArtifactPromotion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: "DELETE_FAILED",
          lastSafeFailureCode: "APPLICATION_ARTIFACT_RECONCILIATION_UNKNOWN",
        }),
      }),
    );
  });

  it("records a retryable delete failure without claiming deletion", async () => {
    mocks.prisma.applicationArtifactPromotion.findMany.mockResolvedValue([
      orphan(),
    ]);
    mocks.storage.delete.mockRejectedValue(new Error("storage unavailable"));

    const result = await runApplicationRetentionCycle(now);

    expect(result.orphansDeleted).toBe(0);
    expect(mocks.prisma.applicationArtifactPromotion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: "DELETE_FAILED",
          lastSafeFailureCode: "APPLICATION_STORAGE_DELETE_FAILED",
        }),
      }),
    );
  });
});
