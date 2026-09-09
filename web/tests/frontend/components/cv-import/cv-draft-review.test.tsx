import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CvDraftReview } from "@/frontend/features/cv-import/components/cv-draft-review";
import {
  cvConfirmationReceiptFixture,
  cvDraftReviewFixture,
} from "../../../fixtures/cv-draft-review";

const { toast } = vi.hoisted(() => ({
  toast: { error: vi.fn() },
}));
const navigation = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

afterEach(() => {
  vi.unstubAllGlobals();
  toast.error.mockClear();
});

describe("CV draft review", () => {
  it("compares, edits, exposes evidence, and keeps bulk choices independent", () => {
    const addListener = vi.spyOn(window, "addEventListener");
    render(
      <CvDraftReview initial={cvDraftReviewFixture} csrfProof="csrf_test" />,
    );
    expect(screen.getByText("Current engineer")).toBeVisible();
    expect(screen.getByDisplayValue("Platform engineer")).toBeVisible();
    expect(screen.getByText("91%")).toBeVisible();
    expect(
      screen.getAllByText("Provenance unavailable.").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Source context unavailable.").length,
    ).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText(/Proposed headline/i), {
      target: { value: "Edited platform engineer" },
    });
    expect(screen.getByText("Unsaved review changes.")).toBeVisible();
    expect(addListener).toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Add all proposed skills" }),
    );
    const skillCard = screen
      .getByLabelText("Proposed skill")
      .closest("article");
    expect(skillCard).not.toBeNull();
    expect(
      within(skillCard as HTMLElement).getByRole("radio", { name: /add/i }),
    ).toBeChecked();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("saves a complete payload, reconciles the server revision, and blocks duplicates", async () => {
    const next = {
      ...cvDraftReviewFixture,
      draftRevision: 1,
      proposals: {
        ...cvDraftReviewFixture.proposals,
        scalars: [
          {
            ...cvDraftReviewFixture.proposals.scalars[0],
            value: "Edited platform engineer",
          },
        ],
      },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            draftId: cvDraftReviewFixture.draftId,
            draftRevision: 1,
            reviewedProfileRevision: 2,
            savedAt: "2026-08-01T08:10:00.000Z",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(next), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CvDraftReview initial={cvDraftReviewFixture} csrfProof="csrf_test" />,
    );
    fireEvent.change(screen.getByLabelText(/Proposed headline/i), {
      target: { value: "Edited platform engineer" },
    });
    const save = screen.getByRole("button", { name: "Save review" });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request).toMatchObject({
      baseDraftRevision: 0,
      reviewedProfileRevision: 2,
    });
    expect(request.proposals.scalars[0].value).toBe("Edited platform engineer");
    expect(await screen.findByText("Review saved.")).toBeVisible();
    expect(screen.getByText("Review draft revision 1")).toBeVisible();
  });

  it("blocks invalid local values, shows a toast, and marks the exact field", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CvDraftReview initial={cvDraftReviewFixture} csrfProof="csrf_test" />,
    );

    const headline = screen.getByLabelText(/Proposed headline/i);
    fireEvent.change(headline, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save review" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(headline).toHaveAttribute("aria-invalid", "true");
    expect(screen.getAllByText("Headline is required.").length).toBeGreaterThan(
      0,
    );
    expect(toast.error).toHaveBeenCalledWith("Review could not be saved.", {
      id: "cv-review-save-error",
      description: expect.stringContaining("Headline is required."),
    });
    expect(headline).toHaveFocus();
  });

  it("requires replace instead of add when a Profile scalar already exists", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const invalidInitial = {
      ...cvDraftReviewFixture,
      reviewDecisions: {
        ...cvDraftReviewFixture.reviewDecisions,
        scalars: [
          {
            ...cvDraftReviewFixture.reviewDecisions.scalars[0],
            action: "ADD" as const,
          },
        ],
      },
    };
    render(<CvDraftReview initial={invalidInitial} csrfProof="csrf_test" />);

    const scalarDecision = screen.getByRole("group", {
      name: /Decision for headline/i,
    });
    expect(
      within(scalarDecision).queryByRole("radio", { name: /add/i }),
    ).not.toBeInTheDocument();
    expect(
      within(scalarDecision).getByRole("radio", { name: /replace/i }),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText(/Proposed headline/i), {
      target: { value: "Edited headline" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save review" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(scalarDecision).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getAllByText(
        "Headline already has a Profile value. Choose replace or skip.",
      ).length,
    ).toBeGreaterThan(0);
    expect(toast.error).toHaveBeenCalledWith("Review could not be saved.", {
      id: "cv-review-save-error",
      description:
        "Headline already has a Profile value. Choose replace or skip.",
    });
  });

  it("hides replacement actions and explains the available choices when collection targets are empty", () => {
    const firstImport = {
      ...cvDraftReviewFixture,
      currentProfile: {
        ...cvDraftReviewFixture.currentProfile,
        experiences: [],
        education: [],
        socialLinks: [],
      },
      reviewDecisions: {
        ...cvDraftReviewFixture.reviewDecisions,
        experiences: cvDraftReviewFixture.reviewDecisions.experiences.map(
          (decision) => ({
            ...decision,
            action: "ADD" as const,
            targetId: null,
          }),
        ),
        education: cvDraftReviewFixture.reviewDecisions.education.map(
          (decision) => ({
            ...decision,
            action: "ADD" as const,
            targetId: null,
          }),
        ),
        socialLinks: cvDraftReviewFixture.reviewDecisions.socialLinks.map(
          (decision) => ({
            ...decision,
            action: "ADD" as const,
            targetId: null,
          }),
        ),
      },
    };
    render(<CvDraftReview initial={firstImport} csrfProof="csrf_test" />);

    const experienceSection = screen
      .getByRole("heading", { name: "Experience" })
      .closest("section");
    expect(experienceSection).not.toBeNull();
    expect(
      within(experienceSection as HTMLElement).queryByRole("radio", {
        name: "Replace",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(experienceSection as HTMLElement).getByText(
        "There are no Profile items to replace. Add this proposal or skip it.",
      ),
    ).toBeVisible();
  });

  it("keeps replacement available when a collection has Profile targets", () => {
    render(
      <CvDraftReview initial={cvDraftReviewFixture} csrfProof="csrf_test" />,
    );

    const experienceSection = screen
      .getByRole("heading", { name: "Experience" })
      .closest("section");
    expect(experienceSection).not.toBeNull();
    expect(
      within(experienceSection as HTMLElement).getByRole("radio", {
        name: "Replace",
      }),
    ).toBeVisible();
  });

  it("surfaces server field errors in a toast and highlights the matching input", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "VALIDATION_ERROR",
            message: "Review the highlighted fields.",
            requestId: "request-test",
            fieldErrors: [
              {
                path: "experiences.0.startDate",
                code: "FUTURE",
                message: "This value is invalid.",
              },
            ],
            latest: null,
          },
        }),
        { status: 400 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CvDraftReview initial={cvDraftReviewFixture} csrfProof="csrf_test" />,
    );

    fireEvent.change(screen.getByLabelText(/Proposed headline/i), {
      target: { value: "Edited headline" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save review" }));

    const startDate = (await screen.findAllByLabelText("Start date"))[0];
    await waitFor(() =>
      expect(startDate).toHaveAttribute("aria-invalid", "true"),
    );
    expect(
      screen.getAllByText("Start date cannot be in the future.").length,
    ).toBeGreaterThan(0);
    expect(toast.error).toHaveBeenCalledWith("Review could not be saved.", {
      id: "cv-review-save-error",
      description: "Start date cannot be in the future.",
      duration: 8_000,
    });
    expect(screen.getByText("Review action failed")).toBeVisible();
    expect(startDate).toHaveFocus();
    fireEvent.change(startDate, { target: { value: "2020-01-01" } });
    expect(startDate).toHaveAttribute("aria-invalid", "false");
  });

  it("requires explicit impact acknowledgement and renders a non-content receipt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(cvConfirmationReceiptFixture), {
        status: 201,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CvDraftReview initial={cvDraftReviewFixture} csrfProof="csrf_test" />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm selected changes" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/acknowledge/i);
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /confirm updates my candidate profile/i,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm selected changes" }),
    );
    expect(
      await screen.findByRole("heading", { name: "CV import confirmed" }),
    ).toBeVisible();
    expect(screen.getByText(/candidate profile revision/i)).toHaveTextContent(
      "3",
    );
    expect(
      screen.getByRole("link", { name: "View import status" }),
    ).toHaveAttribute(
      "href",
      `/profile/cv-imports/${cvConfirmationReceiptFixture.uploadId}`,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].headers["idempotency-key"]).toMatch(
      /^cv-confirm-/u,
    );
    expect(navigation.replace).toHaveBeenCalledWith(
      `/profile/cv-imports/${cvConfirmationReceiptFixture.uploadId}/receipt`,
    );
  });
});
