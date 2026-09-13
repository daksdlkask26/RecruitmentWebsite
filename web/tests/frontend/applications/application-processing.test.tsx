import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplicationProcessing } from "@/frontend/features/candidate-applications/components/application-processing";
import type { ApplicationTracker } from "@/shared/contracts/candidate-applications";

const timestamp = "2026-08-18T09:01:00.000Z";

function tracker(
  state: ApplicationTracker["intake"]["state"],
): ApplicationTracker {
  const complete = state === "SENT_TO_RECRUITER";
  const attention = state === "ATTENTION_REQUIRED";
  return {
    applicationId: "application-1",
    job: {
      jobId: "job-1",
      slug: "merchandising-manager",
      title: "Merchandising Manager",
      companyName: "Unity Trading Co.",
      companyLogoUrl: null,
      location: "Ho Chi Minh City",
      employmentType: "FULL_TIME",
      experienceLevel: "MID",
      workArrangement: "ON_SITE",
      applicationDeadline: null,
      jobAvailable: true,
    },
    publicStage: "APPLICATION_SUBMITTED",
    publicOutcome: null,
    canonicalStage: "APPLIED",
    stageVersion: 1,
    submittedAt: timestamp,
    lastUpdatedAt: timestamp,
    intake: {
      state,
      progressPercent: complete ? 100 : attention ? 45 : 45,
      steps: [
        {
          code: "APPLICATION_RECEIVED",
          status: "COMPLETE",
          timestamp,
        },
        {
          code: "CHECKING_FILES",
          status: complete
            ? "COMPLETE"
            : attention
              ? "ATTENTION_REQUIRED"
              : "ACTIVE",
          timestamp,
        },
        {
          code: "SENT_TO_RECRUITER",
          status: complete ? "COMPLETE" : "PENDING",
          timestamp: complete ? timestamp : null,
        },
      ],
      failureCode: attention ? "APPLICATION_FILE_CHECK_FAILED" : null,
      updatedAt: timestamp,
    },
    updates: [
      {
        id: "update-1",
        eventCode: "APPLICATION_SUBMITTED",
        kind: "SUBMITTED",
        publicStage: "APPLICATION_SUBMITTED",
        publicOutcome: null,
        canonicalStage: "APPLIED",
        title: "Application submitted",
        occurredAt: timestamp,
      },
    ],
    files: [
      {
        versionId: "cv-1",
        displayName: "candidate-cv.pdf",
        fileName: "candidate-cv.pdf",
        mimeType: "application/pdf",
        byteSize: 1_024,
        version: 1,
        pageCount: 1,
        parseStatus: "READY",
        confirmedAt: timestamp,
      },
    ],
    submission: {
      profile: {
        status: "AVAILABLE",
        fullName: "Candidate",
        headline: "TypeScript Engineer",
        summary: null,
        skills: [],
        experience: [],
        education: [],
      },
      contact: {
        status: "AVAILABLE",
        fullName: "Candidate",
        email: "candidate@example.test",
        phone: "0901234567",
        location: "Ho Chi Minh City",
      },
      consent: {
        status: "AVAILABLE",
        version: "2026-08-01",
        consentedAt: timestamp,
      },
      job: {
        available: true,
        title: "Merchandising Manager",
        companyName: "Unity Trading Co.",
        location: "Ho Chi Minh City",
        employmentType: "FULL_TIME",
        experienceLevel: "MID",
        workArrangement: "ON_SITE",
        requiredSkills: ["Merchandising"],
        version: 1,
      },
      cv: {
        availability: "AVAILABLE",
        file: {
          versionId: "cv-1",
          displayName: "candidate-cv.pdf",
          fileName: "candidate-cv.pdf",
          mimeType: "application/pdf",
          byteSize: 1_024,
          version: 1,
          pageCount: 1,
          parseStatus: "READY",
          confirmedAt: timestamp,
        },
        previewSupported: true,
      },
      coverLetter: { kind: "NONE", availability: "NOT_PROVIDED" },
      answers: [],
      message: null,
    },
    notificationPreference: {
      emailEnabled: true,
      inAppEnabled: true,
      version: 1,
      updatedAt: timestamp,
    },
    canWithdraw: true,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("application processing status", () => {
  it("renders a completed intake as complete and does not poll", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    render(
      <ApplicationProcessing
        initialTracker={tracker("SENT_TO_RECRUITER")}
        csrfProof="csrf"
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: "Your application is ready for review",
      }),
    ).toBeVisible();
    expect(screen.getByText("COMPLETE")).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: "Your application has been sent to the recruiter",
      }),
    ).toBeVisible();
    expect(screen.queryByText("PROCESSING")).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100",
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops scheduling polls after a processing response becomes complete", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => tracker("SENT_TO_RECRUITER"),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    render(
      <ApplicationProcessing
        initialTracker={tracker("CHECKING_FILES")}
        csrfProof="csrf"
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(screen.getByText("COMPLETE")).toBeVisible();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
