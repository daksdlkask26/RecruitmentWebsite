import "server-only";

import {
  PrismaCompanyDiscoveryRepository,
  type CompanySearchSuggestionRow,
} from "@/backend/repositories/companies/prisma-company-discovery-repository";
import {
  normalizeSearchText,
  searchTextTokens,
} from "@/backend/services/jobs/search-normalization";
import {
  jobSearchCatalogIndex,
  type SearchCatalogIndex,
} from "./catalogs/job-search-catalog-index";
import {
  resolveSearchTypo,
  type SearchTypoResolution,
} from "./search-typo-engine";
import { classifySearchToken } from "./search-token-policy";
import {
  searchSuggestionsResponseSchema,
  type SearchSuggestion,
  type SearchSuggestionScope,
  type SearchSuggestionsResponse,
} from "@/shared/contracts/search/search-suggestions";

const MIN_AUTOCOMPLETE_LENGTH = 2;

function compact(value: string) {
  return value.replace(/\s+/gu, "");
}

function matchScore(query: string, value: string) {
  const normalizedQuery = normalizeSearchText(query, 160);
  const normalizedValue = normalizeSearchText(value, 160);
  if (!normalizedQuery || !normalizedValue) return 0;
  const compactQuery = compact(normalizedQuery);
  const compactValue = compact(normalizedValue);
  if (normalizedValue === normalizedQuery) return 1_000;
  if (compactValue === compactQuery) return 960;
  const queryTokens = searchTextTokens(normalizedQuery);
  const restrictedToken = queryTokens.some((token) => {
    const kind = classifySearchToken(token);
    return kind !== "SAFE_WORD" && kind !== "STOPWORD";
  });
  if (restrictedToken) {
    const valueTokens = searchTextTokens(normalizedValue);
    if (
      !queryTokens.every((token) =>
        valueTokens.some((part) => part === token || part.startsWith(token)),
      )
    ) {
      return 0;
    }
  }
  if (normalizedValue.startsWith(normalizedQuery)) return 900;
  if (compactValue.startsWith(compactQuery)) return 860;
  if (normalizedValue.includes(normalizedQuery)) return 760;
  if (compactValue.includes(compactQuery)) return 720;
  if (
    normalizedQuery
      .split(/\s+/u)
      .filter(Boolean)
      .every((token) =>
        normalizedValue.split(/\s+/u).some((part) => part.startsWith(token)),
      )
  ) {
    return 680;
  }
  return 0;
}

function typoScore(
  value: string,
  suggestion: SearchSuggestion,
  typo: SearchTypoResolution | undefined,
) {
  if (!typo) return 0;
  if (
    typo.matchedPhrase?.titleId &&
    suggestion.type === "TITLE" &&
    suggestion.id === typo.matchedPhrase.titleId
  ) {
    return typo.confidence === "HIGH" ? 850 : 790;
  }
  if (
    typo.matchedPhrase?.skillId &&
    suggestion.type === "SKILL" &&
    suggestion.id === typo.matchedPhrase.skillId
  ) {
    return typo.confidence === "HIGH" ? 850 : 790;
  }
  if (
    typo.matchedPhrase?.occupationId &&
    ((suggestion.type === "OCCUPATION" &&
      suggestion.id === typo.matchedPhrase.occupationId) ||
      suggestion.type === "TITLE")
  ) {
    return typo.confidence === "HIGH" ? 820 : 770;
  }
  const corrected = Math.max(
    matchScore(typo.to, value),
    matchScore(typo.correctedQuery, value),
  );
  if (!corrected) return 0;
  return (
    (typo.confidence === "HIGH" ? 700 : 640) + Math.min(100, corrected / 20)
  );
}

function rankSuggestion(
  query: string,
  suggestion: SearchSuggestion,
  searchable: readonly string[],
  typePriority: number,
  typo?: SearchTypoResolution,
) {
  const score = Math.max(
    ...searchable.map((value) =>
      Math.max(matchScore(query, value), typoScore(value, suggestion, typo)),
    ),
  );
  return score ? score - typePriority : 0;
}

function localizedLabel(value: string) {
  return { labelVi: value, labelEn: value };
}

