import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeSearchText } from "@/backend/services/jobs/search-normalization";
import {
  exactOccupationPhraseMatches,
  occupationSearchIndex,
  occupationIdsForCategory,
  occupationIdsForIndustry,
} from "@/backend/services/search/catalogs/occupation-search-index";
import {
  auditOccupationSearchCoverage,
  intentionalOtherOccupationTitleReasons,
} from "@/backend/services/search/catalogs/occupation-search-coverage";
import { OCCUPATION_SEARCH_CATALOG_VERSION } from "@/backend/services/search/catalogs/occupation-search-catalog";

describe("occupation search catalog", () => {
  it("loads a validated immutable catalog and category indexes", () => {
    expect(occupationSearchIndex.version).toBe(
      OCCUPATION_SEARCH_CATALOG_VERSION,
    );
    expect(occupationSearchIndex.entries.length).toBeGreaterThanOrEqual(7);
    expect(Object.isFrozen(occupationSearchIndex.entries)).toBe(true);
    expect(Object.isFrozen(occupationSearchIndex.entries[0])).toBe(true);
    expect(Object.isFrozen(occupationSearchIndex.phrases[0])).toBe(true);
    expect(occupationIdsForIndustry("r04")).toContain("occ-r04-accountant");
    expect(occupationIdsForCategory("r04-accounting")).toContain(
      "occ-r04-accountant",
    );
    expect(
      exactOccupationPhraseMatches("KẾ TOÁN").map(
        (match) => match.occupation.occupationId,
      ),
    ).toEqual(["occ-r04-accountant"]);
  });

  it("reports unmapped, ambiguous, and category-mismatched active titles", () => {
    const report = auditOccupationSearchCoverage([
      {
        title: "Chief Accountant",
        industryCode: "r04",
        categoryIds: ["r04-accounting"],
      },
      {
        title: "Recruiter HR Manager",
        industryCode: "r06",
      },
      {
        title: "Warehouse Accountant",
        industryCode: "r03",
        categoryIds: ["r03-software-development"],
      },
      {
        title: "Night Shift Helper",
        industryCode: "r29",
        intentionalOther: true,
      },
      { title: "Unlisted Specialist", industryCode: "r05" },
    ]);

    expect(report.totalTitles).toBe(5);
    expect(report.mappedTitles).toBe(2);
    expect(report.intentionalOtherTitles).toBe(1);
    expect(report.ambiguousTitles).toEqual([
      {
        title: "Recruiter HR Manager",
        occupationIds: ["occ-r06-human-resources", "occ-r06-recruiter"],
      },
    ]);
    expect(report.categoryMismatches).toEqual([
      expect.objectContaining({
        title: "Warehouse Accountant",
        occupationId: "occ-r04-accountant",
        expectedIndustryCode: "r03",
      }),
    ]);
    expect(report.unmapped).toEqual([
      "Warehouse Accountant",
      "Unlisted Specialist",
    ]);
    expect(report.complete).toBe(false);
  });

  it("covers every active title in the checked-in job corpus", () => {
    const rows = fs
      .readdirSync(path.resolve(process.cwd(), "data/jobs"))
      .filter((name) => name.endsWith(".json"))
      .flatMap((name) =>
        JSON.parse(
          fs.readFileSync(
            path.resolve(process.cwd(), "data/jobs", name),
            "utf8",
          ),
        ),
      )
      .filter(
        (row: { status?: string }) => row.status?.toLowerCase() === "active",
      );

    const inputs = [
      ...new Map(
        rows.map(
          (row: {
            title: string;
            industryCode?: string;
            industryId?: string;
            categoryIds?: string[];
            subIndustryCode?: string;
            subIndustryId?: string;
          }) => {
            const titleKey = normalizeSearchText(row.title);
            const industryCode = row.industryCode ?? row.industryId ?? null;
            const categoryIds = (
              row.categoryIds ?? [row.subIndustryCode, row.subIndustryId]
            ).filter((value): value is string => Boolean(value));
            return [
              `${titleKey}\u0000${industryCode ?? ""}\u0000${categoryIds.join(",")}`,
              {
                title: row.title,
                industryCode,
                categoryIds,
                intentionalOther:
                  titleKey in intentionalOtherOccupationTitleReasons,
                intentionalOtherReason:
                  intentionalOtherOccupationTitleReasons[titleKey] ?? null,
              },
            ] as const;
          },
        ),
      ).values(),
    ];
    const report = auditOccupationSearchCoverage(inputs);

    expect(report.totalTitles).toBeGreaterThanOrEqual(398);
    expect(report.unmapped).toEqual([]);
    expect(report.ambiguousTitles).toEqual([]);
    expect(report.categoryMismatches).toEqual([]);
    expect(report.complete).toBe(true);
  });
});
