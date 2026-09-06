import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  candidateViewer,
  employerViewer,
  homeModel,
} from "../../../helpers/home/home-fixtures";
import { HomeTestHarness } from "../../../helpers/home/home-test-harness";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

describe("Home Hero", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the AI CV proposition, concise search, and role CTAs", () => {
    const { container } = render(<HomeTestHarness model={homeModel()} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      /AI understands your CV/u,
    );
    for (const label of ["Keyword", "Location"])
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    for (const label of [
      "Work arrangement",
      "Employment type",
      "Experience level",
      "Skills",
    ])
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Find jobs now" })).toHaveAttribute(
      "href",
      "/jobs",
    );
    expect(
      screen.getByRole("link", { name: /For employers/u }),
    ).toHaveAttribute(
      "href",
      "/login?returnTo=%2Fdashboard%2Femployer-verification",
    );
    expect(container.querySelector(".home-cv-scan")).toHaveTextContent(
      "CV analysis in progress",
    );
    expect(container.querySelector(".home-cv-score-card")).toHaveTextContent(
      "87%",
    );
  });

  it("submits only the concise discovery parameters", () => {
    render(<HomeTestHarness model={homeModel()} />);
    fireEvent.change(screen.getByLabelText("Keyword"), {
      target: { value: "frontend" },
    });
    fireEvent.change(screen.getByLabelText("Location"), {
      target: { value: "Hà Nội" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search jobs" }));
    expect(navigation.push).toHaveBeenCalledOnce();
    const destination = navigation.push.mock.calls[0][0] as string;
    expect(destination).toContain("/jobs?");
    expect(destination).toContain("q=frontend");
    expect(destination).toContain("location=H%C3%A0+N%E1%BB%99i");
    expect(destination).not.toMatch(
      /(?:workArrangement|employmentType|experienceLevel|skills)=/u,
    );
    expect(destination).not.toMatch(/(?:session|role|score|mock|locale)=/u);
  });

  it("uses the profile route after login and only resolved recruiter destinations", () => {
    const { rerender } = render(
      <HomeTestHarness model={homeModel({ viewer: candidateViewer })} />,
    );
    expect(
      screen.getAllByRole("link", { name: "Create Profile" })[0],
    ).toHaveAttribute("href", "/profile");
    expect(screen.getAllByText(/Status unavailable/u).length).toBeGreaterThan(
      0,
    );
    expect(
      screen.queryByRole("link", { name: /For employers/u }),
    ).not.toBeInTheDocument();

    rerender(
      <HomeTestHarness
        model={homeModel({
          viewer: {
            ...candidateViewer,
            recruiterStatus: {
              state: "NEVER_APPLIED",
              destinationKind: "EMPLOYER_VERIFICATION",
              href: "/dashboard/employer-verification",
              observedAt: "2026-08-21T00:00:00.000Z",
            },
          },
        })}
      />,
    );
    expect(
      screen.getByRole("link", { name: /For employers/u }),
    ).toHaveAttribute("href", "/dashboard/employer-verification");

    rerender(<HomeTestHarness model={homeModel({ viewer: employerViewer })} />);
    expect(
      screen.getByRole("link", { name: /For employers/u }),
    ).toHaveAttribute("href", "/recruiter/job-postings");
    expect(
      screen.getAllByRole("link", { name: "Post a Job" })[0],
    ).toHaveAttribute("href", "/recruiter/job-postings");
  });
});
