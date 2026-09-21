import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApplicationReviewSubmit } from "@/frontend/features/candidate-applications/components/application-review-submit";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const review = {
  job: {
    id: "job-1",
    slug: "role",
    title: "Role",
    companyName: "Company",
    location: "Ho Chi Minh City",
    employmentType: "FULL_TIME",
    experienceLevel: "SENIOR",
    workArrangement: "HYBRID",
    applicationDeadline: null,
    isOpen: true,
  },
  draft: {
    draftId: "draft-1",
    jobId: "job-1",
    revision: 3,
    personalInformation: {
      fullName: "Candidate",
      email: "candidate@example.com",
      phone: "0901234567",
      currentLocation: "Ho Chi Minh City",
      linkedInPortfolio: null,
    },
    cv: {
      versionId: "cv-1",
      displayName: "Candidate CV.pdf",
      fileName: "Candidate CV.pdf",
      mimeType: "application/pdf",
      byteSize: 1_200_000,
      pageCount: null,
      parseStatus: "READY",
      confirmedAt: "2026-08-17T00:00:00.000Z",
    },
    cvSource: "UPLOADED",
    coverLetter: null,
    message: null,
    confirmationAccepted: false,
    updatedAt: "2026-08-17T00:00:00.000Z",
    expiresAt: "2026-09-16T00:00:00.000Z",
  },
} as const;

describe("application review and submit", () => {
  it("renders the shared draft, omits empty optional checklist entries, and requires confirmation", () => {
    render(
      <ApplicationReviewSubmit slug="role" review={review} csrfProof="csrf" />,
    );

    expect(screen.getByText("Candidate")).toBeVisible();
    expect(screen.getByText("Ho Chi Minh City")).toBeVisible();
    expect(screen.getByText("Not provided")).toBeVisible();
    expect(screen.getByText("Candidate CV.pdf")).toBeVisible();
    expect(screen.getByText("Uploaded")).toBeVisible();
    expect(screen.getByText("No cover letter added")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Submit application" }),
    ).toBeEnabled();

    const checklist = within(
      screen.getByRole("heading", { name: "Files to be submitted" })
        .parentElement as HTMLElement,
    );
    expect(checklist.getByText("Personal information")).toBeVisible();
    expect(checklist.getByText("CV Candidate CV.pdf")).toBeVisible();
    expect(checklist.queryByText("Cover letter")).not.toBeInTheDocument();
    expect(
      checklist.queryByText("Message to the recruiter"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Submit application" }));
    expect(
      screen.getByText("Confirm the application details before submitting."),
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /I confirm that the information is correct/i,
      }),
    );
    expect(
      screen.getByRole("button", { name: "Submit application" }),
    ).toBeEnabled();
  });

  it("keeps written cover-letter text read-only and saves the recruiter message in the draft", async () => {
    const reviewWithCoverLetter = {
      ...review,
      draft: {
        ...review.draft,
        coverLetter: {
          kind: "TEXT" as const,
          text: "I am excited to discuss how my experience fits this role.",
        },
      },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ...reviewWithCoverLetter.draft,
        revision: 4,
        message: "I would welcome the opportunity to speak.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ApplicationReviewSubmit
        slug="role"
        review={reviewWithCoverLetter}
        csrfProof="csrf"
      />,
    );

    expect(
      screen.getByText(reviewWithCoverLetter.draft.coverLetter.text)
        .parentElement,
    ).toHaveClass("application-review-submit__cover-preview");
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "I would welcome the opportunity to speak." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      coverLetter: reviewWithCoverLetter.draft.coverLetter,
      message: "I would welcome the opportunity to speak.",
    });
    vi.unstubAllGlobals();
  });
});
