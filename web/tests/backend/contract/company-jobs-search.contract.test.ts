import { describe, expect, it } from "vitest";
import {
  companyJobSearchQuerySchema,
  companyJobSearchResponseSchema,
} from "@/shared/contracts/company";

describe("Company job search contract", () => {
  it("normalizes keyword/location query defaults", () => {
    expect(companyJobSearchQuerySchema.parse({})).toMatchObject({
      q: "",
      searchMode: "SMART",
      location: "",
      page: 1,
      limit: 20,
    });
  });

  it("returns a company-scoped result envelope", () => {
    const response = companyJobSearchResponseSchema.parse({
      items: [],
      total: 0,
      nextCursor: null,
      page: 1,
      totalPages: 0,
      companyId: "company-1",
    });
    expect(response.companyId).toBe("company-1");
  });
});
