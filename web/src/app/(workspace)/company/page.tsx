import { redirect } from "next/navigation";
import { getWorkspaceContext } from "@/backend/auth/get-workspace-context";
import { CompanyDiscoveryService } from "@/backend/services/companies/company-discovery-service";
import { CompanyListScreen } from "@/frontend/features/candidate-company/company-list-screen";
import { companyListQuerySchema } from "@/shared/contracts/company";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CompanyPage({ searchParams }: PageProps) {
  const raw = searchParams ? await searchParams : {};
  const parsed = companyListQuerySchema.safeParse({
    q: first(raw.q),
    searchMode: first(raw.searchMode),
    location: first(raw.location),
    page: first(raw.page),
    limit: first(raw.limit),
  });
  const query = parsed.success ? parsed.data : companyListQuerySchema.parse({});

  const context = await getWorkspaceContext();
  if (!context) redirect("/login?returnTo=%2Fcompany");

  const result = await new CompanyDiscoveryService().list(query);
  return (
    <CompanyListScreen
      companies={result.items}
      total={result.total}
      page={result.page}
      totalPages={result.totalPages}
      initialQuery={query.q}
      initialSearchMode={query.searchMode}
      initialLocation={query.location}
      initialLimit={query.limit}
      locations={result.locations}
      searchInterpretation={result.searchInterpretation}
    />
  );
}
