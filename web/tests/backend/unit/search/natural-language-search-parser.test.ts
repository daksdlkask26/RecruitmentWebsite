import { describe, expect, it } from "vitest";
import { parseNaturalLanguageJobSearch } from "@/backend/services/search/natural-language-search-parser";
import { parseJobSearchCriteria } from "@/backend/services/jobs/job-discovery-service";

describe("natural language job search parser", () => {
  it("extracts deterministic filters and leaves the role for title resolution", () => {
    const result = parseNaturalLanguageJobSearch(
      "frontend fresher ở hcm lương từ 15 triệu remote",
    );

    expect(result.hasFilters).toBe(true);
    expect(result.residualQuery).toBe("frontend");
    expect(result.filters).toMatchObject({
      location: "ho chi minh city",
      experienceLevel: ["ENTRY"],
      workArrangement: ["REMOTE"],
      salaryMin: 15_000_000,
      salaryCurrency: "VND",
      salaryPeriod: "MONTH",
    });
    expect(result.structuredFilters.map((filter) => filter.kind)).toEqual([
      "LOCATION",
      "SENIORITY",
      "WORK_ARRANGEMENT",
      "SALARY",
    ]);

    const criteria = parseJobSearchCriteria({
      q: "frontend fresher ở hcm lương từ 15 triệu remote",
    });
    expect(criteria.rawQuery).toBe(
      "frontend fresher ở hcm lương từ 15 triệu remote",
    );
    expect(criteria.normalizedQuery).toBe("frontend");
    expect(criteria.normalizedLocation).toBe("ho chi minh city");
    expect(criteria.experienceLevel).toEqual(["ENTRY"]);
    expect(criteria.workArrangement).toEqual(["REMOTE"]);
    expect(criteria.salaryMin).toBe(15_000_000);
    expect(criteria.searchInterpretation?.structuredFilters).toHaveLength(4);
  });

  it("supports English locations, ranges and posted-time filters", () => {
    const result = parseNaturalLanguageJobSearch(
      "developer in Da Nang senior hybrid 15-25M within 3 days",
    );

    expect(result.residualQuery).toBe("developer");
    expect(result.filters).toMatchObject({
      location: "da nang",
      experienceLevel: ["SENIOR"],
      workArrangement: ["HYBRID"],
      salaryMin: 15_000_000,
      salaryMax: 25_000_000,
      postedWithinDays: 3,
    });
  });

  it("keeps literal searches unchanged", () => {
    const result = parseJobSearchCriteria({
      q: "frontend fresher remote",
      searchMode: "LITERAL",
    });

    expect(result.normalizedQuery).toBe("frontend fresher remote");
    expect(result.normalizedLocation).toBe("");
    expect(result.experienceLevel).toEqual([]);
    expect(result.workArrangement).toEqual([]);
    expect(result.searchInterpretation?.structuredFilters).toBeUndefined();
  });
});
