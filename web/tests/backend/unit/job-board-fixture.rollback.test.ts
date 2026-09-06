import { beforeEach, describe, expect, it, vi } from "vitest";

const { delegates, prismaMock, companyCreateMock, userCreateMock } = vi.hoisted(
  () => {
    const makeDelegate = () => ({
      create: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    });
    const delegates = {
      company: makeDelegate(),
      userAccount: makeDelegate(),
      skill: makeDelegate(),
      jobPosting: makeDelegate(),
      recruitmentThread: makeDelegate(),
      recruitmentNotificationWork: makeDelegate(),
      emailOutbox: makeDelegate(),
      moderationReport: makeDelegate(),
      applicationAnswer: makeDelegate(),
      applicationArtifactPromotion: makeDelegate(),
      inAppNotification: makeDelegate(),
      recruitmentMessage: makeDelegate(),
      jobApplicationAttemptCounter: makeDelegate(),
      jobApplication: makeDelegate(),
      jobReport: makeDelegate(),
      savedJob: makeDelegate(),
      candidateCv: makeDelegate(),
      applicationQuestion: makeDelegate(),
      jobPostingSkill: makeDelegate(),
      candidateProfileSkill: makeDelegate(),
      companyMembership: makeDelegate(),
      candidateIdentity: makeDelegate(),
      authProviderAccount: makeDelegate(),
    };
    const retentionTransaction = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      cvUpload: makeDelegate(),
      cvImportConfirmation: makeDelegate(),
      cvProcessingConsent: makeDelegate(),
      cvRetryRequest: makeDelegate(),
      cvDraft: makeDelegate(),
      cvParseJob: makeDelegate(),
      cvExtraction: makeDelegate(),
      cvScanAssessment: makeDelegate(),
      cvStoredArtifact: makeDelegate(),
      cvAccountQuota: makeDelegate(),
    };
    const prismaMock = {
      ...delegates,
      $transaction: vi.fn(
        async (callback: (client: typeof retentionTransaction) => unknown) =>
          callback(retentionTransaction),
      ),
    };
    return {
      delegates,
      prismaMock,
      companyCreateMock: delegates.company.create,
      userCreateMock: delegates.userAccount.create,
    };
  },
);

vi.mock("@/backend/database/prisma", () => ({ prisma: prismaMock }));
vi.mock("../../helpers/test-database-guard", () => ({
  assertTestDatabaseEnvironment: vi.fn(),
}));

import {
  createJobBoardDatabaseFixture,
  deleteJobBoardDatabaseFixture,
} from "../../helpers/job-board-database-fixture";

describe("job-board fixture rollback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const delegate of Object.values(delegates)) {
      delegate.findMany.mockResolvedValue([]);
      delegate.findUnique.mockResolvedValue(null);
      delegate.deleteMany.mockResolvedValue({ count: 0 });
    }
    companyCreateMock.mockResolvedValue({
      id: "company-fixture-rollback",
      displayName: "Fixture Company",
    });
  });

  it("rolls back a partially-created namespace when the first user fails", async () => {
    const failure = new Error("injected user failure");
    userCreateMock.mockRejectedValueOnce(failure);

    await expect(createJobBoardDatabaseFixture("rollback")).rejects.toBe(
      failure,
    );

    expect(delegates.jobPosting.findMany).toHaveBeenCalledOnce();
    expect(delegates.company.deleteMany).toHaveBeenCalledWith({
      where: { id: expect.stringMatching(/^company-/u) },
    });
    expect(delegates.userAccount.deleteMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: expect.arrayContaining([
            expect.stringMatching(/^job-rollback-a-/u),
          ]),
        },
      },
    });
    expect(delegates.skill.deleteMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: expect.arrayContaining([
            expect.stringMatching(/^skill-/u),
            expect.stringMatching(/^skill-python-/u),
          ]),
        },
      },
    });
  });

  it("keeps a fixture-created skill when another fixture still references it", async () => {
    delegates.jobPostingSkill.findMany.mockResolvedValue([
      { skillId: "skill-shared" },
    ]);

    await expect(
      deleteJobBoardDatabaseFixture({
        company: { id: "company-shared" },
        userIds: ["candidate-shared"],
        suffix: "shared",
        createdSkillIds: ["skill-shared"],
      }),
    ).resolves.toBeUndefined();

    expect(delegates.skill.deleteMany).not.toHaveBeenCalled();
  });
});
