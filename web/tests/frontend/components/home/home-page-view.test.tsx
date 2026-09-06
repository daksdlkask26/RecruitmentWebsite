import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  candidateViewer,
  employerViewer,
  homeModel,
  personalMatch,
} from "../../../helpers/home/home-fixtures";
import { HomeTestHarness } from "../../../helpers/home/home-test-harness";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const orderedHeadings = [
  "Career Paths",
  "Trending Opportunities",
  "Smart Match",
  "How Smart Hire works",
  "Why candidates trust Smart Hire",
  "Companies hiring now",
];

describe("HomePageView shared shell", () => {
  it.each([
    ["guest", homeModel()],
    [
      "candidate",
      homeModel({ viewer: candidateViewer, match: personalMatch() }),
    ],
    ["employer", homeModel({ viewer: employerViewer })],
    ["expired session", homeModel({ viewer: { kind: "guest" } })],
  ])("keeps the same ordered Home sections for %s", (_name, model) => {
    const { container } = render(<HomeTestHarness model={model} />);
    const headings = [...container.querySelectorAll("h2")].map((node) =>
      node.textContent?.trim(),
    );
    let cursor = -1;
    for (const heading of orderedHeadings) {
      const next = headings.indexOf(heading, cursor + 1);
      expect(next).toBeGreaterThan(cursor);
      cursor = next;
    }
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "AI understands your CV. You choose what’s next.",
    );
  });

  it("keeps the active-company section directly above the final CTA", () => {
    const companies = [
      { ...homeModel().spotlights.items[0]!, slug: "company-one" },
      { ...homeModel().spotlights.items[0]!, slug: "company-two" },
      { ...homeModel().spotlights.items[0]!, slug: "company-three" },
    ];
    const { container } = render(
      <HomeTestHarness model={homeModel({ companies })} />,
    );
    const headings = [...container.querySelectorAll("h2")].map((node) =>
      node.textContent?.trim(),
    );
    expect(headings.indexOf("Companies hiring now")).toBeGreaterThan(
      headings.indexOf("Why candidates trust Smart Hire"),
    );
    expect(headings).not.toContain("Employer Spotlight");
  });

  it("keeps private account slots conditional without duplicating the page", () => {
    const { rerender } = render(<HomeTestHarness model={homeModel()} />);
    expect(
      screen.getAllByRole("link", { name: "Log in" }).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("My Applications")).not.toBeInTheDocument();

    rerender(
      <HomeTestHarness
        model={homeModel({ viewer: candidateViewer, match: personalMatch() })}
      />,
    );
    expect(
      screen.queryByRole("link", { name: "Log in" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("My Applications").length).toBeGreaterThan(0);
  });
});
