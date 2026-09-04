import {
  recruiterIndustryByCode,
  recruiterIndustryTaxonomy,
} from "@/shared/contracts/jobs/industry-taxonomy";
import { normalizeSearchText } from "@/backend/services/jobs/search-normalization";
import {
  occupationSearchCatalog,
  OCCUPATION_SEARCH_CATALOG_VERSION,
} from "./occupation-search-catalog";
import {
  occupationSearchCatalogSchema,
  type OccupationSearchEntry,
} from "./occupation-search-catalog-schema";

export type OccupationPhraseKind =
  | "LABEL"
  | "ALIAS"
  | "RELATED_TITLE"
  | "ABBREVIATION"
  | "IRREGULAR_ALIAS";

export type OccupationPhraseMatch = Readonly<{
  occupation: OccupationSearchEntry;
  phrase: string;
  normalizedPhrase: string;
  compactPhrase: string;
  kind: OccupationPhraseKind;
  language: "vi" | "en" | "neutral";
}>;

function compact(value: string) {
  return value.replace(/\s+/gu, "");
}

function freezeEntry(entry: OccupationSearchEntry) {
  return Object.freeze({
    ...entry,
    labels: Object.freeze({ ...entry.labels }),
    aliases: Object.freeze({
      vi: Object.freeze([...entry.aliases.vi]),
      en: Object.freeze([...entry.aliases.en]),
    }),
    categoryIds: Object.freeze([...entry.categoryIds]),
    abbreviations: Object.freeze([...entry.abbreviations]),
    relatedTitles: Object.freeze({
      vi: Object.freeze([...entry.relatedTitles.vi]),
      en: Object.freeze([...entry.relatedTitles.en]),
    }),
    titleFacetMappings: Object.freeze(
      (entry.titleFacetMappings ?? []).map((mapping) =>
        Object.freeze({
          phrase: mapping.phrase,
          facetIds: Object.freeze([...mapping.facetIds]),
        }),
      ),
    ),
    rankingSkills: Object.freeze([...entry.rankingSkills]),
    irregularAliases: Object.freeze([...entry.irregularAliases]),
    exclusions: Object.freeze([...entry.exclusions]),
  });
}

function assertCatalogReferences(entries: readonly OccupationSearchEntry[]) {
  const occupationIds = new Set<string>();
  const normalizedPhrases = new Map<string, string>();
  const categoryIds = new Set<string>(
    recruiterIndustryTaxonomy.flatMap(
      (industry) => industry.subIndustries?.map(([, id]) => id) ?? [],
    ),
  );

  for (const entry of entries) {
    if (occupationIds.has(entry.occupationId)) {
      throw new Error(`Duplicate occupation id: ${entry.occupationId}`);
    }
    occupationIds.add(entry.occupationId);
    if (!recruiterIndustryByCode.has(entry.industryCode as never)) {
      throw new Error(`Unknown occupation industry: ${entry.industryCode}`);
    }
    for (const categoryId of entry.categoryIds) {
      if (!categoryIds.has(categoryId)) {
        throw new Error(`Unknown occupation category: ${categoryId}`);
      }
    }

    const phrases = [
      [entry.labels.vi, "LABEL", "vi"],
      [entry.labels.en, "LABEL", "en"],
      ...entry.aliases.vi.map((phrase) => [phrase, "ALIAS", "vi"] as const),
      ...entry.aliases.en.map((phrase) => [phrase, "ALIAS", "en"] as const),
      ...entry.relatedTitles.vi.map(
        (phrase) => [phrase, "RELATED_TITLE", "vi"] as const,
      ),
      ...entry.relatedTitles.en.map(
        (phrase) => [phrase, "RELATED_TITLE", "en"] as const,
      ),
      ...entry.abbreviations.map(
        (phrase) => [phrase, "ABBREVIATION", "neutral"] as const,
      ),
      ...entry.irregularAliases.map(
        (phrase) => [phrase, "IRREGULAR_ALIAS", "neutral"] as const,
      ),
    ] as const;
    for (const [phrase] of phrases) {
      const normalized = normalizeSearchText(phrase, 160);
      const key = compact(normalized);
      const previous = normalizedPhrases.get(key);
      if (previous && previous !== entry.occupationId) {
        throw new Error(`Occupation phrase collision: ${phrase}`);
      }
      normalizedPhrases.set(key, entry.occupationId);
    }
  }
}

