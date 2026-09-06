import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    candidateCvArtifactPromotion: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
    candidateCv: { findUnique: vi.fn(), findFirst: vi.fn() },
    teamApplication: { findUnique: vi.fn(), findFirst: vi.fn() },
  },
  storage: { assertReady: vi.fn(), delete: vi.fn() },
}));

vi.mock("@/backend/database/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/backend/cv/workers/cv-worker-resources", () => ({
  createCvWorkerStorage: () => mocks.storage,
}));

import { runCandidateCvArtifactReconciliationCycle } from "@/backend/cv/candidate-cv-artifact-reconciliation-worker";

const now = new Date("2026-09-06T08:00:00.000Z");
const digest = "a".repeat(64);

function row(
  overrides: Partial<{
    id: string;
    candidateUserId: string;
    scope: "PROFILE_CV" | "TEAM_APPLICATION";
    targetId: string;
    storageKey: string;
    contentDigestSha256: string;
    byteSize: number;
  }> = {},
) {
  return {
    id: "candidate-promotion-1",
    candidateUserId: "candidate-1",
    scope: "PROFILE_CV" as const,
    targetId: "candidate-cv-1",
    storageKey: "cv-storage-1",
    contentDigestSha256: digest,
    byteSize: 64,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.candidateCvArtifactPromotion.findMany.mockResolvedValue([]);
  mocks.prisma.candidateCvArtifactPromotion.updateMany.mockResolvedValue({
    count: 1,
  });
  mocks.prisma.candidateCvArtifactPromotion.findUnique.mockResolvedValue({
    state: "COMMITTED",
    deletedAt: null,
  });
  mocks.prisma.candidateCv.findUnique.mockResolvedValue(null);
  mocks.prisma.candidateCv.findFirst.mockResolvedValue(null);
  mocks.prisma.teamApplication.findUnique.mockResolvedValue(null);
  mocks.prisma.teamApplication.findFirst.mockResolvedValue(null);
  mocks.storage.assertReady.mockResolvedValue(undefined);
  mocks.storage.delete.mockResolvedValue({ deleted: true });
});

describe("candidate CV artifact reconciliation", () => {
  it("commits a matching Profile CV target", async () => {
    mocks.prisma.candidateCvArtifactPromotion.findMany.mockResolvedValue([
      row(),
    ]);
    mocks.prisma.candidateCv.findUnique.mockResolvedValue({
      candidateUserId: "candidate-1",
      storageKey: "cv-storage-1",
      checksumSha256: digest,
      byteSize: 64,
    });

    await expect(runCandidateCvArtifactReconciliationCycle(now)).resolves.toEqual(
      { scanned: 1, committed: 1, deleted: 0, failed: 0 },
    );
    expect(mocks.storage.delete).not.toHaveBeenCalled();
    expect(mocks.prisma.candidateCvArtifactPromotion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { state: "COMMITTED", lastSafeFailureCode: null },
      }),
    );
  });

  it("preserves a Team Application locator when the digest differs", async () => {
    mocks.prisma.candidateCvArtifactPromotion.findMany.mockResolvedValue([
      row({ scope: "TEAM_APPLICATION", targetId: "team-application-1" }),
    ]);
    mocks.prisma.teamApplication.findUnique.mockResolvedValue({
      candidateUserId: "candidate-1",
      cvStorageKey: "cv-storage-1",
      cvChecksumSha256: "b".repeat(64),
      cvByteSize: 64,
    });

    await expect(runCandidateCvArtifactReconciliationCycle(now)).resolves.toEqual(
      { scanned: 1, committed: 0, deleted: 0, failed: 1 },
    );
    expect(mocks.storage.delete).not.toHaveBeenCalled();
    expect(mocks.prisma.candidateCvArtifactPromotion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: "DELETE_FAILED",
          lastSafeFailureCode: "CANDIDATE_CV_ARTIFACT_DIGEST_MISMATCH",
        }),
      }),
    );
  });

  it("deletes an aged target with no durable peer", async () => {
    mocks.prisma.candidateCvArtifactPromotion.findMany.mockResolvedValue([
      row(),
    ]);

    await expect(runCandidateCvArtifactReconciliationCycle(now)).resolves.toEqual(
      { scanned: 1, committed: 0, deleted: 1, failed: 0 },
    );
    expect(mocks.storage.delete).toHaveBeenCalledWith("cv-storage-1");
    expect(mocks.prisma.candidateCvArtifactPromotion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: "DELETED", deletedAt: now }),
      }),
    );
  });

  it("fails closed when target inspection is unavailable", async () => {
    mocks.prisma.candidateCvArtifactPromotion.findMany.mockResolvedValue([
      row(),
    ]);
    mocks.prisma.candidateCv.findUnique.mockRejectedValue(new Error("P1001"));

    await expect(runCandidateCvArtifactReconciliationCycle(now)).resolves.toEqual(
      { scanned: 1, committed: 0, deleted: 0, failed: 1 },
    );
    expect(mocks.storage.delete).not.toHaveBeenCalled();
  });
});
