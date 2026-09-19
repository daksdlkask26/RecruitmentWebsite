import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), count: vi.fn() }));
vi.mock("@/backend/database/prisma", () => ({
  prisma: { company: { findMany: mocks.findMany, count: mocks.count } },
}));

import { PrismaHomePublicCompanyRepository } from "@/backend/repositories/home/prisma-home-public-company-repository";

describe("Home public company repository", () => {
  beforeEach(() => vi.clearAllMocks());

  it("selects active verified companies with open positions and an authoritative job count", async () => {
    mocks.findMany.mockResolvedValue([
      {
        slug: "verified-company",
        displayName: "Verified Company",
        logoUrl: null,
        publicDescription: "Public summary",
        publicLocation: "Hà Nội",
        industry: "Technology",
        size: "51-200",
        _count: { jobPostings: 9 },
      },
    ]);
    const now = new Date("2026-08-12T00:00:00.000Z");
    const result = await new PrismaHomePublicCompanyRepository().list(now, 99);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          verificationState: "ACTIVE",
          verifiedAt: { not: null },
          verificationInactiveAt: null,
          moderationState: "ACTIVE",
          jobPostings: {
            some: expect.objectContaining({
              status: "ACTIVE",
              approvedAt: { not: null },
              publishedAt: { not: null, lte: now },
              company: expect.objectContaining({
                moderationState: "ACTIVE",
              }),
              AND: expect.arrayContaining([
                expect.objectContaining({
                  OR: [
                    { applicationDeadline: null },
                    { applicationDeadline: { gt: now } },
                  ],
                }),
                expect.objectContaining({
                  OR: expect.any(Array),
                }),
              ]),
            }),
          },
        }),
        orderBy: [{ verifiedAt: "desc" }, { id: "asc" }],
        take: 6,
        select: expect.objectContaining({
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
                where: expect.objectContaining({
                  status: "ACTIVE",
                  approvedAt: { not: null },
                  publishedAt: { not: null, lte: now },
                  company: expect.objectContaining({
                    moderationState: "ACTIVE",
                  }),
                  AND: expect.any(Array),
                }),
              },
            },
          },
        }),
      }),
    );
    expect(result).toEqual([
      {
        slug: "verified-company",
        displayName: "Verified Company",
        logoUrl: null,
        publicDescription: "Public summary",
        publicLocation: "Hà Nội",
        industry: "Technology",
        size: "51-200",
        openPositionCount: 9,
      },
    ]);
    expect(JSON.stringify(mocks.findMany.mock.calls[0][0])).not.toMatch(
      /tax|membership|private|address|culture|badge/iu,
    );
  });

  it("counts with the same active-company criteria as the preview", async () => {
    mocks.count.mockResolvedValue(42);
    const now = new Date("2026-08-12T00:00:00.000Z");

    await expect(
      new PrismaHomePublicCompanyRepository().count(now),
    ).resolves.toBe(42);
    expect(mocks.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        verificationState: "ACTIVE",
        moderationState: "ACTIVE",
        jobPostings: expect.objectContaining({ some: expect.any(Object) }),
      }),
    });
  });
});
