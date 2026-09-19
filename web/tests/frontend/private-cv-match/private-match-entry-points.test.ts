import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve(process.cwd(), "src");

describe("candidate CV Match Check entry points", () => {
  it("exposes the feature from the candidate dashboard and Jobs navigation", async () => {
    const [dashboard, navigation, jobsWorkspace, suggestedJobsRoute] =
      await Promise.all([
        readFile(
          resolve(
            sourceRoot,
            "frontend/features/dashboard/components/dashboard-view.tsx",
          ),
          "utf8",
        ),
        readFile(
          resolve(
            sourceRoot,
            "frontend/features/dashboard/components/workspace-navigation.tsx",
          ),
          "utf8",
        ),
        readFile(
          resolve(
            sourceRoot,
            "frontend/features/jobs/components/jobs-workspace.tsx",
          ),
          "utf8",
        ),
        readFile(resolve(sourceRoot, "app/jobs/matches/page.tsx"), "utf8"),
      ]);

    expect(dashboard).toContain('href="/cv-match-check"');
    expect(dashboard).toContain("matchTitle");
    expect(navigation).toContain('href: "/cv-match-check"');
    expect(navigation).toContain("CV Match Check");
    expect(jobsWorkspace).toContain('href: "/jobs/matches"');
    expect(jobsWorkspace).toContain("Suggested Jobs");
    expect(navigation).toContain("Suggested Jobs");
    expect(suggestedJobsRoute).toContain("SuggestedJobsPage");
    expect(suggestedJobsRoute).toContain("suggestedJobsForSnapshot");
  });

  it("offers a private check from active candidate job details and preselects that job", async () => {
    const [
      jobDetail,
      matchesRoute,
      setupRoute,
      setupRouteComponent,
      jobSearchRoute,
      setup,
      matchLayout,
      workspaceLayout,
    ] = await Promise.all([
      readFile(
        resolve(
          sourceRoot,
          "frontend/features/jobs/components/job-detail-redesign.tsx",
        ),
        "utf8",
      ),
      readFile(
        resolve(sourceRoot, "app/(workspace)/cv-match-check/page.tsx"),
        "utf8",
      ),
      readFile(
        resolve(sourceRoot, "app/(workspace)/cv-match-check/new/page.tsx"),
        "utf8",
      ),
      readFile(
        resolve(sourceRoot, "app/private-match-setup-route.tsx"),
        "utf8",
      ),
      readFile(
        resolve(
          sourceRoot,
          "app/api/candidate/private-cv-matches/jobs/route.ts",
        ),
        "utf8",
      ),
      readFile(
        resolve(
          sourceRoot,
          "frontend/features/private-cv-match/components/private-match-setup.tsx",
        ),
        "utf8",
      ),
      readFile(
        resolve(sourceRoot, "app/(workspace)/cv-match-check/layout.tsx"),
        "utf8",
      ),
      readFile(resolve(sourceRoot, "app/(workspace)/layout.tsx"), "utf8"),
    ]);

    expect(jobDetail).toContain("copy.checkCvFit");
    expect(jobDetail).toContain("copy.checkCvFitAria");
    expect(jobDetail).toContain("/cv-match-check/new?jobId=");
    expect(matchesRoute).toContain("PrivateMatchList");
    expect(setupRoute).toContain("PrivateMatchSetupRoute");
    expect(setupRouteComponent).toContain("initialJobId={requestedJobId}");
    expect(setupRouteComponent).toContain("findEligiblePrivateMatchJob");
    expect(setupRouteComponent).toContain("listEligiblePrivateMatchJobs");
    expect(jobSearchRoute).toContain("searchEligiblePrivateMatchJobs");
    expect(jobSearchRoute).toContain("privateMatchJobsResponseSchema");
    expect(setupRoute).not.toContain("readJobWorkspaceSnapshot");
    expect(setup).toContain("initialJobId");
    expect(setup).toContain("requestedJobIsUnavailable");
    expect(setup).toContain("requestedCvIsUnavailable");
    expect(setup).toContain("private-match-job-search");
    expect(setup).toContain("/api/account/candidate-cvs");
    expect(setup).toContain("mutateWithCurrentCsrf");
    expect(setup).not.toContain("/profile/cv-imports/${");
    expect(setup).not.toContain("<select");
    expect(setup).not.toContain("private-match-compact-select");
    expect(setup).toContain("private-match-setup-cta");
    expect(setup).toContain(
      "router.push(`/cv-match-check/${encodeURIComponent(result.checkId)}`)",
    );
    expect(setup).not.toContain(
      "jobs.find((job) => job.jobId === jobId) ?? jobs[0]",
    );
    expect(matchLayout).toContain("AppProviders");
    expect(matchLayout).toContain("<AppProviders>{children}</AppProviders>");
    expect(workspaceLayout).toContain("WorkspaceShell");
    expect(workspaceLayout).toContain('initialWorkspaceMode="candidate"');
  });

  it("serves the approved setup at the Jobs route through the shared shell", async () => {
    const [jobsMatchRoute, jobsMatchLayout, jobsLayout] = await Promise.all([
      readFile(resolve(sourceRoot, "app/jobs/matches/new/page.tsx"), "utf8"),
      readFile(resolve(sourceRoot, "app/jobs/matches/new/layout.tsx"), "utf8"),
      readFile(resolve(sourceRoot, "app/jobs/layout.tsx"), "utf8"),
    ]);

    expect(jobsMatchRoute).toContain("PrivateMatchSetupRoute");
    expect(jobsMatchLayout).toContain("AppProviders");
    expect(jobsLayout).toContain("WorkspaceShell");
    expect(jobsLayout).toContain('initialWorkspaceMode="candidate"');
  });

  it("serves the report from the Jobs route through the shared matches layout", async () => {
    const [reportRoute, matchesLayout, jobsLayout] = await Promise.all([
      readFile(
        resolve(sourceRoot, "app/jobs/matches/[checkId]/page.tsx"),
        "utf8",
      ),
      readFile(resolve(sourceRoot, "app/jobs/matches/layout.tsx"), "utf8"),
      readFile(resolve(sourceRoot, "app/jobs/layout.tsx"), "utf8"),
    ]);

    expect(reportRoute).toContain("redirect(`/cv-match-check/");
    expect(reportRoute).not.toContain("PrivateMatchPageClient");
    expect(matchesLayout).toContain("AppProviders");
    expect(matchesLayout).toContain("private-cv-match.css");
    expect(jobsLayout).toContain("WorkspaceShell");
    expect(jobsLayout).toContain('initialWorkspaceMode="candidate"');
  });
});
