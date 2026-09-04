import { describe, expect, it, vi } from "vitest";
import { compileSearchCatalogIndex } from "@/backend/services/search/catalogs/job-search-catalog-index";
import { buildJobSearchProfile } from "@/backend/services/search/job-search-profile";
import {
  ensureSearchMappingReview,
  jobSearchProjectionData,
  jobSearchProjectionNeedsRefresh,
  searchMappingReviewOpenKey,
} from "@/backend/services/search/job-search-profile-projection";

const index = compileSearchCatalogIndex({
  version: "fixture-profile-1",
  facets: [
    {
      facetId: "seniority.senior",
      kind: "SENIORITY",
      labels: { vi: "Cấp cao", en: "Senior" },
      positiveTerms: ["senior"],
      conflictFacetIds: [],
    },
  ],
  genericRoleTerms: [],
  skills: [{ skillId: "skill-quantum", phrases: ["quantum workflow"] }],
  occupations: [
    {
      occupationId: "occ-r03-quantum-workflow-designer",
      version: "fixture-profile-1",
      status: "ACTIVE",
      industryCode: "r03",
      categoryIds: ["r03-software-development"],
      labels: {
        vi: "Nhà thiết kế quy trình lượng tử",
        en: "Quantum Workflow Designer",
      },
      canonicalTitles: [
        {
          phrase: "Quantum Workflow Designer",
          language: "en",
          facetIds: [],
          weight: 100,
        },
      ],
      aliases: [
        {
          phrase: "Nhà thiết kế quy trình lượng tử",
          language: "vi",
          kind: "ALIAS",
          weight: 85,
          facetIds: [],
        },
      ],
      relatedTitles: [
        {
          phrase: "Senior Quantum Workflow Designer",
          language: "en",
          facetIds: ["seniority.senior"],
          weight: 75,
        },
      ],
      defaultFacetIds: [],
      supportedFacetIds: ["seniority.senior"],
      skills: ["quantum workflow"],
      negativeTerms: [],
    },
  ],
});

const reviewedCrossTaxonomyIndex = compileSearchCatalogIndex({
  ...index.catalog,
  version: "fixture-profile-reviewed-1",
  titleDefinitions: [
    {
      titleId: "title-reviewed-cross-taxonomy",
      occupationId: "occ-r03-quantum-workflow-designer",
      industryCode: "r03",
      categoryIds: ["r03-software-development"],
      canonical: {
        vi: "Nhà thiết kế quy trình lượng tử",
        en: "Quantum Workflow Designer",
      },
      aliases: { vi: [], en: [] },
      abbreviations: [],
      facetIds: [],
      skillSignals: [],
      excludedTerms: [],
      translationStatus: "HUMAN_VERIFIED",
      mappingSource: "MANUAL_REVIEW",
      mappingConfidence: 1,
      reviewReason: null,
      status: "HUMAN_VERIFIED",
      catalogVersion: "fixture-profile-reviewed-1",
    },
  ],
});

