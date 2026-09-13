import { redirect } from "next/navigation";
import { getWorkspaceContext } from "@/backend/auth/get-workspace-context";
import {
  TeamApplicationOwnerError,
  TeamApplicationOwnerService,
} from "@/backend/services/company-members/team-application-owner-service";
import { CompanyTeamApplicationsScreen } from "@/frontend/features/recruiter-workspace/company-team-applications-screen";
import {
  ownerTeamApplicationListSchema,
  teamApplicationListQuerySchema,
} from "@/shared/contracts/company-members/team-applications";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function TeamApplicationsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await getWorkspaceContext();
  if (!context)
    redirect(
      "/login?returnTo=%2Frecruiter%2Fcompany-settings%2Fteam%2Fapplications",
    );
  const query = searchParams ? await searchParams : {};
  const requestedCompanyId = Array.isArray(query.companyId)
    ? query.companyId[0]
    : query.companyId;
  const service = new TeamApplicationOwnerService();
  const eligibleCompanies = await service.listEligibleCompanies(context.userId);
  const hasExplicitCompanyId = query.companyId !== undefined;
  const selectedCompanyId = hasExplicitCompanyId
    ? eligibleCompanies.find((company) => company.id === requestedCompanyId)?.id
    : eligibleCompanies.length === 1
      ? eligibleCompanies[0]?.id
      : undefined;
  const rawListQuery = Object.fromEntries(
    Object.entries(query).flatMap(([key, value]) =>
      key === "companyId" || key === "selected" || typeof value !== "string"
        ? []
        : [[key, value]],
    ),
  );
  const parsedQuery = teamApplicationListQuerySchema.safeParse(rawListQuery);
  if (!parsedQuery.success && typeof query.cursor === "string") {
    const cursorlessQuery = Object.fromEntries(
      Object.entries(rawListQuery).filter(([key]) => key !== "cursor"),
    );
    const cursorless =
      teamApplicationListQuerySchema.safeParse(cursorlessQuery);
    if (cursorless.success) {
      const restartParams = new URLSearchParams();
      if (selectedCompanyId) restartParams.set("companyId", selectedCompanyId);
      restartParams.set("sort", cursorless.data.sort);
      if (cursorless.data.status)
        restartParams.set("status", cursorless.data.status);
      if (cursorless.data.role) restartParams.set("role", cursorless.data.role);
      redirect(
        `/recruiter/company-settings/team/applications?${restartParams.toString()}`,
      );
    }
  }
  const listQuery = parsedQuery.success
    ? parsedQuery.data
    : teamApplicationListQuerySchema.parse({});
  const emptyResult = ownerTeamApplicationListSchema.parse({
    items: [],
    nextCursor: null,
    hasMore: false,
    total: 0,
    pendingCount: 0,
    filter: { status: null, role: null },
    sort: "SUBMITTED_DESC" as const,
  });
  let result = emptyResult;
  if (selectedCompanyId) {
    try {
      result = await service.list(context.userId, selectedCompanyId, listQuery);
    } catch (error) {
      if (
        error instanceof TeamApplicationOwnerError &&
        error.code === "TEAM_APPLICATION_CURSOR_INVALID"
      ) {
        const restartParams = new URLSearchParams({
          companyId: selectedCompanyId,
          sort: listQuery.sort ?? "SUBMITTED_DESC",
        });
        if (listQuery.status) restartParams.set("status", listQuery.status);
        if (listQuery.role) restartParams.set("role", listQuery.role);
        redirect(
          `/recruiter/company-settings/team/applications?${restartParams.toString()}`,
        );
      } else if (
        error instanceof TeamApplicationOwnerError &&
        error.code === "TEAM_APPLICATION_LIST_REQUEST_INVALID"
      ) {
        result = await service.list(context.userId, selectedCompanyId, {});
      } else if (error instanceof TeamApplicationOwnerError) {
        redirect(
          `/recruiter/company-settings?companyId=${encodeURIComponent(selectedCompanyId)}`,
        );
      } else {
        throw error;
      }
    }
  }
  return (
    <CompanyTeamApplicationsScreen
      initialApplications={result.items}
      companyId={selectedCompanyId}
      eligibleCompanies={eligibleCompanies}
      initialCursor={listQuery.cursor ?? null}
      initialNextCursor={result.nextCursor}
      initialHasMore={result.hasMore}
      initialTotal={result.total}
      initialPendingCount={result.pendingCount}
      initialFilter={result.filter}
      initialSort={result.sort}
    />
  );
}
