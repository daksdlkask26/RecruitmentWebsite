import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CvDraftReview } from "@/frontend/features/cv-import/components/cv-draft-review";
import { cvDraftReviewFixture } from "../../../fixtures/cv-draft-review";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

const conflictLatest = {
  draftRevision: 1,
  profileRevision: 2,
  draftUpdatedAt: "2026-08-01T08:10:00.000Z",
  profileUpdatedAt: "2026-08-01T08:00:00.000Z",
};

function conflictResponse(
  code: "DRAFT_REVISION_CONFLICT" | "PROFILE_REVISION_CONFLICT",
  latest = conflictLatest,
) {
  return new Response(
    JSON.stringify({
      error: {
        code,
        message:
          code === "DRAFT_REVISION_CONFLICT"
            ? "Another session saved this review first."
            : "The Candidate Profile changed after this review.",
        requestId: "request_us4_conflict",
        fieldErrors: [],
        latest,
      },
    }),
    { status: 409, headers: { "content-type": "application/json" } },
  );
}

function editEveryProposal() {
  fireEvent.change(screen.getByLabelText(/Proposed headline/i), {
    target: { value: "Unsaved stale headline" },
  });
  fireEvent.change(screen.getByLabelText("Job title"), {
    target: { value: "Unsaved stale role" },
  });
  fireEvent.change(screen.getByLabelText("Company"), {
    target: { value: "Unsaved stale company" },
  });
  fireEvent.change(screen.getByLabelText(/Proposed skill/i), {
    target: { value: "Unsaved stale skill" },
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe("CV review conflict recovery", () => {
  it("keeps every stale-draft edit in memory through compare and explicit reapply", async () => {
    const latest = {
      ...cvDraftReviewFixture,
      draftRevision: 1,
      proposals: {
        ...cvDraftReviewFixture.proposals,
        scalars: cvDraftReviewFixture.proposals.scalars.map((proposal) => ({
          ...proposal,
          value: "Other session headline",
        })),
      },
    };
    const saved = {
      ...latest,
      draftRevision: 2,
      proposals: {
        ...latest.proposals,
        scalars: latest.proposals.scalars.map((proposal) => ({
          ...proposal,
          value: "Unsaved stale headline",
        })),
        experiences: latest.proposals.experiences.map((proposal) => ({
          ...proposal,
          value: {
            ...proposal.value,
            title: "Unsaved stale role",
            company: "Unsaved stale company",
          },
        })),
        skills: latest.proposals.skills.map((proposal) => ({
          ...proposal,
          value: "Unsaved stale skill",
        })),
      },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(conflictResponse("DRAFT_REVISION_CONFLICT"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(latest), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            draftId: latest.draftId,
            draftRevision: 2,
            reviewedProfileRevision: 2,
            savedAt: "2026-08-01T08:12:00.000Z",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(saved), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CvDraftReview initial={cvDraftReviewFixture} csrfProof="csrf_us4" />,
    );

    editEveryProposal();
    const save = screen.getByRole("button", { name: "Save review" });
    save.focus();
    fireEvent.click(save);

    const conflictHeading = await screen.findByRole("heading", {
      name: "Review conflict needs your choice",
    });
    expect(conflictHeading).toHaveFocus();
    for (const value of [
      "Unsaved stale headline",
      "Unsaved stale role",
      "Unsaved stale company",
      "Unsaved stale skill",
    ]) {
      expect(screen.getByDisplayValue(value)).toBeVisible();
      expect(screen.getByText(value)).toBeVisible();
    }
    expect(
      screen.getByRole("button", { name: "Reapply my edits to latest" }),
    ).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", { name: "Compare with latest saved review" }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/latest saved draft revision 1/i)).toBeVisible();
    expect(screen.getByDisplayValue("Unsaved stale headline")).toBeVisible();
    expect(screen.queryByDisplayValue("Other session headline")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Reapply my edits to latest" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Review CV proposals" }),
      ).toHaveFocus(),
    );
    expect(screen.queryByText("Review conflict needs your choice")).toBeNull();
    expect(screen.getByDisplayValue("Unsaved stale headline")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Save review" }));
    await screen.findByText("Review saved.");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const reapplied = JSON.parse(fetchMock.mock.calls[2]![1]!.body as string);
    expect(reapplied).toMatchObject({
      baseDraftRevision: 1,
      reviewedProfileRevision: 2,
    });
    expect(reapplied.proposals).toMatchObject({
      scalars: [{ value: "Unsaved stale headline" }],
      experiences: [
        {
          value: {
            title: "Unsaved stale role",
            company: "Unsaved stale company",
          },
        },
      ],
      skills: [{ value: "Unsaved stale skill" }],
    });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("keeps stale-Profile edits until an explicit discard reload and restores review focus", async () => {
    const profileLatest = {
      ...cvDraftReviewFixture,
      currentProfile: {
        ...cvDraftReviewFixture.currentProfile,
        revision: 3,
        headline: "Direct Profile winner",
      },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        conflictResponse("PROFILE_REVISION_CONFLICT", {
          ...conflictLatest,
          profileRevision: 3,
          profileUpdatedAt: "2026-08-01T08:15:00.000Z",
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(profileLatest), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CvDraftReview initial={cvDraftReviewFixture} csrfProof="csrf_us4" />,
    );

    editEveryProposal();
    fireEvent.click(screen.getByRole("button", { name: "Save review" }));
    expect(
      await screen.findByText(
        "The Candidate Profile changed after this review.",
      ),
    ).toBeVisible();
    expect(screen.getByText(/Profile revision 3/i)).toBeVisible();
    expect(screen.getByText(/Profile updated/i)).toHaveTextContent(
      "Aug 1, 2026",
    );
    expect(screen.getByDisplayValue("Unsaved stale headline")).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Discard my edits and reload latest",
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Review CV proposals" }),
      ).toHaveFocus(),
    );
    expect(screen.getByText("Latest saved review loaded.")).toBeVisible();
    expect(screen.getByDisplayValue("Platform engineer")).toBeVisible();
    expect(screen.queryByDisplayValue("Unsaved stale headline")).toBeNull();
    expect(screen.queryByText("Review conflict needs your choice")).toBeNull();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
