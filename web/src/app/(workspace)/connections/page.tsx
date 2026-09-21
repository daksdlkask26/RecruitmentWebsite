import { redirect } from "next/navigation";
import { getWorkspaceContext } from "@/backend/auth/get-workspace-context";
import { getConnectionsWorkspaceData } from "@/backend/connections/services/connections-workspace-service";
import { ConnectionsWorkspace } from "@/frontend/features/connections/components/connections-workspace";
import "@/frontend/features/connections/styles/connections.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Professional Connections | SmartHire" };

export default async function ConnectionsPage() {
  const context = await getWorkspaceContext();
  if (!context) redirect("/login?returnTo=%2Fconnections");
  const data = await getConnectionsWorkspaceData(context.userId);
  return (
    <ConnectionsWorkspace
      csrfProof={context.csrfProof}
      currentUserId={context.userId}
      initialProposals={data.proposals}
      initialConnections={data.connections}
      initialNotifications={data.notifications}
    />
  );
}
