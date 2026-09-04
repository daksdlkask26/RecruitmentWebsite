import { normalizeSearchText } from "@/backend/services/jobs/search-normalization";
import {
  type GenericRoleTerm,
  type BilingualJobTitleDefinition,
  type OccupationDefinition,
  type SearchCatalog,
  type SearchFacetDefinition,
  type SearchSkillDefinition,
  createJobSearchIntentSchema,
  searchCatalogSchema,
} from "@/shared/contracts/search/job-search-intent";
import { jobSearchCatalog } from "./job-search-catalog";

export type CompiledSearchPhrase = Readonly<{
  phrase: string;
  normalizedPhrase: string;
  compactPhrase: string;
  occupationId?: string;
  titleId?: string;
  facetId?: string;
  skillId?: string;
  kind:
    | "CANONICAL"
    | "ALIAS"
    | "ABBREVIATION"
    | "IRREGULAR_ALIAS"
    | "RELATED_TITLE"
    | "TITLE_CANONICAL"
    | "TITLE_ALIAS"
    | "TITLE_ABBREVIATION"
    | "TITLE_EXCLUDED"
    | "FACET"
    | "SKILL"
    | "GENERIC_ROLE";
  language: "vi" | "en" | "neutral";
  facetIds: readonly string[];
  roleIds: readonly GenericRoleTerm["role"][];
  weight: number;
}>;

export type SearchCatalogIndex = Readonly<{
  version: string;
  catalog: SearchCatalog;
  occupations: readonly OccupationDefinition[];
  facets: readonly SearchFacetDefinition[];
  genericRoleTerms: readonly GenericRoleTerm[];
  skills: readonly SearchSkillDefinition[];
  occupationById: (occupationId: string) => OccupationDefinition | undefined;
  facetById: (facetId: string) => SearchFacetDefinition | undefined;
  occupationIdsForIndustry: (industryCode: string) => readonly string[];
  occupationIdsForCategory: (categoryId: string) => readonly string[];
  occupationPhrases: () => readonly CompiledSearchPhrase[];
  facetPhrases: () => readonly CompiledSearchPhrase[];
  skillPhrases: () => readonly CompiledSearchPhrase[];
  exactSkillPhraseMatches: (value: string) => readonly CompiledSearchPhrase[];
  fuzzySkillPhraseCandidates: (
    value: string,
  ) => readonly CompiledSearchPhrase[];
  genericPhrases: () => readonly CompiledSearchPhrase[];
  titlePhrases: () => readonly CompiledSearchPhrase[];
  excludedTitlePhrases: () => readonly CompiledSearchPhrase[];
  titleById: (titleId: string) => BilingualJobTitleDefinition | undefined;
  titlesForOccupation: (
    occupationId: string,
  ) => readonly BilingualJobTitleDefinition[];
  fuzzyOccupationPhraseCandidates: (
    value: string,
  ) => readonly CompiledSearchPhrase[];
  exactOccupationPhraseMatches: (
    value: string,
  ) => readonly CompiledSearchPhrase[];
  exactFacetPhraseMatches: (value: string) => readonly CompiledSearchPhrase[];
  exactTitlePhraseMatches: (value: string) => readonly CompiledSearchPhrase[];
  fuzzyTitlePhraseCandidates: (
    value: string,
  ) => readonly CompiledSearchPhrase[];
  exactExcludedTitlePhraseMatches: (
    value: string,
  ) => readonly CompiledSearchPhrase[];
  intentSchema: ReturnType<typeof createJobSearchIntentSchema>;
}>;

function compact(value: string) {
  return value.replace(/\s+/gu, "");
}

function fuzzyNgrams(value: string) {
  const normalized = compact(value);
  const size = normalized.length >= 8 ? 3 : 2;
  if (normalized.length < size) return normalized ? [normalized] : [];
  return Array.from({ length: normalized.length - size + 1 }, (_, index) =>
    normalized.slice(index, index + size),
  );
}

function phraseOccursInText(value: string, phrase: string) {
  const normalizedValue = normalizeSearchText(value, 160);
  const normalizedPhrase = normalizeSearchText(phrase, 160);
  if (compact(normalizedValue) === compact(normalizedPhrase)) return true;

  const valueTokens = normalizedValue.split(/\s+/u).filter(Boolean);
  const phraseTokens = normalizedPhrase.split(/\s+/u).filter(Boolean);
  if (!valueTokens.length || phraseTokens.length > valueTokens.length) {
    return false;
  }
  for (
    let start = 0;
    start <= valueTokens.length - phraseTokens.length;
    start += 1
  ) {
    if (
      valueTokens.slice(start, start + phraseTokens.length).join(" ") ===
      normalizedPhrase
    ) {
      return true;
    }
  }
  return false;
}

