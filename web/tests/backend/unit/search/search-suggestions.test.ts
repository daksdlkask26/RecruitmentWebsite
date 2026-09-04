import { describe, expect, it } from "vitest";
import { listSearchSuggestions } from "@/backend/services/search/search-suggestions";

describe("search suggestions", () => {
  it("returns stable title suggestions for compact bilingual input", async () => {
    const result = await listSearchSuggestions({
      scope: "JOBS",
      q: "ketoan",
      limit: 8,
    });

    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions[0]?.id).toMatch(/^(?:title|occ|skill)-/u);
    expect(result.suggestions[0]).not.toHaveProperty("score");
  });

  it("returns bilingual SEO title labels without exposing internal metadata", async () => {
    const result = await listSearchSuggestions({
      scope: "JOBS",
      q: "seo speci",
      limit: 8,
    });
    const seo = result.suggestions.find(
      (item) => item.type === "TITLE" && item.labelEn === "SEO Specialist",
    );

    expect(seo).toMatchObject({
      type: "TITLE",
      labelEn: expect.stringContaining("SEO"),
      labelVi: expect.any(String),
    });
    expect(JSON.stringify(seo)).not.toContain("mappingConfidence");
  });

  it("does not run a broad query for one-character input", async () => {
    const result = await listSearchSuggestions({
      scope: "JOBS",
      q: "s",
      limit: 8,
    });

    expect(result.suggestions).toEqual([]);
  });

  it.each([
    ["frotend", "title-frontenddeveloper-occ-r03-software-engineer"],
    ["pyhton", "skill-python"],
    ["dokcer", "skill-docker"],
  ] as const)("recovers the catalog suggestion for %s", async (q, id) => {
    const result = await listSearchSuggestions({
      scope: "JOBS",
      q,
      limit: 8,
    });

    expect(result.suggestions.map((suggestion) => suggestion.id)).toContain(id);
  });

  it("keeps compact accounting and abbreviation suggestions scoped", async () => {
    const accounting = await listSearchSuggestions({
      scope: "JOBS",
      q: "ketoa",
      limit: 8,
    });
    expect(accounting.suggestions.map((suggestion) => suggestion.id)).toEqual(
      expect.arrayContaining([
        "occ-r04-accountant",
        "title-generalaccountant-occ-r04-accountant",
      ]),
    );

    const it = await listSearchSuggestions({
      scope: "JOBS",
      q: "it",
      limit: 8,
    });
    expect(it.suggestions[0]).toMatchObject({
      id: "skill-information-technology",
      type: "SKILL",
    });
    expect(
      it.suggestions.map((suggestion) => suggestion.labelEn),
    ).not.toContain("Digital Marketing Executive");
  });
});