function jobSuggestions(
  query: string,
  limit: number,
  catalogIndex: SearchCatalogIndex,
) {
  const typo = resolveSearchTypo(query, catalogIndex);
  const candidates: Array<{
    suggestion: SearchSuggestion;
    searchable: readonly string[];
    typePriority: number;
  }> = [];
  for (const title of catalogIndex.catalog.titleDefinitions ?? []) {
    const occupation = title.occupationId
      ? catalogIndex.occupationById(title.occupationId)
      : undefined;
    candidates.push({
      suggestion: {
        id: title.titleId,
        type: "TITLE",
        labelVi: title.canonical.vi,
        labelEn: title.canonical.en,
        ...(occupation
          ? {
              secondaryLabelVi: occupation.labels.vi,
              secondaryLabelEn: occupation.labels.en,
            }
          : {}),
      },
      searchable: [
        title.canonical.vi,
        title.canonical.en,
        ...title.aliases.vi,
        ...title.aliases.en,
        ...title.abbreviations,
      ],
      typePriority: 0,
    });
  }
  for (const occupation of catalogIndex.occupations) {
    candidates.push({
      suggestion: {
        id: occupation.occupationId,
        type: "OCCUPATION",
        labelVi: occupation.labels.vi,
        labelEn: occupation.labels.en,
        secondaryLabelVi: occupation.industryCode,
        secondaryLabelEn: occupation.industryCode,
      },
      searchable: [
        occupation.labels.vi,
        occupation.labels.en,
        ...occupation.canonicalTitles.map((title) => title.phrase),
        ...occupation.aliases.map((alias) => alias.phrase),
      ],
      // Keep the occupation umbrella visible when the active release adds
      // many translated title variants with the same prefix (for example
      // `kế toán ...`). Specific titles still win on an exact full match, but
      // the parent occupation must not be pushed out of a bounded suggestion
      // page by its own children.
      typePriority: 0,
    });
  }
  for (const skill of catalogIndex.skills) {
    const [firstPhrase] = skill.phrases;
    if (!firstPhrase) continue;
    const labels = localizedLabel(firstPhrase);
    candidates.push({
      suggestion: {
        id: skill.skillId,
        type: "SKILL",
        ...labels,
      },
      searchable: skill.phrases,
      typePriority: 40,
    });
  }

  return candidates
    .map((candidate) => ({
      ...candidate,
      score: rankSuggestion(
        query,
        candidate.suggestion,
        candidate.searchable,
        candidate.typePriority,
        typo,
      ),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.suggestion.type.localeCompare(right.suggestion.type) ||
        left.suggestion.id.localeCompare(right.suggestion.id),
    )
    .slice(0, limit)
    .map(({ suggestion }) => suggestion);
}

function companySuggestions(
  query: string,
  rows: readonly CompanySearchSuggestionRow[],
  limit: number,
) {
  const suggestions: Array<{
    suggestion: SearchSuggestion;
    searchable: readonly string[];
    typePriority: number;
  }> = [];
  const seenCompanies = new Set<string>();
  const seenIndustries = new Set<string>();
  const seenLocations = new Set<string>();
  for (const row of rows) {
    if (!seenCompanies.has(row.id)) {
      seenCompanies.add(row.id);
      suggestions.push({
        suggestion: {
          id: `company:${row.id}`,
          type: "COMPANY",
          labelVi: row.displayName,
          labelEn: row.displayName,
        },
        searchable: [row.displayName],
        typePriority: 0,
      });
    }
    if (row.industry?.trim()) {
      const industry = row.industry.trim();
      const key = normalizeSearchText(industry, 160);
      if (!seenIndustries.has(key)) {
        seenIndustries.add(key);
        suggestions.push({
          suggestion: {
            id: `industry:${key}`,
            type: "INDUSTRY",
            labelVi: industry,
            labelEn: industry,
          },
          searchable: [industry],
          typePriority: 20,
        });
      }
    }
    if (row.publicLocation?.trim()) {
      const location = row.publicLocation.trim();
      const key = normalizeSearchText(location, 160);
      if (!seenLocations.has(key)) {
        seenLocations.add(key);
        suggestions.push({
          suggestion: {
            id: `location:${key}`,
            type: "LOCATION",
            labelVi: location,
            labelEn: location,
          },
          searchable: [location],
          typePriority: 30,
        });
      }
    }
  }
  return suggestions
    .map((candidate) => ({
      ...candidate,
      score: rankSuggestion(
        query,
        candidate.suggestion,
        candidate.searchable,
        candidate.typePriority,
      ),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.suggestion.type.localeCompare(right.suggestion.type) ||
        left.suggestion.id.localeCompare(right.suggestion.id),
    )
    .slice(0, limit)
    .map(({ suggestion }) => suggestion);
}

export async function listSearchSuggestions(input: {
  scope: SearchSuggestionScope;
  q: string;
  limit: number;
  catalogIndex?: SearchCatalogIndex;
}): Promise<SearchSuggestionsResponse> {
  const query = normalizeSearchText(input.q, 160);
  const compactQuery = compact(query);
  const suggestions =
    compactQuery.length < MIN_AUTOCOMPLETE_LENGTH
      ? []
      : input.scope === "JOBS"
        ? jobSuggestions(
            query,
            input.limit,
            input.catalogIndex ?? jobSearchCatalogIndex,
          )
        : companySuggestions(
            query,
            await new PrismaCompanyDiscoveryRepository().suggest(
              query,
              input.limit,
            ),
            input.limit,
          );
  return searchSuggestionsResponseSchema.parse({
    scope: input.scope,
    query: input.q.trim().slice(0, 160),
    suggestions,
    ...(input.scope === "JOBS"
      ? {
          catalogVersion: (input.catalogIndex ?? jobSearchCatalogIndex).version,
        }
      : {}),
  });
}
