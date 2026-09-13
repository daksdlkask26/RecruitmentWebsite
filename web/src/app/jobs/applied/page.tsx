import { redirect } from "next/navigation";
import { getWorkspaceContext } from "@/backend/auth/get-workspace-context";
import { CandidateApplicationError } from "@/backend/candidate-applications/candidate-application-errors";
import { CandidateApplicationTrackingService } from "@/backend/candidate-applications/candidate-application-tracking-service";
import { CandidateApplicationsListPage } from "@/frontend/features/candidate-applications/components/candidate-applications-list-page";
import { JobsWorkspace } from "@/frontend/features/jobs/components/jobs-workspace";
import { candidateApplicationListQuerySchema } from "@/shared/contracts/candidate-applications";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AppliedJobsRoute({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await getWorkspaceContext();
  if (!context) redirect("/login?returnTo=%2Fjobs%2Fapplied");
  const raw = (await searchParams) ?? {};
  const query = Object.fromEntries(
    Object.entries(raw).flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value]] : [],
    ),
  );
  const parsed = candidateApplicationListQuerySchema.safeParse(query);
  if (!parsed.success && typeof query.cursor === "string") {
    const cursorlessQuery = Object.fromEntries(
      Object.entries(query).filter(([key]) => key !== "cursor"),
    );
    const cursorless =
      candidateApplicationListQuerySchema.safeParse(cursorlessQuery);
    if (cursorless.success) {
      const restart = new URLSearchParams({
        filter: cursorless.data.filter,
        sort: cursorless.data.sort,
      });
      redirect(`/jobs/applied?${restart.toString()}`);
    }
  }
  const input = parsed.success
    ? parsed.data
    : { limit: 24, filter: "ALL" as const, sort: "SUBMITTED_DESC" as const };
  let result;
  try {
    result = await new CandidateApplicationTrackingService().list(
      { userId: context.userId, sessionId: context.sessionId },
      input,
    );
  } catch (error) {
    if (
      error instanceof CandidateApplicationError &&
      error.code === "APPLICATION_LIST_CURSOR_INVALID"
    ) {
      const restart = new URLSearchParams();
      restart.set("filter", input.filter ?? "ALL");
      restart.set("sort", input.sort ?? "SUBMITTED_DESC");
      redirect(`/jobs/applied?${restart.toString()}`);
    }
    throw error;
  }
  return (
    <JobsWorkspace>
      <CandidateApplicationsListPage
        initialApplications={result.applications}
        initialCursor={input.cursor ?? null}
        initialNextCursor={result.nextCursor}
        initialHasMore={result.hasMore}
        initialTotal={result.total}
        initialFilter={result.filter}
        initialSort={result.sort}
        initialCounts={result.counts}
      />
    </JobsWorkspace>
  );
}
