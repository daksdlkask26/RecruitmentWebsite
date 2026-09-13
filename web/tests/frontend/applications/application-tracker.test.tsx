import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplicationTracker } from "@/frontend/features/candidate-applications/components/application-tracker";
import type { ApplicationTracker as ApplicationTrackerData } from "@/shared/contracts/candidate-applications";
import { applicationCopy } from "@/frontend/features/candidate-applications/i18n/application-copy";

const localeState = vi.hoisted(() => ({ value: "en" as "en" | "vi" }));

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
}));

vi.mock("@/frontend/features/authentication/client/current-csrf-proof", () => ({
  mutateWithCurrentCsrf: mocks.mutate,
}));

vi.mock("@/frontend/features/dashboard/client/workspace-locale", () => ({
  useWorkspaceLocale: () => localeState.value,
}));

const timestamp = "2026-08-18T09:01:00.000Z";

function offeredTracker(): ApplicationTrackerData {
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
    publicStage: "OUTCOME",
    publicOutcome: "OFFERED",
    canonicalStage: "OFFERED",
    transitionFromStage: "INTERVIEWING",
    stageVersion: 4,
    submittedAt: timestamp,
    lastUpdatedAt: timestamp,
    intake: {
      state: "SENT_TO_RECRUITER",
      progressPercent: 100,
      steps: [
        {
          code: "APPLICATION_RECEIVED",
          status: "COMPLETE",
          timestamp,
        },
        {
          code: "CHECKING_FILES",
          status: "COMPLETE",
          timestamp,
        },
        {
          code: "SENT_TO_RECRUITER",
          status: "COMPLETE",
          timestamp,
        },
      ],
      failureCode: null,
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
      {
        id: "update-2",
        eventCode: "OFFER_SENT",
        kind: "OUTCOME",
        publicStage: "OUTCOME",
        publicOutcome: "OFFERED",
        canonicalStage: "OFFERED",
        title: "Offer sent",
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
        fullName: "Submitted Candidate",
        headline: "Submitted Engineer",
        summary: "Submitted profile summary.",
        skills: ["TypeScript"],
        experience: [],
        education: [],
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
    contactConsent: { shared: false, version: 1 },
    canWithdraw: false,
  };
}

function appliedTracker(): ApplicationTrackerData {
  const base = offeredTracker();
  return {
    ...base,
    publicStage: "APPLICATION_SUBMITTED",
    publicOutcome: null,
    canonicalStage: "APPLIED",
    transitionFromStage: null,
    stageVersion: 1,
    updates: [base.updates[0]!],
    canWithdraw: true,
  };
}

function withdrawnTracker(): ApplicationTrackerData {
  const base = appliedTracker();
  const withdrawnAt = "2026-08-18T09:02:00.000Z";
  return {
    ...base,
    publicStage: "OUTCOME",
    publicOutcome: "WITHDRAWN",
    canonicalStage: "APPLIED",
    lastUpdatedAt: withdrawnAt,
    updates: [
      base.updates[0]!,
      {
        id: "withdrawal-1",
        eventCode: "APPLICATION_WITHDRAWN",
        kind: "WITHDRAWN",
        publicStage: "OUTCOME",
        publicOutcome: "WITHDRAWN",
        canonicalStage: null,
        title: "Application withdrawn",
        occurredAt: withdrawnAt,
      },
    ],
    canWithdraw: false,
  };
}

function renderTracker(
  initialTracker = offeredTracker(),
  refreshedTracker = offeredTracker(),
) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => refreshedTracker,
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("crypto", {
    randomUUID: () => "idempotency-key-123456",
  });
  return render(
    <ApplicationTracker initialTracker={initialTracker} csrfProof="csrf" />,
  );
}

afterEach(() => {
  localeState.value = "en";
  mocks.mutate.mockReset();
  vi.unstubAllGlobals();
});

describe("candidate offer response confirmation", () => {
  it("requires confirmation before accepting an offer", async () => {
    mocks.mutate.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    renderTracker();

    fireEvent.click(screen.getByRole("button", { name: "Accept offer" }));

    expect(
      screen.getByRole("dialog", { name: "Accept this offer?" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Confirm acceptance" }),
    ).toBeVisible();
    expect(mocks.mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mocks.mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Accept offer" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm acceptance" }));

    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1));
    expect(mocks.mutate).toHaveBeenCalledWith(
      "/api/candidate/applications/application-1/offer-response",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ decision: "ACCEPT", expectedVersion: 4 }),
      }),
      "csrf",
    );
  });

  it("requires confirmation before declining an offer", async () => {
    mocks.mutate.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    renderTracker();

    fireEvent.click(screen.getByRole("button", { name: "Decline offer" }));

    expect(
      screen.getByRole("dialog", { name: "Decline this offer?" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Confirm decline" }),
    ).toBeVisible();
    expect(mocks.mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm decline" }));

    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1));
    expect(mocks.mutate).toHaveBeenCalledWith(
      "/api/candidate/applications/application-1/offer-response",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ decision: "DECLINE", expectedVersion: 4 }),
      }),
      "csrf",
    );
  });
});

