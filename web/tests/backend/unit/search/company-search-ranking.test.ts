import { describe, expect, it } from "vitest";
import {
  classifyCompanySearchTerm,
  companyRelevanceScore,
  compareCompaniesForSearch,
  type CompanySearchCandidate,
} from "@/backend/services/search/company-search-ranking";
import type { SearchQueryVariant } from "@/backend/services/search/search-query-resolver";

const original = (value: string): SearchQueryVariant => ({
  value,
  source: "ORIGINAL",
  confidence: "HIGH",
});

const typo = (value: string): SearchQueryVariant => ({
  value,
  source: "TYPO_CORRECTION",
  confidence: "HIGH",
});

const candidate = (
  value: Partial<CompanySearchCandidate> &
    Pick<CompanySearchCandidate, "displayName">,
): CompanySearchCandidate => ({
  displayName: value.displayName,
  legalName: value.legalName,
  slug: value.slug ?? value.displayName.toLowerCase().replace(/\s+/gu, "-"),
  industry: value.industry,
  publicLocation: value.publicLocation,
  publicDescription: value.publicDescription,
});

describe("company search ranking", () => {
  it.each([
    ["displayName", "Alpha Corp", "FULL_NAME"],
    ["legalName", "Alpha Corporation", "LEGAL_NAME"],
    ["slug", "alpha-corp", "BRAND_ALIAS"],
    ["industry", "Information Technology", "INDUSTRY_PHRASE"],
    ["location", "Da Nang", "LOCATION"],
  ] as const)("classifies %s terms as %s", (field, value, expected) => {
    expect(classifyCompanySearchTerm(field, original(value))).toBe(expected);
  });

  it("ranks an exact normalized company name above description and industry matches", () => {
    const exact = candidate({
      displayName: "Công ty Cổ phần FPT",
      legalName: "Công ty Cổ phần FPT",
      slug: "fpt",
    });
    const descriptionMatch = candidate({
      displayName: "Northstar Labs",
      industry: "Information Technology",
      publicDescription: "We integrate with FPT systems.",
    });

    expect(companyRelevanceScore(exact, [original("fpt")])).toBe(100);
    expect(companyRelevanceScore(descriptionMatch, [original("fpt")])).toBe(10);
    expect(
      compareCompaniesForSearch(
        { ...descriptionMatch, id: "description" },
        { ...exact, id: "exact" },
        [original("fpt")],
      ),
    ).toBeGreaterThan(0);
  });

  it("normalizes legal names and exact slugs without changing display data", () => {
    const legalName = candidate({
      displayName: "FPT Holdings",
      legalName: "Công ty Cổ phần FPT",
      slug: "fpt-corporation",
    });
    const slugMatch = candidate({
      displayName: "FPT Holdings",
      slug: "fpt-corporation",
    });

    expect(companyRelevanceScore(legalName, [original("fpt")])).toBe(95);
    expect(
      companyRelevanceScore(slugMatch, [original("fpt corporation")]),
    ).toBe(90);
  });

  it("keeps a typo-derived company match below a direct exact match", () => {
    const typoMatch = candidate({ displayName: "Alpha Corp" });
    const exactMatch = candidate({ displayName: "Alphabeta" });

    expect(companyRelevanceScore(typoMatch, [typo("alpha")])).toBeCloseTo(85);
    expect(companyRelevanceScore(exactMatch, [original("alphabeta")])).toBe(
      100,
    );
  });

  it("does not treat IT as a substring inside unrelated company data", () => {
    const informationTechnology = candidate({
      displayName: "IT Solutions",
      industry: "Information Technology",
    });
    const digital = candidate({
      displayName: "Digital Capital",
      industry: "Digital Services",
      publicDescription: "Technology and finance partner.",
    });

    expect(companyRelevanceScore(informationTechnology, [original("it")])).toBe(
      80,
    );
    expect(companyRelevanceScore(digital, [original("it")])).toBe(0);
  });
});
