import { afterEach, describe, expect, it } from "vitest";
import {
  diversifySearchCandidates,
  mergeHybridSearchCandidates,
} from "@/backend/services/search/job-search-ranking";
import { applyConsentBoundPersonalization } from "@/backend/services/search/search-personalization-policy";
import { getSemanticSearchCandidates } from "@/backend/services/search/semantic-search-fallback";

const originalSemanticFlag = process.env.SEARCH_SEMANTIC_FALLBACK_ENABLED;

afterEach(() => {
  if (originalSemanticFlag === undefined) {
    delete process.env.SEARCH_SEMANTIC_FALLBACK_ENABLED;
  } else {
    process.env.SEARCH_SEMANTIC_FALLBACK_ENABLED = originalSemanticFlag;
  }
});

describe("hybrid search and safety policies", () => {
  it("keeps semantic fallback disabled unless the feature flag is enabled", async () => {
    delete process.env.SEARCH_SEMANTIC_FALLBACK_ENABLED;
    let providerCalls = 0;

    const result = await getSemanticSearchCandidates({
      query: "seo specialist",
      catalogVersion: "catalog-1",
      modelVersion: "model-1",
      deterministicCandidateCount: 0,
      provider: async () => {
        providerCalls += 1;
        return [{ id: "job-1", score: 1 }];
      },
    });

    expect(result).toMatchObject({
      enabled: false,
      used: false,
      reason: "DISABLED",
      candidates: [],
    });
    expect(providerCalls).toBe(0);
  });

  it("allows exact title matches to outrank semantic candidates", () => {
    const ranked = mergeHybridSearchCandidates([
      {
        id: "semantic-job",
        lexicalScore: 0.2,
        semanticScore: 1,
        exactTitle: false,
      },
      {
        id: "exact-job",
        lexicalScore: 0.1,
        semanticScore: 0,
        exactTitle: true,
      },
    ]);

    expect(ranked.map((candidate) => candidate.id)).toEqual([
      "exact-job",
      "semantic-job",
    ]);
  });

  it("applies diversity after relevance without suppressing an exact title", () => {
    const selected = diversifySearchCandidates(
      [
        { id: "company-a-1", lexicalScore: 1, companyId: "company-a" },
        { id: "company-a-2", lexicalScore: 0.9, companyId: "company-a" },
        { id: "company-a-3", lexicalScore: 0.8, companyId: "company-a" },
        {
          id: "company-a-exact",
          lexicalScore: 0.2,
          companyId: "company-a",
          exactTitle: true,
        },
        { id: "company-b-1", lexicalScore: 0.7, companyId: "company-b" },
      ],
      4,
      { company: 3 },
    );

    expect(selected.map((candidate) => candidate.id)).toEqual([
      "company-a-1",
      "company-a-2",
      "company-a-3",
      "company-a-exact",
    ]);
  });

  it("does not personalize without consent and only applies bounded preference boosts with consent", () => {
    const candidates = [
      {
        id: "exact-title",
        lexicalScore: 0.4,
        exactTitle: true,
        skills: ["skill-other"],
        location: "hanoi",
      },
      {
        id: "preferred-profile",
        lexicalScore: 0.39,
        skills: ["skill-seo"],
        location: "da nang",
      },
    ] as const;

    expect(
      applyConsentBoundPersonalization(candidates, {
        consent: false,
        enabled: true,
        skillIds: ["skill-seo"],
        preferredLocations: ["da nang"],
      }).map((candidate) => candidate.id),
    ).toEqual(["exact-title", "preferred-profile"]);

    expect(
      applyConsentBoundPersonalization(candidates, {
        consent: true,
        enabled: true,
        skillIds: ["skill-seo"],
        preferredLocations: ["da nang"],
      }).map((candidate) => candidate.id),
    ).toEqual(["exact-title", "preferred-profile"]);
  });
});
