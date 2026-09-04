import { describe, expect, it } from "vitest";
import { jobSearchRequestQuery } from "@/app/api/jobs/job-search-request-query";
import { parseJobSearchCriteria } from "@/backend/services/jobs/job-discovery-service";

describe("public job search API query parsing", () => {
  it("preserves every selected district for the discovery service", () => {
    const query = jobSearchRequestQuery(
      new Request(
        "https://smarthire.example/api/jobs?location=B%C3%A0+R%E1%BB%8Ba+-+V%C5%A9ng+T%C3%A0u&district=V%C5%A9ng+T%C3%A0u+City+Center&district=Long+%C4%90i%E1%BB%81n&categoryId=r03-software-development&categoryTitle=Backend+Developer",
      ),
    );

    expect(query).toMatchObject({
      location: "Bà Rịa - Vũng Tàu",
      district: ["Vũng Tàu City Center", "Long Điền"],
    });
    expect(query.categoryId).toEqual(["r03-software-development"]);
    expect(query.categoryTitle).toEqual(["Backend Developer"]);
  });

  it("canonicalizes taxonomy filter codes before repository matching", () => {
    const criteria = parseJobSearchCriteria({
      categoryFamily: ["OTHER", "R03"],
      categoryId: ["R03-SOFTWARE-DEVELOPMENT"],
    });

    expect(criteria.categoryFamily).toEqual(["r29", "r03"]);
    expect(criteria.categoryIds).toEqual(["r03-software-development"]);
  });

  it("passes the generic-role SEO composition into job retrieval", () => {
    const criteria = parseJobSearchCriteria({ q: "chuyên viên SEO" });

    expect(criteria.searchVariants?.map((variant) => variant.value)).toEqual(
      expect.arrayContaining(["seo specialist"]),
    );
    expect(criteria.searchIntent?.requiredFacetIds).toContain(
      "specialization.seo",
    );
    expect(criteria.searchIntent?.occupationCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          occupationId: "occ-r02-marketing-communications",
          matchKind: "RELATED",
        }),
      ]),
    );
    expect(
      criteria.searchVariants?.some(
        (variant) => variant.occupationId === "occ-r07-electrical-electronics",
      ),
    ).toBe(false);
  });

  it("preserves the negotiable-salary filter for the discovery service", () => {
    const query = jobSearchRequestQuery(
      new Request("https://smarthire.example/api/jobs?salaryNegotiable=true"),
    );

    expect(parseJobSearchCriteria(query).salaryNegotiable).toBe(true);
  });
});
