import { describe, expect, it } from "vitest";
import { normalizeSearchText } from "@/backend/services/jobs/search-normalization";
import {
  createJobSearchIntentSchema,
  jobSearchIntentSchema,
  searchCatalogSchema,
} from "@/shared/contracts/search/job-search-intent";
import {
  compileSearchCatalogIndex,
  jobSearchCatalogIndex,
} from "@/backend/services/search/catalogs/job-search-catalog-index";
import { JOB_SEARCH_CATALOG_VERSION } from "@/backend/services/search/catalogs/job-search-catalog";

const fixtureCatalog = {
  version: "fixture-1",
  facets: [
    {
      facetId: "seniority.senior",
      kind: "SENIORITY" as const,
      labels: { vi: "Cấp cao", en: "Senior" },
      positiveTerms: ["senior"],
      conflictFacetIds: ["employment.intern"],
    },
    {
      facetId: "employment.intern",
      kind: "EMPLOYMENT_LEVEL" as const,
      labels: { vi: "Thực tập sinh", en: "Intern" },
      positiveTerms: ["intern"],
      conflictFacetIds: ["seniority.senior"],
    },
  ],
  genericRoleTerms: [],
  skills: [],
  occupations: [
    {
      occupationId: "occ-r03-quantum-workflow-designer",
      version: "fixture-1",
      status: "ACTIVE" as const,
      industryCode: "r03",
      categoryIds: ["r03-software-development"],
      labels: {
        vi: "Nhà thiết kế quy trình lượng tử",
        en: "Quantum Workflow Designer",
      },
      canonicalTitles: [
        {
          phrase: "Quantum Workflow Designer",
          language: "en" as const,
          facetIds: [],
          weight: 100,
        },
      ],
      aliases: [
        {
          phrase: "Nhà thiết kế quy trình lượng tử",
          language: "vi" as const,
          kind: "ALIAS" as const,
          weight: 85,
          facetIds: [],
        },
      ],
      relatedTitles: [
        {
          phrase: "Senior Quantum Workflow Designer",
          language: "en" as const,
          facetIds: ["seniority.senior"],
          weight: 75,
        },
      ],
      defaultFacetIds: [],
      supportedFacetIds: ["seniority.senior", "employment.intern"],
      skills: ["quantum workflow"],
      negativeTerms: [],
    },
  ],
};

