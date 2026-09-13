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
 * Resolves the tenant from the application and, when supplied, requires the
 * caller's explicit company scope to match it. The session remains the source
 * of authorization; the client value is only a narrowing selector.
 */
export async function requireTeamApplicationOwner(
  userId: string,
  applicationId: string,
  expectedCompanyId?: string,
) {
  const application = await prisma.teamApplication.findUnique({
    where: { id: applicationId },
    select: { id: true, companyId: true },
  });
  if (!application) {
    throw new TeamApplicationAuthorizationError("TEAM_APPLICATION_UNAVAILABLE");
  }
  if (expectedCompanyId && expectedCompanyId !== application.companyId) {
    throw new TeamApplicationAuthorizationError("TEAM_APPLICATION_FORBIDDEN");
  }
  try {
    const owner = await requireActiveCompanyOwner(userId, expectedCompanyId);
    if (owner.companyId !== application.companyId) {
      throw new TeamApplicationAuthorizationError("TEAM_APPLICATION_FORBIDDEN");
    }
    return { application, owner };
  } catch {
    throw new TeamApplicationAuthorizationError("TEAM_APPLICATION_FORBIDDEN");
  }
}
