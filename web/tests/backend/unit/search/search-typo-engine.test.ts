import { describe, expect, it } from "vitest";
import { jobSearchCatalogIndex } from "@/backend/services/search/catalogs/job-search-catalog-index";
import {
  damerauLevenshtein,
  resolveSearchTypo,
} from "@/backend/services/search/search-typo-engine";
import { resolveSearchQuery } from "@/backend/services/search/search-query-resolver";

describe("catalog-backed Typo Engine V2", () => {
  it("keeps every human-verified title mutation on its owner", () => {
    const humanVerified = (jobSearchCatalogIndex.catalog.titleDefinitions ?? [])
      .filter((title) => title.translationStatus === "HUMAN_VERIFIED")
      .flatMap((title) => [
        { title, phrase: title.canonical.en },
        ...title.aliases.en.map((phrase) => ({ title, phrase })),
      ]);
    const failures = humanVerified.flatMap(({ title, phrase }) => {
      const characters = Array.from(phrase);
      const index = characters.findIndex((character) => character !== " ");
      if (index < 0) return [];
      const mutated = [
        ...characters.slice(0, index),
        ...characters.slice(index + 1),
      ].join("");
      const resolved = resolveSearchQuery(mutated, "JOBS", "en");
      return resolved.intent?.titleCandidates.some(
        (candidate) => candidate.titleId === title.titleId,
      )
        ? []
        : [{ titleId: title.titleId, mutated }];
    });
    expect(failures).toEqual([]);
  });

  it.each([
    [
      "frotend",
      "frontend developer",
      "title-frontenddeveloper-occ-r03-software-engineer",
    ],
    [
      "fontend",
      "frontend developer",
      "title-frontenddeveloper-occ-r03-software-engineer",
    ],
    [
      "frontned developer",
      "frontend developer",
      "title-frontenddeveloper-occ-r03-software-engineer",
    ],
    [
      "bakcend",
      "backend developer",
      "title-backenddeveloper-occ-r03-software-engineer",
    ],
    ["pyhton", "python", undefined],
    ["dokcer", "docker", undefined],
    ["teahcer", "teacher", "title-teacher-occ-r21-education"],
    ["quản lí", "quan ly", undefined],
    ["kĩ sư", "ky su", undefined],
    ["dược sỹ", "duoc si", undefined],
    ["laapj trinhf", "lap trinh", undefined],
  ] as const)("resolves %s to %s", (query, expected, titleId) => {
    const resolved = resolveSearchQuery(query, "JOBS", "vi");

    expect(resolved.correction?.confidence).toBe("HIGH");
    expect(resolved.correction?.to).toBe(expected);
    expect(resolved.variants.map((variant) => variant.value)).toContain(
      expected,
    );
    if (titleId) {
      expect(resolved.intent?.titleCandidates[0]?.titleId).toBe(titleId);
    }
  });

  it("accepts the verified bác sĩ/sỹ spelling variants without cross-occupation correction", () => {
    for (const query of ["bác sĩ", "bác sỹ"]) {
      const resolved = resolveSearchQuery(query, "JOBS", "vi");
      expect(resolved.correction).toBeUndefined();
      expect(
        resolved.intent?.titleCandidates.map((candidate) => candidate.titleId),
      ).toEqual(
        expect.arrayContaining([
          "title-doctor-occ-r18-healthcare-pharmaceuticals",
          "title-physician-occ-r18-healthcare-pharmaceuticals",
        ]),
      );
    }
  });

  it.each([
    "it",
    "ai",
    "hr",
    "qa",
    "ui",
    "ux",
    "go",
    "r",
    "c",
    "c++",
    "c#",
    "manager",
    "developer",
    "specialist",
    "recta",
    "digital",
    "capital",
    "heritage",
    "qwertyuiop",
  ])("does not auto-correct protected or ambiguous token %s", (query) => {
    const resolved = resolveSearchQuery(query, "JOBS", "en");

    expect(resolved.correction).toBeUndefined();
    expect(
      resolved.variants.every(
        (variant) =>
          variant.source === "ORIGINAL" ||
          variant.source === "VIETNAMESE_ALIAS" ||
          variant.source === "RELATED_TITLE",
      ),
    ).toBe(true);
  });

  it("keeps literal mode free of correction and expansion", () => {
    const resolved = resolveSearchQuery("frotend", "JOBS", "en", "LITERAL");

    expect(resolved.variants).toEqual([
      expect.objectContaining({ value: "frotend", source: "ORIGINAL" }),
    ]);
    expect(resolved.correction).toBeUndefined();
    expect(resolved.interpretation.effectiveQuery).toBe("frotend");
  });

  it("uses Unicode code points and Damerau transposition", () => {
    expect(damerauLevenshtein("kế toán", "kế toan")).toBe(1);
    expect(damerauLevenshtein("frontned", "frontend")).toBe(1);
    expect(
      resolveSearchTypo("frontned developer", jobSearchCatalogIndex),
    ).toEqual(
      expect.objectContaining({ confidence: "HIGH", to: "frontend developer" }),
    );
  });

  it("keeps typo candidate generation deterministic and bounded", () => {
    const queries = ["frotend", "bakcend", "pyhton", "dokcer", "qwertyuiop"];
    const first = queries.map((query) =>
      resolveSearchTypo(query, jobSearchCatalogIndex),
    );
    const second = queries.map((query) =>
      resolveSearchTypo(query, jobSearchCatalogIndex),
    );

    expect(second).toEqual(first);
    for (const query of queries) {
      expect(
        resolveSearchQuery(query, "JOBS").variants.length,
      ).toBeLessThanOrEqual(8);
    }
  });
});
