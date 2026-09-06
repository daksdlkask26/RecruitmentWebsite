import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TeamApplicationCommandError,
  TeamApplicationService,
} from "@/backend/services/company-members/team-application-service";

const { createNotificationMock, prismaMock, transaction, tx } = vi.hoisted(
  () => {
    const tx = {
      company: { findFirst: vi.fn() },
      companyMembership: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
      },
      teamOpportunity: { upsert: vi.fn() },
      teamApplication: { findFirst: vi.fn(), create: vi.fn() },
      auditEvent: { create: vi.fn() },
    };
    const transaction = vi.fn();
    const prismaMock = {
      $transaction: transaction,
      userAccount: { findUnique: vi.fn() },
      companyInvitation: { updateMany: vi.fn() },
      teamApplication: { findFirst: vi.fn(), updateMany: vi.fn() },
      candidateCvArtifactPromotion: {
        create: vi.fn(),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
    };
    return {
      createNotificationMock: vi.fn(),
      prismaMock,
      transaction,
      tx,
    };
  },
);

vi.mock("@/backend/database/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/backend/notifications/notification-service", () => ({
  createInAppNotification: createNotificationMock,
}));

describe("TeamApplicationService owner availability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transaction.mockImplementation(
      async (callback: (value: typeof tx) => unknown) => callback(tx),
    );
    prismaMock.userAccount.findUnique.mockResolvedValue({
      email: "candidate@example.com",
      state: "ACTIVE",
      candidateIdentity: { userId: "candidate-1" },
    });
    prismaMock.companyInvitation.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.teamApplication.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.teamApplication.findFirst.mockResolvedValue(null);
    prismaMock.candidateCvArtifactPromotion.create.mockResolvedValue({});
    prismaMock.candidateCvArtifactPromotion.findUnique.mockResolvedValue(null);
    prismaMock.candidateCvArtifactPromotion.updateMany.mockResolvedValue({
      count: 1,
    });
    tx.company.findFirst.mockResolvedValue({
      id: "company-1",
      displayName: "Northstar Labs",
    });
    tx.companyMembership.findMany.mockResolvedValue([]);
    tx.companyMembership.findUnique.mockResolvedValue(null);
    tx.teamApplication.findFirst.mockResolvedValue(null);
    tx.teamApplication.create.mockResolvedValue({ id: "application-1" });
    tx.auditEvent.create.mockResolvedValue({});
    tx.teamOpportunity.upsert.mockResolvedValue({
      id: "opportunity-1",
      state: "OPEN",
    });
  });

  it("rejects a submission when no active Owner can receive it", async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const prepared = {
      cleanup,
      claimOwnership: vi.fn(),
      displayName: "resume.pdf",
      fileName: "resume.pdf",
      mimeType: "application/pdf",
      byteSize: 64,
      storageKey: "team-cv-1",
      checksumSha256: "a".repeat(64),
    };

    await expect(
      new TeamApplicationService({} as never).submit(
        "candidate-1",
        "company-1",
        "HR_MANAGER",
        prepared as never,
      ),
    ).rejects.toMatchObject({
      code: "TEAM_COMPANY_UNAVAILABLE",
    } satisfies Partial<TeamApplicationCommandError>);

    expect(cleanup).toHaveBeenCalledOnce();
    expect(tx.teamOpportunity.upsert).not.toHaveBeenCalled();
  });

  it("notifies every active Owner after creating a team application", async () => {
    tx.companyMembership.findMany.mockResolvedValue([
      { userId: "owner-1" },
      { userId: "owner-2" },
    ]);
    const repository = {
      findForCandidate: vi.fn().mockResolvedValue({
        id: "application-1",
        companyId: "company-1",
        appliedRole: "HR_MANAGER",
        status: "SUBMITTED",
        submittedAt: new Date("2026-08-27T00:00:00.000Z"),
        ownerFirstViewedAt: null,
        decidedAt: null,
        joinedAt: null,
        company: { displayName: "Northstar Labs", slug: "northstar-labs" },
        invitation: null,
      }),
    };
    const prepared = {
      cleanup: vi.fn().mockResolvedValue(undefined),
      claimOwnership: vi.fn(),
      displayName: "resume.pdf",
      fileName: "resume.pdf",
      mimeType: "application/pdf",
      byteSize: 64,
      storageKey: "team-cv-2",
      checksumSha256: "b".repeat(64),
    };

    const result = await new TeamApplicationService(repository as never).submit(
      "candidate-1",
      "company-1",
      "HR_MANAGER",
      prepared as never,
      new Date("2026-08-27T00:00:00.000Z"),
    );

    expect(result.created).toBe(true);
    expect(createNotificationMock).toHaveBeenCalledTimes(2);
    expect(createNotificationMock).toHaveBeenNthCalledWith(
      1,
      tx,
      expect.objectContaining({
        recipientUserId: "owner-1",
        kind: "TEAM_APPLICATION_RECEIVED",
        contextId: "company-1",
        variables: expect.objectContaining({
          companyName: "Northstar Labs",
          state: "HR_MANAGER",
        }),
      }),
    );
    expect(prepared.claimOwnership).toHaveBeenCalledOnce();
    expect(prepared.cleanup).not.toHaveBeenCalled();
  });

  it("keeps an owned CV when the post-commit candidate projection fails", async () => {
    tx.companyMembership.findMany.mockResolvedValue([{ userId: "owner-1" }]);
    const deleteOwnedArtifact = vi.fn();
    let owned = false;
    const prepared = {
      claimOwnership: vi.fn(() => {
        owned = true;
      }),
      preserveOnUnknown: vi.fn(() => {
        owned = true;
      }),
      cleanup: vi.fn(async () => {
        if (!owned) deleteOwnedArtifact();
      }),
      displayName: "resume.pdf",
      fileName: "resume.pdf",
      mimeType: "application/pdf",
      byteSize: 64,
      storageKey: "team-cv-post-commit",
      checksumSha256: "c".repeat(64),
    };
    const repository = {
      findForCandidate: vi
        .fn()
        .mockRejectedValue(new Error("PROJECTION_FAILED")),
    };

    await expect(
      new TeamApplicationService(repository as never).submit(
        "candidate-1",
        "company-1",
        "HR_MANAGER",
        prepared as never,
      ),
    ).rejects.toThrow("PROJECTION_FAILED");

    expect(prepared.claimOwnership).toHaveBeenCalledOnce();
    expect(prepared.cleanup).not.toHaveBeenCalled();
    expect(deleteOwnedArtifact).not.toHaveBeenCalled();
  });

  it("retains a CV when the transaction outcome cannot be read", async () => {
    const prepared = {
      cleanup: vi.fn().mockResolvedValue(undefined),
      claimOwnership: vi.fn(),
      preserveOnUnknown: vi.fn(),
      displayName: "resume.pdf",
      fileName: "resume.pdf",
      mimeType: "application/pdf",
      byteSize: 64,
      storageKey: "team-cv-db-outage",
      checksumSha256: "f".repeat(64),
    };
    transaction.mockRejectedValueOnce(new Error("P1001"));

    await expect(
      new TeamApplicationService({} as never).submit(
        "candidate-1",
        "company-1",
        "HR_MANAGER",
        prepared as never,
      ),
    ).rejects.toThrow("P1001");

    expect(prepared.preserveOnUnknown).toHaveBeenCalledOnce();
    expect(prepared.cleanup).not.toHaveBeenCalled();
  });

  it("preserves an owned CV when the commit ledger acknowledgement is unknown", async () => {
    tx.companyMembership.findMany.mockResolvedValue([{ userId: "owner-1" }]);
    prismaMock.candidateCvArtifactPromotion.updateMany.mockRejectedValueOnce(
      new Error("LEDGER_COMMIT_UNKNOWN"),
    );
    const prepared = {
      cleanup: vi.fn().mockResolvedValue(undefined),
      claimOwnership: vi.fn(),
      preserveOnUnknown: vi.fn(),
      displayName: "resume.pdf",
      fileName: "resume.pdf",
      mimeType: "application/pdf",
      byteSize: 64,
      storageKey: "team-cv-ledger-commit-failure",
      checksumSha256: "a".repeat(64),
    };

    await expect(
      new TeamApplicationService({} as never).submit(
        "candidate-1",
        "company-1",
        "HR_MANAGER",
        prepared as never,
      ),
    ).rejects.toThrow("LEDGER_COMMIT_UNKNOWN");

    expect(transaction).toHaveBeenCalledOnce();
    expect(prepared.claimOwnership).toHaveBeenCalledOnce();
    expect(prepared.preserveOnUnknown).toHaveBeenCalledOnce();
    expect(prepared.cleanup).not.toHaveBeenCalled();
  });

  it("preserves the upload when the first Team Application ledger write fails", async () => {
    prismaMock.candidateCvArtifactPromotion.create.mockRejectedValueOnce(
      new Error("LEDGER_STAGE_UNKNOWN"),
    );
    const prepared = {
      cleanup: vi.fn().mockResolvedValue(undefined),
      claimOwnership: vi.fn(),
      preserveOnUnknown: vi.fn(),
      displayName: "resume.pdf",
      fileName: "resume.pdf",
      mimeType: "application/pdf",
      byteSize: 64,
      storageKey: "team-cv-ledger-first-failure",
      checksumSha256: "f".repeat(64),
    };

    await expect(
      new TeamApplicationService({} as never).submit(
        "candidate-1",
        "company-1",
        "HR_MANAGER",
        prepared as never,
      ),
    ).rejects.toThrow("LEDGER_STAGE_UNKNOWN");

    expect(transaction).not.toHaveBeenCalled();
    expect(prepared.preserveOnUnknown).toHaveBeenCalledOnce();
    expect(prepared.cleanup).not.toHaveBeenCalled();
  });

  it("replays an existing active key without creating a second application", async () => {
    tx.companyMembership.findMany.mockResolvedValue([{ userId: "owner-1" }]);
    const firstPrepared = {
      cleanup: vi.fn().mockResolvedValue(undefined),
      claimOwnership: vi.fn(),
      displayName: "first.pdf",
      fileName: "first.pdf",
      mimeType: "application/pdf",
      byteSize: 64,
      storageKey: "team-cv-first",
      checksumSha256: "d".repeat(64),
    };
    const secondPrepared = {
      cleanup: vi.fn().mockResolvedValue(undefined),
      claimOwnership: vi.fn(),
      displayName: "retry.pdf",
      fileName: "retry.pdf",
      mimeType: "application/pdf",
      byteSize: 64,
      storageKey: "team-cv-retry",
      checksumSha256: "e".repeat(64),
    };
    const repository = {
      findForCandidate: vi.fn().mockResolvedValue({
        id: "application-1",
        companyId: "company-1",
        appliedRole: "HR_MANAGER",
        status: "SUBMITTED",
        submittedAt: new Date("2026-08-27T00:00:00.000Z"),
        ownerFirstViewedAt: null,
        decidedAt: null,
        joinedAt: null,
        company: { displayName: "Northstar Labs", slug: "northstar-labs" },
        invitation: null,
      }),
    };

    await expect(
      new TeamApplicationService(repository as never).submit(
        "candidate-1",
        "company-1",
        "HR_MANAGER",
        firstPrepared as never,
      ),
    ).resolves.toMatchObject({ created: true });

    prismaMock.teamApplication.findFirst.mockResolvedValue({
      id: "application-1",
    });
    await expect(
      new TeamApplicationService(repository as never).submit(
        "candidate-1",
        "company-1",
        "HR_MANAGER",
        secondPrepared as never,
      ),
    ).resolves.toMatchObject({ created: false });

    expect(tx.teamApplication.create).toHaveBeenCalledOnce();
    expect(firstPrepared.claimOwnership).toHaveBeenCalledOnce();
    expect(secondPrepared.claimOwnership).not.toHaveBeenCalled();
    expect(secondPrepared.cleanup).toHaveBeenCalledOnce();
  });
});
