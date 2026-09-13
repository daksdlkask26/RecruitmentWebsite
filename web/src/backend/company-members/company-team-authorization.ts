import "server-only";

import { prisma } from "@/backend/database/prisma";

export class CompanyTeamAuthorizationError extends Error {
  constructor(readonly code: "TEAM_FORBIDDEN") {
    super(code);
  }
}

export async function requireActiveCompanyOwner(
  userId: string,
  companyId?: string,
) {
  const memberships = await prisma.companyMembership.findMany({
    where: {
      userId,
      ...(companyId ? { companyId } : {}),
      role: "OWNER",
      status: "ACTIVE",
      removedAt: null,
      company: {
        verificationState: "ACTIVE",
        verificationInactiveAt: null,
        moderationState: "ACTIVE",
      },
    },
    select: { companyId: true, company: { select: { displayName: true } } },
    take: 2,
  });
  if (memberships.length !== 1)
    throw new CompanyTeamAuthorizationError("TEAM_FORBIDDEN");
  return memberships[0];
}
