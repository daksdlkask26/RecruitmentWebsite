import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CvDraftReview } from "@/frontend/features/cv-import/components/cv-draft-review";
import { cvDraftReviewFixture } from "../../../fixtures/cv-draft-review";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

describe("CV draft review accessibility", () => {
  it("has labelled native controls, live feedback, keyboard focus, and a 320px marker", async () => {
    render(
      <CvDraftReview initial={cvDraftReviewFixture} csrfProof="csrf_test" />,
    );
    const root = screen.getByTestId("cv-draft-review");
    expect(root).toHaveAttribute("data-narrow-layout", "320");
    expect(root).toHaveAttribute("data-reduced-motion-safe", "true");
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByLabelText(/Proposed headline/i)).toBeVisible();
    expect(screen.getAllByRole("group").length).toBeGreaterThan(0);

    fireEvent.click(
      screen.getByRole("button", { name: "Confirm selected changes" }),
    );
    const summary = screen.getByRole("heading", {
      name: "Complete the review",
    });
    await waitFor(() => expect(summary).toHaveFocus());
  });

  it("keeps narrow, focus, error, and reduced-motion rules in owned modules", async () => {
    const componentRoot = resolve(
      process.cwd(),
      "src/frontend/features/cv-import/components",
    );
    for (const name of [
      "cv-draft-review.module.css",
      "cv-scalar-review.module.css",
      "cv-collection-review.module.css",
      "cv-review-feedback.module.css",
    ]) {
      const css = await readFile(resolve(componentRoot, name), "utf8");
      expect(css).toMatch(/focus-visible/u);
      expect(css).not.toContain(":global");
    }
    const reviewCss = await readFile(
      resolve(componentRoot, "cv-draft-review.module.css"),
      "utf8",
    );
    expect(reviewCss).toContain("max-width: 32rem");
    expect(reviewCss).toContain("prefers-reduced-motion");
  });
});
