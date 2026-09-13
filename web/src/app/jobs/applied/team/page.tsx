import { redirect } from "next/navigation";
import { getWorkspaceContext } from "@/backend/auth/get-workspace-context";
import {
  TeamApplicationCommandError,
  TeamApplicationService,
} from "@/backend/services/company-members/team-application-service";
import { TeamApplicationStatus } from "@/frontend/features/candidate-company/team-application-status";
import { JobsWorkspace } from "@/frontend/features/jobs/components/jobs-workspace";
import { teamApplicationListQuerySchema } from "@/shared/contracts/company-members/team-applications";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CandidateTeamApplicationsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await getWorkspaceContext();
  if (!context) redirect("/login?returnTo=%2Fjobs%2Fapplied%2Fteam");
  const raw = (await searchParams) ?? {};
  const query = Object.fromEntries(
    Object.entries(raw).flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value]] : [],
    ),
  );
  const parsed = teamApplicationListQuerySchema.safeParse(query);
  if (!parsed.success && typeof query.cursor === "string") {
    const cursorlessQuery = Object.fromEntries(
      Object.entries(query).filter(([key]) => key !== "cursor"),
    );
    const cursorless =
      teamApplicationListQuerySchema.safeParse(cursorlessQuery);
    if (cursorless.success) {
      const restart = new URLSearchParams({
        sort: cursorless.data.sort,
      });
      if (cursorless.data.status) restart.set("status", cursorless.data.status);
      if (cursorless.data.role) restart.set("role", cursorless.data.role);
      redirect(`/jobs/applied/team?${restart.toString()}`);
    }
  }
  const input = parsed.success
    ? parsed.data
    : { limit: 24, sort: "SUBMITTED_DESC" as const };
  let result;
  try {
    result = await new TeamApplicationService().listCandidate(
      context.userId,
      input,
    );
  } catch (error) {
    if (
      error instanceof TeamApplicationCommandError &&
      error.code === "TEAM_APPLICATION_CURSOR_INVALID"
    ) {
      const restart = new URLSearchParams();
      if (input.status) restart.set("status", input.status);
      if (input.role) restart.set("role", input.role);
      restart.set("sort", input.sort ?? "SUBMITTED_DESC");
      redirect(
        `/jobs/applied/team${restart.toString() ? `?${restart.toString()}` : ""}`,
      );
    }
    throw error;
  }
  return (
    <JobsWorkspace>
      <TeamApplicationStatus
        initialApplications={result.items}
        initialCursor={input.cursor ?? null}
        initialNextCursor={result.nextCursor}
        initialHasMore={result.hasMore}
        initialTotal={result.total}
        initialFilter={result.filter}
        initialSort={result.sort}
      />
    </JobsWorkspace>
  );
}
