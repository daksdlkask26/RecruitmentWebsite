import "server-only";

import { prisma } from "@/backend/database/prisma";
import { candidateVisibleJobWhere } from "@/backend/repositories/jobs/candidate-visible-job-policy";
import {
  companyLocationRegions,
  companyLocationSearchTerms,
} from "@/shared/utils/locations/company-location";
import { resolveSearchQuery } from "@/backend/services/search/search-query-resolver";

const publicCompanyWhere = {
  verifiedAt: { not: null },
  verificationState: "ACTIVE" as const,
  verificationInactiveAt: null,
  moderationState: "ACTIVE" as const,
};

const publicCompanySelect = {
  id: true,
  slug: true,
  displayName: true,
  logoUrl: true,
  publicDescription: true,
  publicLocation: true,
  foundedYear: true,
  industry: true,
} as const;

export type PublicCompanyRow = Awaited<
  ReturnType<PrismaCompanyDiscoveryRepository["findById"]>
>;

export interface CompanyDiscoveryRepository {
  list(input: {
    q?: string;
    location?: string;
    page: number;
    limit: number;
  }): Promise<{
    items: Array<{
      id: string;
      slug: string;
      displayName: string;
      logoUrl: string | null;
      publicDescription: string | null;
      publicLocation: string | null;
      industry: string | null;
      openPositionCount: number;
    }>;
    total: number;
    locations?: string[];
  }>;
  findById(companyId: string): Promise<{
    id: string;
    slug: string;
    displayName: string;
    logoUrl: string | null;
    publicDescription: string | null;
    publicLocation: string | null;
    foundedYear: number | null;
    industry: string | null;
    activeEmployeeCount: number;
    activeOwnerCount: number;
    openPositionCount: number;
  } | null>;
}

export class PrismaCompanyDiscoveryRepository implements CompanyDiscoveryRepository {
  async list(input: {
    q?: string;
    location?: string;
    page: number;
    limit: number;
  }) {
    const resolved = resolveSearchQuery(input.q ?? "", "COMPANIES");
    const variants = resolved.variants.length
      ? resolved.variants
      : [{ value: "", source: "ORIGINAL" as const }];
    const locationTerms = companyLocationSearchTerms(input.location);
    const filters = [
      ...(input.q
        ? [
            {
              OR: variants.map((variant) => ({
                AND: variant.value.split(/\s+/u).filter(Boolean).map((term) => ({
                  OR: [
                    { slug: { contains: term, mode: "insensitive" as const } },
                    { displayName: { contains: term, mode: "insensitive" as const } },
                    { publicDescription: { contains: term, mode: "insensitive" as const } },
                    { publicLocation: { contains: term, mode: "insensitive" as const } },
                    { industry: { contains: term, mode: "insensitive" as const } },
                  ],
                })),
              })),
            },
          ]
        : []),
      ...(locationTerms.length
        ? [
            {
              OR: locationTerms.map((term) => ({
                publicLocation: {
                  contains: term,
                  mode: "insensitive" as const,
                },
              })),
            },
          ]
        : []),
    ];
    const where = filters.length
      ? { ...publicCompanyWhere, AND: filters }
      : publicCompanyWhere;
    const now = new Date();
    const [items, total, locationRows] = await Promise.all([
      prisma.company.findMany({
        where,
        select: {
          ...publicCompanySelect,
          _count: {
            select: {
              jobPostings: { where: candidateVisibleJobWhere(now) },
            },
          },
        },
        orderBy: [{ displayName: "asc" }, { id: "asc" }],
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      prisma.company.count({ where }),
      prisma.company.findMany({
        // Keep the location menu relevant to the active keyword/location
        // result set while preserving the same public-company boundary.
        where,
        select: { publicLocation: true },
        orderBy: { publicLocation: "asc" },
      }),
    ]);
    const locations = companyLocationRegions(
      locationRows.map((row) => row.publicLocation),
    ).slice(0, 200);
    return {
      items: items.map(({ _count, ...company }) => ({
        ...company,
        openPositionCount: _count.jobPostings,
      })),
      total,
      locations,
    };
  }

  async findById(companyId: string) {
    const now = new Date();
    const company = await prisma.company.findFirst({
      where: { id: companyId, ...publicCompanyWhere },
      select: {
        ...publicCompanySelect,
        _count: {
          select: {
            jobPostings: { where: candidateVisibleJobWhere(now) },
          },
        },
      },
    });
    if (!company) return null;
    const [activeEmployeeCount, activeOwnerCount] = await Promise.all([
      prisma.companyMembership.count({
        where: {
          companyId: company.id,
          status: "ACTIVE",
          removedAt: null,
        },
      }),
      prisma.companyMembership.count({
        where: {
          companyId: company.id,
          role: "OWNER",
          status: "ACTIVE",
          removedAt: null,
        },
      }),
    ]);
    const { _count, ...publicFields } = company;
    return {
      ...publicFields,
      activeEmployeeCount,
      activeOwnerCount,
      openPositionCount: _count.jobPostings,
    };
  }
}

export { publicCompanyWhere };
