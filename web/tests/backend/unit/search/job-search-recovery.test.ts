import { describe, expect, it } from "vitest";
import { buildJobSearchRecovery } from "@/backend/services/search/job-search-recovery";
import { parseJobSearchCriteria } from "@/backend/services/jobs/job-discovery-service";

describe("job search zero-result recovery", () => {
  it("returns concrete actions for a structured natural-language search", () => {
    const criteria = parseJobSearchCriteria({
      q: "frontend fresher ở hcm lương từ 15 triệu remote",
      searchMode: "SMART",
    });
    const recovery = buildJobSearchRecovery(criteria);

    expect(recovery.actions.length).toBeGreaterThan(0);
    expect(recovery.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "RELAX_FILTER",
          removeFilter: "LOCATION",
        }),
        expect.objectContaining({
          kind: "RELAX_FILTER",
          removeFilter: "SALARY",
        }),
      ]),
    );
    expect(
      recovery.actions.every((action) => action.id && action.labelEn),
    ).toBe(true);
  });

  it("offers literal search as an explicit action without changing the query", () => {
    const criteria = parseJobSearchCriteria({
      q: "qwertyuiop",
      searchMode: "SMART",
    });
    const recovery = buildJobSearchRecovery(criteria);
    const literal = recovery.actions.find(
      (action) => action.kind === "LITERAL",
    );

    expect(literal).toMatchObject({
      query: "qwertyuiop",
      kind: "LITERAL",
    });
  });
});