const parsedCatalog = occupationSearchCatalogSchema
  .parse(occupationSearchCatalog)
  .map(freezeEntry);
assertCatalogReferences(parsedCatalog);

const entriesById = new Map(
  parsedCatalog.map((entry) => [entry.occupationId, entry]),
);
const occupationIdsByIndustry = new Map<string, readonly string[]>();
const occupationIdsByCategory = new Map<string, readonly string[]>();
for (const occupation of parsedCatalog) {
  const industryEntries =
    occupationIdsByIndustry.get(occupation.industryCode) ?? [];
  occupationIdsByIndustry.set(
    occupation.industryCode,
    Object.freeze([...industryEntries, occupation.occupationId]),
  );
  for (const categoryId of occupation.categoryIds) {
    const categoryEntries = occupationIdsByCategory.get(categoryId) ?? [];
    occupationIdsByCategory.set(
      categoryId,
      Object.freeze([...categoryEntries, occupation.occupationId]),
    );
  }
}
const phrases: OccupationPhraseMatch[] = [];
const indexedPhraseKeys = new Set<string>();
const exactByNormalized = new Map<string, OccupationPhraseMatch[]>();
const exactByCompact = new Map<string, OccupationPhraseMatch[]>();

function addPhrase(
  occupation: OccupationSearchEntry,
  phrase: string,
  kind: OccupationPhraseKind,
  language: OccupationPhraseMatch["language"],
) {
  const normalizedPhrase = normalizeSearchText(phrase, 160);
  const phraseKey = `${occupation.occupationId}\u0000${compact(normalizedPhrase)}`;
  if (indexedPhraseKeys.has(phraseKey)) return;
  indexedPhraseKeys.add(phraseKey);
  const match = Object.freeze<OccupationPhraseMatch>({
    occupation,
    phrase,
    normalizedPhrase,
    compactPhrase: compact(normalizedPhrase),
    kind,
    language,
  });
  phrases.push(match);
  const normalizedMatches = exactByNormalized.get(normalizedPhrase) ?? [];
  normalizedMatches.push(match);
  exactByNormalized.set(normalizedPhrase, normalizedMatches);
  const compactMatches = exactByCompact.get(match.compactPhrase) ?? [];
  compactMatches.push(match);
  exactByCompact.set(match.compactPhrase, compactMatches);
}

for (const occupation of parsedCatalog) {
  addPhrase(occupation, occupation.labels.vi, "LABEL", "vi");
  addPhrase(occupation, occupation.labels.en, "LABEL", "en");
  for (const phrase of occupation.aliases.vi)
    addPhrase(occupation, phrase, "ALIAS", "vi");
  for (const phrase of occupation.aliases.en)
    addPhrase(occupation, phrase, "ALIAS", "en");
  for (const phrase of occupation.relatedTitles.vi)
    addPhrase(occupation, phrase, "RELATED_TITLE", "vi");
  for (const phrase of occupation.relatedTitles.en)
    addPhrase(occupation, phrase, "RELATED_TITLE", "en");
  for (const phrase of occupation.abbreviations)
    addPhrase(occupation, phrase, "ABBREVIATION", "neutral");
  for (const phrase of occupation.irregularAliases)
    addPhrase(occupation, phrase, "IRREGULAR_ALIAS", "neutral");
}

const frozenPhrases = Object.freeze(phrases);

export const occupationSearchIndex = Object.freeze({
  version: OCCUPATION_SEARCH_CATALOG_VERSION,
  entries: Object.freeze(parsedCatalog),
  phrases: frozenPhrases,
});

export function occupationById(occupationId: string) {
  return entriesById.get(occupationId);
}

export function occupationIdsForIndustry(
  industryCode: string,
): readonly string[] {
  return occupationIdsByIndustry.get(industryCode) ?? [];
}

export function occupationIdsForCategory(
  categoryId: string,
): readonly string[] {
  return occupationIdsByCategory.get(categoryId) ?? [];
}

export function exactOccupationPhraseMatches(value: string) {
  const normalized = normalizeSearchText(value, 160);
  return [
    ...(exactByNormalized.get(normalized) ?? []),
    ...(exactByCompact.get(compact(normalized)) ?? []),
  ].filter(
    (match, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.occupation.occupationId === match.occupation.occupationId &&
          candidate.compactPhrase === match.compactPhrase,
      ) === index,
  );
}

export function occupationPhrases(): readonly OccupationPhraseMatch[] {
  return frozenPhrases;
}
