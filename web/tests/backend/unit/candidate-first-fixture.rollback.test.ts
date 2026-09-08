import { beforeEach, describe, expect, it, vi } from "vitest";

const { baseFixture, createBaseMock, deleteBaseMock, prismaMock } = vi.hoisted(
  () => {
    const createBaseMock = vi.fn();
    const deleteBaseMock = vi.fn();
    const prismaMock = {
      candidateCv: { findUniqueOrThrow: vi.fn(), delete: vi.fn() },
      userAccount: { findUniqueOrThrow: vi.fn() },
      authProviderAccount: { create: vi.fn() },
      companyMembership: { create: vi.fn() },
      jobApplication: { create: vi.fn() },
      recruitmentThread: { create: vi.fn() },
      recruitmentMessage: { create: vi.fn() },
      inAppNotification: { create: vi.fn() },
    };
    const baseFixture = {
      suffix: "fixture-fault",
      company: { id: "company-fixture-fault", displayName: "Fixture Company" },
      userIds: ["candidate-fixture-fault", "employer-fixture-fault"],
      confirmedCvIds: ["cv-confirmed-fixture-fault"],
      jobs: { active: { id: "job-fixture-fault", slug: "job-fixture-fault" } },
    };
    return { baseFixture, createBaseMock, deleteBaseMock, prismaMock };
  },
);

vi.mock("@/backend/database/prisma", () => ({ prisma: prismaMock }));
vi.mock("../../helpers/job-board-database-fixture", () => ({
  createJobBoardDatabaseFixture: createBaseMock,
  deleteJobBoardDatabaseFixture: deleteBaseMock,
}));
vi.mock("../../helpers/job-application-cv-fixture", () => ({
  seedCleanJobApplicationCv: vi.fn().mockResolvedValue({
    candidateCvId: "candidate-cv-secure-fixture-fault",
    uploadId: "upload-secure-fixture-fault",
    artifactId: "artifact-secure-fixture-fault",
    assessmentId: "assessment-secure-fixture-fault",
    storageLocator: "secure-fixture-locator-00000000000000000000000000000000",
    checksumSha256: "a".repeat(64),
    byteSize: 32_000,
  }),
}));

import { createCandidateFirstDatabaseFixture } from "../../helpers/candidate-first-database-fixture";

describe("candidate-first fixture rollback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createBaseMock.mockResolvedValue(baseFixture);
    deleteBaseMock.mockResolvedValue(undefined);
    prismaMock.candidateCv.findUniqueOrThrow.mockResolvedValue({
      id: "cv-confirmed-fixture-fault",
      version: 1,
      displayName: "Confirmed CV",
      fileName: "candidate.pdf",
      mimeType: "application/pdf",
      byteSize: 32_000,
      storageKey: "fixtures/fixture-fault/confirmed.pdf",
      checksumSha256: "a".repeat(64),
    });
    prismaMock.userAccount.findUniqueOrThrow.mockResolvedValue({
      email: "candidate-fixture-fault@example.test",
    });
    prismaMock.authProviderAccount.create.mockResolvedValue({});
    prismaMock.companyMembership.create.mockResolvedValue({
      id: "membership-fixture-fault",
    });
    prismaMock.jobApplication.create.mockResolvedValue({});
    prismaMock.recruitmentThread.create.mockResolvedValue({});
    prismaMock.recruitmentMessage.create.mockResolvedValue({});
    prismaMock.inAppNotification.create.mockResolvedValue({});
  });

  it("rolls back the base namespace when a candidate entity fails mid-creation", async () => {
    const failure = new Error("injected membership failure");
    prismaMock.companyMembership.create.mockRejectedValueOnce(failure);

    await expect(createCandidateFirstDatabaseFixture("rollback")).rejects.toBe(
      failure,
    );
    expect(deleteBaseMock).toHaveBeenCalledOnce();
    expect(deleteBaseMock).toHaveBeenCalledWith(baseFixture);
  });

  it("does not hide a rollback failure behind the injected creation error", async () => {
    const creationFailure = new Error("injected application failure");
    const cleanupFailure = new Error("injected cleanup failure");
    prismaMock.jobApplication.create.mockRejectedValueOnce(creationFailure);
    deleteBaseMock.mockRejectedValueOnce(cleanupFailure);

    let thrown: unknown;
    try {
      await createCandidateFirstDatabaseFixture("rollback");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toEqual(
      expect.arrayContaining([creationFailure, cleanupFailure]),
    );
  });
});
