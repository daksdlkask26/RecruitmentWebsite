import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  candidateCvCreateMock,
  candidateCvFindUniqueMock,
  promotionCreateMock,
  promotionFindUniqueMock,
  promotionUpdateManyMock,
} = vi.hoisted(() => ({
  candidateCvCreateMock: vi.fn(),
  candidateCvFindUniqueMock: vi.fn(),
  promotionCreateMock: vi.fn(),
  promotionFindUniqueMock: vi.fn(),
  promotionUpdateManyMock: vi.fn(),
}));

vi.mock("@/backend/database/prisma", () => ({
  prisma: {
    candidateCv: {
      create: candidateCvCreateMock,
      findUnique: candidateCvFindUniqueMock,
    },
    candidateCvArtifactPromotion: {
      create: promotionCreateMock,
      findUnique: promotionFindUniqueMock,
      updateMany: promotionUpdateManyMock,
    },
  },
}));

import { saveDirectCandidateCv } from "@/backend/services/profile/save-direct-candidate-cv";

function makePrepared() {
  let owned = false;
  const deleteOwnedArtifact = vi.fn();
  const prepared = {
    id: "application-cv-profile-1",
    displayName: "profile.pdf",
    fileName: "profile.pdf",
    mimeType: "application/pdf" as const,
    byteSize: 64,
    storageKey: "profile-cv-temporary",
    checksumSha256: "a".repeat(64),
    claimOwnership: vi.fn(() => {
      owned = true;
    }),
    preserveOnUnknown: vi.fn(() => {
      owned = true;
    }),
    cleanup: vi.fn(async () => {
      if (!owned) deleteOwnedArtifact();
    }),
  };
  return { prepared, deleteOwnedArtifact };
}

describe("saveDirectCandidateCv ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    candidateCvFindUniqueMock.mockResolvedValue({
      candidateUserId: "candidate-1",
      storageKey: "profile-cv-temporary",
      checksumSha256: "a".repeat(64),
      byteSize: 64,
    });
    promotionCreateMock.mockResolvedValue({});
    promotionFindUniqueMock.mockResolvedValue(null);
    promotionUpdateManyMock.mockResolvedValue({ count: 1 });
    candidateCvCreateMock.mockResolvedValue({
      id: "application-cv-profile-1",
      displayName: "profile.pdf",
      fileName: "profile.pdf",
      mimeType: "application/pdf",
      byteSize: 64,
      version: 1,
      confirmedAt: new Date("2026-08-01T00:00:00.000Z"),
    });
  });

  it("claims the artifact after the CandidateCv row commits", async () => {
    const { prepared } = makePrepared();

    await expect(
      saveDirectCandidateCv(
        "candidate-1",
        prepared as never,
        new Date("2026-08-01T00:00:00.000Z"),
      ),
    ).resolves.toMatchObject({ id: prepared.id });

    expect(candidateCvCreateMock).toHaveBeenCalledOnce();
    expect(prepared.claimOwnership).toHaveBeenCalledOnce();
    expect(prepared.cleanup).not.toHaveBeenCalled();
  });

  it("does not delete the owned artifact when summary projection fails", async () => {
    candidateCvCreateMock.mockResolvedValueOnce({
      id: "application-cv-profile-1",
      displayName: "profile.pdf",
      fileName: "profile.pdf",
      mimeType: "text/plain",
      byteSize: 64,
      version: 1,
      confirmedAt: new Date("2026-08-01T00:00:00.000Z"),
    });
    const { prepared, deleteOwnedArtifact } = makePrepared();

    await expect(
      saveDirectCandidateCv(
        "candidate-1",
        prepared as never,
        new Date("2026-08-01T00:00:00.000Z"),
      ),
    ).rejects.toThrow();

    expect(prepared.claimOwnership).toHaveBeenCalledOnce();
    expect(prepared.cleanup).not.toHaveBeenCalled();
    expect(deleteOwnedArtifact).not.toHaveBeenCalled();
  });

  it("preserves the owned artifact when the commit ledger acknowledgement is unknown", async () => {
    promotionUpdateManyMock.mockRejectedValueOnce(
      new Error("LEDGER_COMMIT_UNKNOWN"),
    );
    const { prepared, deleteOwnedArtifact } = makePrepared();

    await expect(
      saveDirectCandidateCv("candidate-1", prepared as never),
    ).rejects.toThrow("LEDGER_COMMIT_UNKNOWN");

    expect(candidateCvCreateMock).toHaveBeenCalledOnce();
    expect(prepared.claimOwnership).toHaveBeenCalledOnce();
    expect(prepared.preserveOnUnknown).toHaveBeenCalledOnce();
    expect(prepared.cleanup).not.toHaveBeenCalled();
    expect(deleteOwnedArtifact).not.toHaveBeenCalled();
  });

  it("keeps the artifact when the CandidateCv outcome cannot be read", async () => {
    candidateCvCreateMock.mockRejectedValueOnce(new Error("P1001"));
    candidateCvFindUniqueMock.mockRejectedValueOnce(new Error("P1001"));
    const { prepared, deleteOwnedArtifact } = makePrepared();

    await expect(
      saveDirectCandidateCv(
        "candidate-1",
        prepared as never,
        new Date("2026-08-01T00:00:00.000Z"),
      ),
    ).rejects.toThrow("P1001");

    expect(prepared.preserveOnUnknown).toHaveBeenCalledOnce();
    expect(prepared.cleanup).not.toHaveBeenCalled();
    expect(deleteOwnedArtifact).not.toHaveBeenCalled();
  });

  it("preserves the upload when the first profile ledger write fails", async () => {
    promotionCreateMock.mockRejectedValueOnce(new Error("LEDGER_STAGE_UNKNOWN"));
    const { prepared, deleteOwnedArtifact } = makePrepared();

    await expect(
      saveDirectCandidateCv("candidate-1", prepared as never),
    ).rejects.toThrow("LEDGER_STAGE_UNKNOWN");

    expect(candidateCvCreateMock).not.toHaveBeenCalled();
    expect(prepared.preserveOnUnknown).toHaveBeenCalledOnce();
    expect(prepared.cleanup).not.toHaveBeenCalled();
    expect(deleteOwnedArtifact).not.toHaveBeenCalled();
  });

  it("preserves a committed profile row when its digest does not match", async () => {
    candidateCvCreateMock.mockRejectedValueOnce(new Error("P2002"));
    candidateCvFindUniqueMock.mockResolvedValueOnce({
      candidateUserId: "candidate-1",
      storageKey: "profile-cv-temporary",
      checksumSha256: "b".repeat(64),
      byteSize: 64,
    });
    const { prepared, deleteOwnedArtifact } = makePrepared();

    await expect(
      saveDirectCandidateCv("candidate-1", prepared as never),
    ).rejects.toThrow("P2002");

    expect(prepared.preserveOnUnknown).toHaveBeenCalledOnce();
    expect(prepared.cleanup).not.toHaveBeenCalled();
    expect(deleteOwnedArtifact).not.toHaveBeenCalled();
  });
});
