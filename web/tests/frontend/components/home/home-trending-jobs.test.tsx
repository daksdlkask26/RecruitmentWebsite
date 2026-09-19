import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { homeCopy } from "@/frontend/features/home/home-copy";
import { HomeTrendingJobs } from "@/frontend/features/home/components/home-trending-jobs";
import {
  candidateViewer,
  homeJob,
  homeModel,
  personalMatch,
} from "../../../helpers/home/home-fixtures";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

const breakdown = {
  roleAndSkills: 50,
  preferences: 20,
  experience: 12,
  unmatched: 18,
} as const;

describe("Trending Opportunities", () => {
  it("uses one spotlight plus at most five compact detail rows", () => {
    const jobs = Array.from({ length: 8 }, (_, index) =>
      homeJob({
        id: `job-${index}`,
        slug: `job-${index}`,
        title: `Job ${index}`,
      }),
    );
    const { container } = render(
      <HomeTrendingJobs
        model={{ ...homeModel(), jobs: { status: "ready", items: jobs } }}
        locale="en"
      />,
    );

    expect(container.querySelectorAll(".home-job-spotlight")).toHaveLength(1);
    expect(container.querySelectorAll(".home-job-list-row")).toHaveLength(5);
    expect(screen.getAllByRole("article")).toHaveLength(6);
    expect(screen.getByRole("link", { name: "Job 0" })).toHaveAttribute(
      "href",
      "/jobs/job-0",
    );
    expect(
      container.querySelector(".home-job-spotlight-meta"),
    ).toHaveTextContent(/Hybrid.*Internship/u);
  });

  it("promotes the highest genuine score and shares the match visuals", () => {
    const jobs = [
      homeJob({
        id: "job-1",
        slug: "frontend-intern",
        title: "Frontend Intern",
        matchScore: 75,
        matchSource: "profile",
        matchBreakdown: breakdown,
      }),
      homeJob({
        id: "job-2",
        slug: "backend-intern",
        title: "Backend Intern",
        matchScore: 82,
        matchSource: "profile",
        matchBreakdown: breakdown,
      }),
    ];
    const { container } = render(
      <HomeTrendingJobs
        model={homeModel({
          viewer: candidateViewer,
          match: personalMatch({
            jobSlug: "backend-intern",
            jobTitle: "Backend Intern",
            score: 82,
            matchBreakdown: breakdown,
          }),
          jobs,
        })}
        locale="en"
      />,
    );

    expect(container.querySelector(".home-job-spotlight")).toHaveTextContent(
      "BEST MATCH FOR YOU",
    );
    expect(
      screen.getByRole("img", { name: "Fit estimate: 82%" }),
    ).toBeInTheDocument();
    expect(
      container.querySelector(".home-job-spotlight .home-match-score-progress"),
    ).toBeInTheDocument();
    expect(
      container.querySelector(".home-job-spotlight .home-match-stackbar"),
    ).toBeInTheDocument();
    expect(screen.getByText("75% match estimate")).toBeInTheDocument();
  });

  it("does not call a low score the candidate's best match", () => {
    const limitedBreakdown = {
      roleAndSkills: 3,
      preferences: 0,
      experience: 0,
      unmatched: 97,
    } as const;
    const { container } = render(
      <HomeTrendingJobs
        model={homeModel({
          viewer: candidateViewer,
          match: personalMatch({
            score: 3,
            quality: "limited",
            matchBreakdown: limitedBreakdown,
          }),
          jobs: [
            homeJob({
              matchScore: 3,
              matchSource: "profile",
              matchBreakdown: limitedBreakdown,
            }),
          ],
        })}
        locale="en"
      />,
    );

    expect(container.querySelector(".home-job-spotlight")).toHaveTextContent(
      "TOP SUGGESTION",
    );
    expect(
      container.querySelector(".home-job-spotlight"),
    ).not.toHaveTextContent("BEST MATCH FOR YOU");
    expect(
      container.querySelector(".home-job-low-match-notice"),
    ).toHaveTextContent("low-confidence estimate");
  });

  it("does not tell a complete candidate to complete their profile when no recommendation is available", () => {
    render(
      <HomeTrendingJobs
        model={homeModel({
          viewer: candidateViewer,
          match: {
            kind: "illustrative",
            reason: "noOpportunities",
          },
          jobs: [homeJob()],
        })}
        locale="en"
      />,
    );

    expect(
      screen.getByText("No personalized matches are available yet"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Complete your profile to view your fit"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Browse opportunities" }),
    ).toHaveAttribute("href", "/jobs");
  });

  it("explains a CV Match Check score and links to its private report", () => {
    const job = homeJob({
      id: "checked-job",
      slug: "checked-job",
      matchScore: 97,
      matchSource: "cv",
      cvMatch: {
        checkId: "pmc_checked-job",
        cvVersion: 2,
        jdVersion: 3,
        completeness: "AVAILABLE",
        presentationState: "AVAILABLE",
        scoreEligible: true,
      },
    });
    render(
      <HomeTrendingJobs
        model={homeModel({
          viewer: candidateViewer,
          match: personalMatch({
            jobSlug: "checked-job",
            jobTitle: job.title,
            score: 97,
            scoreSource: "cv",
          }),
          jobs: [job],
        })}
        locale="en"
      />,
    );

    expect(
      screen.getByText("Private result for this exact role"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Checked against your latest CV and the current job description.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Review match report" }),
    ).toHaveAttribute("href", "/cv-match-check/pmc_checked-job");
  });

  it("shows a neutral private-report prompt when the CV result is incomplete", () => {
    const cvMatch = {
      checkId: "pmc_incomplete",
      cvVersion: 2,
      jdVersion: 3,
      completeness: "INCOMPLETE" as const,
      presentationState: "INCOMPLETE" as const,
      scoreEligible: false,
    };
    const job = homeJob({
      id: "incomplete-job",
      slug: "incomplete-job",
      matchSource: "cv",
      cvMatch,
    });
    const { container } = render(
      <HomeTrendingJobs
        model={homeModel({
          viewer: candidateViewer,
          match: personalMatch({
            jobSlug: "incomplete-job",
            jobTitle: job.title,
            score: null,
            presentationState: "INCOMPLETE",
            scoreEligible: false,
            scoreSource: "cv",
            completeness: "INCOMPLETE",
            cvMatch,
          }),
          jobs: [job],
        })}
        locale="en"
      />,
    );

    expect(container.querySelector(".home-job-match-prompt")).toHaveTextContent(
      "Some CV evidence is incomplete; review the private report.",
    );
    expect(screen.queryByRole("img", { name: /\d+%/u })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Review match report" }),
    ).toHaveAttribute("href", "/cv-match-check/pmc_incomplete");
  });

  it("does not show a fabricated score when there is no personal match", () => {
    const { container } = render(
      <HomeTrendingJobs model={homeModel({ jobs: [homeJob()] })} locale="en" />,
    );
    expect(container.querySelector(".home-job-match-prompt")).toHaveTextContent(
      "Log in to view your fit",
    );
    expect(
      screen.queryByRole("img", { name: /Fit estimate/u }),
    ).not.toBeInTheDocument();
    expect(container.querySelector(".home-job-list-match")).toBeNull();
    expect(
      container.querySelector(".home-match-ring--ghost"),
    ).toBeInTheDocument();
    expect(
      container.querySelector(".home-match-score-ghost"),
    ).toBeInTheDocument();
  });

  it("uses localised salary badges without rendering zero-value salaries", () => {
    const jobs = [
      homeJob({
        id: "job-1",
        slug: "paid-role",
        salary: {
          minimum: 8,
          maximum: 12,
          currency: "VND",
          period: "MONTH",
        },
      }),
      homeJob({
        id: "job-2",
        slug: "negotiable-role",
        title: "Negotiable role",
        salary: {
          minimum: 0,
          maximum: 0,
          currency: "VND",
          period: "MONTH",
        },
      }),
    ];
    const { container } = render(
      <HomeTrendingJobs model={homeModel({ jobs })} locale="vi" />,
    );

    expect(
      container.querySelector(".home-job-spotlight-salary"),
    ).toHaveTextContent(/8.*12/u);
    expect(container.querySelector(".home-job-spotlight-salary")).toHaveClass(
      "home-job-salary--configured",
    );
    expect(container.querySelector(".home-job-list-salary")).toHaveTextContent(
      homeCopy.vi.jobs.negotiableSalary,
    );
    expect(container.querySelector(".home-job-list-salary")).toHaveClass(
      "home-job-salary--negotiable",
    );
  });

  it("keeps skills on the spotlight and exposes save actions for every job", () => {
    const jobs = [
      homeJob({ id: "job-1", slug: "frontend-intern" }),
      homeJob({ id: "job-2", slug: "backend-intern", title: "Backend Intern" }),
    ];
    const { container } = render(
      <HomeTrendingJobs model={homeModel({ jobs })} locale="en" />,
    );
    const skillLists = container.querySelectorAll(".home-job-skills");
    expect(skillLists).toHaveLength(1);
    expect(skillLists[0]?.querySelectorAll("li")).toHaveLength(3);
    expect(container.querySelectorAll(".home-save-icon")).toHaveLength(2);
    expect(container.querySelectorAll(".home-job-list-row")).toHaveLength(1);
  });
});
