import "server-only";

import { createHash } from "node:crypto";

import {
  normalizeSearchText,
  compactSearchText,
  foldSearchText,
  searchTextTokens,
} from "@/backend/services/jobs/search-normalization";
import {
  jobSearchCatalogIndex,
  type CompiledSearchPhrase,
  type SearchCatalogIndex,
} from "./catalogs/job-search-catalog-index";
import { JOB_SEARCH_CATALOG_VERSION } from "./catalogs/job-search-catalog";
import type {
  BilingualJobTitleDefinition,
  JobSearchIntent,
  OccupationDefinition,
} from "@/shared/contracts/search/job-search-intent";
import type {
  SearchConfidence,
  SearchInterpretation,
  SearchInterpretationReason,
  SearchMode,
} from "@/shared/contracts/search/search-interpretation";
import {
  resolveSearchTypo,
  type SearchTypoResolution,
} from "./search-typo-engine";
import { searchReleaseFlags } from "./search-release-flags";

export type SearchContext = "JOBS" | "COMPANIES";
export type SearchVariantSource =
  | "ORIGINAL"
  | "VIETNAMESE_ALIAS"
  | "TYPO_CORRECTION"
  | "RELATED_TITLE";
export type { SearchConfidence, SearchInterpretation };

export type SearchQueryVariant = Readonly<{
  value: string;
  source: SearchVariantSource;
  confidence: SearchConfidence;
  occupationId?: string;
  titleId?: string;
  matchedSpan?: string;
  retainedTerms?: readonly string[];
  requiredFacetIds?: readonly string[];
  excludedFacetIds?: readonly string[];
}>;

type SearchCorrection = Readonly<{
  from: string;
  to: string;
  confidence: SearchConfidence;
}>;

export type ResolveSearchQueryOptions = Readonly<{
  correctionTerms?: readonly string[];
  allowOccupationExpansion?: boolean;
  catalogIndex?: SearchCatalogIndex;
}>;

export type ResolvedSearchQuery = Readonly<{
  rawQuery: string;
  normalizedQuery: string;
  foldedQuery: string;
  compactQuery: string;
  effectiveQuery: string;
  variants: SearchQueryVariant[];
  correction?: SearchCorrection;
  usedFallback: boolean;
  resolverVersion: string;
  interpretation: SearchInterpretation;
  intent?: JobSearchIntent;
}>;

const RESOLVER_SUFFIX = ":resolver-8";

function boundedResolverVersion(catalogVersion: string) {
  const plain = `${catalogVersion}${RESOLVER_SUFFIX}`;
  if (plain.length <= 64) return plain;

  // Catalog versions are externally persisted and capped at 64 characters.
  // Preserve a readable prefix while hashing the complete value so long
  // versions remain unique and the response contract stays within 64 chars.
  const digest = createHash("sha256")
    .update(catalogVersion)
    .digest("hex")
    .slice(0, 16);
  const prefixLength = 64 - RESOLVER_SUFFIX.length - digest.length - 1;
  return `${catalogVersion.slice(0, prefixLength)}-${digest}${RESOLVER_SUFFIX}`;
}

export const SEARCH_RESOLVER_VERSION = boundedResolverVersion(
  JOB_SEARCH_CATALOG_VERSION,
);

/**
 * Resolver behaviour is compiled against a specific immutable catalog. Keep
 * the algorithm suffix stable while carrying the request's catalog version
 * through every interpretation and response.
 */
export function searchResolverVersion(
  index: SearchCatalogIndex = jobSearchCatalogIndex,
) {
  return boundedResolverVersion(index.version);
}

const companyAliases: Readonly<Record<string, readonly string[]>> = {
  it: ["information technology"],
  "information technology": ["it"],
  danang: ["da nang"],
  "da nang": ["danang"],
  "cong nghe thong tin": ["information technology", "it"],
  "phan mem": ["software", "software development"],
  "tai chinh ngan hang": ["financial services", "banking"],
  "thanh pho ho chi minh": ["ho chi minh city", "hcmc"],
  "ha noi": ["hanoi"],
};

const companyLegalPrefixPattern =
  /^(?:cong ty trach nhiem huu han|cong ty co phan|cong ty|cty tnhh|cty cp|cty|tnhh|co phan|joint stock company)\s+/u;
const companyLegalSuffixPattern =
  /\s+(?:jsc|ltd|limited|corporation|corp|joint stock company)$/u;

function normalizeCompanySearchText(value: string) {
  let normalized = normalizeSearchText(value);
  let previous = "";
  while (normalized && normalized !== previous) {
    previous = normalized;
    normalized = normalized.replace(companyLegalPrefixPattern, "");
    normalized = normalized.replace(companyLegalSuffixPattern, "");
  }
  return normalized.trim();
}

export function companySearchProjection(value: string) {
  return normalizeCompanySearchText(value);
}

function compact(value: string) {
  return value.replace(/\s+/gu, "");
}

function damerauLevenshtein(left: string, right: string) {
  const source = Array.from(left);
  const target = Array.from(right);
  const distance = Array.from({ length: source.length + 1 }, () =>
    Array<number>(target.length + 1).fill(0),
  );
  for (let row = 0; row <= source.length; row += 1) distance[row][0] = row;
  for (let column = 0; column <= target.length; column += 1)
    distance[0][column] = column;
  for (let row = 1; row <= source.length; row += 1) {
    for (let column = 1; column <= target.length; column += 1) {
      const substitution = source[row - 1] === target[column - 1] ? 0 : 1;
      distance[row][column] = Math.min(
        distance[row - 1][column] + 1,
        distance[row][column - 1] + 1,
        distance[row - 1][column - 1] + substitution,
      );
      if (
        row > 1 &&
        column > 1 &&
        source[row - 1] === target[column - 2] &&
        source[row - 2] === target[column - 1]
      ) {
        distance[row][column] = Math.min(
          distance[row][column],
          distance[row - 2][column - 2] + 1,
        );
      }
    }
  }
  return distance[source.length][target.length];
}

function typoThreshold(length: number) {
  if (length < 4) return 0;
  if (length <= 7) return 1;
  return 2;
}

function isFuzzyCandidate(input: string, candidate: string) {
  const inputKey = compact(input);
  const candidateKey = compact(candidate);
  if (inputKey.length < 4 || candidateKey.length < 4) return false;
  const distance = damerauLevenshtein(inputKey, candidateKey);
  const threshold = typoThreshold(
    Math.max(inputKey.length, candidateKey.length),
  );
  return (
    distance > 0 &&
    distance <= threshold &&
    distance / Math.max(inputKey.length, candidateKey.length) <= 0.34
  );
}

/** Location/filter phrases are resolved by the job-search filters, not by the
 * occupation typo engine.  Protecting the common Vietnamese locations here
 * prevents `đà nẵng` from being rewritten to an unrelated title such as
 * `bán hàng` when it appears after a valid occupation. */
const protectedLocationPhrases = new Set([
  "da nang",
  "ha noi",
  "ho chi minh",
  "ho chi minh city",
  "hai phong",
  "can tho",
  "binh duong",
  "dong nai",
  "ba ria vung tau",
]);

function isProtectedLocationSpan(value: string) {
  return protectedLocationPhrases.has(normalizeSearchText(value));
}

function confidenceFor(
  distance: number,
  secondDistance?: number,
): SearchConfidence {
  return !secondDistance || secondDistance - distance >= 2 ? "HIGH" : "MEDIUM";
}

type PhraseOccurrence = Readonly<{
  match: CompiledSearchPhrase;
  occupation: OccupationDefinition;
  start: number;
  end: number;
  querySpan: string;
  distance: number;
  confidence: SearchConfidence;
}>;

type TitlePhraseOccurrence = Readonly<{
  match: CompiledSearchPhrase;
  title: BilingualJobTitleDefinition;
  occupation?: OccupationDefinition;
  start: number;
  end: number;
  querySpan: string;
  distance: number;
  confidence: SearchConfidence;
}>;

type GenericRoleOccurrence = Readonly<{
  match: CompiledSearchPhrase;
  start: number;
  end: number;
  querySpan: string;
  distance: number;
}>;

function phrasePriority(kind: CompiledSearchPhrase["kind"]) {
  const priorities: Record<CompiledSearchPhrase["kind"], number> = {
    // A related title carries more intent than a longer generic alias. This
    // keeps `nhan vien ke toan kho` anchored on `ke toan kho` so the prefix
    // and the warehouse modifier survive the English expansion.
    RELATED_TITLE: 5,
    TITLE_CANONICAL: 7,
    TITLE_ALIAS: 6,
    TITLE_ABBREVIATION: 5,
    TITLE_EXCLUDED: -10,
    CANONICAL: 4,
    ALIAS: 2,
    IRREGULAR_ALIAS: 1,
    ABBREVIATION: 0,
    FACET: 0,
    SKILL: 0,
    GENERIC_ROLE: 0,
  };
  return priorities[kind];
}

