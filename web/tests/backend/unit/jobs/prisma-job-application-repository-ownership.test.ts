import { beforeEach, describe, expect, it, vi } from "vitest";
import { DIRECT_APPLICATION_CV_ID } from "@/shared/contracts/jobs/actions";
import { ApplicationRepositoryError } from "@/backend/services/jobs/application-policy";

const { ensureCandidateCvLibraryMock } = vi.hoisted(() => ({
  ensureCandidateCvLibraryMock: vi.fn(),
}));

vi.mock("@/backend/database/prisma", () => ({ prisma: {} }));
vi.mock("@/backend/services/profile/candidate-cv-library", () => ({
  ensureCandidateCvLibrary: ensureCandidateCvLibraryMock,
}));

import { PrismaJobApplicationRepository } from "@/backend/repositories/jobs/prisma-job-application-repository";

type TestStorage = {
  assertReady: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

function prepared(
  storageKey: string,
  checksumSha256 = "a".repeat(64),
) {
  return {
    id: `application-cv-${storageKey}`,
    displayName: "resume.pdf",
    fileName: "resume.pdf",
    mimeType: "application/pdf",
    byteSize: 64,
    storageKey,
    checksumSha256,
    claimOwnership: vi.fn(),
    preserveOnUnknown: vi.fn(),
  };
}

function application(created: boolean, applicationId = "application-1") {
  return {
    applicationId,
    jobId: "job-1",
    stage: "APPLIED" as const,
    stageVersion: 1,
    submittedAt: "2026-08-01T00:00:00.000Z",
    created,
    message: created
      ? "Application submitted."
      : "Your application was already submitted.",
  };
}

function input(directCv: ReturnType<typeof prepared>) {
  return {
    candidateUserId: "candidate-1",
    sessionId: "session-1",
    jobId: "job-1",
    idempotencyKey: "application-key-00000001",
    submissionBindingDigest: directCv.checksumSha256,
    command: {
      cvId: DIRECT_APPLICATION_CV_ID,
      answers: [],
      coverLetter: null,
      consentVersion: "2026-08-01",
      consentAccepted: true,
    } as never,
    directCv,
    activeConsentVersion: "2026-08-01",
    occurredAt: new Date("2026-08-01T00:00:00.000Z"),
    correlationId: "correlation-1",
  };
}

function database() {
  const transaction = vi.fn();
  const db = {
    jobApplication: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    applicationArtifactPromotion: {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
    applicationDocument: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: transaction,
  };
  return db;
}

function storage(): TestStorage {
  return {
    assertReady: vi.fn().mockResolvedValue(undefined),
    put: vi.fn(),
    open: vi.fn(),
    delete: vi.fn().mockResolvedValue({ deleted: true }),
  };
}

describe("PrismaJobApplicationRepository artifact ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureCandidateCvLibraryMock.mockResolvedValue(undefined);
  });

  it("stages a direct CV before the transaction and claims it after commit", async () => {
    const direct = prepared("direct-cv-committed");
    const db = database();
    db.$transaction.mockResolvedValue({
      application: application(true),
      created: true,
    });
    const repository = new PrismaJobApplicationRepository(db as never, storage() as never);

    await expect(repository.submit(input(direct) as never)).resolves.toMatchObject({
      created: true,
    });

    expect(db.applicationArtifactPromotion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: "PROMOTED",
          storageKeyEncrypted: "direct-cv-committed",
          contentDigestSha256: "a".repeat(64),
        }),
      }),
    );
    expect(direct.claimOwnership).toHaveBeenCalledOnce();
    expect(direct.preserveOnUnknown).not.toHaveBeenCalled();
  });

  it("preserves the artifact when the first ledger write has an unknown outcome", async () => {
    const direct = prepared("direct-cv-ledger-first-failure");
    const db = database();
    db.applicationArtifactPromotion.create.mockRejectedValueOnce(
      new Error("LEDGER_FIRST_WRITE_UNKNOWN"),
    );
    const repository = new PrismaJobApplicationRepository(db as never, storage() as never);

    await expect(repository.submit(input(direct) as never)).rejects.toThrow(
      "LEDGER_FIRST_WRITE_UNKNOWN",
    );
    expect(direct.preserveOnUnknown).toHaveBeenCalled();
    expect(direct.claimOwnership).not.toHaveBeenCalled();
  });

  it("preserves both artifacts when the second ledger write fails", async () => {
    const direct = prepared("direct-cv-ledger-second-failure", "b".repeat(64));
    const coverLetter = prepared("direct-cover-letter-ledger-second-failure", "c".repeat(64));
    const db = database();
    const artifactStorage = storage();
    db.applicationArtifactPromotion.create
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("LEDGER_SECOND_WRITE_UNKNOWN"));
    const repository = new PrismaJobApplicationRepository(db as never, artifactStorage as never);

    await expect(
      repository.submit({
        ...input(direct),
        directCoverLetter: coverLetter,
        command: {
          cvId: DIRECT_APPLICATION_CV_ID,
          answers: [],
          consentVersion: "2026-08-01",
          consentAccepted: true,
          coverLetter: { kind: "FILE", fileName: coverLetter.fileName },
        },
      } as never),
    ).rejects.toThrow("LEDGER_SECOND_WRITE_UNKNOWN");
    expect(direct.preserveOnUnknown).toHaveBeenCalled();
    expect(coverLetter.preserveOnUnknown).toHaveBeenCalled();
    expect(artifactStorage.delete).not.toHaveBeenCalled();
  });

  it("keeps the artifact when the database outcome is unavailable", async () => {
    const direct = prepared("direct-cv-db-outage");
    const db = database();
    db.$transaction.mockRejectedValue(new Error("P1001"));
    db.applicationArtifactPromotion.findMany.mockRejectedValue(
      new Error("P1001"),
    );
    const artifactStorage = storage();
    const repository = new PrismaJobApplicationRepository(
      db as never,
      artifactStorage as never,
    );

    await expect(repository.submit(input(direct) as never)).rejects.toThrow(
      "P1001",
    );

    expect(artifactStorage.delete).not.toHaveBeenCalled();
    expect(direct.preserveOnUnknown).toHaveBeenCalledOnce();
  });

  it("preserves a matching locator and digest on a replay", async () => {
    const direct = prepared("direct-cv-replay", "b".repeat(64));
    const db = database();
    db.$transaction.mockResolvedValue({
      application: application(false),
      created: false,
    });
    db.applicationArtifactPromotion.findMany.mockImplementation(
      async (args: { where: { id: { in: string[] } } }) =>
        args.where.id.in.map((id) => ({
          id,
          state: "PROMOTED",
          jobApplicationId: null,
          storageKeyEncrypted: "direct-cv-replay",
          contentDigestSha256: "b".repeat(64),
        })),
    );
    db.jobApplication.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "application-1",
        applicationDocuments: [
          {
            storageKeyEncrypted: "direct-cv-replay",
            contentDigestHmac: "b".repeat(64),
          },
        ],
      });
    const artifactStorage = storage();
    const repository = new PrismaJobApplicationRepository(
      db as never,
      artifactStorage as never,
    );

    await expect(repository.submit(input(direct) as never)).resolves.toMatchObject({
      created: false,
    });

    expect(artifactStorage.delete).not.toHaveBeenCalled();
    expect(direct.claimOwnership).toHaveBeenCalledOnce();
  });

  it("retains a locator collision with a different digest for reconciliation", async () => {
    const direct = prepared("direct-cv-collision", "c".repeat(64));
    const db = database();
    db.$transaction.mockResolvedValue({
      application: application(false),
      created: false,
    });
    db.applicationArtifactPromotion.findMany.mockImplementation(
      async (args: { where: { id: { in: string[] } } }) =>
        args.where.id.in.map((id) => ({
          id,
          state: "PROMOTED",
          jobApplicationId: null,
          storageKeyEncrypted: "direct-cv-collision",
        })),
    );
    db.jobApplication.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "application-1",
        applicationDocuments: [
          {
            storageKeyEncrypted: "direct-cv-collision",
            contentDigestHmac: "d".repeat(64),
          },
        ],
      });
    const artifactStorage = storage();
    const repository = new PrismaJobApplicationRepository(
      db as never,
      artifactStorage as never,
    );

    await expect(repository.submit(input(direct) as never)).resolves.toMatchObject({
      created: false,
    });

    expect(artifactStorage.delete).not.toHaveBeenCalled();
    expect(direct.preserveOnUnknown).toHaveBeenCalledOnce();
  });

  it("retries cleanup through the durable ledger after a proven domain rollback", async () => {
    const direct = prepared("direct-cv-retry");
    const db = database();
    db.$transaction.mockRejectedValue(
      new ApplicationRepositoryError("APPLICATION_CV_INELIGIBLE"),
    );
    db.applicationArtifactPromotion.findMany.mockImplementation(
      async (args: { where: { id: { in: string[] } } }) =>
        args.where.id.in.map((id) => ({
          id,
          state: "PROMOTED",
          jobApplicationId: null,
          storageKeyEncrypted: "direct-cv-retry",
        })),
    );
    const artifactStorage = storage();
    const repository = new PrismaJobApplicationRepository(
      db as never,
      artifactStorage as never,
    );

    await expect(repository.submit(input(direct) as never)).rejects.toThrow(
      "APPLICATION_CV_INELIGIBLE",
    );

    expect(artifactStorage.delete).toHaveBeenCalledOnce();
    expect(db.applicationArtifactPromotion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: "DELETED" }),
      }),
    );
  });
});
