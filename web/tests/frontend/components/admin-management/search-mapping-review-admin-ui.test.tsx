import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const { record, refresh, command } = vi.hoisted(() => ({
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
  refresh: vi.fn(),
  command: vi.fn(async () => undefined),
}));

vi.mock("react-admin", () => ({
  useRecordContext: () => record,
  useRefresh: () => refresh,
}));
vi.mock("@/frontend/features/admin/app/data-provider", () => ({
  adminDataProvider: { command },
  searchMappingReviewCommandPath: (id: string, action: string) =>
    `/api/admin/search-mapping-reviews/${id}/${action}`,
}));
vi.mock("@/frontend/features/admin/auth/step-up-dialog", () => ({
  StepUpDialog: () => null,
}));
vi.mock("@/frontend/features/admin/shared/stale-conflict-panel", () => ({
  StaleConflictPanel: () => (
    <div role="alert">A newer review is available.</div>
  ),
}));

import { SearchMappingReviewActionPanel } from "@/frontend/features/admin/search-mapping-reviews/search-mapping-review-action-panel";

describe("search mapping review admin UI", () => {
  it("exposes impact and collision warnings before a sensitive action", () => {
    render(<SearchMappingReviewActionPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Approve mapping" }));

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Impact preview");
    expect(screen.getByRole("status")).toHaveTextContent("ambiguous");
    expect(
      screen.getByRole("textbox", { name: "Private administrator rationale" }),
    ).toBeRequired();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
  });

  it("keeps the confirmation keyboard reachable and submits only a bounded rationale", async () => {
    render(<SearchMappingReviewActionPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Approve mapping" }));
    fireEvent.mouseDown(
      screen.getByRole("combobox", { name: "Reason category" }),
    );
    fireEvent.click(screen.getByRole("option", { name: "Other" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Private administrator rationale" }),
      {
        target: { value: "Reviewer confirmed the title and its translation." },
      },
    );

    const confirm = screen.getByRole("button", { name: "Confirm" });
    expect(confirm).toBeEnabled();
    confirm.focus();
    expect(confirm).toHaveFocus();
    fireEvent.click(confirm);
    await waitFor(() => expect(command).toHaveBeenCalledOnce());
    expect(command).toHaveBeenCalledWith(
      "/api/admin/search-mapping-reviews/review-1/approve",
      expect.objectContaining({
        command: "APPROVE",
        confirmation: true,
        reasonCategory: "OTHER",
      }),
      3,
      expect.any(String),
    );
  });

  it("keeps admin context bounded and visible for audit review", () => {
    const source = readFileSync(
      "src/frontend/features/admin/search-mapping-reviews/search-mapping-review-show.tsx",
      "utf8",
    );
    for (const marker of [
      "Normalized title",
      "Context sample",
      "boundedContext",
      "maxHeight: 240",
      'overflowWrap: "anywhere"',
    ])
      expect(source).toContain(marker);
  });
});
