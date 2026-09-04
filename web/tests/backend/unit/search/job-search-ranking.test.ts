import { describe, expect, it } from "vitest";
import { jobSearchIntentSchema } from "@/shared/contracts/search/job-search-intent";
import {
  rankSearchCandidates,
  type SearchRankingCandidate,
} from "@/backend/services/search/job-search-ranking";
import {
  resolveSearchQuery,
  type SearchQueryVariant,
} from "@/backend/services/search/search-query-resolver";

function intent(
  occupationId: string | undefined,
  requiredFacetIds: readonly string[],
) {
  return jobSearchIntentSchema.parse({
    language: "en",
    occupationCandidates: occupationId
      ? [
          {
            occupationId,
            confidence: "HIGH",
            matchKind: "EXACT",
            score: 100,
          },
        ]
      : [],
    requiredFacetIds,
    preferredFacetIds: [],
    excludedFacetIds: [],
    skills: [],
    retainedTerms: [],
    corrections: [],
    ambiguous: false,
    resolverVersion: "test-resolver",
    catalogVersion: "test-catalog",
  });
}

function variant(
  value: string,
  occupationId: string | undefined,
  requiredFacetIds: readonly string[] = [],
  source: SearchQueryVariant["source"] = "ORIGINAL",
): SearchQueryVariant {
  return {
    value,
    source,
    confidence: "HIGH",
    ...(occupationId ? { occupationId } : {}),
    ...(requiredFacetIds.length ? { requiredFacetIds } : {}),
  };
}

function candidates(...titles: readonly string[]): SearchRankingCandidate[] {
  return titles.map((title, index) => ({
    id: `job-${index + 1}`,
    title,
    publishedAt: "2026-09-01T00:00:00.000Z",
  }));
}

describe("catalog-driven job ranking", () => {
  it("ranks a title matching the requested management facet above a broad occupation alias", () => {
    const ranked = rankSearchCandidates(
      candidates("Accountant", "Chief Accountant"),
      [
        variant(
          "chief accountant",
          "occ-r04-accountant",
          ["management.department-head"],
          "RELATED_TITLE",
        ),
        variant(
          "accountant",
          "occ-r04-accountant",
          ["management.department-head"],
          "VIETNAMESE_ALIAS",
        ),
      ],
      intent("occ-r04-accountant", ["management.department-head"]),
    );

    expect(ranked.map((candidate) => candidate.title)).toEqual([
      "Chief Accountant",
      "Accountant",
    ]);
  });

  it.each([
    [
      "frontend developer",
      "Frontend Developer",
      "Backend Developer",
      "specialization.frontend",
    ],
    ["hr manager", "HR Manager", "HR Intern", "management.manager"],
    ["sales staff", "Sales Staff", "Sales Intern", "employment.staff"],
  ])(
    "keeps the requested facet ahead of a conflicting or less specific title for %s",
    (query, preferredTitle, fallbackTitle, facetId) => {
      const ranked = rankSearchCandidates(
        candidates(fallbackTitle, preferredTitle),
        variant(query, undefined, [facetId]),
        intent(undefined, [facetId]),
      );

      expect(ranked.map((candidate) => candidate.title)).toEqual([
        preferredTitle,
        fallbackTitle,
      ]);
    },
  );

  it("uses stable publishedAt then id tie-breakers for exact and later pages", () => {
    const ranked = rankSearchCandidates(
      [
        {
          id: "job-b",
          title: "Accountant",
          publishedAt: "2026-09-01T00:00:00.000Z",
        },
        {
          id: "job-a",
          title: "Accountant",
          publishedAt: "2026-09-01T00:00:00.000Z",
        },
        {
          id: "job-c",
          title: "Accountant",
          publishedAt: "2026-08-31T00:00:00.000Z",
        },
      ],
      variant("accountant", "occ-r04-accountant"),
      intent("occ-r04-accountant", []),
    );

    expect(ranked.map((candidate) => candidate.id)).toEqual([
      "job-a",
      "job-b",
      "job-c",
    ]);
  });

  it("keeps a role-plus-SEO query ahead of an unrelated electronics title", () => {
    const resolved = resolveSearchQuery("chuyên viên SEO", "JOBS", "vi");
    const ranked = rankSearchCandidates(
      candidates(
        "Electronics Engineer",
        "SEO Specialist",
        "SEO Executive",
        "Specialist",
      ),
      resolved.variants,
      resolved.intent,
    );

    expect(resolved.intent?.requiredFacetIds).toContain("specialization.seo");
    expect(ranked.slice(0, 2).map((candidate) => candidate.title)).toEqual([
      "SEO Specialist",
      "SEO Executive",
    ]);
    expect(
      ranked.slice(0, 3).map((candidate) => candidate.title),
    ).not.toContain("Electronics Engineer");
  });
});