function exactTitlePhraseOccurrences(
  query: string,
  index: SearchCatalogIndex,
): TitlePhraseOccurrence[] {
  const tokens = searchTextTokens(query);
  if (!tokens.length) return [];
  const candidates: TitlePhraseOccurrence[] = [];
  for (const match of index.titlePhrases()) {
    if (!match.titleId) continue;
    const title = index.titleById(match.titleId);
    if (!title) continue;
    const phraseTokens = searchTextTokens(match.normalizedPhrase);
    if (!phraseTokens.length || phraseTokens.length > tokens.length) continue;
    for (
      let start = 0;
      start <= tokens.length - phraseTokens.length;
      start += 1
    ) {
      const querySpan = tokens
        .slice(start, start + phraseTokens.length)
        .join(" ");
      if (
        querySpan !== match.normalizedPhrase &&
        compact(querySpan) !== match.compactPhrase
      ) {
        continue;
      }
      candidates.push({
        match,
        title,
        occupation: title.occupationId
          ? index.occupationById(title.occupationId)
          : undefined,
        start,
        end: start + phraseTokens.length,
        querySpan,
        distance: 0,
        confidence: "HIGH",
      });
    }
  }
  candidates.sort(
    (left, right) =>
      left.start - right.start ||
      right.end - right.start - (left.end - left.start) ||
      phrasePriority(right.match.kind) - phrasePriority(left.match.kind) ||
      right.match.compactPhrase.length - left.match.compactPhrase.length ||
      left.title.titleId.localeCompare(right.title.titleId),
  );
  return candidates;
}

function fuzzyTitlePhraseOccurrence(
  query: string,
  index: SearchCatalogIndex,
): TitlePhraseOccurrence | undefined {
  const tokens = searchTextTokens(query);
  const candidates: TitlePhraseOccurrence[] = [];
  for (const match of index.fuzzyTitlePhraseCandidates(query)) {
    if (!match.titleId) continue;
    const title = index.titleById(match.titleId);
    if (!title) continue;
    const phraseTokens = searchTextTokens(match.normalizedPhrase);
    if (phraseTokens.some((token) => compact(token).length < 2)) continue;
    const windowLengths =
      tokens.length === 1 && phraseTokens.length > 1
        ? [1]
        : [phraseTokens.length];
    for (const length of windowLengths) {
      if (length > tokens.length) continue;
      for (let start = 0; start <= tokens.length - length; start += 1) {
        const querySpan = tokens.slice(start, start + length).join(" ");
        const comparable =
          tokens.length === 1 && phraseTokens.length > 1
            ? (tokens[0] ?? "")
            : querySpan;
        if (isProtectedLocationSpan(comparable)) continue;
        if (!isFuzzyCandidate(comparable, match.normalizedPhrase)) continue;
        const distance = damerauLevenshtein(
          compact(comparable),
          compact(match.normalizedPhrase),
        );
        candidates.push({
          match,
          title,
          occupation: title.occupationId
            ? index.occupationById(title.occupationId)
            : undefined,
          start,
          end: start + length,
          querySpan,
          distance,
          confidence: "MEDIUM",
        });
      }
    }
  }
  if (!candidates.length) return undefined;
  candidates.sort(
    (left, right) =>
      left.distance - right.distance ||
      right.end - right.start - (left.end - left.start) ||
      phrasePriority(right.match.kind) - phrasePriority(left.match.kind) ||
      right.match.compactPhrase.length - left.match.compactPhrase.length ||
      left.title.titleId.localeCompare(right.title.titleId),
  );
  const best = candidates[0];
  if (!best) return undefined;
  const secondDistance = candidates.find(
    (candidate) => candidate.title.titleId !== best.title.titleId,
  )?.distance;
  return { ...best, confidence: confidenceFor(best.distance, secondDistance) };
}

function exactOccupationPhraseOccurrences(
  query: string,
  index: SearchCatalogIndex,
): PhraseOccurrence[] {
  const tokens = searchTextTokens(query);
  if (!tokens.length) return [];
  const candidates: PhraseOccurrence[] = [];
  if (tokens.length === 1) {
    for (const match of index.exactOccupationPhraseMatches(query)) {
      const occupation = match.occupationId
        ? index.occupationById(match.occupationId)
        : undefined;
      if (!occupation) continue;
      candidates.push({
        match,
        occupation,
        start: 0,
        end: 1,
        querySpan: query,
        distance: 0,
        confidence: "HIGH",
      });
    }
  }
  for (const match of index.occupationPhrases()) {
    const occupation = match.occupationId
      ? index.occupationById(match.occupationId)
      : undefined;
    if (!occupation) continue;
    const phraseTokens = searchTextTokens(match.normalizedPhrase);
    if (phraseTokens.length > tokens.length) continue;
    for (
      let start = 0;
      start <= tokens.length - phraseTokens.length;
      start += 1
    ) {
      const querySpan = tokens
        .slice(start, start + phraseTokens.length)
        .join(" ");
      if (
        querySpan !== match.normalizedPhrase &&
        compact(querySpan) !== match.compactPhrase
      )
        continue;
      candidates.push({
        match,
        occupation,
        start,
        end: start + phraseTokens.length,
        querySpan,
        distance: 0,
        confidence: "HIGH",
      });
    }
  }
  candidates.sort(
    (left, right) =>
      left.start - right.start ||
      right.end - right.start - (left.end - left.start) ||
      phrasePriority(right.match.kind) - phrasePriority(left.match.kind) ||
      right.match.compactPhrase.length - left.match.compactPhrase.length ||
      left.occupation.occupationId.localeCompare(right.occupation.occupationId),
  );
  const selected: PhraseOccurrence[] = [];
  for (const candidate of candidates) {
    if (
      selected.some(
        (other) => candidate.start < other.end && other.start < candidate.end,
      )
    ) {
      continue;
    }
    selected.push(candidate);
  }
  return selected;
}

function exactPhraseOccurrence(
  query: string,
  index: SearchCatalogIndex,
): PhraseOccurrence | undefined {
  return exactOccupationPhraseOccurrences(query, index)[0];
}

function selectOccupationOccurrence(
  exact: PhraseOccurrence | undefined,
  fuzzy: PhraseOccurrence | undefined,
) {
  if (!exact) return fuzzy;
  if (!fuzzy) return exact;
  const exactLength = exact.end - exact.start;
  const fuzzyLength = fuzzy.end - fuzzy.start;
  const fuzzyContainsExact =
    fuzzyLength > exactLength &&
    fuzzy.start <= exact.start &&
    fuzzy.end >= exact.end;

  // An exact sub-phrase must not hide a high-confidence correction for the
  // complete title. This matters for titles such as `Vận hành nhân sự`: a
  // one-character typo must not fall back to the shorter `Nhân sự` occupation.
  // A full exact phrase still always wins over fuzzy matching.
  return fuzzyContainsExact && fuzzy.confidence === "HIGH" ? fuzzy : exact;
}

