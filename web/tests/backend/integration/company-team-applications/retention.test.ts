import { beforeEach, describe, expect, it, vi } from "vitest";
import { runTeamApplicationRetentionCycle } from "@/backend/jobs/team-application-retention";

const {
  invitationUpdateMany,
  applicationUpdateMany,
  applicationFindMany,
  artifactFindUnique,
  transaction,
  txApplicationUpdateMany,
  txArtifactUpdateMany,
  txPromotionUpdateMany,
  auditCreate,
  storageAssertReady,
  storageDelete,
} = vi.hoisted(() => ({
  invitationUpdateMany: vi.fn(),
  applicationUpdateMany: vi.fn(),
  applicationFindMany: vi.fn(),
  artifactFindUnique: vi.fn(),
  transaction: vi.fn(),
  txApplicationUpdateMany: vi.fn(),
  txArtifactUpdateMany: vi.fn(),
  txPromotionUpdateMany: vi.fn(),
  auditCreate: vi.fn(),
  storageAssertReady: vi.fn(),
  storageDelete: vi.fn(),
}));

const tx = {
  teamApplication: { updateMany: txApplicationUpdateMany },
  cvStoredArtifact: { updateMany: txArtifactUpdateMany },
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
    cvStoredArtifact: { findUnique: artifactFindUnique },
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
    txArtifactUpdateMany.mockResolvedValue({ count: 1 });
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

  it("preserves a secure source artifact while another projection references it", async () => {
    applicationFindMany.mockResolvedValue([
      {
        id: "application-1",
        companyId: "company-1",
        candidateUserId: "candidate-1",
        cvByteSize: 64,
        cvStorageKey: "encrypted-source",
        cvChecksumSha256: "a".repeat(64),
        cvSourceArtifactId: "artifact-1",
      },
    ]);
    artifactFindUnique.mockResolvedValue({
      id: "artifact-1",
      uploadId: "upload-1",
      accountId: "candidate-1",
      kind: "SOURCE_DOCUMENT",
      status: "AVAILABLE",
      storageLocator: "encrypted-source",
      plaintextBytes: 64,
      plaintextSha256: Buffer.from("a".repeat(64), "hex"),
      contentInaccessibleAt: null,
      deletedAt: null,
      upload: { accountId: "candidate-1", purpose: "TEAM_APPLICATION_DIRECT" },
      candidateCvs: [{ id: "profile-cv-1" }],
      applicationDocuments: [],
      teamApplications: [{ id: "application-1" }],
    });

    const result = await runTeamApplicationRetentionCycle(
      new Date("2026-08-27T00:00:00.000Z"),
    );

    expect(result).toEqual({ scanned: 1, deleted: 1, failed: 0 });
    expect(storageAssertReady).not.toHaveBeenCalled();
    expect(storageDelete).not.toHaveBeenCalled();
    expect(txArtifactUpdateMany).not.toHaveBeenCalled();
  });

  it("deletes an unshared secure source only after proving its provenance", async () => {
    applicationFindMany.mockResolvedValue([
      {
        id: "application-1",
        companyId: "company-1",
        candidateUserId: "candidate-1",
        cvByteSize: 64,
        cvStorageKey: "encrypted-source",
        cvChecksumSha256: "a".repeat(64),
        cvSourceArtifactId: "artifact-1",
      },
    ]);
    artifactFindUnique.mockResolvedValue({
      id: "artifact-1",
      uploadId: "upload-1",
      accountId: "candidate-1",
      kind: "SOURCE_DOCUMENT",
      status: "AVAILABLE",
      storageLocator: "encrypted-source",
      plaintextBytes: 64,
      plaintextSha256: Buffer.from("a".repeat(64), "hex"),
      contentInaccessibleAt: null,
      deletedAt: null,
      upload: { accountId: "candidate-1", purpose: "TEAM_APPLICATION_DIRECT" },
      candidateCvs: [],
      applicationDocuments: [],
      teamApplications: [{ id: "application-1" }],
    });

    const result = await runTeamApplicationRetentionCycle(
      new Date("2026-08-27T00:00:00.000Z"),
    );

    expect(result).toEqual({ scanned: 1, deleted: 1, failed: 0 });
    expect(storageDelete).toHaveBeenCalledWith("encrypted-source");
    expect(txArtifactUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "artifact-1",
        deletedAt: null,
        status: { in: ["AVAILABLE", "DELETE_PENDING", "DELETE_FAILED"] },
      },
      data: expect.objectContaining({ status: "DELETED" }),
    });
  });

  it("fails closed before storage deletion when secure provenance mismatches", async () => {
    applicationFindMany.mockResolvedValue([
      {
        id: "application-1",
        companyId: "company-1",
        candidateUserId: "candidate-1",
        cvByteSize: 64,
        cvStorageKey: "encrypted-source",
        cvChecksumSha256: "a".repeat(64),
        cvSourceArtifactId: "artifact-1",
      },
    ]);
    artifactFindUnique.mockResolvedValue({
      id: "artifact-1",
      uploadId: "upload-1",
      accountId: "candidate-2",
      kind: "SOURCE_DOCUMENT",
      status: "AVAILABLE",
      storageLocator: "encrypted-source",
      plaintextBytes: 64,
      plaintextSha256: Buffer.from("a".repeat(64), "hex"),
      contentInaccessibleAt: null,
      deletedAt: null,
      upload: { accountId: "candidate-2", purpose: "TEAM_APPLICATION_DIRECT" },
      candidateCvs: [],
      applicationDocuments: [],
      teamApplications: [{ id: "application-1" }],
    });

    const result = await runTeamApplicationRetentionCycle(
      new Date("2026-08-27T00:00:00.000Z"),
    );

    expect(result).toEqual({ scanned: 1, deleted: 0, failed: 1 });
    expect(storageDelete).not.toHaveBeenCalled();
    expect(applicationUpdateMany).toHaveBeenCalledWith({
      where: { id: "application-1", cvDeletedAt: null },
      data: { cvDeletionFailureCode: "TEAM_CV_RETENTION_ARTIFACT_MISMATCH" },
    });
  });
});
