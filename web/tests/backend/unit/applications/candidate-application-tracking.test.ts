import { describe, expect, it, vi } from "vitest";
import { CandidateApplicationTrackingService } from "@/backend/candidate-applications/candidate-application-tracking-service";

const submittedAt = new Date("2026-08-18T09:01:00.000Z");
const withdrawnAt = new Date("2026-08-18T09:02:00.000Z");

function withdrawnRow(
  publicUpdates: unknown[] = [
    {
      id: "withdrawal-update-1",
      kind: "WITHDRAWN",
      // Legacy rows may still contain the preserved public stage here. The
      // candidate projection must expose the effective terminal Outcome.
      publicStage: "APPLICATION_SUBMITTED",
      publicOutcome: "WITHDRAWN",
      title: "Application withdrawn",
      effectiveAt: withdrawnAt,
      sourceEventReference: null,
    },
  ],
) {
  return {
    id: "application-1",
    candidateUserId: "candidate-1",
    jobPostingId: "job-1",
    stage: "APPLIED",
    stageVersion: 1,
    submittedAt,
    lastStageChangedAt: submittedAt,
    withdrawalOutcome: "CANDIDATE_WITHDRAWN",
    withdrawnAt,
    cvSnapshot: {
      cvId: "cv-1",
      displayName: "Candidate CV",
      fileName: "candidate-cv.pdf",
      mimeType: "application/pdf",
      byteSize: 1_024,
      cvVersion: 1,
    },
    jobSnapshot: {
      title: "Software Engineer",
      companyName: "Unity Trading Co.",
      location: "Ho Chi Minh City",
    },
    selectedCv: {
      id: "cv-1",
      displayName: "Candidate CV",
      fileName: "candidate-cv.pdf",
      mimeType: "application/pdf",
      byteSize: 1_024,
      version: 1,
      confirmedAt: submittedAt,
    },
    jobPosting: {
      slug: "software-engineer",
      title: "Software Engineer",
      location: "Ho Chi Minh City",
      employmentType: "FULL_TIME",
      experienceLevel: "MID",
      workArrangement: "ON_SITE",
      applicationDeadline: null,
      status: "ACTIVE",
      removedAt: null,
      company: { displayName: "Unity Trading Co.", logoUrl: null },
    },
    applicationDocuments: [],
    intake: {
      state: "SENT_TO_RECRUITER",
      progressPercent: 100,
      receivedAt: submittedAt,
      checkingStartedAt: submittedAt,
      sentAt: submittedAt,
      failureCode: null,
      version: 1,
      updatedAt: submittedAt,
    },
    publicUpdates,
    stageEvents: [
      {
        id: "stage-1",
        fromStage: null,
        toStage: "APPLIED",
        occurredAt: submittedAt,
      },
    ],
    notificationPreference: {
      emailEnabled: true,
      inAppEnabled: true,
      version: 1,
      updatedAt: submittedAt,
    },
    candidate: { user: { preferences: { applicationUpdatesEmail: true } } },
  };
}

async function getTracker(publicUpdates?: unknown[]) {
  const repository = {
    getTracker: vi.fn().mockResolvedValue(withdrawnRow(publicUpdates)),
  };
  return new CandidateApplicationTrackingService(repository as never).get(
    { userId: "candidate-1", sessionId: "session-1" },
    "application-1",
  );
}

describe("candidate application withdrawal projection", () => {
  it("exposes Outcome: Withdrawn while preserving the canonical stage and timeline entry", async () => {
    const result = await getTracker();

    expect(result).toMatchObject({
      publicStage: "OUTCOME",
      publicOutcome: "WITHDRAWN",
      canonicalStage: "APPLIED",
      lastUpdatedAt: withdrawnAt.toISOString(),
    });
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]).toMatchObject({
      kind: "WITHDRAWN",
      publicStage: "OUTCOME",
      publicOutcome: "WITHDRAWN",
      title: "Application withdrawn",
    });
  });

  it("creates one fallback withdrawal update only when the persisted update is missing", async () => {
    const result = await getTracker([]);

    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]).toMatchObject({
      id: "withdrawal:application-1",
      kind: "WITHDRAWN",
      publicStage: "OUTCOME",
    });
  });
});

describe("candidate application list projection", () => {
  it("builds summaries from the lightweight list row", async () => {
    const repository = {
      list: vi.fn().mockResolvedValue([
        {
          id: "application-1",
          jobPostingId: "job-1",
          stage: "APPLIED",
          stageVersion: 1,
          submittedAt,
          lastStageChangedAt: submittedAt,
          withdrawalOutcome: null,
          withdrawnAt: null,
          jobSnapshot: {
            title: "Software Engineer",
            companyName: "Unity Trading Co.",
            location: "Ho Chi Minh City",
          },
          jobPosting: {
            slug: "software-engineer",
            title: "Software Engineer",
            location: "Ho Chi Minh City",
            status: "ACTIVE",
            removedAt: null,
            company: { displayName: "Unity Trading Co.", logoUrl: null },
          },
        },
      ]),
    };

    const result = await new CandidateApplicationTrackingService(
      repository as never,
    ).list({ userId: "candidate-1", sessionId: "session-1" });

    expect(repository.list).toHaveBeenCalledWith("candidate-1", 24, undefined);
    expect(result).toEqual({
      applications: [
        expect.objectContaining({
          applicationId: "application-1",
          jobTitle: "Software Engineer",
          companyName: "Unity Trading Co.",
          canonicalStage: "APPLIED",
          publicStage: "APPLICATION_SUBMITTED",
          publicOutcome: null,
          jobAvailable: true,
        }),
      ],
      nextCursor: null,
    });
  });
});