function immutableArray<T>(items: readonly T[]) {
  return Object.freeze([...items]);
}

function immutableCatalog(catalog: SearchCatalog): SearchCatalog {
  return Object.freeze({
    ...catalog,
    titleDefinitions: immutableArray(
      (catalog.titleDefinitions ?? []).map((definition) =>
        Object.freeze({
          ...definition,
          categoryIds: immutableArray(definition.categoryIds),
          canonical: Object.freeze({ ...definition.canonical }),
          aliases: Object.freeze({
            vi: immutableArray(definition.aliases.vi),
            en: immutableArray(definition.aliases.en),
          }),
          abbreviations: immutableArray(definition.abbreviations),
          facetIds: immutableArray(definition.facetIds),
          skillSignals: immutableArray(definition.skillSignals),
          excludedTerms: immutableArray(definition.excludedTerms),
        }),
      ),
    ),
    occupations: immutableArray(
      catalog.occupations.map((occupation) =>
        Object.freeze({
          ...occupation,
          categoryIds: immutableArray(occupation.categoryIds),
          labels: Object.freeze({ ...occupation.labels }),
          canonicalTitles: immutableArray(
            occupation.canonicalTitles.map((title) =>
              Object.freeze({
                ...title,
                facetIds: immutableArray(title.facetIds),
              }),
            ),
          ),
          aliases: immutableArray(
            occupation.aliases.map((alias) =>
              Object.freeze({
                ...alias,
                facetIds: immutableArray(alias.facetIds),
              }),
            ),
          ),
          relatedTitles: immutableArray(
            occupation.relatedTitles.map((title) =>
              Object.freeze({
                ...title,
                facetIds: immutableArray(title.facetIds),
              }),
            ),
          ),
          titleFacetMappings: immutableArray(
            (occupation.titleFacetMappings ?? []).map((mapping) =>
              Object.freeze({
                ...mapping,
                facetIds: immutableArray(mapping.facetIds),
              }),
            ),
          ),
          defaultFacetIds: immutableArray(occupation.defaultFacetIds),
          supportedFacetIds: immutableArray(occupation.supportedFacetIds),
          skills: immutableArray(occupation.skills),
          negativeTerms: immutableArray(occupation.negativeTerms),
        }),
      ),
    ),
    facets: immutableArray(
      catalog.facets.map((facet) =>
        Object.freeze({
          ...facet,
          labels: Object.freeze({ ...facet.labels }),
          positiveTerms: immutableArray(facet.positiveTerms),
          conflictFacetIds: immutableArray(facet.conflictFacetIds),
          compatibleIndustryCodes: immutableArray(
            facet.compatibleIndustryCodes ?? [],
          ),
          compatibleCategoryIds: immutableArray(
            facet.compatibleCategoryIds ?? [],
          ),
        }),
      ),
    ),
    genericRoleTerms: immutableArray(
      catalog.genericRoleTerms.map((term) => Object.freeze({ ...term })),
    ),
    skills: immutableArray(
      catalog.skills.map((skill) =>
        Object.freeze({ ...skill, phrases: immutableArray(skill.phrases) }),
      ),
    ),
  }) as unknown as SearchCatalog;
}

function addLookup(
  map: Map<string, CompiledSearchPhrase[]>,
  phrase: CompiledSearchPhrase,
) {
  const values = map.get(phrase.normalizedPhrase) ?? [];
  values.push(phrase);
  map.set(phrase.normalizedPhrase, values);
  const compactKey = compact(phrase.normalizedPhrase);
  if (compactKey !== phrase.normalizedPhrase) {
    const compactValues = map.get(compactKey) ?? [];
    compactValues.push(phrase);
    map.set(compactKey, compactValues);
  }
}

