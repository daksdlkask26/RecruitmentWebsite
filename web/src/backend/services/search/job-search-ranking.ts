import "server-only";

import {
  normalizeSearchText,
  searchTextTokens,
} from "@/backend/services/jobs/search-normalization";
import type { JobSearchIntent } from "@/shared/contracts/search/job-search-intent";
import {
  jobSearchCatalogIndex,
  type SearchCatalogIndex,
} from "./catalogs/job-search-catalog-index";
import type {
  SearchQueryVariant,
  SearchVariantSource,
} from "./search-query-resolver";

export const SEARCH_RANKING_WEIGHTS = {
  requiredFacet: 42,
  completeRequiredFacets: 110,
  preferredFacet: 30,
  excludedFacet: -45,
  negativeTerm: -40,
} as const;

export type SearchVariantTitleWeights = Readonly<{
  exact: number;
  starts: number;
  tokens: number;
  similarity: number;
}>;

export function searchVariantTitleWeights(
  source: SearchVariantSource,
): SearchVariantTitleWeights {
  return source === "ORIGINAL"
    ? { exact: 100, starts: 90, tokens: 80, similarity: 20 }
    : source === "TYPO_CORRECTION"
      ? { exact: 95, starts: 85, tokens: 76, similarity: 18 }
      : source === "RELATED_TITLE"
        ? { exact: 75, starts: 68, tokens: 64, similarity: 16 }
        : { exact: 65, starts: 58, tokens: 56, similarity: 14 };
}

export type SearchRankingSignals = Readonly<{
  requiredFacetIds: readonly string[];
  preferredFacetIds: readonly string[];
  excludedFacetIds: readonly string[];
  negativeTerms: readonly string[];
}>;