describe("candidate application withdrawal confirmation", () => {
  it("requires confirmation before withdrawing an application", async () => {
    mocks.mutate.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    renderTracker({ ...offeredTracker(), canWithdraw: true });

    fireEvent.click(
      screen.getByRole("button", { name: "Withdraw application" }),
    );

    expect(
      screen.getByRole("dialog", { name: "Withdraw this application?" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Confirm withdrawal" }),
    ).toBeVisible();
    expect(mocks.mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mocks.mutate).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Withdraw application" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm withdrawal" }));

    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1));
    expect(mocks.mutate).toHaveBeenCalledWith(
      "/api/candidate/applications/application-1/withdraw",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ expectedVersion: 4, confirmed: true }),
      }),
      "csrf",
    );
  });

  it("moves withdrawal into Outcome and shows one recent update", async () => {
    mocks.mutate.mockResolvedValue({
      ok: true,
      json: async () => ({
        applicationId: "application-1",
        outcome: "WITHDRAWN",
        withdrawnAt: "2026-08-18T09:02:00.000Z",
        preservedStage: "APPLIED",
        version: 1,
      }),
    });
    renderTracker(appliedTracker(), withdrawnTracker());

    fireEvent.click(
      screen.getByRole("button", { name: "Withdraw application" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm withdrawal" }));

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Application withdrawn" }),
      ).toBeVisible(),
    );

    const outcomeStep = screen.getByText("Outcome").closest("li");
    expect(outcomeStep).toHaveAttribute("data-step-state", "active");
    expect(screen.getByText("Interview").closest("li")).toHaveAttribute(
      "data-step-state",
      "skipped",
    );

    const recentUpdates = screen
      .getByRole("heading", { name: "Recent updates" })
      .closest("section");
    expect(recentUpdates).not.toBeNull();
    expect(
      within(recentUpdates!).getAllByText("Application withdrawn"),
    ).toHaveLength(1);
  });
});

