import { beforeEach, describe, expect, it, vi } from "vitest";

const { promotionCreate, promotionFindUnique, promotionUpdateMany } = vi.hoisted(
  () => ({
    promotionCreate: vi.fn(),
    promotionFindUnique: vi.fn(),
    promotionUpdateMany: vi.fn(),
  }),
);

vi.mock("@/backend/database/prisma", () => ({
  prisma: {
    candidateCvArtifactPromotion: {
      create: promotionCreate,
      findUnique: promotionFindUnique,
      updateMany: promotionUpdateMany,
    },
  },
}));

import {
  CANDIDATE_CV_ARTIFACT_SCOPE,
  markCandidateCvArtifactCommitted,
  markCandidateCvArtifactDeleted,
  stageCandidateCvArtifact,
} from "@/backend/cv/candidate-cv-artifact-promotion";

const occurredAt = new Date("2026-09-06T00:00:00.000Z");
const digest = "a".repeat(64);

function input(overrides: Partial<Parameters<typeof stageCandidateCvArtifact>[0]> = {}) {
  return {
    candidateUserId: "candidate-1",
    scope: CANDIDATE_CV_ARTIFACT_SCOPE.PROFILE_CV,
    targetId: "candidate-cv-1",
    storageKey: "candidate-storage-1",
    contentDigestSha256: digest,
    byteSize: 64,
    occurredAt,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  promotionCreate.mockResolvedValue({});
  promotionFindUnique.mockResolvedValue(null);
  promotionUpdateMany.mockResolvedValue({ count: 1 });
});

describe("candidate CV promotion ledger", () => {
  it("stores the plaintext digest and replays an acknowledged stage", async () => {
    const first = await stageCandidateCvArtifact(input());
    expect(first).toMatch(/^candidate-cv-artifact-/u);
    expect(promotionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: first,
        scope: "PROFILE_CV",
        contentDigestSha256: digest,
        byteSize: 64,
        state: "PROMOTED",
      }),
    });

    promotionCreate.mockRejectedValueOnce(new Error("P2002"));
    promotionFindUnique.mockResolvedValueOnce({
      candidateUserId: "candidate-1",
      scope: "PROFILE_CV",
      targetId: "candidate-cv-1",
      storageKey: "candidate-storage-1",
      contentDigestSha256: digest,
      byteSize: 64,
    });
    await expect(stageCandidateCvArtifact(input())).resolves.toBe(first);
  });

  it("coalesces concurrent retries and rejects a digest collision", async () => {
    let created = false;
    promotionCreate.mockImplementation(async ({ data }: { data: { id: string } }) => {
      if (created) throw new Error("P2002");
      created = true;
      return data;
    });
    promotionFindUnique.mockResolvedValue({
      candidateUserId: "candidate-1",
      scope: "PROFILE_CV",
      targetId: "candidate-cv-1",
      storageKey: "candidate-storage-1",
      contentDigestSha256: digest,
      byteSize: 64,
    });
    const [first, second] = await Promise.all([
      stageCandidateCvArtifact(input()),
      stageCandidateCvArtifact(input()),
    ]);
    expect(second).toBe(first);

    promotionCreate.mockRejectedValueOnce(new Error("P2002"));
    promotionFindUnique.mockResolvedValueOnce({
      candidateUserId: "candidate-1",
      scope: "PROFILE_CV",
      targetId: "candidate-cv-1",
      storageKey: "candidate-storage-1",
      contentDigestSha256: "b".repeat(64),
      byteSize: 64,
    });
    await expect(stageCandidateCvArtifact(input())).rejects.toThrow(
      "CANDIDATE_CV_ARTIFACT_LEDGER_CONFLICT",
    );
  });

  it("fails before writing when a digest is malformed", async () => {
    await expect(
      stageCandidateCvArtifact(input({ contentDigestSha256: "short" })),
    ).rejects.toThrow("CANDIDATE_CV_ARTIFACT_DIGEST_INVALID");
    expect(promotionCreate).not.toHaveBeenCalled();
  });

  it("treats committed and deleted acknowledgements as idempotent", async () => {
    promotionUpdateMany.mockResolvedValueOnce({ count: 0 });
    promotionFindUnique.mockResolvedValueOnce({ state: "COMMITTED", deletedAt: null });
    await expect(markCandidateCvArtifactCommitted("promotion-1")).resolves.toBeUndefined();

    promotionUpdateMany.mockResolvedValueOnce({ count: 0 });
    promotionFindUnique.mockResolvedValueOnce({ state: "DELETED", deletedAt: occurredAt });
    await expect(
      markCandidateCvArtifactDeleted("promotion-1", occurredAt),
    ).resolves.toBeUndefined();
  });
});
