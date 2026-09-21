import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceLocaleProvider } from "@/frontend/features/dashboard/client/workspace-locale";
import { JobPreferencesForm } from "@/frontend/features/jobs/components/job-preferences-form";
import { JobsWorkspaceNav } from "@/frontend/features/jobs/components/jobs-workspace";
import { defaultJobPreferences } from "@/shared/contracts/jobs/preferences";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("job recommendation settings localization", () => {
  it("uses Vietnamese consistently across the form and jobs navigation", () => {
    render(
      <WorkspaceLocaleProvider initialLocale="vi">
        <JobsWorkspaceNav activeTab="settings" />
        <JobPreferencesForm
          initialPreferences={defaultJobPreferences}
          positionOptions={[]}
          skillOptions={[]}
        />
      </WorkspaceLocaleProvider>,
    );

    expect(
      screen.getByRole("link", { name: "Cài đặt gợi ý việc làm" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("navigation", { name: "Điều hướng việc làm" }),
    ).toBeVisible();
    expect(screen.getByText("Thông tin cá nhân")).toBeVisible();
    expect(screen.getByLabelText(/vị trí chuyên môn/i)).toHaveAttribute(
      "placeholder",
      "Tìm vị trí chuyên môn",
    );
    expect(screen.getByText("Chưa có kinh nghiệm")).toBeVisible();
    expect(screen.getByRole("button", { name: "Cập nhật" })).toBeVisible();
    expect(screen.queryByText("Personal information")).not.toBeInTheDocument();
  });

  it("retains the English copy for English workspaces", () => {
    render(
      <WorkspaceLocaleProvider initialLocale="en">
        <JobsWorkspaceNav activeTab="settings" />
        <JobPreferencesForm
          initialPreferences={defaultJobPreferences}
          positionOptions={[]}
          skillOptions={[]}
        />
      </WorkspaceLocaleProvider>,
    );

    expect(
      screen.getByRole("navigation", { name: "Jobs navigation" }),
    ).toBeVisible();
    expect(screen.getByText("Personal information")).toBeVisible();
    expect(screen.getByRole("button", { name: "Update" })).toBeVisible();
  });
});
