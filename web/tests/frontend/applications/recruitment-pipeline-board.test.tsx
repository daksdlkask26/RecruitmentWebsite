import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RecruitmentPipelineBoard } from "@/frontend/features/recruiter-applications/recruitment-pipeline-board";

vi.mock(
  "@/frontend/features/recruiter-applications/use-recruitment-pipeline",
  () => ({
    useRecruitmentPipeline: () => ({
      metadata: {
        job: { jobId: "job-1", title: "Engineer", status: "ACTIVE" },
        permissions: {
          role: "OWNER",
          canView: true,
          canMoveStages: true,
          canReject: true,
          canRecordOfferDeclined: true,
          canConfirmHired: true,
        },
        stages: [
           "New",
          "Viewed",
          "Shortlisted",
          "Interviewing",
           "Offer",
          "Hired",
           "Offer declined",
          "Rejected",
           "Needs details",
        ].map((label, index) => ({
          stage: [
            "APPLIED",
            "VIEWED",
            "SHORTLISTED",
            "INTERVIEWING",
            "OFFERED",
            "HIRED",
            "OFFER_DECLINED",
            "REJECTED",
            "WAITLISTED",
          ][index],
          label,
          count: 0,
        })),
        observedAt: new Date().toISOString(),
      },
      columns: {},
      loading: false,
      error: null,
      loadStage: vi.fn(),
      loadMore: vi.fn(),
      retry: vi.fn(),
    }),
  }),
);

describe("RecruitmentPipelineBoard", () => {
  it("renders all canonical columns plus the read-only Withdrawn column", () => {
    render(<RecruitmentPipelineBoard jobId="job-1" />);
    const columns = screen.getAllByRole("region");
    expect(columns).toHaveLength(10);
    expect(
      columns.map((column) => within(column).getByRole("heading").textContent),
    ).toEqual([
      "New",
      "Viewed",
      "Shortlisted",
      "Interviewing",
      "Offer",
      "Hired",
      "Offer declined",
      "Rejected",
      "Needs details",
      "Withdrawn",
    ]);
    expect(screen.getByText(/read.only/i)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /offer declined/i }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "View full list" }),
    ).toHaveLength(10);
    expect(screen.getByRole("region", { name: /withdrawn/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});
