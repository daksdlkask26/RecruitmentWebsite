import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HomeAccountMenu } from "@/frontend/features/home/components/home-account-menu";
import { candidateViewer, homeModel } from "../../../helpers/home/home-fixtures";
import { HomeTestHarness } from "../../../helpers/home/home-test-harness";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

const labels = {
  profile: "Open your profile",
  fallbackName: "Smart Hire member",
  logout: "Log out",
  loggingOut: "Logging out…",
  logoutSuccess: "You have been logged out.",
  logoutError: "Could not log out.",
};

describe("Home account presentation", () => {
  it("shows guest authentication actions and no private shortcuts", () => {
    render(<HomeTestHarness model={homeModel()} />);
    expect(screen.getAllByRole("link", { name: "Log in" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Sign up" }).length).toBeGreaterThan(0);
    expect(screen.queryByText("My Dashboard")).not.toBeInTheDocument();
  });

  it("uses a non-identifying avatar/name fallback and never falls back to email", () => {
    render(
      <HomeAccountMenu
        name="   "
        avatarUrl="https://tracker.example/avatar.png"
        csrfProof="proof"
        labels={labels}
      />,
    );
    expect(screen.getByText("Smart Hire member")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByText(/@/u)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open your profile" })).toHaveAttribute("href", "/profile");
  });

  it("keeps long authenticated names accessible", () => {
    const name = "Nguyễn An với một tên hiển thị rất dài";
    render(
      <HomeTestHarness
        model={homeModel({
          viewer: { ...candidateViewer, displayName: name },
        })}
      />,
    );
    expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Log out" }).length).toBeGreaterThan(0);
  });
});