describe("JobSearchIntent V2 contracts and compiled index", () => {
  it("rejects duplicate ids, empty aliases, unknown facets, and self-conflicts", () => {
    const result = searchCatalogSchema.safeParse({
      ...fixtureCatalog,
      facets: [
        {
          ...fixtureCatalog.facets[0],
          conflictFacetIds: ["seniority.senior", "missing"],
        },
        fixtureCatalog.facets[0],
      ],
      occupations: [
        {
          ...fixtureCatalog.occupations[0],
          aliases: [
            {
              ...fixtureCatalog.occupations[0].aliases[0],
              phrase: " ",
              facetIds: ["missing"],
            },
          ],
        },
        fixtureCatalog.occupations[0],
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects a fake human-verified translation that merely repeats English", () => {
    // The production release may legitimately have zero REQUIRES_REVIEW
    // titles after human approval. Use any real title as the schema subject
    // and explicitly put it into the pre-review state for this negative test.
    const title = jobSearchCatalogIndex.catalog.titleDefinitions?.[0];
    expect(title).toBeDefined();
    const result = searchCatalogSchema.safeParse({
      ...jobSearchCatalogIndex.catalog,
      version: "fixture-human-provenance",
      titleDefinitions: [
        {
          ...title!,
          canonical: { vi: title!.canonical.en, en: title!.canonical.en },
          translationStatus: "HUMAN_VERIFIED",
          status: "HUMAN_VERIFIED",
          mappingSource: "CURATED",
          mappingConfidence: 1,
          reviewReason: null,
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects duplicate occupation candidates and facet conflicts", () => {
    const schema = createJobSearchIntentSchema({
      occupationIds: new Set(["occ-r03-quantum-workflow-designer"]),
      facets: new Map(
        fixtureCatalog.facets.map((facet) => [facet.facetId, facet]),
      ),
    });
    const result = schema.safeParse({
      language: "en",
      occupationCandidates: [
        {
          occupationId: "occ-r03-quantum-workflow-designer",
          confidence: "HIGH",
          matchKind: "EXACT",
          score: 100,
        },
        {
          occupationId: "occ-r03-quantum-workflow-designer",
          confidence: "MEDIUM",
          matchKind: "RELATED",
          score: 70,
        },
      ],
      requiredFacetIds: ["seniority.senior", "employment.intern"],
      preferredFacetIds: [],
      excludedFacetIds: [],
      skills: [],
      retainedTerms: [],
      corrections: [],
      ambiguous: false,
      resolverVersion: "fixture-resolver",
      catalogVersion: "fixture-1",
    });

    expect(result.success).toBe(false);
  });

  it("compiles an immutable, injectable fixture and supports compact phrases", () => {
    const index = compileSearchCatalogIndex(fixtureCatalog);
    expect(compileSearchCatalogIndex(fixtureCatalog)).toBe(index);
    expect(
      index.exactOccupationPhraseMatches("quantumworkflowdesigner"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          occupationId: "occ-r03-quantum-workflow-designer",
        }),
      ]),
    );
    expect(index.exactFacetPhraseMatches("senior")).toHaveLength(1);
    expect(Object.isFrozen(index.catalog)).toBe(true);
    expect(Object.isFrozen(index.catalog.occupations[0])).toBe(true);
  });

  it("limits fuzzy lookup to indexed phrase candidates", () => {
    const candidates =
      jobSearchCatalogIndex.fuzzyOccupationPhraseCandidates("seo speclialist");

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ normalizedPhrase: "seo specialist" }),
      ]),
    );
    expect(candidates.length).toBeLessThan(
      jobSearchCatalogIndex.occupationPhrases().length,
    );
  });

  it("exposes the production catalog with generic terms and facets", () => {
    expect(jobSearchCatalogIndex.version).toBe(JOB_SEARCH_CATALOG_VERSION);
    expect(jobSearchCatalogIndex.facets.map((facet) => facet.facetId)).toEqual(
      expect.arrayContaining([
        "specialization.frontend",
        "specialization.backend",
        "specialization.seo",
      ]),
    );
    expect(
      jobSearchCatalogIndex.genericRoleTerms.map((term) => term.phrase),
    ).toEqual(expect.arrayContaining(["chuyên viên", "specialist", "intern"]));
    expect(
      jobSearchCatalogIndex.intentSchema.safeParse({
        language: "en",
        occupationCandidates: [
          {
            occupationId: "occ-missing",
            confidence: "HIGH",
            matchKind: "EXACT",
            score: 100,
          },
        ],
        requiredFacetIds: [],
        preferredFacetIds: [],
        excludedFacetIds: [],
        skills: [],
        retainedTerms: [],
        corrections: [],
        ambiguous: false,
        resolverVersion: "resolver",
        catalogVersion: jobSearchCatalogIndex.version,
      }).success,
    ).toBe(false);
  });

  it("compiles role and facet signals for data-driven related titles", () => {
    const seoSpecialist = jobSearchCatalogIndex
      .occupationPhrases()
      .find(
        (phrase) =>
          phrase.normalizedPhrase === "seo specialist" &&
          phrase.kind === "RELATED_TITLE",
      );
    const specialistRole = jobSearchCatalogIndex
      .genericPhrases()
      .find(
        (phrase) =>
          phrase.normalizedPhrase === normalizeSearchText("chuyên viên") &&
          phrase.roleIds.includes("INDIVIDUAL_CONTRIBUTOR"),
      );

    expect(seoSpecialist).toEqual(
      expect.objectContaining({
        occupationId: "occ-r02-marketing-communications",
        facetIds: expect.arrayContaining(["specialization.seo"]),
        roleIds: expect.arrayContaining(["INDIVIDUAL_CONTRIBUTOR"]),
      }),
    );
    expect(specialistRole).toEqual(
      expect.objectContaining({
        kind: "GENERIC_ROLE",
        roleIds: expect.arrayContaining(["INDIVIDUAL_CONTRIBUTOR"]),
      }),
    );
  });

  it("keeps the base intent schema strict and serializable", () => {
    expect(
      jobSearchIntentSchema.parse({
        language: "en",
        occupationCandidates: [],
        requiredFacetIds: [],
        preferredFacetIds: [],
        excludedFacetIds: [],
        skills: [],
        retainedTerms: [],
        corrections: [],
        ambiguous: false,
        resolverVersion: "resolver",
        catalogVersion: "catalog",
      }),
    ).toMatchObject({ language: "en", occupationCandidates: [] });
  });
});
