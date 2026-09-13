import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  jobApplication: {
    findUnique: vi.fn(),
  },
  candidateCv: {
    findFirst: vi.fn(),
  },
}));

const tracker = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("@/backend/database/prisma", () => ({ prisma: db }));

vi.mock(
  "@/backend/candidate-applications/candidate-application-tracking-service",
  () => ({
    CandidateApplicationTrackingService: class {
      get = tracker.get;
    },
  }),
);

import { CandidateApplicationSubmissionService } from "@/backend/candidate-applications/candidate-application-submission-service";

const actor = { userId: "candidate-1", sessionId: "session-1" };
const command = {
  draftId: "draft-1",
  expectedRevision: 1,
  informationConfirmed: true as const,
  shareContactWithRecruiter: true,
};

function receipt(applicationId = "application-1") {
  return {
    applicationId,
    submittedAt: "2026-09-09T12:00:00.000Z",
    intake: {
      state: "RECEIVED",
      progressPercent: 0,
      steps: [
        {
          code: "APPLICATION_RECEIVED",
          status: "COMPLETE",
          timestamp: "2026-09-09T12:00:00.000Z",
        },
        { code: "CHECKING_FILES", status: "ACTIVE", timestamp: null },
        { code: "SENT_TO_RECRUITER", status: "PENDING", timestamp: null },
      ],
      failureCode: null,
      updatedAt: "2026-09-09T12:00:00.000Z",
    },
    files: [
      {
        versionId: "cv-version-1",
        displayName: "CV",
        fileName: "cv.pdf",
        mimeType: "application/pdf",
        byteSize: 1,
        parseStatus: "READY",
      },
    ],
  };
}

function replayRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "application-1",
    jobPostingId: "job-1",
    jobSnapshot: {
      submissionBinding: {
        v: 1,
        candidateUserId: actor.userId,
        jobId: "job-1",
        draftId: command.draftId,
        expectedDraftRevision: command.expectedRevision,
        shareContactWithRecruiter: true,
      },
    },
    ...overrides,
  };
}

