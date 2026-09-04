import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JobSearchForm } from "@/frontend/features/jobs/components/job-search-form";

vi.mock("@/frontend/features/dashboard/client/workspace-locale", () => ({
  useWorkspaceLocale: () => "en",
}));

describe("JobSearchForm sidebar", () => {
  it("does not duplicate the global keyword search controls", () => {
    render(
      <JobSearchForm
        criteria={{ q: "accountant" }}
        onCriteriaChange={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("combobox", { name: "Keywords" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Search" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("search", { name: "Job search" })).toBeVisible();
  });
});
