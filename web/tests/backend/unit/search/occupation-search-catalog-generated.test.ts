import { describe, expect, it } from "vitest";
import { resolveSearchQuery } from "@/backend/services/search/search-query-resolver";
import { jobSearchCatalogIndex } from "@/backend/services/search/catalogs/job-search-catalog-index";
import { bilingualJobTitleDefinitions } from "@/backend/services/search/catalogs/bilingual-job-title-catalog";

function withoutDiacritics(value: string) {
  return value.normalize("NFD").replace(/\p{M}+/gu, "");
}

const occupationPhrases = jobSearchCatalogIndex
  .occupationPhrases()
  .filter((phrase) => phrase.occupationId);

const uniqueOccupationPhrases = [
  ...new Map(
    occupationPhrases.map((phrase) => [
      `${phrase.kind}\u0000${phrase.normalizedPhrase}\u0000${phrase.occupationId}`,
      phrase,
    ]),
  ).values(),
];

describe("generated occupation search coverage", () => {
  it("resolves every compiled canonical, alias, and related title to its owner", () => {
    const unresolved = uniqueOccupationPhrases.flatMap((phrase) => {
      const resolved = resolveSearchQuery(
        phrase.phrase,
        "JOBS",
        "en",
        "SMART",
        {
          catalogIndex: jobSearchCatalogIndex,
        },
      );
      const occupationIds = new Set(
        resolved.intent?.occupationCandidates.map(
          (candidate) => candidate.occupationId,
        ),
      );
      return occupationIds.has(phrase.occupationId!)
        ? []
        : [
            {
              kind: phrase.kind,
              phrase: phrase.phrase,
              normalizedPhrase: phrase.normalizedPhrase,
              occupationId: phrase.occupationId,
              variants: resolved.variants.map((variant) => variant.value),
            },
          ];
    });

    expect(unresolved).toEqual([]);
  });

  it("keeps every active occupation bilingual and related-title facet references valid", () => {
    const invalid = jobSearchCatalogIndex.occupations.flatMap((occupation) => {
      const supported = new Set(occupation.supportedFacetIds);
      const hasBilingualLabel = Boolean(
        occupation.labels.vi.trim() && occupation.labels.en.trim(),
      );
      const invalidFacetReference = [
        ...occupation.canonicalTitles,
        ...occupation.aliases,
        ...occupation.relatedTitles,
      ].some((title) =>
        title.facetIds.some(
          (facetId) =>
            !supported.has(facetId) ||
            !jobSearchCatalogIndex.facetById(facetId),
        ),
      );

      return hasBilingualLabel && !invalidFacetReference
        ? []
        : [occupation.occupationId];
    });

    expect(invalid).toEqual([]);
  });

  it("resolves every active title definition in English and Vietnamese", () => {
    const unresolved = bilingualJobTitleDefinitions.flatMap((definition) => {
      const languages =
        definition.status === "INTENTIONAL_UNTRANSLATED"
          ? (["en"] as const)
          : (["en", "vi"] as const);
      return languages.flatMap((language) => {
        const resolved = resolveSearchQuery(
          definition.canonical[language],
          "JOBS",
          language,
          "SMART",
          { catalogIndex: jobSearchCatalogIndex },
        );
        const occupationIds = new Set(
          resolved.intent?.occupationCandidates.map(
            (candidate) => candidate.occupationId,
          ),
        );
        const hasLiteralVariant = resolved.variants.some(
          (variant) => variant.value === resolved.normalizedQuery,
        );
        const resolvedToOwner = Boolean(
          definition.occupationId && occupationIds.has(definition.occupationId),
        );
        return resolvedToOwner ||
          (!definition.occupationId && hasLiteralVariant)
          ? []
          : [
              {
                titleId: definition.titleId,
                title: definition.canonical[language],
                language,
                status: definition.status,
                occupationId: definition.occupationId,
                variants: resolved.variants.map((variant) => variant.value),
              },
            ];
      });
    });

    expect(unresolved).toEqual([]);
  });

  it("resolves title phrases with and without diacritics and rejects cross-occupation collisions", () => {
    const unresolved = jobSearchCatalogIndex.occupations.flatMap(
      (occupation) => {
        const phrases = [
          occupation.labels.vi,
          occupation.labels.en,
          ...occupation.aliases.map((alias) => alias.phrase),
          ...occupation.relatedTitles.map((title) => title.phrase),
        ];
        return phrases.flatMap((phrase) =>
          [phrase, withoutDiacritics(phrase)].flatMap((query) => {
            const resolved = resolveSearchQuery(query, "JOBS", "vi", "SMART", {
              catalogIndex: jobSearchCatalogIndex,
            });
            return resolved.intent?.occupationCandidates.some(
              (candidate) => candidate.occupationId === occupation.occupationId,
            )
              ? []
              : [{ occupationId: occupation.occupationId, phrase, query }];
          }),
        );
      },
    );

    const phrasesByKey = new Map<string, Set<string>>();
    for (const phrase of jobSearchCatalogIndex.occupationPhrases()) {
      const key = phrase.compactPhrase;
      const occupationIds = phrasesByKey.get(key) ?? new Set<string>();
      if (phrase.occupationId) occupationIds.add(phrase.occupationId);
      phrasesByKey.set(key, occupationIds);
    }
    const collisions = [...phrasesByKey.entries()]
      .filter(([, occupationIds]) => occupationIds.size > 1)
      .map(([phrase, occupationIds]) => ({
        phrase,
        occupationIds: [...occupationIds].sort(),
      }));

    expect(unresolved).toEqual([]);
    expect(collisions).toEqual([]);
  });

  it("keeps title metadata within its occupation industry, categories, and supported facets", () => {
    const invalid = bilingualJobTitleDefinitions.flatMap((definition) => {
      const occupation = definition.occupationId
        ? jobSearchCatalogIndex.occupationById(definition.occupationId)
        : undefined;
      if (!occupation) {
        return definition.status === "INTENTIONAL_UNTRANSLATED" &&
          definition.reviewReason
          ? []
          : [definition.titleId];
      }
      const supportedFacets = new Set(occupation.supportedFacetIds);
      const compatible =
        definition.industryCode === occupation.industryCode &&
        definition.categoryIds.every((categoryId) =>
          occupation.categoryIds.includes(categoryId),
        ) &&
        definition.facetIds.every((facetId) => supportedFacets.has(facetId));
      return compatible ? [] : [definition.titleId];
    });

    expect(invalid).toEqual([]);
  });

  it("limits frontend and backend facets to the software-development category", () => {
    const software = jobSearchCatalogIndex.occupationById(
      "occ-r03-software-engineer",
    );
    const dataAnalyst = jobSearchCatalogIndex.occupationById(
      "occ-r03-data-analyst",
    );
    const systemAdministrator = jobSearchCatalogIndex.occupationById(
      "occ-r03-system-administrator",
    );

    expect(software?.supportedFacetIds).toEqual(
      expect.arrayContaining([
        "specialization.frontend",
        "specialization.backend",
      ]),
    );
    expect(dataAnalyst?.supportedFacetIds).not.toEqual(
      expect.arrayContaining([
        "specialization.frontend",
        "specialization.backend",
      ]),
    );
    expect(systemAdministrator?.supportedFacetIds).not.toEqual(
      expect.arrayContaining([
        "specialization.frontend",
        "specialization.backend",
      ]),
    );
  });
});