function genericRoleOccurrences(
  query: string,
  index: SearchCatalogIndex,
): GenericRoleOccurrence[] {
  const tokens = searchTextTokens(query);
  if (!tokens.length) return [];

  const candidates: GenericRoleOccurrence[] = [];
  const seen = new Set<string>();
  const addCandidate = (
    match: CompiledSearchPhrase,
    start: number,
    end: number,
    distance = 0,
  ) => {
    if (!match.roleIds.length) return;
    const key = `${match.normalizedPhrase}\u0000${start}\u0000${end}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({
      match,
      start,
      end,
      querySpan: tokens.slice(start, end).join(" "),
      distance,
    });
  };

  for (const match of index.genericPhrases()) {
    const phraseTokens = searchTextTokens(match.normalizedPhrase);
    if (!phraseTokens.length) continue;

    for (let start = 0; start < tokens.length; start += 1) {
      for (let end = start + 1; end <= tokens.length; end += 1) {
        const querySpan = tokens.slice(start, end).join(" ");
        if (
          querySpan === match.normalizedPhrase ||
          compact(querySpan) === match.compactPhrase
        ) {
          addCandidate(match, start, end);
        }
      }
    }
    if (phraseTokens.length < 2) continue;
    for (
      let start = 0;
      start <= tokens.length - phraseTokens.length;
      start += 1
    ) {
      const querySpan = tokens
        .slice(start, start + phraseTokens.length)
        .join(" ");
      if (isFuzzyCandidate(querySpan, match.normalizedPhrase)) {
        addCandidate(
          match,
          start,
          start + phraseTokens.length,
          damerauLevenshtein(
            compact(querySpan),
            compact(match.normalizedPhrase),
          ),
        );
      }
    }
  }

  candidates.sort(
    (left, right) =>
      left.start - right.start ||
      right.end - right.start - (left.end - left.start) ||
      right.match.weight - left.match.weight ||
      left.match.normalizedPhrase.localeCompare(right.match.normalizedPhrase),
  );
  const selected: GenericRoleOccurrence[] = [];
  for (const candidate of candidates) {
    if (
      selected.some(
        (other) => candidate.start < other.end && other.start < candidate.end,
      )
    ) {
      continue;
    }
    selected.push(candidate);
  }
  return selected;
}

function fuzzyCandidateConflictsWithGenericRole(
  start: number,
  length: number,
  queryTokens: readonly string[],
  phraseTokens: readonly string[],
  candidatePhrase: string,
  protectedGenericRoles: readonly GenericRoleOccurrence[],
) {
  return protectedGenericRoles.some((role) => {
    if (compact(candidatePhrase) === compact(role.match.normalizedPhrase)) {
      return false;
    }
    const overlapStart = Math.max(start, role.start);
    const overlapEnd = Math.min(start + length, role.end);
    for (let index = overlapStart; index < overlapEnd; index += 1) {
      const phraseIndex = index - start;
      if (
        compact(queryTokens[index]) !== compact(phraseTokens[phraseIndex] ?? "")
      ) {
        return true;
      }
    }
    return false;
  });
}

function fuzzyPhraseOccurrence(
  query: string,
  index: SearchCatalogIndex,
  protectedGenericRoles: readonly GenericRoleOccurrence[] = [],
): PhraseOccurrence | undefined {
  const tokens = searchTextTokens(query);
  const candidates: PhraseOccurrence[] = [];
  for (const match of index.fuzzyOccupationPhraseCandidates(query)) {
    const occupation = match.occupationId
      ? index.occupationById(match.occupationId)
      : undefined;
    if (!occupation) continue;
    const phraseTokens = searchTextTokens(match.normalizedPhrase);
    if (phraseTokens.some((token) => compact(token).length < 2)) continue;
    const windowLengths =
      tokens.length === 1 && phraseTokens.length > 1
        ? [1]
        : [phraseTokens.length];
    for (const length of windowLengths) {
      if (length > tokens.length) continue;
      for (let start = 0; start <= tokens.length - length; start += 1) {
        if (
          fuzzyCandidateConflictsWithGenericRole(
            start,
            length,
            tokens,
            phraseTokens,
            match.normalizedPhrase,
            protectedGenericRoles,
          )
        ) {
          continue;
        }
        const querySpan = tokens.slice(start, start + length).join(" ");
        if (isProtectedLocationSpan(querySpan)) continue;
        const comparable =
          tokens.length === 1 && phraseTokens.length > 1
            ? tokens[0]
            : querySpan;
        if (!isFuzzyCandidate(comparable, match.normalizedPhrase)) continue;
        const distance = damerauLevenshtein(
          compact(comparable),
          compact(match.normalizedPhrase),
        );
        candidates.push({
          match,
          occupation,
          start,
          end: start + length,
          querySpan,
          distance,
          confidence: "MEDIUM",
        });
      }
    }
  }
  if (!candidates.length) return undefined;
  const nonContainedCandidates = candidates.filter(
    (candidate) =>
      !candidates.some(
        (other) =>
          other !== candidate &&
          other.start <= candidate.start &&
          other.end >= candidate.end &&
          other.end - other.start > candidate.end - candidate.start &&
          other.distance <= candidate.distance,
      ),
  );
  const rankedCandidates = nonContainedCandidates.length
    ? nonContainedCandidates
    : candidates;
  rankedCandidates.sort(
    (left, right) =>
      left.distance - right.distance ||
      right.end - right.start - (left.end - left.start) ||
      phrasePriority(right.match.kind) - phrasePriority(left.match.kind) ||
      right.match.compactPhrase.length - left.match.compactPhrase.length ||
      left.occupation.occupationId.localeCompare(right.occupation.occupationId),
  );
  const best = rankedCandidates[0];
  const secondDistance = rankedCandidates.find(
    (candidate) =>
      candidate.occupation.occupationId !== best.occupation.occupationId,
  )?.distance;
  return {
    ...best,
    confidence: confidenceFor(best.distance, secondDistance),
  };
}

function replaceOccurrence(
  query: string,
  occurrence: Pick<PhraseOccurrence, "start" | "end">,
  replacement: string,
) {
  const tokens = searchTextTokens(query);
  const replacementTokens = new Set(searchTextTokens(replacement));
  const prefix = tokens
    .slice(0, occurrence.start)
    .filter((token) => !replacementTokens.has(token));
  const suffix = tokens
    .slice(occurrence.end)
    .filter((token) => !replacementTokens.has(token));
  return [...prefix, replacement, ...suffix].join(" ").trim();
}

const semanticConnectorPattern = /\s+(?:and|or)\s+/u;

/**
 * Some clients used to feed the UI-generated expansion back into the search
 * box, for example `accountant and accounting and accounting specialist`.
 * Treat that shape as one occupation intent instead of producing a contextual
 * SQL variant for every repeated alias. Modifiers and unrelated phrases do
 * not satisfy this check, so queries such as `senior accountant` keep their
 * normal context-preserving behavior.
 */
function isRedundantOccupationConnectorQuery(
  query: string,
  occupationId: string,
  index: SearchCatalogIndex,
) {
  const segments = query
    .split(semanticConnectorPattern)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length < 2) return false;

  return segments.every((segment) =>
    index
      .exactOccupationPhraseMatches(segment)
      .some(
        (match) =>
          match.occupationId === occupationId && match.kind !== "RELATED_TITLE",
      ),
  );
}

function phraseOccursInQuery(query: string, phrase: string) {
  if (compact(query) === compact(phrase)) return true;
  const queryTokens = searchTextTokens(query);
  const phraseTokens = searchTextTokens(phrase);
  if (phraseTokens.length > queryTokens.length) return false;
  for (
    let start = 0;
    start <= queryTokens.length - phraseTokens.length;
    start += 1
  ) {
    if (
      queryTokens.slice(start, start + phraseTokens.length).join(" ") === phrase
    )
      return true;
  }
  return false;
}

function queryFacetIds(query: string, index: SearchCatalogIndex) {
  const normalizedQuery = normalizeSearchText(query);
  return [
    ...new Set(
      index
        .facetPhrases()
        .filter((phrase) =>
          phraseOccursInQuery(normalizedQuery, phrase.normalizedPhrase),
        )
        .flatMap((phrase) => (phrase.facetId ? [phrase.facetId] : [])),
    ),
  ].sort();
}

type TokenRange = Readonly<{
  start: number;
  end: number;
}>;

function exactPhraseRanges(
  query: string,
  phrases: readonly CompiledSearchPhrase[],
): TokenRange[] {
  const tokens = searchTextTokens(query);
  const ranges: TokenRange[] = [];
  for (const phrase of phrases) {
    const phraseTokens = searchTextTokens(phrase.normalizedPhrase);
    if (!phraseTokens.length) continue;
    for (let start = 0; start < tokens.length; start += 1) {
      for (let end = start + 1; end <= tokens.length; end += 1) {
        const querySpan = tokens.slice(start, end).join(" ");
        if (
          querySpan === phrase.normalizedPhrase ||
          compact(querySpan) === phrase.compactPhrase
        ) {
          ranges.push({ start, end });
        }
      }
    }
  }
  return ranges;
}

function independentFacetIds(
  query: string,
  genericRoles: readonly GenericRoleOccurrence[],
  index: SearchCatalogIndex,
) {
  const genericRanges = genericRoles.map(({ start, end }) => ({ start, end }));
  return [
    ...new Set(
      index
        .facetPhrases()
        .filter((phrase) => phrase.facetId)
        .filter((phrase) =>
          exactPhraseRanges(query, [phrase]).some(
            (range) =>
              !genericRanges.some(
                (genericRange) =>
                  range.start < genericRange.end &&
                  genericRange.start < range.end,
              ),
          ),
        )
        .flatMap((phrase) => (phrase.facetId ? [phrase.facetId] : [])),
    ),
  ].sort();
}

function compatibleFacetContext(
  requestedFacetIds: readonly string[],
  candidateFacetIds: readonly string[],
  index: SearchCatalogIndex,
) {
  const requested = new Set(requestedFacetIds);
  const candidate = new Set(candidateFacetIds);
  return [...requested, ...candidate].every((facetId) => {
    const facet = index.facetById(facetId);
    return !facet?.conflictFacetIds.some((conflictFacetId) =>
      (requested.has(facetId) ? candidate : requested).has(conflictFacetId),
    );
  });
}

function composedOccupationQuery(
  query: string,
  candidate: CompiledSearchPhrase,
  genericRoles: readonly GenericRoleOccurrence[],
  facetIds: readonly string[],
  index: SearchCatalogIndex,
) {
  const facetRanges = exactPhraseRanges(
    query,
    index
      .facetPhrases()
      .filter((phrase) => phrase.facetId && facetIds.includes(phrase.facetId)),
  );
  const ranges: TokenRange[] = [...genericRoles, ...facetRanges];
  const tokens = searchTextTokens(query);
  const covered = new Set<number>();
  for (const range of ranges) {
    for (let index = range.start; index < range.end; index += 1) {
      covered.add(index);
    }
  }
  const firstCovered = ranges.reduce(
    (first, range) => Math.min(first, range.start),
    tokens.length,
  );
  if (firstCovered === tokens.length) return candidate.normalizedPhrase;

  const value: string[] = [];
  let inserted = false;
  for (let index = 0; index < tokens.length; index += 1) {
    if (covered.has(index)) {
      if (!inserted && index === firstCovered) {
        value.push(candidate.normalizedPhrase);
        inserted = true;
      }
      continue;
    }
    value.push(tokens[index]);
  }
  if (!inserted) value.unshift(candidate.normalizedPhrase);
  return value.join(" ").trim();
}

function facetAwareOccupationVariants(
  query: string,
  genericRoles: readonly GenericRoleOccurrence[],
  facetIds: readonly string[],
  index: SearchCatalogIndex,
): SearchQueryVariant[] {
  if (!genericRoles.length || !facetIds.length) return [];
  if (conflictingFacetIds(facetIds, index).length) return [];

  const requestedRoles = new Set(
    genericRoles.flatMap((occurrence) => occurrence.match.roleIds),
  );
  if (!requestedRoles.size) return [];

  const candidates = index
    .occupationPhrases()
    .filter((phrase) => phrase.kind === "RELATED_TITLE" && phrase.occupationId)
    .filter((phrase) =>
      facetIds.every((facetId) => phrase.facetIds.includes(facetId)),
    )
    .filter((phrase) =>
      phrase.roleIds.some((roleId) => requestedRoles.has(roleId)),
    )
    .filter((phrase) =>
      compatibleFacetContext(facetIds, phrase.facetIds, index),
    )
    .sort(
      (left, right) =>
        right.facetIds.filter((facetId) => facetIds.includes(facetId)).length -
          left.facetIds.filter((facetId) => facetIds.includes(facetId))
            .length ||
        right.roleIds.filter((roleId) => requestedRoles.has(roleId)).length -
          left.roleIds.filter((roleId) => requestedRoles.has(roleId)).length ||
        right.weight - left.weight ||
        left.normalizedPhrase.localeCompare(right.normalizedPhrase) ||
        left.occupationId!.localeCompare(right.occupationId!),
    );
  const seen = new Set<string>();
  const variants: SearchQueryVariant[] = [];
  for (const candidate of candidates) {
    const occupationId = candidate.occupationId!;
    const key = `${occupationId}\u0000${candidate.normalizedPhrase}`;
    if (seen.has(key)) continue;
    seen.add(key);
    addVariant(variants, {
      value: composedOccupationQuery(
        query,
        candidate,
        genericRoles,
        facetIds,
        index,
      ),
      source: "RELATED_TITLE",
      confidence: "HIGH",
      occupationId,
      matchedSpan: query,
      retainedTerms: genericRoles.map((occurrence) => occurrence.querySpan),
      requiredFacetIds: facetIds,
    });
    if (variants.length >= 6) break;
  }
  return variants;
}

function relatedTitleMetadata(
  occupationId: string,
  value: string,
  index: SearchCatalogIndex,
) {
  const normalizedValue = normalizeSearchText(value);
  return index
    .occupationPhrases()
    .find(
      (phrase) =>
        phrase.occupationId === occupationId &&
        phrase.normalizedPhrase === normalizedValue &&
        phrase.kind === "RELATED_TITLE",
    );
}

function hasRequiredFacetContext(
  query: string,
  coreOccurrence: PhraseOccurrence | undefined,
  index: SearchCatalogIndex,
) {
  return Boolean(coreOccurrence && queryFacetIds(query, index).length);
}

function isGenericRoleOnly(query: string, index: SearchCatalogIndex) {
  const tokens = searchTextTokens(query);
  return genericRoleOccurrences(query, index).some(
    (occurrence) =>
      occurrence.distance === 0 &&
      occurrence.start === 0 &&
      occurrence.end === tokens.length,
  );
}

function containedOccupationCoreOccurrence(
  query: string,
  occurrence: PhraseOccurrence,
  index: SearchCatalogIndex,
): PhraseOccurrence | undefined {
  const tokens = searchTextTokens(query);
  const candidates: PhraseOccurrence[] = [];
  for (const match of index.occupationPhrases()) {
    if (
      match.occupationId !== occurrence.occupation.occupationId ||
      match.kind === "RELATED_TITLE" ||
      match.kind === "ABBREVIATION"
    ) {
      continue;
    }
    const occupation = index.occupationById(match.occupationId!);
    if (!occupation) continue;
    const phraseTokens = searchTextTokens(match.normalizedPhrase);
    if (phraseTokens.length >= occurrence.end - occurrence.start) continue;
    const firstStart = occurrence.start;
    const lastStart = occurrence.end - phraseTokens.length;
    for (let start = firstStart; start <= lastStart; start += 1) {
      const querySpan = tokens
        .slice(start, start + phraseTokens.length)
        .join(" ");
      if (querySpan !== match.normalizedPhrase) continue;
      candidates.push({
        match,
        occupation,
        start,
        end: start + phraseTokens.length,
        querySpan,
        distance: 0,
        confidence: "HIGH",
      });
    }
  }
  candidates.sort(
    (left, right) =>
      right.end - right.start - (left.end - left.start) ||
      phrasePriority(right.match.kind) - phrasePriority(left.match.kind),
  );
  const exact = candidates[0];
  if (exact) return exact;

  for (const match of index.occupationPhrases()) {
    if (
      match.occupationId !== occurrence.occupation.occupationId ||
      match.kind === "RELATED_TITLE" ||
      match.kind === "ABBREVIATION"
    ) {
      continue;
    }
    const occupation = index.occupationById(match.occupationId!);
    if (!occupation) continue;
    const phraseTokens = searchTextTokens(match.normalizedPhrase);
    if (phraseTokens.length >= occurrence.end - occurrence.start) continue;
    const lastStart = occurrence.end - phraseTokens.length;
    for (let start = occurrence.start; start <= lastStart; start += 1) {
      const querySpan = tokens
        .slice(start, start + phraseTokens.length)
        .join(" ");
      if (!isFuzzyCandidate(querySpan, match.normalizedPhrase)) continue;
      const distance = damerauLevenshtein(
        compact(querySpan),
        compact(match.normalizedPhrase),
      );
      candidates.push({
        match,
        occupation,
        start,
        end: start + phraseTokens.length,
        querySpan,
        distance,
        confidence: "HIGH",
      });
    }
  }
  return candidates.sort(
    (left, right) =>
      left.distance - right.distance ||
      right.end - right.start - (left.end - left.start) ||
      phrasePriority(right.match.kind) - phrasePriority(left.match.kind),
  )[0];
}

function occupationEnglishVariants(
  occurrence: PhraseOccurrence,
  query: string,
  index: SearchCatalogIndex,
) {
  const occupation = index.occupationById(occurrence.occupation.occupationId);
  if (!occupation) return [];
  const exactTitleVariants = index
    .exactTitlePhraseMatches(query)
    .filter(
      (match) =>
        match.occupationId === occupation.occupationId &&
        Boolean(match.titleId),
    )
    .flatMap((match) => {
      const title = match.titleId ? index.titleById(match.titleId) : undefined;
      return title ? [title.canonical.en] : [];
    });
  const facets = new Set(queryFacetIds(query, index));
  const related = occupation.relatedTitles
    .filter((title) => title.language === "en")
    .map((title) => ({
      title: title.phrase,
      score:
        title.facetIds.filter((facetId) => facets.has(facetId)).length * 1000 +
        title.weight,
    }))
    .filter(
      (title) =>
        occurrence.match.kind === "RELATED_TITLE" ||
        facets.size > 0 ||
        title.score > 0,
    )
    .sort(
      (left, right) =>
        right.score - left.score || left.title.localeCompare(right.title),
    )
    .map((title) => title.title);
  const relatedWithFacetMatch = related.filter((title) => {
    const metadata = relatedTitleMetadata(
      occupation.occupationId,
      title,
      index,
    );
    return metadata?.facetIds.some((facetId) => facets.has(facetId));
  });
  const relatedWithoutFacetMatch = related
    .filter((title) => !relatedWithFacetMatch.includes(title))
    .slice(0, facets.size ? 3 : 0);
  return [
    ...new Set([
      ...exactTitleVariants,
      ...relatedWithFacetMatch,
      occupation.labels.en,
      ...occupation.aliases
        .filter((alias) => alias.language === "en")
        .map((alias) => alias.phrase),
      ...relatedWithoutFacetMatch,
    ]),
  ].slice(0, 7);
}

function addVariant(
  variants: SearchQueryVariant[],
  input: Omit<SearchQueryVariant, "value"> & { value: string },
) {
  const value = normalizeSearchText(input.value);
  if (!value || variants.some((variant) => variant.value === value)) return;
  variants.push({ ...input, value });
}

function companyAliasValues(query: string) {
  const values = [
    ...(companyAliases[query] ?? []),
    ...Object.entries(companyAliases)
      .filter(([source]) => compact(source) === compact(query))
      .flatMap(([, aliases]) => aliases),
  ];
  return [...new Set(values)];
}

function companyCorrection(
  query: string,
  correctionTerms: readonly string[],
): SearchCorrection | undefined {
  if (!query || compact(query).length < 4) return undefined;
  const candidates = [
    ...correctionTerms,
    ...Object.keys(companyAliases),
    ...Object.values(companyAliases).flat(),
  ]
    .map((term) => normalizeCompanySearchText(term))
    .filter((term) => term && compact(term).length >= 4)
    .filter((term, index, all) => all.indexOf(term) === index)
    .map((term) => ({
      term,
      distance: damerauLevenshtein(compact(query), compact(term)),
    }))
    .sort(
      (left, right) =>
        left.distance - right.distance || left.term.localeCompare(right.term),
    );
  const best = candidates[0];
  if (!best || best.distance === 0) return undefined;
  const threshold = typoThreshold(
    Math.max(compact(query).length, compact(best.term).length),
  );
  if (
    best.distance > threshold ||
    best.distance / Math.max(compact(query).length, compact(best.term).length) >
      0.34
  )
    return undefined;
  return {
    from: query,
    to: best.term,
    confidence: confidenceFor(best.distance, candidates[1]?.distance),
  };
}

function buildInterpretation(
  input: Readonly<{
    mode: SearchMode;
    raw: string;
    normalizedQuery: string;
    effectiveQuery: string;
    intentPrefixes?: readonly string[];
    correction?: SearchCorrection;
    matchedOccupation?: Readonly<{
      occupationId: string;
      labels: Readonly<{ vi: string; en: string }>;
    }>;
    matchedTitle?: Readonly<{
      titleId: string;
      canonical: Readonly<{ vi: string; en: string }>;
    }>;
    appliedTerms: readonly string[];
    hasAlias: boolean;
    autoCorrected: boolean;
    matchedFacetIds?: readonly string[];
    ambiguous?: boolean;
    resolverVersion?: string;
    catalogVersion?: string;
    catalogIndex?: SearchCatalogIndex;
  }>,
): SearchInterpretation {
  const rawComparable = input.raw.trim().replace(/\s+/gu, " ");
  const normalizedChanged =
    rawComparable.toLocaleLowerCase() !== input.normalizedQuery;
  const reason: SearchInterpretationReason =
    input.mode === "LITERAL"
      ? normalizedChanged
        ? "NORMALIZED"
        : "NONE"
      : input.autoCorrected
        ? input.hasAlias
          ? "TYPO_AND_ALIAS"
          : "TYPO_CORRECTED"
        : input.hasAlias
          ? "ALIAS_EXPANDED"
          : normalizedChanged
            ? "NORMALIZED"
            : "NONE";
  const catalogIndex = input.catalogIndex ?? jobSearchCatalogIndex;
  const matchedFacets = (input.matchedFacetIds ?? []).flatMap((facetId) => {
    const facet = catalogIndex.facetById(facetId);
    return facet
      ? [
          {
            facetId,
            kind: facet.kind,
            labelVi: facet.labels.vi,
            labelEn: facet.labels.en,
          },
        ]
      : [];
  });
  return {
    mode: input.mode,
    originalQuery: input.raw,
    normalizedQuery: input.normalizedQuery,
    foldedQuery: foldSearchText(input.normalizedQuery),
    compactQuery: compactSearchText(input.normalizedQuery),
    effectiveQuery: input.effectiveQuery,
    reason,
    ...(input.correction
      ? {
          confidence: input.correction.confidence,
          correction: {
            from: input.correction.from,
            to: input.correction.to,
          },
        }
      : {}),
    ...(input.matchedTitle
      ? {
          matchedTitle: {
            titleId: input.matchedTitle.titleId,
            labelVi: input.matchedTitle.canonical.vi,
            labelEn: input.matchedTitle.canonical.en,
          },
        }
      : {}),
    ...(input.matchedOccupation
      ? {
          matchedOccupation: {
            occupationId: input.matchedOccupation.occupationId,
            labelVi: input.matchedOccupation.labels.vi,
            labelEn: input.matchedOccupation.labels.en,
          },
        }
      : {}),
    ...(matchedFacets.length ? { matchedFacets } : {}),
    ...(input.correction
      ? {
          corrections: [
            {
              from: input.correction.from,
              to: input.correction.to,
              confidence: input.correction.confidence,
              reason: "TYPO" as const,
            },
          ],
          ...(input.correction.confidence === "MEDIUM"
            ? { suggestedQuery: input.correction.to }
            : {}),
        }
      : {}),
    ...(input.autoCorrected ? { autoCorrected: true } : {}),
    ...(input.ambiguous ? { ambiguous: true } : {}),
    ...(input.intentPrefixes?.length
      ? { intentPrefixes: [...new Set(input.intentPrefixes)].slice(0, 4) }
      : {}),
    ...(input.resolverVersion
      ? { resolverVersion: input.resolverVersion }
      : {}),
    ...(input.catalogVersion ? { catalogVersion: input.catalogVersion } : {}),
    appliedTerms: [...new Set(input.appliedTerms)].slice(0, 8),
    canSearchLiteral: input.mode === "SMART" && Boolean(input.raw.trim()),
    usedFallback: Boolean(
      input.hasAlias ||
      input.autoCorrected ||
      input.effectiveQuery !== input.normalizedQuery,
    ),
  };
}

function conflictingFacetIds(
  facetIds: readonly string[],
  index: SearchCatalogIndex,
) {
  const matched = new Set(facetIds);
  return facetIds.filter((facetId) => {
    const facet = index.facetById(facetId);
    return Boolean(
      facet?.conflictFacetIds.some((conflictFacetId) =>
        matched.has(conflictFacetId),
      ),
    );
  });
}

function buildJobSearchIntent(input: {
  query: string;
  occupation?: OccupationDefinition;
  correction?: SearchCorrection;
  variants: readonly SearchQueryVariant[];
  facetIds: readonly string[];
  ambiguous?: boolean;
  index: SearchCatalogIndex;
}): JobSearchIntent {
  const occupationMatches = exactOccupationPhraseOccurrences(
    input.query,
    input.index,
  );
  const titleMatches = exactTitlePhraseOccurrences(input.query, input.index);
  const titleMatchById = new Map<string, TitlePhraseOccurrence>();
  for (const match of titleMatches) {
    if (!match.match.titleId) continue;
    if (!titleMatchById.has(match.match.titleId)) {
      titleMatchById.set(match.match.titleId, match);
    }
  }
  for (const variant of input.variants) {
    if (!variant.titleId || titleMatchById.has(variant.titleId)) continue;
    const title = input.index.titleById(variant.titleId);
    if (!title) continue;
    titleMatchById.set(variant.titleId, {
      match: {
        phrase: title.canonical.en,
        normalizedPhrase: normalizeSearchText(title.canonical.en),
        compactPhrase: compact(normalizeSearchText(title.canonical.en)),
        titleId: title.titleId,
        kind: "TITLE_CANONICAL",
        language: "en",
        facetIds: title.facetIds,
        roleIds: [],
        weight: 100,
      },
      title,
      occupation: title.occupationId
        ? input.index.occupationById(title.occupationId)
        : undefined,
      start: 0,
      end: 0,
      querySpan: variant.value,
      distance: variant.source === "TYPO_CORRECTION" ? 1 : 0,
      confidence: variant.confidence,
    });
  }
  const titleIds = [...titleMatchById.keys()];
  const occupationIds = [
    ...new Set([
      ...(input.occupation ? [input.occupation.occupationId] : []),
      ...occupationMatches.map(
        (occurrence) => occurrence.occupation.occupationId,
      ),
      ...input.variants.flatMap((variant) =>
        variant.occupationId ? [variant.occupationId] : [],
      ),
    ]),
  ];
  const bestPhrase = occupationMatches[0]?.match;
  const relatedVariantOccupationIds = new Set(
    input.variants
      .filter(
        (variant) =>
          variant.source === "RELATED_TITLE" && Boolean(variant.occupationId),
      )
      .map((variant) => variant.occupationId!),
  );
  const conflictIds = conflictingFacetIds(input.facetIds, input.index);
  const skills = input.index
    .skillPhrases()
    .filter((phrase) =>
      phraseOccursInQuery(input.query, phrase.normalizedPhrase),
    )
    .flatMap((phrase) => (phrase.skillId ? [phrase.skillId] : []));
  const intent = {
    language: "neutral" as const,
    titleCandidates: titleIds.slice(0, 16).map((titleId) => {
      const match = titleMatchById.get(titleId);
      const matchKind =
        input.correction || match?.distance
          ? ("FUZZY" as const)
          : match?.match.kind === "TITLE_ALIAS" ||
              match?.match.kind === "TITLE_ABBREVIATION"
            ? ("ALIAS" as const)
            : ("EXACT" as const);
      return {
        titleId,
        confidence: input.correction?.confidence ?? match?.confidence ?? "HIGH",
        matchKind,
        score:
          input.correction?.confidence === "MEDIUM"
            ? 60
            : matchKind === "EXACT"
              ? 100
              : matchKind === "ALIAS"
                ? 90
                : 70,
      };
    }),
    occupationCandidates: occupationIds.slice(0, 16).map((occupationId) => ({
      occupationId,
      confidence:
        input.correction?.confidence === "MEDIUM"
          ? ("MEDIUM" as const)
          : ("HIGH" as const),
      matchKind: input.correction
        ? ("FUZZY" as const)
        : relatedVariantOccupationIds.has(occupationId) ||
            (bestPhrase?.occupationId === occupationId &&
              bestPhrase.kind === "RELATED_TITLE")
          ? ("RELATED" as const)
          : ("EXACT" as const),
      score: input.correction?.confidence === "MEDIUM" ? 60 : 100,
    })),
    requiredFacetIds: conflictIds.length ? [] : [...input.facetIds],
    preferredFacetIds: conflictIds.length ? [...input.facetIds] : [],
    excludedFacetIds: [],
    skills: [...new Set(skills)].slice(0, 16),
    retainedTerms: [
      ...new Set(
        input.variants.flatMap((variant) => variant.retainedTerms ?? []),
      ),
    ].slice(0, 16),
    corrections: input.correction
      ? [
          {
            from: input.correction.from,
            to: input.correction.to,
            confidence: input.correction.confidence,
            reason: "TYPO" as const,
          },
        ]
      : [],
    ambiguous:
      Boolean(input.ambiguous) ||
      occupationIds.length > 1 ||
      titleIds.length > 1 ||
      conflictIds.length > 0,
    resolverVersion: searchResolverVersion(input.index),
    catalogVersion: input.index.version,
  };
  return input.index.intentSchema.parse(intent);
}

type ResolveJobsCoreOptions = Readonly<{
  displayNormalizedQuery?: string;
  initialVariantQuery?: string;
  intentPrefixes?: readonly string[];
}>;

function alignCorrectedTitle(
  core: ReturnType<typeof resolveJobsCore>,
  titleOccurrence: TitlePhraseOccurrence,
) {
  const titleId = titleOccurrence.title.titleId;
  const occupationId = titleOccurrence.occupation?.occupationId;
  const variants = core.variants.map((variant, index) =>
    index === 0 || variant.source === "TYPO_CORRECTION" || variant.titleId
      ? {
          ...variant,
          titleId,
          ...(occupationId ? { occupationId } : {}),
        }
      : variant,
  );
  const existingCandidate = core.intent.titleCandidates.find(
    (candidate) => candidate.titleId === titleId,
  );
  const titleCandidates = [
    existingCandidate ?? {
      titleId,
      confidence: "HIGH" as const,
      matchKind: "FUZZY" as const,
      score: 70,
    },
    ...core.intent.titleCandidates.filter(
      (candidate) => candidate.titleId !== titleId,
    ),
  ];
  return {
    ...core,
    variants,
    intent: {
      ...core.intent,
      titleCandidates,
    },
    interpretation: {
      ...core.interpretation,
      matchedTitle: {
        titleId,
        labelVi: titleOccurrence.title.canonical.vi,
        labelEn: titleOccurrence.title.canonical.en,
      },
    },
  };
}

function resolveJobsCore(
  raw: string,
  normalizedQuery: string,
  mode: SearchMode,
  allowOccupationExpansion: boolean,
  index: SearchCatalogIndex,
  options: ResolveJobsCoreOptions = {},
) {
  const displayNormalizedQuery =
    options.displayNormalizedQuery ?? normalizedQuery;
  const initialVariantQuery = options.initialVariantQuery ?? normalizedQuery;
  const variants: SearchQueryVariant[] = [];
  if (initialVariantQuery) {
    addVariant(variants, {
      value: initialVariantQuery,
      source: "ORIGINAL",
      confidence: "HIGH",
    });
  }
  if (mode === "LITERAL" || !normalizedQuery) {
    return {
      variants,
      correction: undefined,
      intent: buildJobSearchIntent({
        query: normalizedQuery,
        variants,
        facetIds: [],
        index,
      }),
      interpretation: buildInterpretation({
        mode,
        raw,
        normalizedQuery: displayNormalizedQuery,
        effectiveQuery: normalizedQuery,
        appliedTerms: [],
        hasAlias: false,
        autoCorrected: false,
        intentPrefixes: options.intentPrefixes,
        resolverVersion: searchResolverVersion(index),
        catalogVersion: index.version,
        catalogIndex: index,
      }),
    };
  }

  const genericRoles = allowOccupationExpansion
    ? genericRoleOccurrences(normalizedQuery, index)
    : [];
  const initialFacetIds = allowOccupationExpansion
    ? independentFacetIds(normalizedQuery, genericRoles, index)
    : [];
  const composedVariants = allowOccupationExpansion
    ? facetAwareOccupationVariants(
        normalizedQuery,
        genericRoles,
        initialFacetIds,
        index,
      )
    : [];
  const exactOccurrence = allowOccupationExpansion
    ? exactPhraseOccurrence(normalizedQuery, index)
    : undefined;
  const exactTitleOccurrence = allowOccupationExpansion
    ? exactTitlePhraseOccurrences(normalizedQuery, index)[0]
    : undefined;
  const typoEnabled = searchReleaseFlags().typoV2Enabled;
  const exactTitleCoversWholeQuery = Boolean(
    exactTitleOccurrence &&
    exactTitleOccurrence.start === 0 &&
    exactTitleOccurrence.end === searchTextTokens(normalizedQuery).length,
  );
  const fuzzyTitleOccurrence =
    typoEnabled &&
    allowOccupationExpansion &&
    !exactTitleCoversWholeQuery &&
    !composedVariants.length &&
    !isGenericRoleOnly(normalizedQuery, index)
      ? fuzzyTitlePhraseOccurrence(normalizedQuery, index)
      : undefined;
  const titleOccurrence =
    fuzzyTitleOccurrence &&
    (!exactTitleOccurrence ||
      fuzzyTitleOccurrence.end - fuzzyTitleOccurrence.start >
        exactTitleOccurrence.end - exactTitleOccurrence.start)
      ? fuzzyTitleOccurrence
      : exactTitleOccurrence;
  const fuzzyOccurrence =
    typoEnabled &&
    allowOccupationExpansion &&
    !composedVariants.length &&
    !isGenericRoleOnly(normalizedQuery, index)
      ? fuzzyPhraseOccurrence(normalizedQuery, index, genericRoles)
      : undefined;
  const occurrence = selectOccupationOccurrence(
    exactOccurrence,
    fuzzyOccurrence,
  );
  const correction =
    occurrence && occurrence.distance > 0
      ? {
          from: occurrence.querySpan,
          to: occurrence.match.normalizedPhrase,
          confidence: occurrence.confidence,
        }
      : titleOccurrence && titleOccurrence.distance > 0
        ? {
            from: titleOccurrence.querySpan,
            to: titleOccurrence.title.canonical.en,
            confidence: titleOccurrence.confidence,
          }
        : undefined;
  const autoCorrected = Boolean(correction?.confidence === "HIGH");
  const occupation = occurrence?.occupation;
  const correctionOccurrence = occurrence ?? titleOccurrence;
  const correctionTarget = occurrence
    ? occurrence.match.normalizedPhrase
    : titleOccurrence?.title.canonical.en;
  const correctedFacetQuery =
    correction && correctionOccurrence && correctionTarget
      ? replaceOccurrence(
          normalizedQuery,
          correctionOccurrence,
          correctionTarget,
        )
      : normalizedQuery;
  const englishVariants = occurrence
    ? occupationEnglishVariants(occurrence, correctedFacetQuery, index)
    : [];
  if (
    titleOccurrence &&
    titleOccurrence.distance === 0 &&
    titleOccurrence.start === 0 &&
    titleOccurrence.end === searchTextTokens(normalizedQuery).length &&
    variants[0]
  ) {
    variants[0] = {
      ...variants[0],
      titleId: titleOccurrence.title.titleId,
      ...(titleOccurrence.occupation
        ? { occupationId: titleOccurrence.occupation.occupationId }
        : {}),
      matchedSpan: titleOccurrence.querySpan,
    };
  } else if (
    occurrence &&
    occupation &&
    occurrence.distance === 0 &&
    occurrence.start === 0 &&
    occurrence.end === searchTextTokens(normalizedQuery).length &&
    variants[0]
  ) {
    // The user's complete query is already an occupation phrase. Mark the
    // original variant so retrieval can use the indexed title/skill signals
    // instead of evaluating company-name projections for every job row.
    variants[0] = {
      ...variants[0],
      occupationId: occupation.occupationId,
      matchedSpan: occurrence.querySpan,
    };
  }
  if (titleOccurrence && variants[0] && !variants[0].titleId) {
    variants[0] = {
      ...variants[0],
      titleId: titleOccurrence.title.titleId,
    };
  }
  const coreOccurrence =
    occurrence && occupation
      ? containedOccupationCoreOccurrence(normalizedQuery, occurrence, index)
      : undefined;
  const collapseRedundantOccupationQuery = Boolean(
    occurrence &&
    occupation &&
    occurrence.distance === 0 &&
    isRedundantOccupationConnectorQuery(
      normalizedQuery,
      occupation.occupationId,
      index,
    ),
  );
  if (collapseRedundantOccupationQuery) {
    // The original value is retained in the interpretation and remains
    // available through the literal-search action, but it should not make the
    // database evaluate a long chain of redundant AND terms.
    variants.shift();
  }
  const matchedFacetIds = queryFacetIds(correctedFacetQuery, index);
  const preserveFacetContext = hasRequiredFacetContext(
    normalizedQuery,
    coreOccurrence,
    index,
  );

  if (correctionOccurrence && autoCorrected && correctionTarget) {
    const correctedQuery = replaceOccurrence(
      normalizedQuery,
      correctionOccurrence,
      correctionTarget,
    );
    addVariant(variants, {
      value: correctedQuery,
      source: "TYPO_CORRECTION",
      confidence: "HIGH",
      ...(occupation ? { occupationId: occupation.occupationId } : {}),
      ...(titleOccurrence ? { titleId: titleOccurrence.title.titleId } : {}),
      matchedSpan: correctionOccurrence.querySpan,
      retainedTerms: [
        ...searchTextTokens(normalizedQuery).slice(
          0,
          correctionOccurrence.start,
        ),
        ...searchTextTokens(normalizedQuery).slice(correctionOccurrence.end),
      ],
      requiredFacetIds: matchedFacetIds,
    });
  }

  if (!occurrence) {
    for (const composedVariant of composedVariants) {
      addVariant(variants, composedVariant);
    }
  }

  if (
    occurrence &&
    occupation &&
    (autoCorrected || occurrence.distance === 0)
  ) {
    for (const englishVariant of englishVariants) {
      const source: SearchVariantSource =
        occurrence.match.kind === "RELATED_TITLE" ||
        Boolean(
          relatedTitleMetadata(occupation.occupationId, englishVariant, index),
        )
          ? "RELATED_TITLE"
          : "VIETNAMESE_ALIAS";
      const relatedMetadata = relatedTitleMetadata(
        occupation.occupationId,
        englishVariant,
        index,
      );
      const isBroadOccupationVariant =
        preserveFacetContext &&
        matchedFacetIds.some((facetId) => {
          const facet = index.facetById(facetId);
          return facet?.kind === "SPECIALIZATION" || facet?.kind === "DOMAIN";
        }) &&
        !relatedMetadata?.facetIds.some((facetId) =>
          matchedFacetIds.includes(facetId),
        );
      const replacementOccurrence = preserveFacetContext
        ? coreOccurrence
        : occurrence;
      const retainedTerms = replacementOccurrence
        ? [
            ...searchTextTokens(normalizedQuery).slice(
              0,
              replacementOccurrence.start,
            ),
            ...searchTextTokens(normalizedQuery).slice(
              replacementOccurrence.end,
            ),
            ...genericRoles
              .filter(
                (role) =>
                  role.start >= replacementOccurrence.start &&
                  role.end <= replacementOccurrence.end,
              )
              .map((role) => role.querySpan),
          ]
        : [];
      const metadata = {
        source,
        confidence: "HIGH" as const,
        occupationId: occupation.occupationId,
        ...(titleOccurrence ? { titleId: titleOccurrence.title.titleId } : {}),
        matchedSpan: replacementOccurrence?.querySpan ?? occurrence.querySpan,
        retainedTerms,
        requiredFacetIds: matchedFacetIds,
      };

      if (collapseRedundantOccupationQuery) {
        addVariant(variants, {
          value: englishVariant,
          ...metadata,
        });
        continue;
      }

      if (preserveFacetContext) {
        if (isBroadOccupationVariant) {
          // A broad occupation variant would discard a required facet. Keep
          // the facet in the contextual form so a generic fallback cannot
          // outrank a more specific title merely because it shares one word.
          addVariant(variants, {
            value: replaceOccurrence(
              normalizedQuery,
              coreOccurrence!,
              englishVariant,
            ),
            ...metadata,
          });
          continue;
        }
        const isWholeQueryOccurrence =
          occurrence.start === 0 &&
          occurrence.end === searchTextTokens(normalizedQuery).length;
        if (isWholeQueryOccurrence && !relatedMetadata) {
          addVariant(variants, { value: englishVariant, ...metadata });
          continue;
        }
        addVariant(variants, {
          value: replaceOccurrence(
            normalizedQuery,
            coreOccurrence!,
            englishVariant,
          ),
          ...metadata,
        });
        // Specific related titles are also searched on their own so an
        // English title such as `Inventory Accountant` remains discoverable.
        addVariant(variants, { value: englishVariant, ...metadata });
        continue;
      }

      const contextual = replaceOccurrence(
        normalizedQuery,
        occurrence,
        englishVariant,
      );
      addVariant(variants, { value: contextual, ...metadata });
      if (
        occurrence.start > 0 ||
        occurrence.end < searchTextTokens(normalizedQuery).length
      ) {
        addVariant(variants, { value: englishVariant, ...metadata });
      }
    }
  }

  const effectiveQuery = correction
    ? correctionOccurrence && correctionTarget
      ? replaceOccurrence(
          normalizedQuery,
          correctionOccurrence,
          correctionTarget,
        )
      : normalizedQuery
    : normalizedQuery;
  const finalVariants = variants.slice(0, 8);
  const inferredOccupation =
    occupation ??
    (composedVariants[0]?.occupationId
      ? index.occupationById(composedVariants[0].occupationId)
      : undefined);
  const ambiguous = matchedFacetIds.some((facetId) => {
    const facet = index.facetById(facetId);
    return Boolean(
      facet?.conflictFacetIds.some((conflictFacetId) =>
        matchedFacetIds.includes(conflictFacetId),
      ),
    );
  });
  return {
    variants: finalVariants,
    correction,
    intent: buildJobSearchIntent({
      query: normalizedQuery,
      occupation,
      correction,
      variants: finalVariants,
      facetIds: matchedFacetIds,
      ambiguous,
      index,
    }),
    interpretation: buildInterpretation({
      mode,
      raw,
      normalizedQuery: displayNormalizedQuery,
      effectiveQuery,
      correction,
      matchedTitle: titleOccurrence
        ? {
            titleId: titleOccurrence.title.titleId,
            canonical: titleOccurrence.title.canonical,
          }
        : undefined,
      matchedOccupation: inferredOccupation,
      appliedTerms: finalVariants.slice(1).map((variant) => variant.value),
      hasAlias: Boolean(
        occupation ||
        composedVariants.length ||
        titleOccurrence?.match.kind === "TITLE_ALIAS" ||
        titleOccurrence?.match.kind === "TITLE_ABBREVIATION",
      ),
      autoCorrected,
      matchedFacetIds,
      ambiguous,
      resolverVersion: searchResolverVersion(index),
      catalogVersion: index.version,
      catalogIndex: index,
      intentPrefixes: options.intentPrefixes,
    }),
  };
}

const searchIntentPrefixes = [
  "tuyen dung",
  "tuyen",
  "tim viec",
  "viec lam",
  "can tim",
  "can tuyen",
] as const;

type SearchIntentPrefixResolution = Readonly<{
  prefix: string;
  targetQuery: string;
}>;

function hasMeaningfulTarget(query: string, index: SearchCatalogIndex) {
  if (searchTextTokens(query).length === 0) return false;
  if (
    index.exactOccupationPhraseMatches(query).length ||
    index.exactTitlePhraseMatches(query).length ||
    index.exactFacetPhraseMatches(query).length ||
    index.exactSkillPhraseMatches(query).length
  ) {
    return true;
  }
  // A prefix may precede a single-edit typo.  It is safe to classify it as a
  // target only when the bounded typo engine can name a catalog term.
  return searchReleaseFlags().typoV2Enabled
    ? Boolean(resolveSearchTypo(query, index))
    : false;
}

function resolveSearchIntentPrefix(
  query: string,
  index: SearchCatalogIndex,
): SearchIntentPrefixResolution | undefined {
  const normalized = normalizeSearchText(query);
  for (const prefix of searchIntentPrefixes) {
    if (!normalized.startsWith(`${prefix} `)) continue;
    const targetQuery = normalized.slice(prefix.length).trim();
    if (!hasMeaningfulTarget(targetQuery, index)) continue;
    return { prefix, targetQuery };
  }
  return undefined;
}

function withTokenCorrection(
  raw: string,
  originalNormalizedQuery: string,
  baseQuery: string,
  mode: SearchMode,
  allowOccupationExpansion: boolean,
  index: SearchCatalogIndex,
  intentPrefixes: readonly string[],
  typo: SearchTypoResolution,
) {
  const autoCorrected = typo.confidence === "HIGH";
  const matchingQuery = autoCorrected ? typo.correctedQuery : baseQuery;
  const rawCore = resolveJobsCore(
    raw,
    matchingQuery,
    mode,
    allowOccupationExpansion,
    index,
    {
      displayNormalizedQuery: originalNormalizedQuery,
      initialVariantQuery: baseQuery,
      intentPrefixes,
    },
  );
  const correctedTitle = exactTitlePhraseOccurrences(
    typo.correctedQuery,
    index,
  ).find(
    (candidate) =>
      candidate.start === 0 &&
      candidate.end === searchTextTokens(typo.correctedQuery).length,
  );
  const core = correctedTitle
    ? alignCorrectedTitle(rawCore, correctedTitle)
    : rawCore;
  // A phrase-level correction found by the existing resolver is more
  // specific than a token suggestion; keep it as the authoritative result.
  if (core.correction) return core;

  const variants: SearchQueryVariant[] = [];
  for (const variant of core.variants) {
    addVariant(variants, variant);
    if (variants.length === 1) {
      addVariant(variants, {
        value: typo.to,
        source: "TYPO_CORRECTION",
        confidence: typo.confidence,
        ...(core.interpretation.matchedOccupation
          ? {
              occupationId: core.interpretation.matchedOccupation.occupationId,
            }
          : {}),
        ...(core.interpretation.matchedTitle
          ? { titleId: core.interpretation.matchedTitle.titleId }
          : {}),
        matchedSpan: typo.from,
        requiredFacetIds: [
          ...(core.intent?.requiredFacetIds ?? []),
          ...(core.intent?.preferredFacetIds ?? []),
        ],
      });
    }
  }
  if (!variants.length) {
    addVariant(variants, {
      value: baseQuery,
      source: "ORIGINAL",
      confidence: "HIGH",
    });
    addVariant(variants, {
      value: typo.to,
      source: "TYPO_CORRECTION",
      confidence: typo.confidence,
      matchedSpan: typo.from,
    });
  }
  const finalVariants = variants.slice(0, 8);
  const matchedFacetIds = [
    ...new Set([
      ...(core.intent?.requiredFacetIds ?? []),
      ...(core.intent?.preferredFacetIds ?? []),
    ]),
  ];
  const correction = {
    from: typo.from,
    to: typo.to,
    confidence: typo.confidence,
  };
  const matchedOccupation = core.interpretation.matchedOccupation
    ? index.occupationById(core.interpretation.matchedOccupation.occupationId)
    : undefined;
  const intent = buildJobSearchIntent({
    query: autoCorrected ? matchingQuery : baseQuery,
    occupation: matchedOccupation,
    correction,
    variants: finalVariants,
    facetIds: matchedFacetIds,
    ambiguous: core.interpretation.ambiguous,
    index,
  });
  const coreMatchedTitle = core.interpretation.matchedTitle;
  const matchedTitleCanonical = coreMatchedTitle
    ? "canonical" in coreMatchedTitle
      ? (
          coreMatchedTitle as Readonly<{
            titleId: string;
            canonical: Readonly<{ vi: string; en: string }>;
          }>
        ).canonical
      : {
          vi: coreMatchedTitle.labelVi,
          en: coreMatchedTitle.labelEn,
        }
    : undefined;
  return {
    variants: finalVariants,
    correction,
    intent,
    interpretation: buildInterpretation({
      mode,
      raw,
      normalizedQuery: originalNormalizedQuery,
      effectiveQuery: autoCorrected ? matchingQuery : typo.to,
      correction,
      matchedTitle:
        coreMatchedTitle && matchedTitleCanonical
          ? {
              titleId: coreMatchedTitle.titleId,
              canonical: matchedTitleCanonical,
            }
          : undefined,
      matchedOccupation,
      appliedTerms: finalVariants.slice(1).map((variant) => variant.value),
      hasAlias: Boolean(
        core.interpretation.matchedOccupation ||
        core.interpretation.matchedTitle ||
        core.interpretation.matchedFacets?.length,
      ),
      autoCorrected,
      matchedFacetIds,
      ambiguous: core.interpretation.ambiguous,
      intentPrefixes,
      resolverVersion: searchResolverVersion(index),
      catalogVersion: index.version,
      catalogIndex: index,
    }),
  };
}

function resolveJobs(
  raw: string,
  normalizedQuery: string,
  mode: SearchMode,
  allowOccupationExpansion: boolean,
  index: SearchCatalogIndex,
) {
  if (mode === "LITERAL" || !normalizedQuery) {
    return resolveJobsCore(
      raw,
      normalizedQuery,
      mode,
      allowOccupationExpansion,
      index,
    );
  }
  const prefix = resolveSearchIntentPrefix(normalizedQuery, index);
  const baseQuery = prefix?.targetQuery ?? normalizedQuery;
  const intentPrefixes = prefix ? [prefix.prefix] : [];
  const typo = searchReleaseFlags().typoV2Enabled
    ? resolveSearchTypo(baseQuery, index)
    : undefined;
  if (typo) {
    return withTokenCorrection(
      raw,
      normalizedQuery,
      baseQuery,
      mode,
      allowOccupationExpansion,
      index,
      intentPrefixes,
      typo,
    );
  }
  return resolveJobsCore(
    raw,
    baseQuery,
    mode,
    allowOccupationExpansion,
    index,
    {
      displayNormalizedQuery: normalizedQuery,
      initialVariantQuery: baseQuery,
      intentPrefixes,
    },
  );
}

function resolveCompanies(
  raw: string,
  mode: SearchMode,
  options: ResolveSearchQueryOptions,
) {
  const normalizedRaw = normalizeSearchText(raw);
  const normalizedQuery =
    mode === "SMART"
      ? normalizeCompanySearchText(raw) || normalizedRaw
      : normalizedRaw;
  const variants: SearchQueryVariant[] = [];
  if (normalizedQuery) {
    addVariant(variants, {
      value: normalizedQuery,
      source: "ORIGINAL",
      confidence: "HIGH",
    });
  }
  if (mode === "LITERAL" || !normalizedQuery) {
    return {
      variants,
      correction: undefined,
      interpretation: buildInterpretation({
        mode,
        raw,
        normalizedQuery,
        effectiveQuery: normalizedQuery,
        appliedTerms: [],
        hasAlias: false,
        autoCorrected: false,
        resolverVersion: SEARCH_RESOLVER_VERSION,
        catalogVersion: JOB_SEARCH_CATALOG_VERSION,
      }),
    };
  }
  const aliases = companyAliasValues(normalizedQuery);
  for (const value of aliases) {
    addVariant(variants, {
      value,
      source: "VIETNAMESE_ALIAS",
      confidence: "HIGH",
    });
  }
  const correction = companyCorrection(
    normalizedQuery,
    options.correctionTerms ?? [],
  );
  const autoCorrected = Boolean(correction?.confidence === "HIGH");
  if (autoCorrected && correction) {
    addVariant(variants, {
      value: correction.to,
      source: "TYPO_CORRECTION",
      confidence: "HIGH",
    });
  }
  const finalVariants = variants.slice(0, 8);
  return {
    variants: finalVariants,
    correction,
    interpretation: buildInterpretation({
      mode,
      raw,
      normalizedQuery,
      effectiveQuery: correction ? correction.to : normalizedQuery,
      correction,
      appliedTerms: finalVariants.slice(1).map((variant) => variant.value),
      hasAlias: aliases.length > 0,
      autoCorrected,
      resolverVersion: SEARCH_RESOLVER_VERSION,
      catalogVersion: JOB_SEARCH_CATALOG_VERSION,
    }),
  };
}

export function resolveSearchQuery(
  rawQuery: string,
  context: SearchContext,
  locale: "vi" | "en" = "en",
  searchMode: SearchMode = "SMART",
  options: ResolveSearchQueryOptions = {},
): ResolvedSearchQuery {
  void locale;
  const raw = rawQuery ?? "";
  const result =
    context === "JOBS"
      ? resolveJobs(
          raw,
          normalizeSearchText(raw),
          searchMode,
          options.allowOccupationExpansion !== false,
          options.catalogIndex ?? jobSearchCatalogIndex,
        )
      : resolveCompanies(raw, searchMode, options);
  const usedFallback = result.interpretation.usedFallback ?? false;
  const intent =
    "intent" in result
      ? (result as { intent?: JobSearchIntent }).intent
      : undefined;
  const resolverVersion =
    context === "JOBS"
      ? searchResolverVersion(options.catalogIndex ?? jobSearchCatalogIndex)
      : SEARCH_RESOLVER_VERSION;
  const normalizedQuery =
    context === "JOBS"
      ? normalizeSearchText(raw)
      : result.interpretation.normalizedQuery;
  const effectiveQuery = result.interpretation.effectiveQuery;
  return {
    rawQuery: raw,
    normalizedQuery,
    foldedQuery: foldSearchText(normalizedQuery),
    compactQuery: compactSearchText(normalizedQuery),
    effectiveQuery,
    variants: result.variants,
    ...(result.correction ? { correction: result.correction } : {}),
    ...(intent ? { intent } : {}),
    usedFallback,
    resolverVersion,
    interpretation: result.interpretation,
  };
}

export function searchResolverCatalogStats(
  index: SearchCatalogIndex = jobSearchCatalogIndex,
) {
  return {
    resolverVersion: searchResolverVersion(index),
    catalogVersion: index.version,
    occupationCount: index.occupations.length,
    phraseCount: index.occupationPhrases().length,
    facetCount: index.facets.length,
    skillCount: index.skills.length,
  };
}
