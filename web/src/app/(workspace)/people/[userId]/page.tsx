import { notFound, redirect } from "next/navigation";
import { getWorkspaceContext } from "@/backend/auth/get-workspace-context";
import { PublicProfessionalProfileService } from "@/backend/services/profile/public-professional-profile-service";
import { PublicProfessionalProfile } from "@/frontend/features/profile/components/public-professional-profile";

export const dynamic = "force-dynamic";

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const workspace = await getWorkspaceContext();
  if (!workspace) redirect("/login");
  const { userId } = await params;
  const profile = await new PublicProfessionalProfileService().get(
    workspace.userId,
    userId,
  );
  if (!profile) notFound();
  return (
    <PublicProfessionalProfile
      participant={profile.participant}
      contexts={profile.contexts}
      profile={profile.profile}
      visibleSections={profile.visibleSections}
      csrfProof={workspace.csrfProof}
      canMessage={profile.canMessage}
    />
  );
}