function dedupeMatches(matches: readonly CompiledSearchPhrase[]) {
  const seen = new Set<string>();
  return immutableArray(
    matches.filter((match) => {
      const key = [
        match.titleId ?? "",
        match.occupationId ?? "",
        match.facetId ?? "",
        match.skillId ?? "",
        match.normalizedPhrase,
      ].join("\u0000");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  );
}

const compiledIndexByVersion = new Map<string, SearchCatalogIndex>();

export function compileSearchCatalogIndex(
  input: SearchCatalog,
): SearchCatalogIndex {
  // Validate every caller-supplied catalog, but reuse the immutable compiled
  // index for a catalog version. Catalog versions are immutable identities;
  // changing the data requires publishing a new version.
  const parsedCatalog = searchCatalogSchema.parse(input);
  const cached = compiledIndexByVersion.get(parsedCatalog.version);
  if (cached) return cached;

  const catalog = immutableCatalog(parsedCatalog);
  const occupationsById = new Map(
    catalog.occupations.map((occupation) => [
      occupation.occupationId,
      occupation,
    ]),
  );
  const titles = catalog.titleDefinitions ?? [];
  const titlesById = new Map(titles.map((title) => [title.titleId, title]));
  const titlesByOccupation = new Map<string, BilingualJobTitleDefinition[]>();
  for (const title of titles) {
    if (!title.occupationId) continue;
    const values = titlesByOccupation.get(title.occupationId) ?? [];
    values.push(title);
    titlesByOccupation.set(title.occupationId, values);
  }
  const facetsById = new Map(
    catalog.facets.map((facet) => [facet.facetId, facet]),
  );
  const occupationIdsByIndustry = new Map<string, readonly string[]>();
  const occupationIdsByCategory = new Map<string, readonly string[]>();
  for (const occupation of catalog.occupations) {
    occupationIdsByIndustry.set(
      occupation.industryCode,
      immutableArray([
        ...(occupationIdsByIndustry.get(occupation.industryCode) ?? []),
        occupation.occupationId,
      ]),
    );
    for (const categoryId of occupation.categoryIds) {
      occupationIdsByCategory.set(
        categoryId,
        immutableArray([
          ...(occupationIdsByCategory.get(categoryId) ?? []),
          occupation.occupationId,
        ]),
      );
    }
  }

  const occupationPhrases: CompiledSearchPhrase[] = [];
  const facetPhrases: CompiledSearchPhrase[] = [];
  const skillPhrases: CompiledSearchPhrase[] = [];
  const genericPhrases: CompiledSearchPhrase[] = [];
  const titlePhrases: CompiledSearchPhrase[] = [];
  const excludedTitlePhrases: CompiledSearchPhrase[] = [];
  const exactOccupation = new Map<string, CompiledSearchPhrase[]>();
  const exactFacet = new Map<string, CompiledSearchPhrase[]>();
  const exactTitle = new Map<string, CompiledSearchPhrase[]>();
  const exactExcludedTitle = new Map<string, CompiledSearchPhrase[]>();
  const exactSkill = new Map<string, CompiledSearchPhrase[]>();
  const fuzzyOccupation = new Map<string, CompiledSearchPhrase[]>();
  const fuzzyTitle = new Map<string, CompiledSearchPhrase[]>();
  const fuzzySkill = new Map<string, CompiledSearchPhrase[]>();
  const addOccupationPhrase = (
    occupation: OccupationDefinition,
    phrase: string,
    kind: CompiledSearchPhrase["kind"],
    language: CompiledSearchPhrase["language"],
    facetIds: readonly string[],
    weight: number,
  ) => {
    const normalizedPhrase = normalizeSearchText(phrase, 160);
    const compiled = Object.freeze({
      phrase,
      normalizedPhrase,
      compactPhrase: compact(normalizedPhrase),
      occupationId: occupation.occupationId,
      kind,
      language,
      facetIds: immutableArray(facetIds),
      roleIds: immutableArray(
        catalog.genericRoleTerms
          .filter((term) => phraseOccursInText(phrase, term.phrase))
          .map((term) => term.role)
          .filter((role, index, roles) => roles.indexOf(role) === index)
          .sort(),
      ),
      weight,
    } satisfies CompiledSearchPhrase);
    occupationPhrases.push(compiled);
    addLookup(exactOccupation, compiled);
    for (const gram of fuzzyNgrams(compiled.compactPhrase)) {
      const matches = fuzzyOccupation.get(gram) ?? [];
      matches.push(compiled);
      fuzzyOccupation.set(gram, matches);
    }
  };
  for (const occupation of catalog.occupations) {
    for (const title of occupation.canonicalTitles) {
      addOccupationPhrase(
        occupation,
        title.phrase,
        "CANONICAL",
        title.language,
        title.facetIds,
        title.weight,
      );
    }
    for (const alias of occupation.aliases) {
      addOccupationPhrase(
        occupation,
        alias.phrase,
        alias.kind === "IRREGULAR" ? "IRREGULAR_ALIAS" : alias.kind,
        alias.language,
        alias.facetIds,
        alias.weight,
      );
    }
    for (const title of occupation.relatedTitles) {
      addOccupationPhrase(
        occupation,
        title.phrase,
        "RELATED_TITLE",
        title.language,
        title.facetIds,
        title.weight,
      );
    }
  }

  const addTitlePhrase = (
    title: BilingualJobTitleDefinition,
    phrase: string,
    kind: Extract<
      CompiledSearchPhrase["kind"],
      "TITLE_CANONICAL" | "TITLE_ALIAS" | "TITLE_ABBREVIATION"
    >,
    language: CompiledSearchPhrase["language"],
    weight: number,
    excluded = false,
  ) => {
    const normalizedPhrase = normalizeSearchText(phrase, 160);
    if (!normalizedPhrase) return;
    const compiled = Object.freeze({
      phrase,
      normalizedPhrase,
      compactPhrase: compact(normalizedPhrase),
      ...(title.occupationId ? { occupationId: title.occupationId } : {}),
      titleId: title.titleId,
      kind: excluded ? ("TITLE_EXCLUDED" as const) : kind,
      language,
      facetIds: immutableArray(title.facetIds),
      roleIds: immutableArray(
        catalog.genericRoleTerms
          .filter((term) => phraseOccursInText(phrase, term.phrase))
          .map((term) => term.role)
          .filter((role, index, roles) => roles.indexOf(role) === index)
          .sort(),
      ),
      weight,
    } satisfies CompiledSearchPhrase);
    if (excluded) {
      excludedTitlePhrases.push(compiled);
      addLookup(exactExcludedTitle, compiled);
      return;
    }
    titlePhrases.push(compiled);
    addLookup(exactTitle, compiled);
    for (const gram of fuzzyNgrams(compiled.compactPhrase)) {
      const matches = fuzzyTitle.get(gram) ?? [];
      matches.push(compiled);
      fuzzyTitle.set(gram, matches);
    }
  };
  for (const title of titles) {
    addTitlePhrase(title, title.canonical.vi, "TITLE_CANONICAL", "vi", 100);
    addTitlePhrase(title, title.canonical.en, "TITLE_CANONICAL", "en", 100);
    for (const phrase of title.aliases.vi) {
      addTitlePhrase(title, phrase, "TITLE_ALIAS", "vi", 90);
    }
    for (const phrase of title.aliases.en) {
      addTitlePhrase(title, phrase, "TITLE_ALIAS", "en", 90);
    }
    for (const phrase of title.abbreviations) {
      addTitlePhrase(title, phrase, "TITLE_ABBREVIATION", "neutral", 70);
    }
    for (const phrase of title.excludedTerms) {
      addTitlePhrase(title, phrase, "TITLE_ALIAS", "neutral", 0, true);
    }
  }
  for (const facet of catalog.facets) {
    for (const phrase of facet.positiveTerms) {
      const normalizedPhrase = normalizeSearchText(phrase, 160);
      const compiled = Object.freeze({
        phrase,
        normalizedPhrase,
        compactPhrase: compact(normalizedPhrase),
        facetId: facet.facetId,
        kind: "FACET" as const,
        language: "neutral" as const,
        facetIds: immutableArray([facet.facetId]),
        roleIds: immutableArray([]),
        weight: 60,
      });
      facetPhrases.push(compiled);
      addLookup(exactFacet, compiled);
    }
  }
  for (const skill of catalog.skills) {
    for (const phrase of skill.phrases) {
      const normalizedPhrase = normalizeSearchText(phrase, 100);
      skillPhrases.push(
        Object.freeze({
          phrase,
          normalizedPhrase,
          compactPhrase: compact(normalizedPhrase),
          skillId: skill.skillId,
          kind: "SKILL" as const,
          language: "neutral" as const,
          facetIds: immutableArray([]),
          roleIds: immutableArray([]),
          weight: 45,
        }),
      );
      const compiled = skillPhrases[skillPhrases.length - 1]!;
      addLookup(exactSkill, compiled);
      for (const gram of fuzzyNgrams(compiled.compactPhrase)) {
        const matches = fuzzySkill.get(gram) ?? [];
        matches.push(compiled);
        fuzzySkill.set(gram, matches);
      }
    }
  }
  for (const term of catalog.genericRoleTerms) {
    const normalizedPhrase = normalizeSearchText(term.phrase, 80);
    genericPhrases.push(
      Object.freeze({
        phrase: term.phrase,
        normalizedPhrase,
        compactPhrase: compact(normalizedPhrase),
        kind: "GENERIC_ROLE" as const,
        language: term.language,
        facetIds: immutableArray([]),
        roleIds: immutableArray([term.role]),
        weight: 20,
      }),
    );
  }

  const index: SearchCatalogIndex = Object.freeze({
    version: catalog.version,
    catalog,
    occupations: catalog.occupations,
    facets: catalog.facets,
    genericRoleTerms: catalog.genericRoleTerms,
    skills: catalog.skills,
    occupationById: (occupationId) => occupationsById.get(occupationId),
    facetById: (facetId) => facetsById.get(facetId),
    occupationIdsForIndustry: (industryCode) =>
      occupationIdsByIndustry.get(industryCode) ?? [],
    occupationIdsForCategory: (categoryId) =>
      occupationIdsByCategory.get(categoryId) ?? [],
    occupationPhrases: () => immutableArray(occupationPhrases),
    facetPhrases: () => immutableArray(facetPhrases),
    skillPhrases: () => immutableArray(skillPhrases),
    exactSkillPhraseMatches: (value) => {
      const normalized = normalizeSearchText(value, 100);
      return dedupeMatches([
        ...(exactSkill.get(normalized) ?? []),
        ...(exactSkill.get(compact(normalized)) ?? []),
      ]);
    },
    fuzzySkillPhraseCandidates: (value) => {
      const normalized = normalizeSearchText(value, 100);
      const compactValue = compact(normalized);
      if (compactValue.length < 4) return immutableArray([]);
      const matches = new Map<string, CompiledSearchPhrase>();
      for (const gram of fuzzyNgrams(compactValue)) {
        for (const match of fuzzySkill.get(gram) ?? []) {
          const key = `${match.skillId ?? ""}\u0000${match.compactPhrase}`;
          matches.set(key, match);
        }
      }
      return dedupeMatches([...matches.values()]);
    },
    genericPhrases: () => immutableArray(genericPhrases),
    titlePhrases: () => immutableArray(titlePhrases),
    excludedTitlePhrases: () => immutableArray(excludedTitlePhrases),
    titleById: (titleId) => titlesById.get(titleId),
    titlesForOccupation: (occupationId) =>
      immutableArray(titlesByOccupation.get(occupationId) ?? []),
    fuzzyOccupationPhraseCandidates: (value) => {
      const normalized = normalizeSearchText(value, 160);
      const compactValue = compact(normalized);
      if (compactValue.length < 4) return immutableArray([]);

      const matches = new Map<string, CompiledSearchPhrase>();
      for (const gram of fuzzyNgrams(compactValue)) {
        for (const match of fuzzyOccupation.get(gram) ?? []) {
          const key = `${match.occupationId ?? ""}\u0000${match.compactPhrase}`;
          matches.set(key, match);
        }
      }
      return dedupeMatches([...matches.values()]);
    },
    exactOccupationPhraseMatches: (value) => {
      const normalized = normalizeSearchText(value, 160);
      return dedupeMatches([
        ...(exactOccupation.get(normalized) ?? []),
        ...(exactOccupation.get(compact(normalized)) ?? []),
      ]);
    },
    exactFacetPhraseMatches: (value) => {
      const normalized = normalizeSearchText(value, 160);
      return dedupeMatches([
        ...(exactFacet.get(normalized) ?? []),
        ...(exactFacet.get(compact(normalized)) ?? []),
      ]);
    },
    exactTitlePhraseMatches: (value) => {
      const normalized = normalizeSearchText(value, 160);
      return dedupeMatches([
        ...(exactTitle.get(normalized) ?? []),
        ...(exactTitle.get(compact(normalized)) ?? []),
      ]);
    },
    exactExcludedTitlePhraseMatches: (value) => {
      const normalized = normalizeSearchText(value, 160);
      return dedupeMatches([
        ...(exactExcludedTitle.get(normalized) ?? []),
        ...(exactExcludedTitle.get(compact(normalized)) ?? []),
      ]);
    },
    fuzzyTitlePhraseCandidates: (value) => {
      const normalized = normalizeSearchText(value, 160);
      const compactValue = compact(normalized);
      if (compactValue.length < 4) return immutableArray([]);

      const matches = new Map<string, CompiledSearchPhrase>();
      for (const gram of fuzzyNgrams(compactValue)) {
        for (const match of fuzzyTitle.get(gram) ?? []) {
          const key = `${match.titleId ?? ""}\u0000${match.compactPhrase}`;
          matches.set(key, match);
        }
      }
      return dedupeMatches([...matches.values()]);
    },
    intentSchema: createJobSearchIntentSchema({
      occupationIds: new Set(occupationsById.keys()),
      titleIds: new Set(titlesById.keys()),
      facets: facetsById,
    }),
  });
  compiledIndexByVersion.set(catalog.version, index);
  return index;
}

export const jobSearchCatalogIndex =
  compileSearchCatalogIndex(jobSearchCatalog);
