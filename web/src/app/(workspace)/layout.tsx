import "../../frontend/styles/workspace.css";
import "../../frontend/styles/responsive.css";
import "../../frontend/styles/recruiter-workspace-full.css";
import "../../frontend/features/jobs/styles/job-board.css";
import "../../frontend/features/profile/styles/professional-profile.css";
import { redirect } from "next/navigation";
import { getWorkspaceContext } from "@/backend/auth/get-workspace-context";
import { WorkspaceShell } from "@/frontend/features/dashboard/components/workspace-shell";

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { headers } = await import("next/headers");
  const { notFound } = await import("next/navigation");
  const { isCandidateRequestHost } =
    await import("@/backend/auth/candidate-host-boundary");
  if (!isCandidateRequestHost(await headers())) notFound();

  const context = await getWorkspaceContext();
  if (!context) {
    const requestPath = (await headers()).get("x-smarthire-request-path");
    if (requestPath === "/company" || requestPath?.startsWith("/company/"))
      return <>{children}</>;
    redirect("/login?returnTo=%2Fdashboard");
  }

  return (
    <WorkspaceShell
      csrfProof={context.csrfProof}
      profile={context.account}
      initialLocale={context.initialLocale}
      initialRecruiterStatus={context.initialRecruiterStatus}
      initialWorkspaceMode="candidate"
    >
      {children}
    </WorkspaceShell>
  );
}
