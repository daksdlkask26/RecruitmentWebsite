import { describe, expect, it } from "vitest";
import { assessSavedSearchVersion } from "@/shared/utils/jobs/saved-search-version-policy";

const intent = {
  language: "en" as const,
  titleCandidates: [],
  occupationCandidates: [],
  requiredFacetIds: [],
  preferredFacetIds: [],
  excludedFacetIds: [],
  skills: [],
  retainedTerms: ["accountant"],
  corrections: [],
  ambiguous: false,
  resolverVersion: "resolver-v1",
  catalogVersion: "catalog-v1",
};

describe("saved search version policy", () => {
  it("keeps current versioned intent without a warning", () => {
    expect(
      assessSavedSearchVersion({
        saved: {
          catalogVersion: "catalog-v1",
          resolverVersion: "resolver-v1",
          searchIntent: intent,
        },
        currentCatalogVersion: "catalog-v1",
        currentResolverVersion: "resolver-v1",
        currentInterpretation: { searchIntent: intent } as never,
      }),
    ).toMatchObject({ state: "CURRENT", needsReview: false });
  });

  it("flags catalog drift for controlled re-resolution", () => {
    expect(
      assessSavedSearchVersion({
        saved: { catalogVersion: "catalog-v1", resolverVersion: "resolver-v1" },
        currentCatalogVersion: "catalog-v2",
        currentResolverVersion: "resolver-v1",
      }),
    ).toMatchObject({
      state: "STALE",
      catalogChanged: true,
      needsReview: true,
    });
  });

  it("flags a changed resolved meaning", () => {
    expect(
      assessSavedSearchVersion({
        saved: { searchIntent: intent },
        currentInterpretation: {
          searchIntent: { ...intent, retainedTerms: ["seo"] },
        } as never,
      }),
    ).toMatchObject({ state: "MEANING_CHANGED", meaningChanged: true });
  });

  it("flags ambiguous saved or current intent", () => {
    expect(
      assessSavedSearchVersion({
        saved: { searchIntent: { ...intent, ambiguous: true } },
      }),
    ).toMatchObject({ state: "AMBIGUOUS", needsReview: true });
  });
});