describe("buildJobSearchProfile", () => {
  it("maps an exact related title and captures reusable facets", () => {
    const profile = buildJobSearchProfile(
      {
        title: "Senior Quantum Workflow Designer",
        industryCode: "r03",
        categoryIds: ["r03-software-development"],
      },
      { index },
    );

    expect(profile).toMatchObject({
      occupationIds: ["occ-r03-quantum-workflow-designer"],
      facetIds: ["seniority.senior"],
      source: "EXPLICIT",
      catalogVersion: "fixture-profile-1",
    });
  });

  it("uses only high-confidence fuzzy title matches and preserves skills", () => {
    const profile = buildJobSearchProfile(
      {
        title: "Quantum Workflwo Designer",
        industryCode: "r03",
        skills: ["Quantum Workflow"],
      },
      { index },
    );

    expect(profile.occupationIds).toEqual([
      "occ-r03-quantum-workflow-designer",
    ]);
    expect(profile.source).toBe("AUTO_HIGH_CONFIDENCE");
    expect(profile.normalizedSkills).toEqual(["quantum workflow"]);
  });

  it("falls back to an occupation only when a supplied skill is a catalog signal", () => {
    const profile = buildJobSearchProfile(
      {
        title: "Unlisted workflow role",
        industryCode: "r03",
        skills: ["Quantum Workflow"],
      },
      { index },
    );

    expect(profile.occupationIds).toEqual([
      "occ-r03-quantum-workflow-designer",
    ]);
    expect(profile.confidence).toBe(0.78);
  });

  it("does not cross an explicit industry/category boundary", () => {
    const profile = buildJobSearchProfile(
      {
        title: "Quantum Workflow Designer",
        industryCode: "r04",
        categoryIds: ["r04-accounting"],
      },
      { index },
    );

    expect(profile.source).toBe("UNMAPPED");
    expect(profile.occupationIds).toEqual([]);
  });

  it("honors an exact human-reviewed title correction across a stale taxonomy", () => {
    const profile = buildJobSearchProfile(
      {
        title: "Quantum Workflow Designer",
        industryCode: "r04",
        categoryIds: ["r04-accounting"],
      },
      { index: reviewedCrossTaxonomyIndex },
    );

    expect(profile).toMatchObject({
      titleIds: ["title-reviewed-cross-taxonomy"],
      occupationIds: ["occ-r03-quantum-workflow-designer"],
      canonicalTitleVi: "Nhà thiết kế quy trình lượng tử",
      canonicalTitleEn: "Quantum Workflow Designer",
      translationStatus: "HUMAN_VERIFIED",
      mappingSource: "MANUAL_REVIEW",
    });
  });

  it("produces a stable, deduplicated SQL projection and detects stale versions", () => {
    const profile = buildJobSearchProfile(
      {
        title: "Senior Quantum Workflow Designer",
        industryCode: "r03",
        categoryIds: ["r03-software-development", "r03-software-development"],
        skills: ["Quantum Workflow", "Quantum Workflow"],
      },
      { index },
    );
    const projection = jobSearchProjectionData("job-1", profile);

    expect(projection).toMatchObject({
      jobPostingId: "job-1",
      occupationIds: ["occ-r03-quantum-workflow-designer"],
      facetIds: ["seniority.senior"],
      normalizedTitle: "senior quantum workflow designer",
      normalizedSkills: ["quantum workflow"],
      catalogVersion: "fixture-profile-1",
    });
    expect(jobSearchProjectionNeedsRefresh(projection, projection)).toBe(false);
    expect(
      jobSearchProjectionNeedsRefresh(projection, {
        ...projection,
        catalogVersion: "fixture-profile-2",
      }),
    ).toBe(true);
  });

  it("deduplicates an unresolved title review across repeated lifecycle events", async () => {
    const profile = buildJobSearchProfile(
      {
        title: "Unlisted workflow role",
        industryCode: "r03",
      },
      { index },
    );
    expect(profile.translationStatus).toBe("UNMAPPED");
    const records = new Map<string, { id: string; status: "PENDING" }>();
    const db = {
      searchCatalogVersion: {
        findUnique: vi.fn().mockResolvedValue({ id: "catalog-1" }),
      },
      searchMappingReview: {
        findUnique: vi.fn(({ where }: { where: { openKey: string } }) => {
          const existing = records.get(where.openKey);
          return Promise.resolve(existing ?? null);
        }),
        create: vi.fn(({ data }: { data: { openKey: string } }) => {
          const record = {
            id: `review-${records.size + 1}`,
            status: "PENDING" as const,
          };
          records.set(data.openKey, record);
          return Promise.resolve(record);
        }),
        update: vi
          .fn()
          .mockResolvedValue({ id: "review-1", status: "PENDING" }),
      },
    } as unknown as Parameters<typeof ensureSearchMappingReview>[0];

    await ensureSearchMappingReview(db, "job-1", profile, {
      originalTitle: "Unlisted workflow role",
      industryCode: "r03",
      categoryIds: ["r03-software-development"],
      sampleJobId: "job-1",
    });
    await ensureSearchMappingReview(db, "job-2", profile, {
      originalTitle: "Unlisted workflow role",
      industryCode: "r03",
      categoryIds: ["r03-software-development"],
      sampleJobId: "job-2",
    });

    expect(records.size).toBe(1);
    expect(db.searchMappingReview.create).toHaveBeenCalledTimes(1);
    expect(db.searchMappingReview.update).toHaveBeenCalledTimes(1);
  });

  it("uses the same punctuation-insensitive title key for bootstrap and projections", () => {
    const left = buildJobSearchProfile(
      { title: "Senior Quantum Workflow Designer" },
      { index },
    );
    const withAmpersand = { ...left, canonicalTitleEn: "R&D Specialist" };
    const withSpaces = { ...left, canonicalTitleEn: "R & D Specialist" };
    expect(searchMappingReviewOpenKey(withAmpersand, {})).toBe(
      searchMappingReviewOpenKey(withSpaces, {}),
    );
  });
});