describe("CandidateApplicationSubmissionService idempotent replay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a consumed-draft replay whose logical command changed", async () => {
    db.jobApplication.findUnique.mockResolvedValue(replayRow());
    tracker.get.mockResolvedValue(receipt());
    const drafts = { getForSubmission: vi.fn() };
    const applications = { submit: vi.fn() };
    const service = new CandidateApplicationSubmissionService(
      drafts as never,
      applications as never,
    );

    await expect(
      service.submit(actor, "candidate-replay-key-0001", {
        ...command,
        expectedRevision: 2,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "APPLICATION_IDEMPOTENCY_KEY_REUSED",
    });

    expect(tracker.get).not.toHaveBeenCalled();
    expect(drafts.getForSubmission).not.toHaveBeenCalled();
    expect(applications.submit).not.toHaveBeenCalled();
  });

  it("returns the existing receipt for an exact consumed-draft replay", async () => {
    db.jobApplication.findUnique.mockResolvedValue(replayRow());
    tracker.get.mockResolvedValue(receipt());
    const drafts = { getForSubmission: vi.fn() };
    const applications = { submit: vi.fn() };
    const service = new CandidateApplicationSubmissionService(
      drafts as never,
      applications as never,
    );

    await expect(
      service.submit(actor, "candidate-replay-key-0001", command),
    ).resolves.toMatchObject({ applicationId: "application-1" });

    expect(tracker.get).toHaveBeenCalledWith(actor, "application-1");
    expect(drafts.getForSubmission).not.toHaveBeenCalled();
    expect(applications.submit).not.toHaveBeenCalled();
  });

  it("rejects a pre-CF-301 row whose consumed command cannot be verified", async () => {
    db.jobApplication.findUnique.mockResolvedValue(
      replayRow({ jobSnapshot: { jobId: "job-1" } }),
    );
    const trackerGet = tracker.get;
    const drafts = { getForSubmission: vi.fn() };
    const applications = { submit: vi.fn() };
    const service = new CandidateApplicationSubmissionService(
      drafts as never,
      applications as never,
    );

    await expect(
      service.submit(actor, "legacy-application-key-0001", command),
    ).rejects.toMatchObject({
      status: 409,
      code: "APPLICATION_IDEMPOTENCY_KEY_REUSED",
    });

    expect(trackerGet).not.toHaveBeenCalled();
    expect(drafts.getForSubmission).not.toHaveBeenCalled();
    expect(applications.submit).not.toHaveBeenCalled();
  });

  it("does not replay a row whose stored binding belongs to another Candidate", async () => {
    db.jobApplication.findUnique.mockResolvedValue(
      replayRow({
        jobSnapshot: {
          submissionBinding: {
            ...replayRow().jobSnapshot.submissionBinding,
            candidateUserId: "candidate-foreign",
          },
        },
      }),
    );
    const service = new CandidateApplicationSubmissionService(
      { getForSubmission: vi.fn() } as never,
      { submit: vi.fn() } as never,
    );

    await expect(
      service.submit(actor, "foreign-application-key-0001", command),
    ).rejects.toMatchObject({
      status: 409,
      code: "APPLICATION_IDEMPOTENCY_KEY_REUSED",
    });
    expect(tracker.get).not.toHaveBeenCalled();
  });

  it("rejects a consumed-draft replay whose contact-sharing choice changed", async () => {
    db.jobApplication.findUnique.mockResolvedValue(replayRow());
    tracker.get.mockResolvedValue(receipt());
    const service = new CandidateApplicationSubmissionService(
      { getForSubmission: vi.fn() } as never,
      { submit: vi.fn() } as never,
    );

    await expect(
      service.submit(actor, "candidate-replay-key-0001", {
        ...command,
        shareContactWithRecruiter: false,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "APPLICATION_IDEMPOTENCY_KEY_REUSED",
    });
    expect(tracker.get).not.toHaveBeenCalled();
  });

  it("recovers the committed receipt after a post-commit projection failure", async () => {
    db.jobApplication.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(replayRow());
    db.candidateCv.findFirst.mockResolvedValue({
      id: "cv-1",
      displayName: "CV",
      fileName: "cv.pdf",
      mimeType: "application/pdf",
      byteSize: 1,
      version: 1,
      confirmedAt: new Date("2026-09-09T12:00:00.000Z"),
      checksumSha256: "a".repeat(64),
      storageKey: "safe/cv-1",
      sourceArtifactId: "artifact-1",
      scanAssessmentId: "assessment-1",
      sourceArtifact: { id: "artifact-1" },
      scanAssessment: { id: "assessment-1", sourceArtifactId: "artifact-1" },
    });
    tracker.get
      .mockRejectedValueOnce(new Error("APPLICATION_RECEIPT_UNAVAILABLE"))
      .mockResolvedValueOnce(receipt());
    const drafts = {
      getForSubmission: vi.fn().mockResolvedValue({
        id: command.draftId,
        jobPostingId: "job-1",
        revision: command.expectedRevision,
        confirmationAccepted: true,
        personalInfoDraft: null,
        selectedCvId: "cv-1",
        coverLetterDraft: null,
        messageDraft: null,
      }),
      currentPersonalInfo: vi.fn().mockResolvedValue({
        fullName: "Candidate One",
        email: "candidate@example.test",
        phone: "0901234567",
        currentLocation: "Ho Chi Minh City",
        linkedInPortfolio: null,
      }),
    };
    const applications = {
      submit: vi.fn().mockResolvedValue({ applicationId: "application-1" }),
    };
    const service = new CandidateApplicationSubmissionService(
      drafts as never,
      applications as never,
    );

    await expect(
      service.submit(actor, "candidate-replay-key-0001", command),
    ).rejects.toThrow("APPLICATION_RECEIPT_UNAVAILABLE");
    await expect(
      service.submit(actor, "candidate-replay-key-0001", command),
    ).resolves.toMatchObject({ applicationId: "application-1" });

    expect(applications.submit).toHaveBeenCalledOnce();
    expect(drafts.getForSubmission).toHaveBeenCalledOnce();
  });
});
