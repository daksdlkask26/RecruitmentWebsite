import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { record } = vi.hoisted(() => ({
  record: {
    id: "review-1",
    originalTitle: "Accountant",
    normalizedTitle: "accountant",
    context: { sampleJobIds: ["job-1"] },
    suggestedTitleId: "title-accountant-occ-r01-accounting",
    suggestedTranslationVi: "Kế toán",
    suggestedTranslationEn: "Accountant",
    suggestedOccupationId: "occ-r01-accounting",
    suggestedFacetIds: ["r01-accounting"],
    confidence: 0.55,
    status: "PENDING" as const,
    version: 3,
  },
}));

vi.mock("react-admin", () => ({
  useRecordContext: () => record,
  useRefresh: () => vi.fn(),
}));
vi.mock("@/frontend/features/admin/app/data-provider", () => ({
  adminDataProvider: { command: vi.fn() },
  searchMappingReviewCommandPath: () =>
    "/admin/search-mapping-reviews/review-1",
}));
vi.mock("@/frontend/features/admin/auth/step-up-dialog", () => ({
  StepUpDialog: () => null,
}));
vi.mock("@/frontend/features/admin/shared/stale-conflict-panel", () => ({
  StaleConflictPanel: () => null,
}));

import { SearchMappingReviewActionPanel } from "@/frontend/features/admin/search-mapping-reviews/search-mapping-review-action-panel";

describe("search mapping review accessibility", () => {
  it("has no serious or critical violations before and during approval", async () => {
    const { container } = render(<SearchMappingReviewActionPanel />);
    const axe = (await import("axe-core")).default;
    const initial = await axe.run(container);
    expect(
      initial.violations.filter((item) =>
        ["serious", "critical"].includes(item.impact ?? ""),
      ),
    ).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Approve mapping" }));
    const dialog = screen.getByRole("dialog");
    const duringAction = await axe.run(dialog);
    expect(
      duringAction.violations.filter((item) =>
        ["serious", "critical"].includes(item.impact ?? ""),
      ),
    ).toEqual([]);
    expect(screen.getByRole("status")).toBeVisible();
  });
});
