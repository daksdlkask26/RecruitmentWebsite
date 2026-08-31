import "server-only";

import { normalizeSearchText, searchTextTokens } from "@/backend/services/jobs/search-normalization";

export type SearchContext = "JOBS" | "COMPANIES";
export type SearchVariantSource = "ORIGINAL" | "VIETNAMESE_ALIAS" | "TYPO_CORRECTION";
export type SearchConfidence = "HIGH" | "MEDIUM";

export type SearchQueryVariant = Readonly<{
  value: string;
  source: SearchVariantSource;
  confidence: SearchConfidence;
}>;

export type SearchInterpretation = Readonly<{
  appliedTerms: string[];
  correction?: { from: string; to: string; confidence: SearchConfidence };
  usedFallback: boolean;
}>;

export type ResolvedSearchQuery = Readonly<{
  rawQuery: string;
  normalizedQuery: string;
  variants: SearchQueryVariant[];
  correction?: { from: string; to: string; confidence: SearchConfidence };
  usedFallback: boolean;
  resolverVersion: string;
  interpretation: SearchInterpretation;
}>;

export const SEARCH_RESOLVER_VERSION = "2026-08-31.1";

const aliases: Record<SearchContext, Record<string, string[]>> = {
  JOBS: {
    "ke toan": ["accountant", "accounting", "accounting specialist"],
    accounting: ["accountant", "accounting specialist"],
    "lap trinh vien": ["software engineer", "software developer", "programmer"],
    "ky su phan mem": ["software engineer"],
    "quan tri vien he thong": ["system administrator", "systems engineer"],
    "phat trien phan mem": ["software development", "software engineer"],
    "du lieu": ["data", "data engineering", "data analyst"],
    "tri tue nhan tao": ["artificial intelligence", "machine learning"],
    "nhan su": ["human resources", "hr"],
    "phan tich du lieu": ["data analyst"],
  },
  COMPANIES: {
    it: ["information technology"],
    danang: ["da nang"],
    "da nang": ["danang"],
    "cong nghe thong tin": ["information technology", "it"],
    "phan mem": ["software", "software development"],
    "tai chinh ngan hang": ["financial services", "banking"],
    "thanh pho ho chi minh": ["ho chi minh city", "hcmc"],
    "ha noi": ["hanoi"],
  },
};

const correctionTerms = [
  ...new Set([
    ...Object.values(aliases).flatMap((group) => Object.values(group).flat()),
    "software engineer",
    "accountant",
    "accounting",
    "accounting specialist",
    "software developer",
    "programmer",
    "information technology",
    "machine learning",
    "data analyst",
    "system administrator",
    "hanoi",
    "ho chi minh city",
  ]),
];

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column];
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

function typoCorrection(query: string) {
  if (!query || searchTextTokens(query).some((token) => token.length < 4)) return undefined;
  const candidates = correctionTerms
    .map((term) => ({ term, distance: editDistance(query, term) }))
    .sort((left, right) => left.distance - right.distance || left.term.localeCompare(right.term));
  const best = candidates[0];
  if (!best) return undefined;
  const threshold = query.length >= 12 ? 3 : 2;
  if (best.distance === 0 || best.distance > threshold) return undefined;
  const second = candidates[1];
  const confidence: SearchConfidence =
    !second || second.distance - best.distance >= 2 ? "HIGH" : "MEDIUM";
  return { from: query, to: best.term, confidence };
}

function compactAliasValues(context: SearchContext, query: string) {
  return Object.entries(aliases[context])
    .filter(([source]) => source.replace(/\s+/gu, "") === query)
    .flatMap(([, values]) => values);
}

export function resolveSearchQuery(
  rawQuery: string,
  context: SearchContext,
  locale: "vi" | "en" = "en",
): ResolvedSearchQuery {
  void locale;
  const raw = rawQuery ?? "";
  const normalizedQuery = normalizeSearchText(raw);
  const variants: SearchQueryVariant[] = normalizedQuery
    ? [{ value: normalizedQuery, source: "ORIGINAL", confidence: "HIGH" }]
    : [];
  const contextAliases = Object.entries(aliases[context])
    .filter(([source]) => normalizedQuery === source || normalizedQuery.includes(`${source} `) || normalizedQuery.includes(` ${source}`))
    .flatMap(([, values]) => values);
  contextAliases.push(...compactAliasValues(context, normalizedQuery));
  for (const value of contextAliases) {
    if (!variants.some((variant) => variant.value === value)) {
      variants.push({ value, source: "VIETNAMESE_ALIAS", confidence: "HIGH" });
    }
  }
  const correction = typoCorrection(normalizedQuery);
  if (correction && !variants.some((variant) => variant.value === correction.to)) {
    variants.push({ value: correction.to, source: "TYPO_CORRECTION", confidence: correction.confidence });
  }
  const limitedVariants = variants.slice(0, 6);
  const usedFallback = limitedVariants.some((variant) => variant.source !== "ORIGINAL");
  return {
    rawQuery: raw,
    normalizedQuery,
    variants: limitedVariants,
    correction,
    usedFallback,
    resolverVersion: SEARCH_RESOLVER_VERSION,
    interpretation: {
      appliedTerms: limitedVariants.slice(1).map((variant) => variant.value),
      ...(correction ? { correction } : {}),
      usedFallback,
    },
  };
}
