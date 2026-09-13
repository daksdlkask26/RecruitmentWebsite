import "server-only";

import { prisma } from "@/backend/database/prisma";
import type { Prisma } from "@/backend/generated/prisma/client";
import type { TeamApplicationListQuery } from "@/shared/contracts/company-members/team-applications";

const invitationSelect = {
  id: true,
  state: true,
  expiresAt: true,
} as const;

const candidateSelect = {
  id: true,
  companyId: true,
  appliedRole: true,
  status: true,
  submittedAt: true,
  ownerFirstViewedAt: true,
  decidedAt: true,
  joinedAt: true,
  company: { select: { displayName: true, slug: true } },
  invitation: { select: invitationSelect },
} as const;

const ownerSelect = {
  ...candidateSelect,
  applicationEmail: true,
  cvDisplayName: true,
  cvFileName: true,
  cvMimeType: true,
  cvByteSize: true,
  rejectionReason: true,
  candidate: { select: { user: { select: { name: true } } } },
} as const;

export type CandidateTeamApplicationRow = Awaited<
  ReturnType<PrismaTeamApplicationRepository["findForCandidate"]>
>;
export type OwnerTeamApplicationRow = Awaited<
  ReturnType<PrismaTeamApplicationRepository["findForOwner"]>
>;

export interface TeamApplicationRepositoryPort {
  listForCandidate(
    input: TeamApplicationCandidateListInput,
  ): ReturnType<PrismaTeamApplicationRepository["listForCandidate"]>;
  findForCandidate(
    userId: string,
    applicationId: string,
  ): ReturnType<PrismaTeamApplicationRepository["findForCandidate"]>;
  listForOwner(
    input: TeamApplicationOwnerListInput,
  ): ReturnType<PrismaTeamApplicationRepository["listForOwner"]>;
  countActionableForOwner(
    companyId: string,
    role?: TeamApplicationListQuery["role"],
    status?: TeamApplicationListQuery["status"],
  ): ReturnType<PrismaTeamApplicationRepository["countActionableForOwner"]>;
  findForOwner(
    companyId: string,
    applicationId: string,
  ): ReturnType<PrismaTeamApplicationRepository["findForOwner"]>;
}

export type TeamApplicationCandidateListInput = Omit<
  TeamApplicationListQuery,
  "cursor"
> & {
  userId: string;
  cursor: { submittedAt: Date; id: string } | null;
};

export type TeamApplicationOwnerListInput = Omit<
  TeamApplicationListQuery,
  "cursor"
> & {
  companyId: string;
  cursor: { submittedAt: Date; id: string } | null;
};

function afterCursor(
  cursor: { submittedAt: Date; id: string } | null,
  sort: TeamApplicationListQuery["sort"],
): Prisma.TeamApplicationWhereInput {
  if (!cursor) return {};
  const forward = sort === "SUBMITTED_ASC";
  return {
    OR: [
      { submittedAt: { [forward ? "gt" : "lt"]: cursor.submittedAt } },
      {
        submittedAt: cursor.submittedAt,
        id: { [forward ? "gt" : "lt"]: cursor.id },
      },
    ],
  } as Prisma.TeamApplicationWhereInput;
}

function candidateWhere(
  input: TeamApplicationCandidateListInput,
  withCursor: boolean,
): Prisma.TeamApplicationWhereInput {
  const base: Prisma.TeamApplicationWhereInput = {
    candidateUserId: input.userId,
    ...(input.status ? { status: input.status } : {}),
    ...(input.role ? { appliedRole: input.role } : {}),
  };
  return withCursor
    ? { AND: [base, afterCursor(input.cursor, input.sort)] }
    : base;
}

function ownerWhere(
  input: TeamApplicationOwnerListInput,
  withCursor: boolean,
): Prisma.TeamApplicationWhereInput {
  const base: Prisma.TeamApplicationWhereInput = {
    companyId: input.companyId,
    appliedRole: input.role ?? { in: ["HR_MANAGER", "RECRUITER"] },
    ...(input.status ? { status: input.status } : {}),
  };
  return withCursor
    ? { AND: [base, afterCursor(input.cursor, input.sort)] }
    : base;
}

export class PrismaTeamApplicationRepository implements TeamApplicationRepositoryPort {
  async listForCandidate(input: TeamApplicationCandidateListInput) {
    const direction = input.sort === "SUBMITTED_DESC" ? "desc" : "asc";
    const [rows, total] = await Promise.all([
      prisma.teamApplication.findMany({
        where: candidateWhere(input, true),
        select: candidateSelect,
        orderBy: [{ submittedAt: direction }, { id: direction }],
        take: input.limit + 1,
      }),
      prisma.teamApplication.count({ where: candidateWhere(input, false) }),
    ]);
    return { rows, total };
  }

  findForCandidate(userId: string, applicationId: string) {
    return prisma.teamApplication.findFirst({
      where: { id: applicationId, candidateUserId: userId },
      select: candidateSelect,
    });
  }

  async listForOwner(input: TeamApplicationOwnerListInput) {
    const direction = input.sort === "SUBMITTED_DESC" ? "desc" : "asc";
    const [rows, total] = await Promise.all([
      prisma.teamApplication.findMany({
        where: ownerWhere(input, true),
        select: ownerSelect,
        orderBy: [{ submittedAt: direction }, { id: direction }],
        take: input.limit + 1,
      }),
      prisma.teamApplication.count({ where: ownerWhere(input, false) }),
    ]);
    return { rows, total };
  }

  countActionableForOwner(
    companyId: string,
    role?: TeamApplicationListQuery["role"],
    status?: TeamApplicationListQuery["status"],
  ) {
    if (status && status !== "SUBMITTED" && status !== "VIEWED")
      return Promise.resolve(0);
    return prisma.teamApplication.count({
      where: {
        companyId,
        status: status ?? { in: ["SUBMITTED", "VIEWED"] },
        ...(role ? { appliedRole: role } : {}),
      },
    });
  }

  findForOwner(companyId: string, applicationId: string) {
    return prisma.teamApplication.findFirst({
      where: {
        id: applicationId,
        companyId,
        appliedRole: { in: ["HR_MANAGER", "RECRUITER"] },
      },
      select: ownerSelect,
    });
  }
}

export { candidateSelect, ownerSelect };
