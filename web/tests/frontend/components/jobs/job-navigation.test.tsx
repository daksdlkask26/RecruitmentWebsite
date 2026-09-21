import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceShell } from "@/frontend/features/dashboard/components/workspace-shell";
import { JobBoardHeader } from "@/frontend/features/jobs/components/job-board-header";
import { JobWorkspaceSearch } from "@/frontend/features/jobs/components/job-workspace-search";
import { ThemeProvider } from "@/frontend/providers/theme-provider";
import type { JobSearchTaxonomy } from "@/shared/contracts/jobs/taxonomy";

const navigation = vi.hoisted(() => ({
  pathname: "/jobs",
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({
    push: navigation.push,
    replace: navigation.replace,
    refresh: navigation.refresh,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

const taxonomy: JobSearchTaxonomy = {
  industries: [],
  locations: [],
  locationGroups: [],
};

const visitorTaxonomy: JobSearchTaxonomy = {
  ...taxonomy,
  industries: [
    {
      code: "software",
      name: "IT & Software",
      count: 1,
      subIndustries: [
        {
          name: "Software Engineering",
          count: 1,
          titles: [
            {
              name: "Software Engineer",
              categoryIds: ["software-engineer"],
              count: 1,
            },
          ],
        },
      ],
    },
  ],
};

describe("job board navigation", () => {
  it("shows the header search on Find Jobs only", async () => {
    const headerSlot = document.createElement("div");
    headerSlot.id = "workspace-job-search-slot";
    document.body.append(headerSlot);
    navigation.push.mockClear();
    navigation.pathname = "/jobs";
    window.history.replaceState(null, "", "/jobs");
    const rendered = render(<JobWorkspaceSearch taxonomy={taxonomy} />);

    try {
      await waitFor(() => {
        expect(headerSlot.querySelector("#global-image-search")).not.toBeNull();
      });
      fireEvent.change(
        within(headerSlot).getByPlaceholderText(
          "Search jobs, skills, or companies",
        ),
        { target: { value: "designer" } },
      );
      fireEvent.submit(within(headerSlot).getByRole("search"));
      expect(window.location.pathname).toBe("/jobs");
      expect(window.location.search).toBe("?q=designer");

      navigation.pathname = "/jobs/saved";
      rendered.rerender(<JobWorkspaceSearch taxonomy={taxonomy} />);
      expect(headerSlot.querySelector("#global-image-search")).toBeNull();
    } finally {
      rendered.unmount();
      headerSlot.remove();
      navigation.pathname = "/jobs";
      window.history.replaceState(null, "", "/jobs");
    }
  });

  it.each(["/jobs/saved", "/jobs/matches", "/jobs/settings", "/jobs/applied"])(
    "omits the header search on %s",
    (pathname) => {
      const headerSlot = document.createElement("div");
      headerSlot.id = "workspace-job-search-slot";
      document.body.append(headerSlot);
      navigation.pathname = pathname;
      const rendered = render(<JobWorkspaceSearch taxonomy={taxonomy} />);

      try {
        expect(headerSlot.querySelector("#global-image-search")).toBeNull();
      } finally {
        rendered.unmount();
        headerSlot.remove();
        navigation.pathname = "/jobs";
      }
    },
  );

  it("gives visitors focused authentication paths without redundant navigation", () => {
    render(<JobBoardHeader authenticated={false} taxonomy={visitorTaxonomy} />);

    expect(
      within(screen.getByRole("banner")).getByRole("search", {
        name: "Global job search",
      }),
    ).toBeVisible();
    expect(
      within(screen.getByRole("banner")).getByRole("button", {
        name: /job category/i,
      }),
    ).toBeVisible();

    expect(
      screen.queryByRole("link", { name: /browse jobs/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /image search/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute(
      "href",
      "/login?returnTo=%2Fjobs",
    );
    expect(
      screen.getByRole("link", { name: /create account/i }),
    ).toHaveAttribute("href", "/register");
    expect(
      screen.getByRole("button", { name: /switch to dark mode/i }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("toggles and persists the public Jobs theme preference", async () => {
    localStorage.clear();
    render(
      <ThemeProvider>
        <JobBoardHeader authenticated={false} />
      </ThemeProvider>,
    );

    const toggle = screen.getByRole("button", {
      name: /switch to dark mode/i,
    });
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("dark");
    });
    expect(localStorage.getItem("smarthire-theme")).toBe("dark");
  });

  it("links authenticated candidates back to their workspace", () => {
    render(<JobBoardHeader authenticated />);

    expect(screen.getByRole("link", { name: /dashboard/i })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(screen.getByRole("link", { name: /profile/i })).toHaveAttribute(
      "href",
      "/profile",
    );
  });

  it("keeps authenticated Job pages inside the same workspace shell as Profile", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/app/jobs/layout.tsx"),
      "utf8",
    );

    expect(source).toContain("getWorkspaceContext");
    expect(source).toContain("<WorkspaceShell");
    expect(source).toContain("profile={context.account}");
  });

  it("lets the results list grow with the page instead of creating a nested scroll region", async () => {
    const source = await readFile(
      resolve(
        process.cwd(),
        "src/frontend/features/jobs/components/live-job-search-experience.tsx",
      ),
      "utf8",
    );
    const layoutSource = await readFile(
      resolve(process.cwd(), "src/app/jobs/layout.tsx"),
      "utf8",
    );
    const headerSearchSource = await readFile(
      resolve(
        process.cwd(),
        "src/frontend/features/jobs/components/job-workspace-search.tsx",
      ),
      "utf8",
    );
    const styles = await readFile(
      resolve(process.cwd(), "src/frontend/features/jobs/styles/job-board.css"),
      "utf8",
    );

    expect(source).toContain('className="jobs-fixed-region"');
    expect(source).not.toContain("searchDocked");
    expect(source).toContain('className="job-filter-column"');
    expect(source).toContain('className="job-results"');
    expect(source).not.toContain("tabIndex={0}");
    expect(layoutSource).toContain("JobWorkspaceSearch");
    expect(headerSearchSource).toContain("dockToWorkspaceHeader");
    expect(headerSearchSource).toContain('pathname !== "/jobs"');
    expect(headerSearchSource).not.toContain('"/jobs/saved"');
    expect(headerSearchSource).not.toContain('"/jobs/matches"');
    expect(headerSearchSource).not.toContain('"/jobs/settings"');
    expect(headerSearchSource).toContain('new PopStateEvent("popstate")');
    expect(styles).toContain(".job-list");
    expect(styles).toContain(".jobs-search-sticky-region {");
    expect(styles).toContain("position: sticky;");
    expect(styles).toContain(
      "top: calc(var(--sh-topbar-height) + var(--sh-space-2));",
    );
    expect(styles).not.toContain(
      '.job-board-public-main .jobs-page,\n  .workspace-content[data-content-mode="job-board"] > .jobs-page',
    );
    expect(styles).not.toContain(
      ".job-filter-column,\n  .job-results {\n    position: static;",
    );
  });

  it("uses compact numeric pagination for job results", async () => {
    const source = await readFile(
      resolve(
        process.cwd(),
        "src/frontend/features/jobs/components/live-job-search-experience.tsx",
      ),
      "utf8",
    );
    const styles = await readFile(
      resolve(process.cwd(), "src/frontend/features/jobs/styles/job-board.css"),
      "utf8",
    );

    expect(source).toContain("function pageNumbers");
    expect(source).toContain("currentPage - 1");
    expect(source).toContain("currentPage + 1");
    expect(source).toContain("result.totalPages > 1");
    expect(source).toContain("goToPage(result.totalPages)");
    expect(source).toContain('className="job-pagination-progress"');
    expect(styles).toContain(".job-pagination-pages {");
    expect(styles).toContain("overflow-x: auto;");
  });

  it("keeps the Filters sidebar sticky with its own scroll region", async () => {
    const styles = await readFile(
      resolve(process.cwd(), "src/frontend/features/jobs/styles/job-board.css"),
      "utf8",
    );
    const formSource = await readFile(
      resolve(
        process.cwd(),
        "src/frontend/features/jobs/components/job-search-form.tsx",
      ),
      "utf8",
    );

    expect(styles).toContain("position: sticky;");
    expect(styles).toContain("max-height: calc(");
    expect(styles).toContain("overflow-y: auto;");
    expect(styles).toContain("overscroll-behavior: contain;");
    expect(formSource).toContain('filterColumn.addEventListener("wheel"');
    expect(styles).toContain(".job-filter-mobile-trigger");
    expect(styles).toContain(".job-filter-drawer");
    expect(styles).toContain("max-height: min(88dvh, 52rem);");
    expect(styles).toContain(".job-filter-actions {");
    expect(styles).toContain("position: sticky;");
  });

  it("routes Apply entry points to the page-based application wizard", async () => {
    const detailSource = await readFile(
      resolve(
        process.cwd(),
        "src/frontend/features/jobs/components/job-detail-redesign.tsx",
      ),
      "utf8",
    );
    const cardSource = await readFile(
      resolve(
        process.cwd(),
        "src/frontend/features/jobs/components/job-card.tsx",
      ),
      "utf8",
    );
    expect(cardSource).toContain('href={"/jobs/" + job.slug + "/apply"}');
    expect(detailSource).toContain(
      'const applyPath = "/jobs/" + job.slug + "/apply";',
    );
    expect(detailSource).toContain("href={applyPath}");
    expect(cardSource).not.toContain("?apply=true");
    expect(detailSource).not.toContain('params.get("apply")');
    expect(detailSource).not.toContain("scrollIntoView");
  });

  it("shows the Profile workspace bar and marks Jobs as active", () => {
    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          })
        }
      >
        <WorkspaceShell
          csrfProof="proof"
          profile={{ name: "Job Candidate", email: "candidate@example.test" }}
        >
          <h1>Jobs</h1>
        </WorkspaceShell>
      </QueryClientProvider>,
    );

    expect(
      screen.getByRole("complementary", { name: "Workspace sidebar" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Jobs" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("link", { name: /open profile for job candidate/i }),
    ).toBeVisible();
  });
});
