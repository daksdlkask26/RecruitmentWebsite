import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ApplyButton,
  JobCardBody,
  JobCardView,
} from "@/frontend/features/jobs/components/job-card";
import { JobSearchForm } from "@/frontend/features/jobs/components/job-search-form";
import { CompanyAvatar } from "@/frontend/features/jobs/components/company-avatar";
import { WorkspaceLocaleProvider } from "@/frontend/features/dashboard/client/workspace-locale";
import JobsLoading from "@/app/jobs/loading";

const job = {
  id: "job-1",
  slug: "lap-trinh-vien",
  title: "Lập trình viên TypeScript",
  company: {
    slug: "smart-hire",
    displayName: "SmartHire",
    logoUrl: null,
    websiteUrl: null,
    publicDescription: null,
    publicLocation: "Hồ Chí Minh",
  },
  location: "Hồ Chí Minh",
  employmentType: "FULL_TIME" as const,
  experienceLevel: "MID" as const,
  workArrangement: "HYBRID" as const,
  salary: null,
  summary: "Build accessible products.",
  skills: ["TypeScript"],
  publishedAt: "2026-08-01T00:00:00.000Z",
  applicationDeadline: null,
  actions: {
    authenticated: false,
    saved: false,
    applied: false,
    canSave: false,
    canReport: false,
    canApply: true,
  },
};

