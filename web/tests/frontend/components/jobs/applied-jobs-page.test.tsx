import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppliedJobsPage } from "@/frontend/features/jobs/components/applied-jobs-page";
import {
  applicationStageSchema,
  type CandidateApplicationSummary,
} from "@/shared/contracts/jobs/applications";

function application(
  stage: (typeof applicationStageSchema.options)[number],
  index: number,
): CandidateApplicationSummary {
  return {
    applicationId: `application-${index}`,
    jobId: `job-${index}`,
    jobSlug: `job-${index}`,
    jobTitle: `Role ${index}`,
    companyName: "SmartHire",
    companyLogoUrl: null,
    location: "Ho Chi Minh City",
    employmentType: "FULL_TIME",
    workArrangement: "HYBRID",
    stage,
    stageVersion: 1,
    submittedAt: "2026-08-01T00:00:00.000Z",
    lastStageChangedAt: "2026-08-02T00:00:00.000Z",
    jobAvailable: index !== 8,
    scoringStatus: "NOT_REQUESTED",
    aiMatchScore: null,
  };
}

const applications = applicationStageSchema.options.map(application);

describe("AppliedJobsPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the company logo field with a monogram fallback", () => {
    render(
      <AppliedJobsPage
        applications={[
          {
            ...applications[0]!,
            companyName: "Compass Capital",
            companyLogoUrl: "https://example.com/compass-capital/logo.png",
          },
        ]}
      />,
    );

    expect(screen.getByText("CC")).toBeVisible();
    expect(document.querySelector(".application-company-mark img")).toBeNull();
  });

  it("renders all canonical stages without legacy recruitment labels", () => {
    render(<AppliedJobsPage applications={applications} />);
    expect(document.querySelectorAll(".application-stage-badge")).toHaveLength(
      9,
    );
    expect(screen.queryByText("Screening")).not.toBeInTheDocument();
    expect(screen.queryByText("Matched")).not.toBeInTheDocument();
    expect(screen.queryByText("Not a fit")).not.toBeInTheDocument();
  });

  it("filters by semantic group and exact stage", () => {
    render(<AppliedJobsPage applications={applications} />);
    fireEvent.click(
      screen.getByRole("button", { name: /Terminal\s*3/u }),
    );
    expect(
      document.querySelectorAll(".application-tracking-card"),
    ).toHaveLength(3);

    fireEvent.click(
      screen.getByRole("button", { name: /All applications\s*9/u }),
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Stage" }), {
      target: { value: "WAITLISTED" },
    });
    expect(
      document.querySelectorAll(".application-tracking-card"),
    ).toHaveLength(1);
    expect(
      screen.getByText("Waitlisted", { selector: ".application-stage-badge" }),
    ).toBeVisible();
  });

  it("preserves unavailable applications and links by application ID", () => {
    render(<AppliedJobsPage applications={[applications[8]!]} />);
    const card = screen.getByRole("article");
    expect(within(card).getByText(/job is no longer available/u)).toBeVisible();
    expect(
      within(card).getByRole("link", { name: /View application/u }),
    ).toHaveAttribute("href", "/jobs/applied/application-8");
  });

  it("shows a recoverable state when CV scoring fails", () => {
    render(
      <AppliedJobsPage
        applications={[
          {
            ...applications[0]!,
            scoringStatus: "FAILED",
            scoringFailureCode: "CV_NOT_RECOGNIZED_AS_CV",
          },
        ]}
      />,
    );
    const card = screen.getByRole("article");
    expect(within(card).getByRole("alert")).toHaveTextContent(
      /does not appear to be a valid CV/i,
    );
    expect(
      within(card).getByRole("link", { name: /re-upload your CV/i }),
    ).toHaveAttribute("href", "/jobs/job-0/apply");
  });

  it("loads the next database page without duplicating applications", async () => {
    const next = application("APPLIED", 20);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          applications: [applications[0], next],
          nextCursor: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AppliedJobsPage applications={applications} nextCursor="cursor-1" />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Next page" }),
    );

    await waitFor(() => expect(screen.getByText("Role 20")).toBeVisible());
    expect(
      document.querySelectorAll(".application-tracking-card"),
    ).toHaveLength(10);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/candidate/applications?cursor=cursor-1&limit=24",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(
      screen.queryByRole("button", { name: "Load more applications" }),
    ).not.toBeInTheDocument();
  });
});
