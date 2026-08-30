import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PipelineApplicationCard } from "@/shared/contracts/applications";
import { RecruitmentPipelineBoard } from "@/frontend/features/recruiter-applications/recruitment-pipeline-board";

const card = (
  applicationId: string,
  displayName: string,
): PipelineApplicationCard => ({
  applicationId,
  candidate: { displayName, avatarUrl: null },
  submittedAt: "2026-08-29T00:00:00.000Z",
  stage: "APPLIED",
  stageVersion: 1,
  documents: { cvAvailable: true, coverLetterAvailable: false },
  score: null,
  allowedDestinations: ["VIEWED", "REJECTED"],
  dragDestinations: ["VIEWED", "REJECTED"],
});

const first = card("application-ada", "Ada Candidate");
const second = card("application-grace", "Grace Candidate");

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
          "APPLIED",
          "VIEWED",
          "SHORTLISTED",
          "INTERVIEWING",
          "OFFERED",
          "HIRED",
          "OFFER_DECLINED",
          "REJECTED",
          "WAITLISTED",
        ].map((stage) => ({
          stage,
          label: stage,
          count: stage === "APPLIED" ? 2 : 0,
        })),
        observedAt: "2026-08-29T00:00:00.000Z",
      },
      columns: {
        APPLIED: {
          page: {
            stage: "APPLIED",
            items: [first, second],
            nextCursor: null,
            hasMore: false,
            observedAt: "2026-08-29T00:00:00.000Z",
          },
          loading: false,
          loadingMore: false,
          error: null,
        },
      },
      loading: false,
      error: null,
      loadStage: vi.fn(),
      loadMore: vi.fn(),
      retry: vi.fn(),
      move: vi.fn(),
      moveDrag: vi.fn(),
      moveMany: vi.fn(),
    }),
  }),
);

afterEach(() => vi.useRealTimers());

describe("RecruitmentPipelineBoard hover preview", () => {
  it("never displays the previous candidate while switching hover targets", () => {
    vi.useFakeTimers();
    render(<RecruitmentPipelineBoard jobId="job-1" />);

    const firstCard = screen
      .getByText(first.candidate.displayName)
      .closest("article");
    const secondCard = screen
      .getByText(second.candidate.displayName)
      .closest("article");
    expect(firstCard).not.toBeNull();
    expect(secondCard).not.toBeNull();

    fireEvent.mouseEnter(firstCard!);
    act(() => vi.advanceTimersByTime(280));
    expect(
      screen.getByRole("heading", { name: first.candidate.displayName }),
    ).toBeVisible();

    fireEvent.mouseEnter(secondCard!);
    expect(
      screen.queryByRole("heading", { name: first.candidate.displayName }),
    ).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(280));
    expect(
      screen.getByRole("heading", { name: second.candidate.displayName }),
    ).toBeVisible();
  });
});
