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
    profileSnapshot: {
      v: 1,
      candidateName: "Submitted Candidate",
      headline: "Submitted Engineer",
      summary: "Submitted profile summary.",
      skills: [{ id: "skill-1", label: "TypeScript" }],
      experience: [],
      education: [],
    },
    contactSnapshot: {
      fullName: "Submitted Candidate",
      email: "submitted@example.test",
      phone: "0901234567",
      location: "Da Nang",
    },
    consentVersion: "2026-08-01",
    consentedAt: submittedAt,
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
    contactConsent: {
      sharedAt: submittedAt,
      withdrawnAt: null,
      version: 2,
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
    expect(result.updates).toHaveLength(2);
    expect(result.updates).toContainEqual(
      expect.objectContaining({
        eventCode: "APPLICATION_SUBMITTED",
        kind: "SUBMITTED",
      }),
    );
    expect(result.updates).toContainEqual(
      expect.objectContaining({
        kind: "WITHDRAWN",
        publicStage: "OUTCOME",
        publicOutcome: "WITHDRAWN",
        title: "Application withdrawn",
      }),
    );
  });

  it("does not infer a withdrawal update from mutable withdrawal state", async () => {
    const result = await getTracker([]);

    expect(result.updates).toHaveLength(1);
    expect(result.updates).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventCode: "APPLICATION_WITHDRAWN" }),
      ]),
    );
  });
});

describe("candidate application immutable submission projection", () => {
  it("keeps submitted job, CV, answers and text evidence when live records change", async () => {
    const base = withdrawnRow([]);
    const row = {
      ...base,
      withdrawalOutcome: null as "CANDIDATE_WITHDRAWN" | null,
      withdrawnAt: null as Date | null,
      jobSnapshot: {
        ...base.jobSnapshot,
        title: "Submitted Engineer",
        companyName: "Submitted Company",
        location: "Da Nang",
        employmentType: "CONTRACT",
        experienceLevel: "SENIOR",
        workArrangement: "REMOTE",
        requiredSkills: ["TypeScript", "PostgreSQL"],
        jobVersion: 7,
      },
      cvSnapshot: {
        cvId: "submitted-cv",
        displayName: "Submitted CV",
        fileName: "submitted.pdf",
        mimeType: "application/pdf",
        byteSize: 512,
        cvVersion: 3,
      },
      selectedCv: {
        ...base.selectedCv,
        id: "live-cv",
        displayName: "Changed CV",
        version: 99,
      },
      jobPosting: {
        ...base.jobPosting,
        title: "Changed job",
        location: "Hanoi",
        company: { displayName: "Changed company", logoUrl: null },
      },
      submissionMessage: "Submitted message",
      answers: [
        { questionSnapshot: { prompt: "Can you start?" }, answer: "Yes" },
      ],
      coverLetterText: {
        textEncrypted: "Submitted cover letter",
        ordinaryAccessDeniedAt: null,
        deleteAfter: null,
        deletedAt: null,
      },
      legalHolds: [],
      documentAccessDeniedAt: null,
      documentDeletedAt: null,
    };
    const repository = { getTracker: vi.fn().mockResolvedValue(row) };

    const result = await new CandidateApplicationTrackingService(
      repository as never,
    ).get({ userId: "candidate-1", sessionId: "session-1" }, "application-1");

    expect(result.submission).toMatchObject({
      job: {
        title: "Submitted Engineer",
        companyName: "Submitted Company",
        location: "Da Nang",
        employmentType: "CONTRACT",
        experienceLevel: "SENIOR",
        workArrangement: "REMOTE",
        requiredSkills: ["TypeScript", "PostgreSQL"],
        version: 7,
      },
      cv: {
        file: {
          versionId: "submitted-cv",
          displayName: "Submitted CV",
          version: 3,
        },
      },
      coverLetter: { kind: "TEXT", text: "Submitted cover letter" },
      answers: [{ question: "Can you start?", answer: "Yes" }],
      message: "Submitted message",
      profile: {
        status: "AVAILABLE",
        fullName: "Submitted Candidate",
        headline: "Submitted Engineer",
        summary: "Submitted profile summary.",
        skills: ["TypeScript"],
      },
      contact: {
        status: "AVAILABLE",
        fullName: "Submitted Candidate",
        email: "submitted@example.test",
        phone: "0901234567",
        location: "Da Nang",
      },
      consent: {
        status: "AVAILABLE",
        version: "2026-08-01",
        consentedAt: submittedAt.toISOString(),
      },
    });
  });

  it("fails conservatively when legacy snapshot fields are missing", async () => {
    const legacyRow = { ...withdrawnRow([]) } as Record<string, unknown>;
    delete legacyRow.profileSnapshot;
    delete legacyRow.contactSnapshot;
    delete legacyRow.consentVersion;
    delete legacyRow.consentedAt;
    const repository = { getTracker: vi.fn().mockResolvedValue(legacyRow) };

    const result = await new CandidateApplicationTrackingService(
      repository as never,
    ).get({ userId: "candidate-1", sessionId: "session-1" }, "application-1");

    expect(result.submission.profile).toEqual({ status: "UNAVAILABLE" });
    expect(result.submission.contact).toEqual({ status: "UNAVAILABLE" });
    expect(result.submission.consent).toEqual({ status: "UNAVAILABLE" });
  });

  it("keeps current contact sharing state separate from submitted contact evidence", async () => {
    const row = withdrawnRow([]);
    const repository = { getTracker: vi.fn().mockResolvedValue(row) };

    const result = await new CandidateApplicationTrackingService(
      repository as never,
    ).get({ userId: "candidate-1", sessionId: "session-1" }, "application-1");

    expect(result.submission.contact).toMatchObject({
      fullName: "Submitted Candidate",
      email: "submitted@example.test",
      phone: "0901234567",
      location: "Da Nang",
    });
    expect(result.contactConsent).toEqual({ shared: true, version: 2 });
  });
});

