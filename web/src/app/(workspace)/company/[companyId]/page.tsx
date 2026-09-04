import { notFound, redirect } from "next/navigation";
import { getWorkspaceContext } from "@/backend/auth/get-workspace-context";
import { CompanyDiscoveryAuthorizationError } from "@/backend/services/companies/company-discovery-authorization";
import { CompanyDiscoveryService } from "@/backend/services/companies/company-discovery-service";
import { JobInteractionProvider } from "@/frontend/features/jobs/components/job-interaction-provider";
import { CompanyDetailScreen } from "@/frontend/features/candidate-company/company-detail-screen";
import { companyJobSearchQuerySchema } from "@/shared/contracts/company";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ companyId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CompanyDetailPage({
  params,
  searchParams,
}: PageProps) {
  const context = await getWorkspaceContext();
  if (!context) redirect("/login?returnTo=%2Fcompany");
  const { companyId } = await params;
  const raw = searchParams ? await searchParams : {};
  const parsedQuery = companyJobSearchQuerySchema.safeParse({
    q: first(raw.q),
    searchMode: first(raw.searchMode),
    location: first(raw.location),
    page: first(raw.page),
    limit: first(raw.limit),
  });
  const query = parsedQuery.success
    ? parsedQuery.data
    : companyJobSearchQuerySchema.parse({});

  let company;
  try {
    company = await new CompanyDiscoveryService().detail(
      companyId,
      {
        kind: "user",
        userId: context.userId,
        sessionId: context.sessionId,
      },
      {
        q: query.q,
        searchMode: query.searchMode,
        location: query.location,
        searchBy: "BOTH",
        sort: "NEWEST",
        page: query.page,
        limit: query.limit,
      },
    );
  } catch (error) {
    if (error instanceof CompanyDiscoveryAuthorizationError) notFound();
    throw error;
  }
  return (
    <JobInteractionProvider>
      <CompanyDetailScreen
        initialCompany={company}
        initialKeyword={query.q}
        initialSearchMode={query.searchMode}
        initialLocation={query.location}
        initialLimit={query.limit}
      />
    </JobInteractionProvider>
  );
}
