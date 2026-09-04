import {
  companySearchProjection,
  type SearchQueryVariant,
} from "./search-query-resolver";
import { classifySearchToken } from "./search-token-policy";

export const COMPANY_SEARCH_TERM_KINDS = [
  "FULL_NAME",
  "BRAND_ALIAS",
  "LEGAL_NAME",
  "INDUSTRY_PHRASE",
  "ABBREVIATION",
  "LOCATION",
  "TYPO_CORRECTION",
] as const;

export type CompanySearchTermKind = (typeof COMPANY_SEARCH_TERM_KINDS)[number];

export function classifyCompanySearchTerm(
  field: "displayName" | "legalName" | "slug" | "industry" | "location",
  variant: Pick<SearchQueryVariant, "value" | "source">,
): CompanySearchTermKind {
  if (variant.source === "TYPO_CORRECTION") return "TYPO_CORRECTION";
  const normalized = companySearchProjection(variant.value);
  if (field === "displayName") return "FULL_NAME";
  if (field === "legalName") return "LEGAL_NAME";
  if (field === "slug") return "BRAND_ALIAS";
  if (field === "industry") return "INDUSTRY_PHRASE";
  if (normalized.split(/\s+/u).join("").length <= 4) return "ABBREVIATION";
  return "LOCATION";
}

export type CompanySearchCandidate = Readonly<{
  displayName: string;
  legalName?: string | null;
  slug: string;
  industry?: string | null;
  publicLocation?: string | null;
  publicDescription?: string | null;
}>;

function normalized(value: string | null | undefined) {
  return companySearchProjection(value ?? "");
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function tokenMatches(value: string, token: string) {
  const kind = classifySearchToken(token);
  if (kind === "STOPWORD") return false;
  const normalizedValue = normalized(value);
  const normalizedToken = normalized(token);
  if (
    kind === "KNOWN_ABBREVIATION" ||
    kind === "SHORT_AMBIGUOUS" ||
    kind === "GENERIC_ROLE"
  ) {
    return new RegExp(
      `(?:^|\\s)${escapeRegex(normalizedToken)}(?:$|\\s)`,
      "u",
    ).test(normalizedValue);
  }
  return normalizedValue.includes(normalizedToken);
}

function containsAllTokens(value: string, query: string) {
  return query
    .split(/\s+/u)
    .filter(Boolean)
    .every((token) => tokenMatches(value, token));
}

function startsWithQuery(value: string, query: string) {
  const haystack = normalized(value);
  if (!haystack.startsWith(query)) return false;
  const firstToken = query.split(/\s+/u).find(Boolean);
  if (!firstToken) return false;
  const kind = classifySearchToken(firstToken);
  if (
    kind !== "KNOWN_ABBREVIATION" &&
    kind !== "SHORT_AMBIGUOUS" &&
    kind !== "GENERIC_ROLE"
  ) {
    return true;
  }
  return haystack.length === query.length || haystack[query.length] === " ";
}

function fieldScore(
  candidate: CompanySearchCandidate,
  query: string,
  variant: SearchQueryVariant,
) {
  if (!query) return 0;
  const display = normalized(candidate.displayName);
  const legal = normalized(candidate.legalName);
  const slug = normalized(candidate.slug.replace(/-/gu, " "));
  const industry = normalized(candidate.industry);
  const location = normalized(candidate.publicLocation);
  const description = normalized(candidate.publicDescription);
  const exactDisplayName = display === query;
  const exactLegalName = legal === query;
  const exactSlug = slug === query;
  const displayPrefix = startsWithQuery(display, query);
  const value = exactDisplayName
    ? 100
    : exactLegalName
      ? 95
      : exactSlug
        ? 90
        : displayPrefix
          ? 80
          : containsAllTokens(display, query) || containsAllTokens(legal, query)
            ? 70
            : containsAllTokens(industry, query)
              ? 40
              : containsAllTokens(location, query)
                ? 25
                : containsAllTokens(description, query)
                  ? 10
                  : 0;
  return variant.source === "TYPO_CORRECTION" ? value * 0.85 : value;
}

export function companyRelevanceScore(
  candidate: CompanySearchCandidate,
  variants: readonly SearchQueryVariant[],
) {
  return Math.max(
    0,
    ...variants.map((variant) =>
      fieldScore(candidate, normalized(variant.value), variant),
    ),
  );
}

export function compareCompaniesForSearch(
  left: CompanySearchCandidate & { id: string },
  right: CompanySearchCandidate & { id: string },
  variants: readonly SearchQueryVariant[],
) {
  const scoreDifference =
    companyRelevanceScore(right, variants) -
    companyRelevanceScore(left, variants);
  if (scoreDifference) return scoreDifference;
  return (
    left.displayName.localeCompare(right.displayName) ||
    left.id.localeCompare(right.id)
  );
}
