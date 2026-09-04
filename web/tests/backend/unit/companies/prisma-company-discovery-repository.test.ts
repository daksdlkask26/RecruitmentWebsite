import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
}));

vi.mock("@/backend/database/prisma", () => ({
  prisma: {
    $queryRaw: database.queryRaw,
    company: {
      findMany: database.findMany,
      count: database.count,
    },
  },
}));

import { PrismaCompanyDiscoveryRepository } from "@/backend/repositories/companies/prisma-company-discovery-repository";

describe("Prisma company search ranking", () => {
  beforeEach(() => {
    database.queryRaw.mockReset();
    database.findMany.mockReset();
    database.count.mockReset();
  });

  it("uses DB-ranked ids, preserves page order, and avoids the old fixed corpus cap", async () => {
    database.queryRaw
      .mockResolvedValueOnce([
        {
          displayName: "Da Nang Labs",
          legalName: "Da Nang Labs Ltd",
          slug: "da-nang-labs",
        },
      ])
      .mockResolvedValueOnce([
        { id: "company-page-two", score: 100, totalCount: 2 },
      ])
      .mockResolvedValueOnce([{ publicLocation: "Hai Chau, Da Nang" }]);
    database.findMany.mockResolvedValueOnce([
      {
        id: "company-page-two",
        slug: "page-two",
        displayName: "Da Nang Labs",
        legalName: "Da Nang Labs Ltd",
        logoUrl: null,
        publicDescription: "A public company.",
        publicLocation: "Hai Chau, Da Nang",
        foundedYear: null,
        industry: "Information Technology",
        _count: { jobPostings: 3 },
      },
    ]);

    const result = await new PrismaCompanyDiscoveryRepository().list({
      q: "danang",
      searchMode: "SMART",
      location: "Da Nang",
      page: 2,
      limit: 1,
    });

    expect(result.items.map((item) => item.id)).toEqual(["company-page-two"]);
    expect(result.total).toBe(2);
    expect(result.locations).toEqual(["Da Nang"]);
    expect(database.count).not.toHaveBeenCalled();

    const correctionQuery = database.queryRaw.mock.calls[0]?.[0] as {
      strings: readonly string[];
    };
    expect(correctionQuery.strings.join(" ")).toContain("LIMIT 8");
    expect(correctionQuery.strings.join(" ")).not.toContain('"legalName"');
    expect(correctionQuery.strings.join(" ")).not.toContain('"slug"');
    expect(correctionQuery.strings.join(" ")).not.toContain('"industry"');
    expect(correctionQuery.strings.join(" ")).not.toContain('"publicLocation"');

    const rankedQuery = database.queryRaw.mock.calls[1]?.[0] as {
      strings: readonly string[];
    };
    expect(rankedQuery.strings.join(" ")).toContain("COUNT(*) OVER()");
    expect(rankedQuery.strings.join(" ")).toContain("ORDER BY score DESC");
    expect(rankedQuery.strings.join(" ")).toContain("OFFSET");
    expect(rankedQuery.strings.join(" ")).not.toContain("5000");

    const locationQuery = database.queryRaw.mock.calls[2]?.[0] as {
      strings: readonly string[];
    };
    expect(locationQuery.strings.join(" ")).toContain("SELECT DISTINCT");
    expect(locationQuery.strings.join(" ")).toContain('"publicLocation"');
    expect(JSON.stringify(locationQuery)).toContain("2_000");
  });

  it("retrieves short company abbreviations with a word boundary", async () => {
    database.queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    database.findMany.mockResolvedValueOnce([]);

    await new PrismaCompanyDiscoveryRepository().list({
      q: "IT",
      searchMode: "SMART",
      page: 1,
      limit: 20,
    });

    const rankedQuery = database.queryRaw.mock.calls[0]?.[0] as {
      strings: readonly string[];
      values?: readonly unknown[];
    };
    const queryShape = JSON.stringify(rankedQuery);
    expect(queryShape).toContain("[[:space:]]");
    expect(queryShape).toContain("it");
    expect(queryShape).not.toContain("%it%");
  });
});
