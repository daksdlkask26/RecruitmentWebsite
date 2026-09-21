import { redirect } from "next/navigation";
import { getWorkspaceContext } from "@/backend/auth/get-workspace-context";
import { RequesterSupportService } from "@/backend/support/services/requester-support-service";
import { SupportWorkspace } from "@/frontend/features/support/components/support-workspace";
import "@/frontend/features/support/styles/support.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "SmartHire Support" };

export default async function SupportPage() {
  const context = await getWorkspaceContext();
  if (!context) redirect("/login?returnTo=%2Fsupport");
  const cases = await new RequesterSupportService().list(context.userId);
  return (
    <SupportWorkspace csrfProof={context.csrfProof} initialCases={cases} />
  );
}