describe("candidate application public timeline contract", () => {
  it.each([
    ["APPLIED", "APPLICATION_SUBMITTED", "SUBMITTED"],
    ["VIEWED", "APPLICATION_VIEWED", "UNDER_REVIEW"],
    ["SHORTLISTED", "APPLICATION_SHORTLISTED", "UNDER_REVIEW"],
    ["INTERVIEWING", "INTERVIEW_STARTED", "INTERVIEW"],
    ["OFFERED", "OFFER_SENT", "OUTCOME"],
    ["HIRED", "OFFER_ACCEPTED", "OUTCOME"],
    ["OFFER_DECLINED", "OFFER_DECLINED", "OUTCOME"],
    ["REJECTED", "APPLICATION_REJECTED", "OUTCOME"],
    ["WAITLISTED", "APPLICATION_WAITLISTED", "OUTCOME"],
  ] as const)(
    "projects %s as the stable public event",
    async (stage, eventCode, kind) => {
      const row = withdrawnRow([]);
      Object.assign(row, {
        stage,
        withdrawalOutcome: null,
        withdrawnAt: null,
        stageVersion: 2,
        lastStageChangedAt: new Date("2026-08-18T09:03:00.000Z"),
        stageEvents: [
          {
            id: `event-${stage}`,
            fromStage: "APPLIED",
            toStage: stage,
            occurredAt: new Date("2026-08-18T09:03:00.000Z"),
            candidateVisible: true,
            candidateVisibleReason:
              "Candidate-authored reason exactly as entered.",
          },
        ],
      });
      const repository = { getTracker: vi.fn().mockResolvedValue(row) };
      const result = await new CandidateApplicationTrackingService(
        repository as never,
      ).get({ userId: "candidate-1", sessionId: "session-1" }, "application-1");

      expect(result.updates).toHaveLength(1);
      expect(result.updates[0]).toMatchObject({
        eventCode,
        kind,
        userMessage: "Candidate-authored reason exactly as entered.",
      });
    },
  );

  it("deduplicates a public update and its referenced stage event, including a replay", async () => {
    const row = withdrawnRow([
      {
        id: "public-stage-1",
        kind: "UNDER_REVIEW",
        publicStage: "UNDER_REVIEW",
        publicOutcome: null,
        title: "Application viewed",
        effectiveAt: new Date("2026-08-18T09:03:00.000Z"),
        sourceEventReference: "event-viewed",
      },
      {
        id: "public-stage-replay",
        kind: "UNDER_REVIEW",
        publicStage: "UNDER_REVIEW",
        publicOutcome: null,
        title: "Application viewed",
        effectiveAt: new Date("2026-08-18T09:03:00.000Z"),
        sourceEventReference: "event-viewed",
      },
    ]);
    Object.assign(row, {
      withdrawalOutcome: null,
      withdrawnAt: null,
      stage: "VIEWED",
      stageVersion: 2,
      stageEvents: [
        {
          id: "event-viewed",
          fromStage: "APPLIED",
          toStage: "VIEWED",
          occurredAt: new Date("2026-08-18T09:03:00.000Z"),
          candidateVisible: true,
          candidateVisibleReason: "Exact recruiter message.",
        },
      ],
    });
    const repository = { getTracker: vi.fn().mockResolvedValue(row) };
    const result = await new CandidateApplicationTrackingService(
      repository as never,
    ).get({ userId: "candidate-1", sessionId: "session-1" }, "application-1");

    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]).toMatchObject({
      eventCode: "APPLICATION_VIEWED",
      userMessage: "Exact recruiter message.",
    });
  });

  it("suppresses private events and sorts equal timestamps by stable event id", async () => {
    const row = withdrawnRow([]);
    Object.assign(row, {
      withdrawalOutcome: null,
      withdrawnAt: null,
      stage: "SHORTLISTED",
      stageVersion: 3,
      stageEvents: [
        {
          id: "z-private",
          fromStage: "VIEWED",
          toStage: "REJECTED",
          occurredAt: submittedAt,
          candidateVisible: false,
          candidateVisibleReason: "Private rejection detail",
        },
        {
          id: "b-visible",
          fromStage: "APPLIED",
          toStage: "VIEWED",
          occurredAt: submittedAt,
          candidateVisible: true,
          candidateVisibleReason: null,
        },
        {
          id: "a-visible",
          fromStage: "VIEWED",
          toStage: "SHORTLISTED",
          occurredAt: submittedAt,
          candidateVisible: true,
          candidateVisibleReason: null,
        },
      ],
    });
    const repository = { getTracker: vi.fn().mockResolvedValue(row) };
    const result = await new CandidateApplicationTrackingService(
      repository as never,
    ).get({ userId: "candidate-1", sessionId: "session-1" }, "application-1");

    expect(result.updates.map((update) => update.id)).toEqual([
      "a-visible",
      "b-visible",
    ]);
    expect(result.updates).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventCode: "APPLICATION_REJECTED" }),
      ]),
    );
  });

  it("keeps technical file-processing updates separate from recruitment stages", async () => {
    const row = withdrawnRow([
      {
        id: "file-processing-1",
        kind: "TECHNICAL_UPDATE",
        publicStage: null,
        publicOutcome: null,
        title: "Internal file processing wording",
        effectiveAt: new Date("2026-08-18T09:04:00.000Z"),
        sourceEventReference: null,
      },
    ]);
    Object.assign(row, {
      withdrawalOutcome: null,
      withdrawnAt: null,
      stageEvents: [],
    });
    const repository = { getTracker: vi.fn().mockResolvedValue(row) };
    const result = await new CandidateApplicationTrackingService(
      repository as never,
    ).get({ userId: "candidate-1", sessionId: "session-1" }, "application-1");

    expect(result.updates).toEqual([
      expect.objectContaining({
        id: "file-processing-1",
        eventCode: "FILE_PROCESSING_UPDATED",
        kind: "TECHNICAL_UPDATE",
        publicStage: null,
        publicOutcome: null,
        canonicalStage: null,
      }),
    ]);
  });
});

