import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  candidateViewer,
  employerViewer,
  homeModel,
} from "../../../helpers/home/home-fixtures";
import { HomeTestHarness } from "../../../helpers/home/home-test-harness";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

describe("Home destination map", () => {
  it("smoothly centres a fitting in-page section and top-aligns a longer one", () => {
    const { container } = render(<HomeTestHarness model={homeModel()} />);
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const howItWorks = container.querySelector("#how-it-works") as HTMLElement;
    const companies = container.querySelector("#companies-hiring") as HTMLElement;

    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 100,
    });
    vi.spyOn(howItWorks, "getBoundingClientRect").mockReturnValue({
      top: 600,
      height: 400,
      bottom: 1000,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: 600,
      toJSON: () => ({}),
    });
    vi.spyOn(companies, "getBoundingClientRect").mockReturnValue({
      top: 900,
      height: 900,
      bottom: 1800,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: 900,
      toJSON: () => ({}),
    });

    fireEvent.click(screen.getAllByRole("link", { name: "How it works" })[0]!);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 500, behavior: "smooth" });
    expect(window.location.hash).toBe("#how-it-works");

    fireEvent.click(
      screen.getAllByRole("link", { name: "Hiring companies" })[0]!,
    );
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 956, behavior: "smooth" });

    scrollTo.mockRestore();
  });

  it("uses only existing public routes and matching in-page anchors", () => {
    const { container } = render(<HomeTestHarness model={homeModel()} />);
    for (const id of [
      "career-paths",
      "jobs",
      "smart-match",
      "how-it-works",
      "candidate-trust",
      "companies-hiring",
    ])
      expect(container.querySelector(`#${id}`)).toBeInTheDocument();
    const hrefs = [...container.querySelectorAll("a")].map((link) =>
      link.getAttribute("href"),
    );
    for (const destination of [
      "/jobs",
      "/help",
      "/legal/privacy",
      "/legal/terms",
      "/legal/cookies",
      "/legal/ai-cv-analysis-policy",
      "#career-paths",
      "#jobs",
      "#smart-match",
      "#how-it-works",
      "#candidate-trust",
      "#companies-hiring",
      "/jobs/frontend-intern",
      "/register",
      "/login?returnTo=%2Fdashboard%2Femployer-verification",
    ])
      expect(hrefs).toContain(destination);
    expect(hrefs).not.toContain("/companies");
    expect(
      screen.getByText(/© 2026(?:–\d{4})? Smart Hire\. All rights reserved\./u),
    ).toBeInTheDocument();
    for (const selector of [
      ".home-process-list",
      ".home-candidate-trust-grid",
      ".home-companies-hiring-grid",
    ])
      expect(
        within(container.querySelector(selector) as HTMLElement).queryByRole(
          "link",
        ),
      ).not.toBeInTheDocument();
    expect(
      within(
        container.querySelector(".home-path-grid") as HTMLElement,
      ).getAllByRole("link"),
    ).toHaveLength(6);
    expect(hrefs).toContain("/jobs?careerPath=software-engineering");
    expect(hrefs).not.toContain("#employer-spotlight");
  });

  it("maps candidate shortcuts/profile and preserves recruiter authority separately", () => {
    const { container, rerender } = render(
      <HomeTestHarness model={homeModel({ viewer: candidateViewer })} />,
    );
    expect(container.querySelector(".home-header-actions .home-shortcuts")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Open navigation menu" }),
    );
    const mobileLinks = container.querySelector("#home-mobile-links");
    expect(mobileLinks).toBeInTheDocument();

    for (const [name, href] of [
      ["My Dashboard", "/dashboard"],
      ["My Applications", "/jobs/applied"],
      ["Saved Jobs", "/jobs/saved"],
    ])
      expect(within(mobileLinks as HTMLElement).getByRole("link", { name })).toHaveAttribute(
        "href",
        href,
      );
    expect(screen.getAllByRole("link", { name: "Create Profile" })[0]).toHaveAttribute(
      "href",
      "/profile",
    );
    rerender(<HomeTestHarness model={homeModel({ viewer: employerViewer })} />);
    expect(
      screen.getAllByRole("link", { name: "Post a Job" })[0],
    ).toHaveAttribute("href", "/recruiter/job-postings");
  });
});
