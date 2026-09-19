import "server-only";

import { prisma } from "@/backend/database/prisma";
import { candidateVisibleJobWhere } from "@/backend/repositories/jobs/candidate-visible-job-policy";
import { getPublicCompanyWhere } from "@/backend/repositories/companies/public-company-visibility-policy";

export type HomePublicCompanyRow = {
  slug: string;
  displayName: string;
  logoUrl: string | null;
  publicDescription: string | null;
  publicLocation: string | null;
  industry: string | null;
  size: string | null;
  openPositionCount: number;
};

export interface HomePublicCompanyRepository {
  list(now: Date, limit: number): Promise<readonly HomePublicCompanyRow[]>;
  count(now: Date): Promise<number>;
}

function activeCompanyWhere(now: Date) {
  return {
    ...getPublicCompanyWhere(),
    jobPostings: {
      some: {
        ...candidateVisibleJobWhere(now),
      },
    },
  };
}

function activeJobWhere(now: Date) {
  return candidateVisibleJobWhere(now);
}

export class PrismaHomePublicCompanyRepository implements HomePublicCompanyRepository {
  async list(now: Date, limit = 6): Promise<readonly HomePublicCompanyRow[]> {
    const rows = await prisma.company.findMany({
      where: activeCompanyWhere(now),
      orderBy: [{ verifiedAt: "desc" }, { id: "asc" }],
      take: Math.min(Math.max(limit, 1), 6),
      select: {
        slug: true,
        displayName: true,
        logoUrl: true,
        publicDescription: true,
        publicLocation: true,
        industry: true,
        size: true,
        _count: {
          select: {
            jobPostings: {
              where: activeJobWhere(now),
            },
          },
        },
      },
    });
    return rows.map(({ _count, ...company }) => ({
      ...company,
      openPositionCount: _count.jobPostings,
    }));
  }

  count(now: Date): Promise<number> {
    return prisma.company.count({ where: activeCompanyWhere(now) });
  }
}
