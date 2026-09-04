import { describe, expect, it } from "vitest";
import {
  resolveSearchQuery,
  SEARCH_RESOLVER_VERSION,
  searchResolverVersion,
} from "@/backend/services/search/search-query-resolver";
import {
  compileSearchCatalogIndex,
  jobSearchCatalogIndex,
} from "@/backend/services/search/catalogs/job-search-catalog-index";

describe("resolveSearchQuery", () => {
  it.each([
    ["kế toán", "occ-r04-accountant"],
    ["ke toan", "occ-r04-accountant"],
    ["KẾ TOÁN", "occ-r04-accountant"],
    ["ketoan", "occ-r04-accountant"],
    ["ke tona", "occ-r04-accountant"],
    ["accountant", "occ-r04-accountant"],
    ["accounting", "occ-r04-accountant"],
    ["nhân viên kế toán", "occ-r04-accountant"],
    ["kế toán trưởng", "occ-r04-accountant"],
    ["kế toán kho", "occ-r04-accountant"],
    ["chief accountant", "occ-r04-accountant"],
    ["inventory accountant", "occ-r04-accountant"],
    ["kế toán công nợ", "occ-r04-accountant"],
    ["accounts payable", "occ-r04-accountant"],
    ["lập trình viên", "occ-r03-software-engineer"],
    ["lap trinh vien", "occ-r03-software-engineer"],
    ["laptrinhvien", "occ-r03-software-engineer"],
    ["lpa trinh vien", "occ-r03-software-engineer"],
    ["software engineer", "occ-r03-software-engineer"],
    ["frontend developer", "occ-r03-software-engineer"],
    ["backend developer", "occ-r03-software-engineer"],
    ["full stack developer", "occ-r03-software-engineer"],
    ["kỹ sư phần mềm", "occ-r03-software-engineer"],
    ["nhân sự", "occ-r06-human-resources"],
    ["nhan su", "occ-r06-human-resources"],
    ["human resources", "occ-r06-human-resources"],
    ["hr", "occ-r06-human-resources"],
    ["giáo viên", "occ-r21-education"],
    ["y tá", "occ-r18-healthcare-pharmaceuticals"],
    ["điều dưỡng", "occ-r18-healthcare-pharmaceuticals"],
    ["dược sĩ", "occ-r18-healthcare-pharmaceuticals"],
    ["kiến trúc sư", "occ-r09-construction-architecture"],
    ["thợ hàn", "occ-r08-mechanical-automotive"],
    ["tài xế xe tải", "occ-r28-general-labor-drivers"],
    ["nhân viên kho", "occ-r10-supply-chain-logistics"],
    ["biên dịch viên", "occ-r24-translation"],
    ["tuyển dụng", "occ-r06-recruiter"],
    ["talent acquisition", "occ-r06-recruiter"],
    ["recruiter", "occ-r06-recruiter"],
  ] as const)(
    "maps the quality corpus query %s to %s",
    (query, occupationId) => {
      const result = resolveSearchQuery(query, "JOBS", "vi");

      expect(result.interpretation.matchedOccupation?.occupationId).toBe(
        occupationId,
      );
      expect(result.variants.length).toBeLessThanOrEqual(8);
    },
  );

  it.each(["it", "qa", "ui", "ux", "c", "c++", "r", "go"])(
    "does not fuzzy-expand short or unknown token %s",
    (query) => {
      const result = resolveSearchQuery(query, "JOBS");

      expect(result.correction).toBeUndefined();
      expect(result.variants).toHaveLength(1);
    },
  );

  it("normalizes Vietnamese and expands controlled job aliases", () => {
    const result = resolveSearchQuery("LẬP TRÌNH VIÊN", "JOBS", "vi");

    expect(result.normalizedQuery).toBe("lap trinh vien");
    expect(result.variants.map((variant) => variant.value)).toEqual([
      "lap trinh vien",
      "software engineer",
      "software developer",
      "programmer",
    ]);
    expect(result.usedFallback).toBe(true);
    expect(result.foldedQuery).toBe("lap trinh vien");
    expect(result.compactQuery).toBe("laptrinhvien");
    expect(result.effectiveQuery).toBe("lap trinh vien");
    expect(result.interpretation.foldedQuery).toBe("lap trinh vien");
    expect(result.interpretation.compactQuery).toBe("laptrinhvien");
  });

  it("does not fuzzy-correct short queries", () => {
    const result = resolveSearchQuery("IT", "COMPANIES");

    expect(result.correction).toBeUndefined();
    expect(result.variants.map((variant) => variant.value)).toEqual([
      "it",
      "information technology",
    ]);
    expect(result.usedFallback).toBe(true);
  });

  it("marks a close canonical term as a typo correction", () => {
    const result = resolveSearchQuery("sofware engineer", "JOBS");

    expect(result.correction?.to).toBe("software engineer");
    expect(result.correction?.confidence).toBe("HIGH");
    expect(result.resolverVersion).toBe(SEARCH_RESOLVER_VERSION);
  });

  it("carries a request's catalog version through resolver and interpretation", () => {
    const catalogB = compileSearchCatalogIndex({
      ...jobSearchCatalogIndex.catalog,
      version: "catalog-b",
    });

    const result = resolveSearchQuery("kế toán", "JOBS", "vi", "SMART", {
      catalogIndex: catalogB,
    });

    expect(result.resolverVersion).toBe("catalog-b:resolver-8");
    expect(result.interpretation.catalogVersion).toBe("catalog-b");
    expect(result.intent?.catalogVersion).toBe("catalog-b");
  });

  it("bounds long catalog resolver versions without losing identity", () => {
    const first = compileSearchCatalogIndex({
      ...jobSearchCatalogIndex.catalog,
      version: `draft-${"a".repeat(58)}`,
    });
    const second = compileSearchCatalogIndex({
      ...jobSearchCatalogIndex.catalog,
      version: `draft-${"a".repeat(57)}b`,
    });

    const firstVersion = searchResolverVersion(first);
    const secondVersion = searchResolverVersion(second);
    expect(firstVersion).toHaveLength(64);
    expect(secondVersion).toHaveLength(64);
    expect(firstVersion).not.toBe(secondVersion);
    expect(firstVersion).toMatch(/^draft-a{30}-[0-9a-f]{16}:resolver-8$/u);
  });

  it.each(["kế toán", "ke toan", "KẾ TOÁN"])(
    "maps %s to the accounting canonical terms",
    (query) => {
      const result = resolveSearchQuery(query, "JOBS", "vi");
      expect(result.variants.map((variant) => variant.value)).toContain(
        "accountant",
      );
    },
  );

  it("recognizes an accounting phrase inside a longer query", () => {
    const result = resolveSearchQuery("nhân viên kế toán", "JOBS", "vi");
    expect(result.variants.map((variant) => variant.value)).toContain(
      "accountant",
    );
  });

  it("recognizes compact Vietnamese phrases without spaces", () => {
    const accounting = resolveSearchQuery("ketoan", "JOBS", "vi");
    const engineering = resolveSearchQuery("laptrinhvien", "JOBS", "vi");

    expect(accounting.variants.map((variant) => variant.value)).toContain(
      "accountant",
    );
    expect(engineering.variants.map((variant) => variant.value)).toContain(
      "software engineer",
    );
  });

  it("keeps title identity separate from its broad occupation", () => {
    const result = resolveSearchQuery("SEO Specialist", "JOBS", "en");

    expect(result.intent?.titleCandidates[0]).toEqual(
      expect.objectContaining({
        titleId: "title-seospecialist-occ-r02-marketing-communications",
        matchKind: "EXACT",
      }),
    );
    expect(result.variants[0]).toEqual(
      expect.objectContaining({
        titleId: "title-seospecialist-occ-r02-marketing-communications",
      }),
    );
    expect(result.interpretation.matchedTitle).toEqual(
      expect.objectContaining({
        titleId: "title-seospecialist-occ-r02-marketing-communications",
        labelEn: "SEO Specialist",
      }),
    );
  });

  it("keeps shared translated titles ambiguous instead of silently choosing one", () => {
    const result = resolveSearchQuery("Chuyên viên SEO", "JOBS", "vi");

    expect(result.intent?.titleCandidates.length).toBeGreaterThan(1);
    expect(result.intent?.ambiguous).toBe(true);
    expect(result.correction).toBeUndefined();
  });

  it("corrects a transposed Vietnamese typo before expanding the occupation", () => {
    const result = resolveSearchQuery("ke tona", "JOBS", "vi");

    expect(result.correction).toMatchObject({
      from: "ke tona",
      to: "ke toan",
      confidence: "HIGH",
    });
    expect(result.variants.map((variant) => variant.value)).toContain(
      "accountant",
    );
    expect(result.interpretation.reason).toBe("TYPO_AND_ALIAS");
  });

  it("corrects English occupation typos from the catalog corpus", () => {
    const result = resolveSearchQuery("accountnat", "JOBS");

    expect(result.correction?.to).toBe("accountant");
    expect(result.correction?.confidence).toBe("HIGH");
    expect(result.interpretation.effectiveQuery).toBe("accountant");
  });

  it("keeps a seniority modifier and prioritizes specific accounting titles", () => {
    const result = resolveSearchQuery("kế toán trưởng", "JOBS", "vi");
    const values = result.variants.map((variant) => variant.value);

    expect(values.indexOf("chief accountant")).toBeGreaterThan(-1);
    expect(values.indexOf("chief accountant")).toBeLessThan(
      values.indexOf("accountant"),
    );
    expect(result.variants.some((variant) => variant.retainedTerms)).toBe(true);
  });

  it("keeps General Accountant distinct from Chief Accountant", () => {
    const general = resolveSearchQuery("kế toán tổng hợp", "JOBS", "vi");
    const chief = resolveSearchQuery("kế toán trưởng", "JOBS", "vi");
    const generalValues = general.variants.map((variant) => variant.value);
    const chiefValues = chief.variants.map((variant) => variant.value);

    expect(generalValues).toContain("general accountant");
    expect(generalValues).not.toContain("chief accountant");
    expect(chiefValues).toContain("chief accountant");
    expect(chiefValues).not.toContain("general accountant");
  });

  it("retains the employee and warehouse modifiers in a compound accounting query", () => {
    const result = resolveSearchQuery("nhân viên kế toán kho", "JOBS", "vi");
    const values = result.variants.map((variant) => variant.value);

    expect(values).toContain("nhan vien accountant kho");
    expect(values).toContain("inventory accountant");
    expect(values).toContain("warehouse accountant");
    expect(values).not.toContain("accountant");
    expect(
      result.variants.some((variant) => variant.retainedTerms?.includes("kho")),
    ).toBe(true);
  });

  it("collapses a repeated alias chain without losing the occupation intent", () => {
    const result = resolveSearchQuery(
      "accountant and accounting and accounting specialist",
      "JOBS",
    );

    expect(result.variants.map((variant) => variant.value)).toEqual([
      "accountant",
      "accounting",
      "accounting specialist",
    ]);
    expect(result.interpretation.matchedOccupation?.occupationId).toBe(
      "occ-r04-accountant",
    );
  });

  it("keeps a transposed core and its modifier together during correction", () => {
    const result = resolveSearchQuery("nhan vien ke tona kho", "JOBS", "vi");
    const values = result.variants.map((variant) => variant.value);

    expect(values).toContain("nhan vien ke toan kho");
    expect(values).toContain("nhan vien accountant kho");
    expect(values).toContain("inventory accountant");
  });

  it("does not repeat a replacement title when the same facet remains in context", () => {
    const result = resolveSearchQuery("frontend developer frontend", "JOBS");
    const values = result.variants.map((variant) => variant.value);

    expect(values.slice(1)).not.toContain("frontend developer frontend");
    expect(values.slice(1)).toContain("frontend developer");
  });

  it("does not expand or fuzzy-correct literal search", () => {
    const result = resolveSearchQuery("ke tona", "JOBS", "en", "LITERAL");

    expect(result.variants.map((variant) => variant.value)).toEqual([
      "ke tona",
    ]);
    expect(result.correction).toBeUndefined();
    expect(result.interpretation.mode).toBe("LITERAL");
  });

  it("parses reusable specialization facets without an occupation special case", () => {
    const result = resolveSearchQuery("frontned developer", "JOBS", "en");

    expect(result.correction?.to).toBe("frontend developer");
    expect(result.interpretation.matchedFacets).toEqual([
      expect.objectContaining({ facetId: "specialization.frontend" }),
    ]);
    expect(result.intent?.requiredFacetIds).toContain(
      "specialization.frontend",
    );
  });

  it("does not fuzzy-correct a generic role term by itself", () => {
    const result = resolveSearchQuery("specialist", "JOBS", "en");

    expect(result.correction).toBeUndefined();
    expect(result.intent?.occupationCandidates).toEqual([]);
  });

  it.each([
    "chuy\u00ean vi\u00ean SEO",
    "chuyen vien SEO",
    "chuyenvien SEO",
    "CHUY\u00caN VI\u00caN seo",
    "chuy\u00ean v\u00ean SEO",
    "chuyrn vien SEO",
  ])(
    "composes the generic role and SEO facet without crossing occupations for %s",
    (query) => {
      const result = resolveSearchQuery(query, "JOBS", "vi");
      const values = result.variants.map((variant) => variant.value);

      expect(result.correction).toBeUndefined();
      expect(values).toEqual(
        expect.arrayContaining(["seo executive", "seo specialist"]),
      );
      expect(values).not.toContain("dien");
      expect(
        result.variants.some(
          (variant) =>
            variant.occupationId === "occ-r07-electrical-electronics",
        ),
      ).toBe(false);
      expect(result.intent?.occupationCandidates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            occupationId: "occ-r02-marketing-communications",
            matchKind: "RELATED",
          }),
        ]),
      );
      expect(result.intent?.requiredFacetIds).toContain("specialization.seo");
      expect(result.intent?.retainedTerms.length).toBeGreaterThan(0);
      expect(result.interpretation.matchedOccupation?.occupationId).toBe(
        "occ-r02-marketing-communications",
      );
    },
  );

  it.each(["nh\u00e2n vi\u00ean \u0111i\u1ec7n", "vi\u00ean ch\u1ee9c"])(
    "does not fuzzy-correct Vietnamese generic vocabulary in %s",
    (query) => {
      const result = resolveSearchQuery(query, "JOBS", "vi");

      expect(result.correction).toBeUndefined();
      expect(result.variants[0]?.source).toBe("ORIGINAL");
      expect(
        result.variants.some((variant) => variant.source === "TYPO_CORRECTION"),
      ).toBe(false);
    },
  );

  it("marks conflicting exact facets as ambiguous without throwing", () => {
    const result = resolveSearchQuery("SEO electronics", "JOBS", "en");

    expect(result.interpretation.ambiguous).toBe(true);
    expect(result.intent?.ambiguous).toBe(true);
    expect(
      result.interpretation.matchedFacets?.map((facet) => facet.facetId),
    ).toEqual(
      expect.arrayContaining(["specialization.seo", "domain.electronics"]),
    );
  });

  it("reports medium confidence without auto-adding the ambiguous candidate", () => {
    const result = resolveSearchQuery("alph", "COMPANIES", "en", "SMART", {
      correctionTerms: ["alpha", "alphi"],
    });

    expect(result.correction?.confidence).toBe("MEDIUM");
    expect(result.variants.map((variant) => variant.value)).toEqual(["alph"]);
    expect(result.interpretation.effectiveQuery).toBe("alpha");
  });

  it("removes legal company prefixes from the smart search projection", () => {
    const result = resolveSearchQuery("Công ty Cổ phần FPT", "COMPANIES");

    expect(result.normalizedQuery).toBe("fpt");
    expect(result.variants.map((variant) => variant.value)).toEqual(["fpt"]);
  });
});