describe("job discovery presentation", () => {
  it("uses a stable company monogram instead of a broken remote logo", () => {
    render(
      <CompanyAvatar
        name="Compass Capital"
        imageUrl="https://example.com/compass-capital/logo.png"
      />,
    );

    expect(screen.getByText("CC")).toBeVisible();
    expect(document.querySelector("img")).toBeNull();
  });

  it("falls back to the company monogram when a local logo fails", () => {
    render(
      <CompanyAvatar name="Smart Hire" imageUrl="/logos/smart-hire.png" />,
    );

    const logo = document.querySelector("img");
    expect(logo).not.toBeNull();
    fireEvent.error(logo!);
    expect(screen.getByText("SH")).toBeVisible();
    expect(document.querySelector("img")).toBeNull();
  });

  it("renders a semantic result with its stable detail link", () => {
    render(<JobCardView job={job} />);
    expect(
      screen.getByRole("link", { name: /lập trình viên typescript/i }),
    ).toHaveAttribute("href", "/jobs/lap-trinh-vien");
    expect(screen.getByText("Negotiable")).toHaveClass(
      "job-salary--negotiable",
    );
    expect(screen.getByText("Hồ Chí Minh")).toBeVisible();
  });

  it("limits job metadata tags to three visible tags", () => {
    render(
      <JobCardBody
        job={{
          ...job,
          skills: ["TypeScript", "React", "Next.js", "Vitest"],
        }}
      />,
    );

    expect(document.querySelectorAll(".job-card-tag")).toHaveLength(3);
    expect(screen.queryByText("Next.js")).not.toBeInTheDocument();
    expect(screen.queryByText("Vitest")).not.toBeInTheDocument();
  });

  it("routes authenticated card Apply clicks to the page-based flow", () => {
    render(
      <ApplyButton
        job={{
          ...job,
          actions: { ...job.actions, authenticated: true },
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "Apply" })).toHaveAttribute(
      "href",
      "/jobs/lap-trinh-vien/apply",
    );
  });

  it("shows the permanent per-job attempt limit after five attempts", () => {
    render(
      <ApplyButton
        job={{
          ...job,
          actions: {
            ...job.actions,
            authenticated: true,
            canApply: false,
            applicationCount: 5,
            applicationLimitReached: true,
            applicationLimitMessage:
              "You have reached the maximum number of applications for this job.",
          },
        }}
      />,
    );

    expect(
      screen.getByRole("status", {
        name: "You have reached the maximum number of applications for this job.",
      }),
    ).toBeVisible();
    expect(screen.queryByRole("link", { name: "Apply" })).toBeNull();
  });

  it("keeps secondary actions visible and preserves action order", () => {
    render(<JobCardView job={job} variant="grid" />);

    for (const name of ["Quick view", "Hide job"]) {
      expect(screen.getByRole("button", { name })).toHaveClass("duration-150");
      expect(screen.getByRole("button", { name })).not.toHaveClass(
        "opacity-0",
        "group-hover:opacity-100",
      );
    }

    const actions = document.querySelector(".job-card-grid-actions");
    expect(actions).not.toBeNull();
    const orderedActions = Array.from(
      actions?.querySelectorAll("button, a") ?? [],
    ).map(
      (element) =>
        element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "",
    );
    expect(orderedActions).toEqual([
      "Quick view",
      "Hide job",
      "Sign in to save this job",
      "Apply",
    ]);
  });

  it("exposes redesigned filters and a clear action", () => {
    render(<JobSearchForm criteria={{}} />);
    expect(screen.getByText("Refine search")).toBeVisible();
    expect(screen.queryByText("Job category")).not.toBeInTheDocument();
    expect(screen.getByText("Salary")).toBeVisible();
    expect(screen.getByText("10 - 15M")).toBeVisible();
    expect(screen.queryByText("10 - 15 triệu")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/work arrangement/i)).toBeVisible();
    fireEvent.change(screen.getByLabelText(/skill/i), {
      target: { value: "Đà Nẵng" },
    });
    expect(screen.getByRole("button", { name: "Search" })).toBeVisible();
    expect(
      screen.getAllByRole("link", { name: /clear filters/i }).at(-1),
    ).toHaveAttribute("href", "/jobs");
  });

  it("uses one consistent Vietnamese locale for redesigned filters", () => {
    render(
      <WorkspaceLocaleProvider initialLocale="vi">
        <JobSearchForm criteria={{}} />
      </WorkspaceLocaleProvider>,
    );

    expect(screen.getByText("Mức lương")).toBeVisible();
    expect(screen.getByText("10 - 15 triệu")).toBeVisible();
    expect(screen.getByText("Không yêu cầu kinh nghiệm")).toBeVisible();
    expect(screen.queryByText("Salary")).not.toBeInTheDocument();
    expect(
      screen.queryByText("No experience required"),
    ).not.toBeInTheDocument();
  });

  it("reports redesigned filter changes with the right trigger", () => {
    const onCriteriaChange = vi.fn();
    render(<JobSearchForm criteria={{}} onCriteriaChange={onCriteriaChange} />);

    fireEvent.click(screen.getByLabelText("Under 10M"));
    expect(onCriteriaChange).toHaveBeenLastCalledWith(
      { salaryMax: "10000000" },
      "immediate",
    );

    fireEvent.click(screen.getByLabelText("Negotiable"));
    expect(onCriteriaChange).toHaveBeenLastCalledWith(
      { salaryNegotiable: "true" },
      "immediate",
    );

    fireEvent.click(screen.getByLabelText("Full-time"));
    expect(onCriteriaChange).toHaveBeenLastCalledWith(
      { employmentType: "FULL_TIME" },
      "immediate",
    );
  });

  it("shows removable active filters and opens the mobile drawer accessibly", () => {
    render(
      <JobSearchForm
        criteria={{ q: "TypeScript", location: "Da Nang", sort: "NEWEST" }}
      />,
    );
    expect(
      screen.getByRole("link", { name: /remove filter keyword: typescript/i }),
    ).toHaveAttribute("href", "/jobs?location=Da+Nang&sort=NEWEST");

    const trigger = screen.getByRole("button", { name: /filters3/i });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Filters" })).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Filters" }),
    ).not.toBeInTheDocument();
  });

  it("presents the loading state with the informational blue tone", () => {
    render(<JobsLoading />);
    expect(screen.getByRole("status", { name: "" })).toHaveClass(
      "job-feedback-info",
    );
  });
});
