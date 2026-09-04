import { describe, expect, it } from "vitest";
import { normalizeSearchText } from "@/backend/services/jobs/search-normalization";
import { jobSearchCatalogIndex } from "@/backend/services/search/catalogs/job-search-catalog-index";
import { resolveSearchQuery } from "@/backend/services/search/search-query-resolver";

const canonicalPhrases = [
  ...new Map(
    jobSearchCatalogIndex
      .occupationPhrases()
      .filter((phrase) => phrase.kind === "CANONICAL" && phrase.occupationId)
      .map((phrase) => [
        `${phrase.normalizedPhrase}\u0000${phrase.occupationId}`,
        phrase,
      ]),
  ).values(),
];

function occupationIds(resolved: ReturnType<typeof resolveSearchQuery>) {
  return resolved.intent?.occupationCandidates.map(
    (candidate) => candidate.occupationId,
  );
}

function removeOneCharacter(value: string) {
  const characters = Array.from(value);
  const index = characters.findIndex((character) => character !== " ");
  if (index < 0) return value;
  return [...characters.slice(0, index), ...characters.slice(index + 1)].join(
    "",
  );
}

function transposeFirstPair(value: string) {
  const characters = Array.from(value);
  for (let index = 0; index < characters.length - 1; index += 1) {
    if (characters[index] === " " || characters[index + 1] === " ") continue;
    [characters[index], characters[index + 1]] = [
      characters[index + 1]!,
      characters[index]!,
    ];
    return characters.join("");
  }
  return value;
}

function insertOneCharacter(value: string) {
  const characters = Array.from(value);
  const index = characters.findIndex((character) => character !== " ");
  if (index < 0) return value;
  return [
    ...characters.slice(0, index + 1),
    "x",
    ...characters.slice(index + 1),
  ].join("");
}

describe("catalog-driven search resolver invariants", () => {
  it("keeps casing, spacing, and diacritic variants on the compiled occupation", () => {
    const failures = canonicalPhrases.flatMap((phrase) => {
      const variants = [
        phrase.phrase.toUpperCase(),
        phrase.phrase.replace(/\s+/gu, "  "),
        normalizeSearchText(phrase.phrase),
      ];
      return variants.flatMap((query) => {
        const resolved = resolveSearchQuery(query, "JOBS", "vi", "SMART", {
          catalogIndex: jobSearchCatalogIndex,
        });
        return occupationIds(resolved)?.[0] === phrase.occupationId
          ? []
          : [
              {
                query,
                expected: phrase.occupationId,
                actual: occupationIds(resolved),
              },
            ];
      });
    });

    expect(failures).toEqual([]);
  });

  it("never changes the leading occupation for bounded single-edit title typos", () => {
    const cases = canonicalPhrases
      .filter((phrase) => phrase.compactPhrase.length >= 8)
      .slice(0, 80);
    const failures = cases.flatMap((phrase) => {
      const queries = [
        removeOneCharacter(phrase.normalizedPhrase),
        transposeFirstPair(phrase.normalizedPhrase),
        insertOneCharacter(phrase.normalizedPhrase),
      ];
      return queries.flatMap((query) => {
        const resolved = resolveSearchQuery(query, "JOBS", "en", "SMART", {
          catalogIndex: jobSearchCatalogIndex,
        });
        const firstOccupation = occupationIds(resolved)?.[0];
        return !firstOccupation || firstOccupation === phrase.occupationId
          ? []
          : [
              {
                query,
                expected: phrase.occupationId,
                actual: firstOccupation,
              },
            ];
      });
    });

    expect(failures).toEqual([]);
  });
});
