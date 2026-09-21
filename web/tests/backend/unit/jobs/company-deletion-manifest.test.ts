import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCompanyDeletionReceipt,
  purgeCompanyDeletionRequest,
} from "@/backend/services/jobs/company-deletion-manifest-service";

const prismaMocks = vi.hoisted(() => ({
  companyDeletionRequest: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  companyDeletionManifestEntry: {
    findMany: vi.fn(),
    count: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
  applicationDocument: { findFirst: vi.fn() },
  applicationArtifactPromotion: { findFirst: vi.fn() },
}));

const transactionMocks = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  companyDeletionManifestEntry: {
    updateMany: vi.fn(),
    update: vi.fn(),
  },
  applicationDocument: { findFirst: vi.fn() },
  applicationArtifactPromotion: { findFirst: vi.fn() },
}));

const storageMock = vi.hoisted(() => ({
  assertReady: vi.fn(),
  put: vi.fn(),
  open: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/backend/database/prisma", () => ({
  prisma: {
    ...prismaMocks,
    $transaction: vi.fn(
      async (callback: (tx: typeof transactionMocks) => unknown) =>
        callback({
          ...transactionMocks,
          companyDeletionManifestEntry:
            prismaMocks.companyDeletionManifestEntry,
          applicationDocument: prismaMocks.applicationDocument,
          applicationArtifactPromotion:
            prismaMocks.applicationArtifactPromotion,
        }),
    ),
  },
}));
vi.mock("@/backend/applications/storage/factory", () => ({
  createApplicationDocumentStorage: () => storageMock,
}));

const fixedNow = new Date("2026-09-09T00:00:00.000Z");