function unique(values: readonly (string | undefined)[]) {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

function rankingSignals(
  variant: SearchQueryVariant,
  intent: JobSearchIntent | undefined,
  index: SearchCatalogIndex,
): SearchRankingSignals {
  const requiredFacetIds = unique([
    ...(intent?.requiredFacetIds ?? []),
    ...(variant.requiredFacetIds ?? []),
  ]);
  const preferredFacetIds = unique([
    ...(intent?.preferredFacetIds ?? []),
    ...(variant.requiredFacetIds ?? []),
  ]).filter((facetId) => !requiredFacetIds.includes(facetId));
  const desired = new Set([...requiredFacetIds, ...preferredFacetIds]);
  const conflicts = [...desired].flatMap(
    (facetId) =>
      index
        .facetById(facetId)
        ?.conflictFacetIds.filter((conflictId) => !desired.has(conflictId)) ??
      [],
  );
  const explicitlyExcluded = unique([
    ...(intent?.excludedFacetIds ?? []),
    ...(variant.excludedFacetIds ?? []),
  ]);
  const excludedFacetIds = unique([...explicitlyExcluded, ...conflicts]);
  const occupation = variant.occupationId
    ? index.occupationById(variant.occupationId)
    : undefined;
  return {
    requiredFacetIds,
    preferredFacetIds,
    excludedFacetIds,
    negativeTerms: occupation?.negativeTerms ?? [],
  };
}

export function getSearchRankingSignals(
  variant: SearchQueryVariant,
  intent?: JobSearchIntent,
  index: SearchCatalogIndex = jobSearchCatalogIndex,
) {
  return rankingSignals(variant, intent, index);
}

function containsPhrase(title: string, phrase: string) {
  return title.includes(normalizeSearchText(phrase, 160));
}

function containsAllPhrases(title: string, phrases: readonly string[]) {
  return phrases.every((phrase) => containsPhrase(title, phrase));
}

function containsFacet(
  title: string,
  facetId: string,
  index: SearchCatalogIndex,
) {
  const facet = index.facetById(facetId);
  return Boolean(
    facet?.positiveTerms.some((term) => containsPhrase(title, term)),
  );
}

function containsAnyNegativeTerm(title: string, terms: readonly string[]) {
  return terms.some((term) => containsPhrase(title, term));
}

function containsTitleIdentity(
  title: string,
  titleId: string,
  index: SearchCatalogIndex,
) {
  return index
    .titlePhrases()
    .some(
      (phrase) =>
        phrase.titleId === titleId &&
        (containsPhrase(title, phrase.normalizedPhrase) ||
          normalizeSearchText(title, 200) === phrase.normalizedPhrase),
    );
}

/**
 * Deterministic title-only policy used by ranking tests and local diagnostics.
 * The production repository applies the same signals in parameterized SQL;
 * keeping this evaluator small makes the expected ordering independently
 * testable without requiring a database fixture.
 */
export function scoreSearchTitle(
  title: string,
  variant: SearchQueryVariant,
  intent?: JobSearchIntent,
  index: SearchCatalogIndex = jobSearchCatalogIndex,
) {
  const normalizedTitle = normalizeSearchText(title, 200);
  const normalizedValue = normalizeSearchText(variant.value, 160);
  const weights = searchVariantTitleWeights(variant.source);
  const valueTokens = searchTextTokens(normalizedValue);
  let score = 0;
  const titleIds = [
    ...(variant.titleId ? [variant.titleId] : []),
    ...(intent?.titleCandidates?.map((candidate) => candidate.titleId) ?? []),
  ];
  const matchedTitleIdentity = titleIds.some((titleId) =>
    containsTitleIdentity(normalizedTitle, titleId, index),
  );
  if (matchedTitleIdentity) {
    score += variant.titleId ? 320 : 280;
  }
  if (normalizedTitle === normalizedValue) score += weights.exact;
  if (normalizedTitle.startsWith(normalizedValue)) score += weights.starts;
  if (containsAllPhrases(normalizedTitle, valueTokens)) score += weights.tokens;

  const signals = rankingSignals(variant, intent, index);
  const matchedRequired = signals.requiredFacetIds.filter((facetId) =>
    containsFacet(normalizedTitle, facetId, index),
  );
  score += matchedRequired.length * SEARCH_RANKING_WEIGHTS.requiredFacet;
  if (
    matchedRequired.length === signals.requiredFacetIds.length &&
    signals.requiredFacetIds.length
  ) {
    score += SEARCH_RANKING_WEIGHTS.completeRequiredFacets;
  }
  score +=
    signals.preferredFacetIds.filter((facetId) =>
      containsFacet(normalizedTitle, facetId, index),
    ).length * SEARCH_RANKING_WEIGHTS.preferredFacet;
  score +=
    signals.excludedFacetIds.filter((facetId) =>
      containsFacet(normalizedTitle, facetId, index),
    ).length * SEARCH_RANKING_WEIGHTS.excludedFacet;
  if (containsAnyNegativeTerm(normalizedTitle, signals.negativeTerms)) {
    score += SEARCH_RANKING_WEIGHTS.negativeTerm;
  }
  return score * (variant.source === "TYPO_CORRECTION" ? 0.85 : 1);
}

export type SearchRankingCandidate = Readonly<{
  id: string;
  title: string;
  publishedAt?: string | Date;
}>;

export type HybridSearchCandidate = Readonly<{
  id: string;
  lexicalScore: number;
  semanticScore?: number;
  exactTitle?: boolean;
  publishedAt?: string | Date;
  companyId?: string;
  titleId?: string;
}>;

/**
 * Merge an optional semantic candidate set without allowing it to outrank an
 * exact title match. Scores are deliberately bounded and deterministic so the
 * semantic provider cannot become the sole ranking decision.
 */
export function mergeHybridSearchCandidates<T extends HybridSearchCandidate>(
  candidates: readonly T[],
) {
  return [...candidates].sort((left, right) => {
    if (Boolean(right.exactTitle) !== Boolean(left.exactTitle))
      return (
        Number(Boolean(right.exactTitle)) - Number(Boolean(left.exactTitle))
      );
    const leftScore =
      Math.max(0, Math.min(1, left.lexicalScore)) * 0.8 +
      Math.max(0, Math.min(1, left.semanticScore ?? 0)) * 0.2;
    const rightScore =
      Math.max(0, Math.min(1, right.lexicalScore)) * 0.8 +
      Math.max(0, Math.min(1, right.semanticScore ?? 0)) * 0.2;
    return (
      rightScore - leftScore ||
      String(right.publishedAt ?? "").localeCompare(
        String(left.publishedAt ?? ""),
      ) ||
      left.id.localeCompare(right.id)
    );
  });
}

export function diversifySearchCandidates<T extends HybridSearchCandidate>(
  candidates: readonly T[],
  limit = 20,
  caps: { company?: number; title?: number } = {},
) {
  const companyCap = caps.company ?? 3;
  const titleCap = caps.title ?? 3;
  const companyCounts = new Map<string, number>();
  const titleCounts = new Map<string, number>();
  const selected: T[] = [];
  const deferred: T[] = [];
  for (const candidate of candidates) {
    const companyCount = candidate.companyId
      ? (companyCounts.get(candidate.companyId) ?? 0)
      : 0;
    const titleCount = candidate.titleId
      ? (titleCounts.get(candidate.titleId) ?? 0)
      : 0;
    const capped = companyCount >= companyCap || titleCount >= titleCap;
    if (capped && !candidate.exactTitle) {
      deferred.push(candidate);
      continue;
    }
    selected.push(candidate);
    if (candidate.companyId)
      companyCounts.set(candidate.companyId, companyCount + 1);
    if (candidate.titleId) titleCounts.set(candidate.titleId, titleCount + 1);
    if (selected.length >= limit) return selected;
  }
  for (const candidate of deferred) {
    if (selected.length >= limit) break;
    selected.push(candidate);
  }
  return selected;
}

export function rankSearchCandidates(
  candidates: readonly SearchRankingCandidate[],
  variants: SearchQueryVariant | readonly SearchQueryVariant[],
  intent?: JobSearchIntent,
  index: SearchCatalogIndex = jobSearchCatalogIndex,
) {
  const variantList = Array.isArray(variants) ? variants : [variants];
  if (!variantList.length) {
    return [...candidates].sort((left, right) => {
      const rightPublished = right.publishedAt
        ? new Date(right.publishedAt).getTime()
        : 0;
      const leftPublished = left.publishedAt
        ? new Date(left.publishedAt).getTime()
        : 0;
      return rightPublished - leftPublished || left.id.localeCompare(right.id);
    });
  }
  return candidates
    .map((candidate) => ({
      candidate,
      score: Math.max(
        ...variantList.map((variant) =>
          scoreSearchTitle(candidate.title, variant, intent, index),
        ),
      ),
    }))
    .sort((left, right) => {
      const scoreDifference = right.score - left.score;
      if (scoreDifference) return scoreDifference;
      const rightPublished = right.candidate.publishedAt
        ? new Date(right.candidate.publishedAt).getTime()
        : 0;
      const leftPublished = left.candidate.publishedAt
        ? new Date(left.candidate.publishedAt).getTime()
        : 0;
      return (
        rightPublished - leftPublished ||
        left.candidate.id.localeCompare(right.candidate.id)
      );
    })
    .map(({ candidate }) => candidate);
}