describe("candidate application list projection", () => {
  it("builds summaries from the lightweight list row", async () => {
    const repository = {
      list: vi.fn().mockResolvedValue({
        rows: [
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
        ],
        total: 1,
        counts: {
          ALL: 1,
          APPLICATION_SUBMITTED: 1,
          UNDER_REVIEW: 0,
          INTERVIEW: 0,
          OUTCOME: 0,
          WITHDRAWN: 0,
        },
      }),
    };

    const result = await new CandidateApplicationTrackingService(
      repository as never,
    ).list({ userId: "candidate-1", sessionId: "session-1" });

    expect(repository.list).toHaveBeenCalledWith({
      candidateUserId: "candidate-1",
      limit: 24,
      filter: "ALL",
      sort: "SUBMITTED_DESC",
      cursor: null,
    });
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
      hasMore: false,
      total: 1,
      counts: {
        ALL: 1,
        APPLICATION_SUBMITTED: 1,
        UNDER_REVIEW: 0,
        INTERVIEW: 0,
        OUTCOME: 0,
        WITHDRAWN: 0,
      },
      filter: "ALL",
      sort: "SUBMITTED_DESC",
    });
  });
});

describe("candidate application document availability projection", () => {
  async function availability(changes: Record<string, unknown>) {
    const row = withdrawnRow([]);
    Object.assign(row, changes);
    const repository = { getTracker: vi.fn().mockResolvedValue(row) };
    const result = await new CandidateApplicationTrackingService(
      repository as never,
    ).get({ userId: "candidate-1", sessionId: "session-1" }, "application-1");
    return result.submission.cv.availability;
  }

  it.each([
    ["missing document", {}, "TEMPORARILY_UNAVAILABLE"],
    [
      "application retention denial",
      { documentAccessDeniedAt: new Date("2026-01-01") },
      "EXPIRED",
    ],
    [
      "application deletion",
      { documentDeletedAt: new Date("2026-01-01") },
      "DELETED",
    ],
    [
      "active legal hold",
      {
        legalHolds: [
          { startsAt: new Date("2026-01-01"), endsAt: null, releasedAt: null },
        ],
      },
      "HELD",
    ],
  ])(
    "reports %s without exposing retention internals",
    async (_name, changes, expected) => {
      await expect(availability(changes)).resolves.toBe(expected);
    },
  );
});