describe("company deletion manifest purge", () => {
  beforeEach(() => {
    for (const delegate of Object.values(prismaMocks)) {
      for (const method of Object.values(delegate)) method.mockReset();
    }
    for (const delegate of Object.values(transactionMocks)) {
      if (typeof delegate === "function") {
        delegate.mockReset();
        continue;
      }
      for (const method of Object.values(delegate)) method.mockReset();
    }
    storageMock.assertReady.mockReset();
    storageMock.delete.mockReset();
    storageMock.assertReady.mockResolvedValue(undefined);
    storageMock.delete.mockResolvedValue({ deleted: true });
    prismaMocks.companyDeletionRequest.findUnique.mockResolvedValue({
      id: "deletion-request-1",
      state: "PURGING",
      purgeState: "PENDING",
      retentionEligibleAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    prismaMocks.companyDeletionRequest.findMany.mockResolvedValue([]);
    prismaMocks.companyDeletionManifestEntry.findMany.mockResolvedValue([
      { id: "entry-1", objectKeyEncrypted: "old-object-locator" },
    ]);
    prismaMocks.companyDeletionManifestEntry.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    prismaMocks.companyDeletionManifestEntry.update.mockResolvedValue({});
    prismaMocks.companyDeletionManifestEntry.updateMany.mockResolvedValue({
      count: 1,
    });
    prismaMocks.companyDeletionRequest.update.mockResolvedValue({});
    prismaMocks.applicationDocument.findFirst.mockResolvedValue(null);
    prismaMocks.applicationArtifactPromotion.findFirst.mockResolvedValue(null);
    transactionMocks.$queryRaw.mockResolvedValue([]);
    transactionMocks.companyDeletionManifestEntry.updateMany.mockResolvedValue({
      count: 1,
    });
    transactionMocks.companyDeletionManifestEntry.update.mockResolvedValue({});
    transactionMocks.applicationDocument.findFirst.mockResolvedValue(null);
    transactionMocks.applicationArtifactPromotion.findFirst.mockResolvedValue(
      null,
    );
  });

  it("deletes the recorded object and completes the request", async () => {
    const result = await purgeCompanyDeletionRequest("deletion-request-1", {
      now: fixedNow,
      storage: storageMock,
    });

    expect(result).toMatchObject({
      status: "COMPLETED",
      deletedObjects: 1,
      retryableObjects: 0,
    });
    expect(storageMock.delete).toHaveBeenCalledWith("old-object-locator");
    expect(
      prismaMocks.companyDeletionManifestEntry.update,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "entry-1" },
        data: expect.objectContaining({
          state: "DELETED",
          outcomeCode: "OBJECT_DELETED",
        }),
      }),
    );
    expect(prismaMocks.companyDeletionRequest.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: "COMPLETED",
          purgeState: "COMPLETE",
        }),
      }),
    );
  });

  it("records an already absent object as a terminal idempotent outcome", async () => {
    storageMock.delete.mockResolvedValue({ deleted: false });

    const result = await purgeCompanyDeletionRequest("deletion-request-1", {
      now: fixedNow,
      storage: storageMock,
    });

    expect(result).toMatchObject({
      status: "COMPLETED",
      deletedObjects: 0,
      alreadyAbsentObjects: 1,
      retryableObjects: 0,
    });
    expect(
      prismaMocks.companyDeletionManifestEntry.update,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: "DELETED",
          outcomeCode: "OBJECT_ALREADY_ABSENT",
        }),
      }),
    );
  });

  it("does not delete a locator reused by a new live application object", async () => {
    prismaMocks.applicationDocument.findFirst.mockResolvedValue({
      id: "new-document-1",
    });

    const result = await purgeCompanyDeletionRequest("deletion-request-1", {
      now: fixedNow,
      storage: storageMock,
    });

    expect(result).toMatchObject({
      status: "RETRY_REQUIRED",
      conflictingObjects: 1,
    });
    expect(storageMock.delete).not.toHaveBeenCalled();
    expect(
      prismaMocks.companyDeletionManifestEntry.update,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: "CONFLICT",
          outcomeCode: "OBJECT_REUSED_AFTER_REQUEST",
        }),
      }),
    );
  });

  it("holds the atomic object claim while the reference check and delete run", async () => {
    let lockAcquired = false;
    transactionMocks.$queryRaw.mockImplementation(async () => {
      lockAcquired = true;
      return [];
    });
    storageMock.delete.mockImplementation(async () => {
      expect(lockAcquired).toBe(true);
      return { deleted: true };
    });

    await expect(
      purgeCompanyDeletionRequest("deletion-request-1", {
        now: fixedNow,
        storage: storageMock,
      }),
    ).resolves.toMatchObject({ status: "COMPLETED" });
    expect(transactionMocks.$queryRaw).toHaveBeenCalledOnce();
    expect(
      prismaMocks.companyDeletionManifestEntry.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ outcomeCode: "PURGE_CLAIMED" }),
      }),
    );
  });

  it("keeps a scanner/storage outage retryable without claiming completion", async () => {
    storageMock.assertReady.mockRejectedValue(
      Object.assign(new Error("not ready"), { code: "CV_STORAGE_NOT_READY" }),
    );

    const result = await purgeCompanyDeletionRequest("deletion-request-1", {
      now: fixedNow,
      storage: storageMock,
    });

    expect(result).toMatchObject({
      status: "RETRY_REQUIRED",
      retryableObjects: 1,
    });
    expect(storageMock.delete).not.toHaveBeenCalled();
    expect(
      prismaMocks.companyDeletionManifestEntry.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: "RETRYABLE",
          outcomeCode: "CV_STORAGE_NOT_READY",
        }),
      }),
    );
    expect(prismaMocks.companyDeletionRequest.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: "RETRY_REQUIRED",
          purgeState: "RETRYABLE",
        }),
      }),
    );
  });

  it("does not report completion while a legacy catalogue checkpoint is pending", async () => {
    prismaMocks.companyDeletionRequest.findUnique.mockResolvedValue({
      id: "deletion-request-1",
      state: "PURGING",
      purgeState: "PENDING",
      retentionEligibleAt: new Date("2026-09-01T00:00:00.000Z"),
      manifestEntries: [
        {
          resourceType: "LEGACY_CATALOGUE_APPLICATIONS",
          recordId: "company-1",
          state: "PENDING",
        },
      ],
    });

    await expect(
      purgeCompanyDeletionRequest("deletion-request-1", { now: fixedNow }),
    ).resolves.toMatchObject({
      status: "RETRY_REQUIRED",
      retryableObjects: 1,
    });
    expect(storageMock.delete).not.toHaveBeenCalled();
    expect(prismaMocks.companyDeletionRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: "RETRY_REQUIRED",
          purgeState: "RETRYABLE",
          lastFailureCode: "LEGACY_CATALOGUE_RECONCILIATION_PENDING",
        }),
      }),
    );
  });

  it("exposes a bounded reconciliation worker for retryable requests", async () => {
    const { runCompanyDeletionManifestReconciliation } =
      await import("@/backend/services/jobs/company-deletion-manifest-service");
    prismaMocks.companyDeletionRequest.findMany.mockResolvedValue([
      { id: "deletion-request-1" },
    ]);

    const result = await runCompanyDeletionManifestReconciliation(fixedNow, 10);

    expect(result).toEqual({
      claimed: 1,
      completed: 1,
      retryRequired: 0,
      blocked: 0,
    });
    expect(prismaMocks.companyDeletionRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 }),
    );
  });

  it("routes a blocked request through the retention re-evaluator", async () => {
    const { runCompanyDeletionManifestReconciliation } =
      await import("@/backend/services/jobs/company-deletion-manifest-service");
    prismaMocks.companyDeletionRequest.findMany.mockResolvedValue([
      { id: "blocked-request-1", state: "BLOCKED_BY_LEGAL_HOLD" },
    ]);
    const resumeBlocked = vi.fn().mockResolvedValue({
      requestId: "blocked-request-1",
      status: "BLOCKED_BY_LEGAL_HOLD",
      deletedObjects: 0,
      alreadyAbsentObjects: 0,
      retainedSharedObjects: 0,
      retryableObjects: 0,
      conflictingObjects: 0,
    });

    const result = await runCompanyDeletionManifestReconciliation(
      fixedNow,
      10,
      resumeBlocked,
    );

    expect(resumeBlocked).toHaveBeenCalledWith("blocked-request-1", fixedNow);
    expect(result).toEqual({
      claimed: 1,
      completed: 0,
      retryRequired: 0,
      blocked: 1,
    });
  });

  it("projects an owner-scoped receipt without company or object data", async () => {
    prismaMocks.companyDeletionRequest.findFirst.mockResolvedValue({
      id: "deletion-request-1",
      state: "RETRY_REQUIRED",
      holdState: "CLEAR",
      purgeState: "RETRYABLE",
      requestedAt: fixedNow,
      retentionEligibleAt: fixedNow,
      completedAt: null,
      manifestEntries: [
        { resourceKind: "DATABASE_RECORD", state: "DELETED" },
        { resourceKind: "OBJECT", state: "CONFLICT" },
      ],
    });

    const receipt = await getCompanyDeletionReceipt(
      "deletion-request-1",
      "owner-1",
    );

    expect(receipt).toEqual({
      requestId: "deletion-request-1",
      status: "RETRY_REQUIRED",
      holdState: "CLEAR",
      purgeState: "RETRYABLE",
      requestedAt: fixedNow.toISOString(),
      retentionEligibleAt: fixedNow.toISOString(),
      completedAt: null,
      manifest: {
        total: 2,
        databaseRecords: 1,
        objects: 1,
        pending: 0,
        deleted: 1,
        retainedShared: 0,
        blocked: 0,
        retryable: 0,
        conflicts: 1,
      },
    });
    expect(receipt).not.toHaveProperty("companyId");
    expect(receipt).not.toHaveProperty("objectKeyEncrypted");
    expect(receipt).not.toHaveProperty("lastFailureCode");
    expect(prismaMocks.companyDeletionRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "deletion-request-1", requestedByUserId: "owner-1" },
      }),
    );
  });

  it("returns no receipt for another account instead of disclosing its state", async () => {
    prismaMocks.companyDeletionRequest.findFirst.mockResolvedValue(null);

    await expect(
      getCompanyDeletionReceipt("deletion-request-1", "other-owner"),
    ).resolves.toBeNull();
  });

  it.each([
    ["REQUESTED", "PENDING"],
    ["ELIGIBLE", "PENDING"],
    ["PURGING", "PENDING"],
    ["BLOCKED_BY_LEGAL_HOLD", "BLOCKED"],
    ["RETRY_REQUIRED", "RETRY_REQUIRED"],
    ["COMPLETED", "COMPLETED"],
  ] as const)(
    "maps %s to the safe receipt status %s",
    async (state, status) => {
      prismaMocks.companyDeletionRequest.findFirst.mockResolvedValue({
        id: "deletion-request-1",
        state,
        holdState: state === "BLOCKED_BY_LEGAL_HOLD" ? "ACTIVE" : "CLEAR",
        purgeState:
          state === "BLOCKED_BY_LEGAL_HOLD"
            ? "BLOCKED"
            : state === "RETRY_REQUIRED"
              ? "RETRYABLE"
              : state === "COMPLETED"
                ? "COMPLETE"
                : "PENDING",
        requestedAt: fixedNow,
        retentionEligibleAt: fixedNow,
        completedAt: state === "COMPLETED" ? fixedNow : null,
        manifestEntries: [],
      });

      await expect(
        getCompanyDeletionReceipt("deletion-request-1", "owner-1"),
      ).resolves.toMatchObject({ status });
    },
  );
});
