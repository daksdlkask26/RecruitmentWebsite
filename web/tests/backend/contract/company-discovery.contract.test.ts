import { describe, expect, it } from "vitest";
import {
  companyCardSchema,
  companyListQuerySchema,
  companyListResponseSchema,
} from "@/shared/contracts/company";
import { approvedCompanyFixture } from "../../helpers/company-team-applications-fixture";

describe("Company discovery contract", () => {
  it("projects only safe public company card fields", () => {
    const card = companyCardSchema.parse({
      companyId: approvedCompanyFixture.id,
      slug: approvedCompanyFixture.slug,
      name: approvedCompanyFixture.displayName,
      logoUrl: approvedCompanyFixture.logoUrl,
      description: approvedCompanyFixture.publicDescription,
    });
    expect(card).not.toHaveProperty("normalizedTaxIdentifier");
    expect(card).not.toHaveProperty("verificationState");
  });

  it("requires a deterministic pagination envelope", () => {
    expect(
      companyListResponseSchema.safeParse({
        items: [],
        page: 1,
        total: 0,
        totalPages: 0,
      }).success,
    ).toBe(true);
  });

  it("normalizes the public company search query", () => {
    expect(
      companyListQuerySchema.parse({ q: "  Northstar Labs  ", page: "2" }),
    ).toEqual({
      q: "Northstar Labs",
      searchMode: "SMART",
      page: 2,
      limit: 24,
    });
  });
});