describe("submitted application evidence", () => {
  it("renders the immutable snapshot and a safe unavailable state", () => {
    const tracker = offeredTracker();
    tracker.submission = {
      ...tracker.submission,
      cv: {
        availability: "EXPIRED",
        file: null,
        previewSupported: false,
      },
      message: "A submitted message that must remain visible.",
      answers: [
        {
          question: "What is your strongest skill?",
          answer: "Merchandising",
        },
      ],
    };
    renderTracker(tracker, tracker);

    const section = screen
      .getByRole("heading", { name: "Submitted files" })
      .closest("section");
    expect(section).not.toBeNull();
    expect(section!).toHaveTextContent(/Merchandising Manager/);
    expect(
      within(section!).getByText(
        "A submitted message that must remain visible.",
      ),
    ).toBeVisible();
    expect(within(section!).getByText("Expired")).toBeVisible();
    expect(within(section!).queryByRole("link", { name: "Open" })).toBeNull();
    expect(
      within(section!).queryByRole("link", { name: "Download" }),
    ).toBeNull();
  });

  it("uses the Vietnamese copy boundary for submitted and absent evidence", () => {
    localeState.value = "vi";
    const tracker = offeredTracker();
    tracker.submission = {
      ...tracker.submission,
      coverLetter: { kind: "NONE", availability: "NOT_PROVIDED" },
    };
    renderTracker(tracker, tracker);

    const copy = applicationCopy("vi").tracker;
    const section = screen
      .getByRole("heading", { name: copy.submittedFiles })
      .closest("section");
    expect(section).not.toBeNull();
    expect(section!).toHaveTextContent(new RegExp(copy.notProvided));
    expect(within(section!).getByText(copy.versionLocked)).toBeVisible();
  });

  it("renders submitted profile, contact, consent and the separate current sharing control", () => {
    renderTracker();

    const section = screen
      .getByRole("heading", { name: "Submitted files" })
      .closest("section");
    expect(section).not.toBeNull();
    expect(
      within(section!).getByRole("heading", { name: "Submitted profile" }),
    ).toBeVisible();
    expect(within(section!).getAllByText("Submitted Candidate")).toHaveLength(
      2,
    );
    expect(within(section!).getByText("submitted@example.test")).toBeVisible();
    expect(within(section!).getByText("0901234567")).toBeVisible();
    expect(within(section!).getByText("2026-08-01")).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Share contact with recruiter/i }),
    ).toBeVisible();
  });

  it("renders unavailable submitted profile, contact and consent states in Vietnamese", () => {
    localeState.value = "vi";
    const tracker = offeredTracker();
    tracker.submission = {
      ...tracker.submission,
      profile: { status: "UNAVAILABLE" },
      contact: { status: "UNAVAILABLE" },
      consent: { status: "UNAVAILABLE" },
    };
    renderTracker(tracker, tracker);

    const copy = applicationCopy("vi").tracker;
    expect(screen.getByText(copy.submittedProfileUnavailable)).toBeVisible();
    expect(screen.getByText(copy.submittedContactUnavailable)).toBeVisible();
    expect(screen.getByText(copy.submittedConsentUnavailable)).toBeVisible();
  });

  it("keeps the timeline semantic, deterministic and accessible in both locales", async () => {
    const tracker = offeredTracker();
    tracker.updates = [
      {
        ...tracker.updates[0]!,
        userMessage: "Exact recruiter-authored text — do not translate.",
      },
      tracker.updates[1]!,
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => tracker }),
    );
    vi.stubGlobal("crypto", { randomUUID: () => "idempotency-key-123456" });
    const rendered = render(
      <ApplicationTracker initialTracker={tracker} csrfProof="csrf" />,
    );
    const result = await axe.run(rendered.container, {
      rules: { "color-contrast": { enabled: false } },
    });

    const timeline = screen
      .getByRole("heading", { name: "Recent updates" })
      .closest("section");
    expect(timeline).not.toBeNull();
    expect(within(timeline!).getByRole("list")).toBeInTheDocument();
    expect(timeline!).toHaveTextContent(
      "Exact recruiter-authored text — do not translate.",
    );
    expect(timeline!.querySelectorAll("li")).toHaveLength(2);
    expect(timeline!.querySelector("time")?.getAttribute("dateTime")).toBe(
      timestamp,
    );
    expect(timeline!.querySelector('[data-event-code="OFFER_SENT"]')).not.toBe(
      null,
    );
    expect(timeline!.querySelector("time")).toHaveTextContent(
      new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeZone: "Asia/Ho_Chi_Minh",
      }).format(new Date(timestamp)),
    );
    expect(result.violations).toEqual([]);

    rendered.unmount();
    const technical = offeredTracker();
    technical.updates = [
      {
        id: "file-update-1",
        eventCode: "FILE_PROCESSING_UPDATED",
        kind: "TECHNICAL_UPDATE",
        publicStage: null,
        publicOutcome: null,
        canonicalStage: null,
        title: "Application file check updated",
        occurredAt: timestamp,
      },
    ];
    const technicalRendered = renderTracker(technical, technical);
    const technicalTimeline = screen
      .getByRole("heading", { name: "Recent updates" })
      .closest("section");
    expect(technicalTimeline).not.toBeNull();
    expect(
      technicalTimeline!.querySelector(
        '[data-event-code="FILE_PROCESSING_UPDATED"]',
      ),
    ).toHaveClass("is-technical");
    expect(technicalTimeline!.querySelector("li svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );

    technicalRendered.unmount();
    const empty = offeredTracker();
    empty.updates = [];
    const emptyRendered = renderTracker(empty, empty);
    expect(screen.getByText("No public updates yet.")).toBeVisible();
    emptyRendered.unmount();

    mocks.mutate.mockResolvedValue(
      new Response(JSON.stringify({ code: "TEMPORARY_FAILURE" }), {
        status: 503,
      }),
    );
    const errorRendered = renderTracker();
    fireEvent.click(
      screen.getByRole("button", { name: /Share contact with recruiter/i }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        applicationCopy("en").tracker.contactConsentError,
      ),
    );
    expect(
      screen.getByRole("heading", { name: "Recent updates" }),
    ).toBeVisible();
    errorRendered.unmount();

    rendered.unmount();
    localeState.value = "vi";
    render(<ApplicationTracker initialTracker={tracker} csrfProof="csrf" />);
    expect(
      screen.getByRole("heading", {
        name: applicationCopy("vi").tracker.recentUpdates,
      }),
    ).toBeVisible();
    expect(
      screen.getByText("Exact recruiter-authored text — do not translate."),
    ).toBeVisible();
    expect(
      screen
        .getByRole("heading", {
          name: applicationCopy("vi").tracker.recentUpdates,
        })
        .closest("section")
        ?.querySelector("time"),
    ).toHaveTextContent(
      new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "medium",
        timeZone: "Asia/Ho_Chi_Minh",
      }).format(new Date(timestamp)),
    );
  });
});
