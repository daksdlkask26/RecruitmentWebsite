import { redirect } from "next/navigation";
import { getWorkspaceContext } from "@/backend/auth/get-workspace-context";
import { RecruitmentMessagingService } from "@/backend/recruitment-messaging/recruitment-messaging-service";
import { RecruitmentMessagingWorkspace } from "@/frontend/features/recruitment-messaging/recruitment-messaging-workspace";
import "@/frontend/features/recruitment-messaging/recruitment-messaging.css";

export const dynamic = "force-dynamic";

export default async function RecruiterMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string }>;
}) {
  const context = await getWorkspaceContext();
  if (!context) redirect("/login?returnTo=%2Frecruiter%2Fmessages");
  const messaging = new RecruitmentMessagingService();
  const { items, ownerOversight } = await messaging.workspace(context.userId);
  return (
    <RecruitmentMessagingWorkspace
      csrfProof={context.csrfProof}
      initialItems={items}
      initialThreadId={(await searchParams).thread ?? null}
      ownerOversight={ownerOversight}
    />
  );
}
