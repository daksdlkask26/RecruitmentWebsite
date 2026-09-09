import { redirect } from "next/navigation";
import { getWorkspaceContext } from "@/backend/auth/get-workspace-context";
import { readRecruiterCompanySettingsList } from "@/backend/services/jobs/recruiter-job-posting-data";
import { CompanySettingsScreen } from "@/frontend/features/recruiter-workspace/company-settings-screen";

export const dynamic = "force-dynamic";

export default async function RecruiterCompanySettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    companyId?: string | string[];
    deletionRequestId?: string | string[];
  }>;
}) {
  const context = await getWorkspaceContext();
  if (!context) redirect("/login?returnTo=%2Frecruiter%2Fcompany-settings");
  const companies = await readRecruiterCompanySettingsList(context.userId);
  const query = searchParams ? await searchParams : {};
  const requestedCompanyId = Array.isArray(query.companyId)
    ? query.companyId[0]
    : query.companyId;
  const requestedDeletionId = Array.isArray(query.deletionRequestId)
    ? query.deletionRequestId[0]
    : query.deletionRequestId;
  const deletionRequestId =
    requestedDeletionId && /^[A-Za-z0-9_-]{1,128}$/u.test(requestedDeletionId)
      ? requestedDeletionId
      : undefined;
  const company =
    companies.find(
      (candidate) =>
        candidate.id === requestedCompanyId ||
        candidate.databaseId === requestedCompanyId,
    ) ??
    companies[0] ??
    null;
  const companySelectedByQuery = Boolean(
    requestedCompanyId &&
    company &&
    (company.id === requestedCompanyId ||
      company.databaseId === requestedCompanyId),
  );
  return (
    <CompanySettingsScreen
      initialCompany={company}
      initialCompanies={companies}
      canManageTeam={company?.role === "OWNER"}
      initialCompanyId={companySelectedByQuery ? company?.id : undefined}
      initialDeletionRequestId={deletionRequestId}
    />
  );
}
