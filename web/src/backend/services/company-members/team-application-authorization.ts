import "server-only";

import { prisma } from "@/backend/database/prisma";
import { requireActiveCompanyOwner } from "@/backend/company-members/company-team-authorization";

export class TeamApplicationAuthorizationError extends Error {
  constructor(
    readonly code:
      | "TEAM_APPLICATION_UNAVAILABLE"
      | "TEAM_APPLICATION_FORBIDDEN"
      | "MEMBERSHIP_REQUIRED",
  ) {
    super(code);
  }
}

/**
 * Resolves the tenant from the application before checking the current
 * account's Owner membership. The caller never supplies a company id that can
 * broaden this authorization check.
 */
export async function requireTeamApplicationOwner(
  userId: string,
  applicationId: string,
) {
  const application = await prisma.teamApplication.findUnique({
    where: { id: applicationId },
    select: { id: true, companyId: true },
  });
  if (!application) {
    throw new TeamApplicationAuthorizationError("TEAM_APPLICATION_UNAVAILABLE");
  }
  try {
    const owner = await requireActiveCompanyOwner(
      userId,
      application.companyId,
    );
    return { application, owner };
  } catch {
    throw new TeamApplicationAuthorizationError("TEAM_APPLICATION_FORBIDDEN");
  }
}
