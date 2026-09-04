import { normalizeSearchText } from "@/backend/services/jobs/search-normalization";

/**
 * Retrieval must never turn a short token into an unrestricted substring
 * scan.  Keep this policy shared by Jobs and Company search so a new surface
 * cannot accidentally re-introduce matches such as `it` -> `digital`.
 */
export const SEARCH_TOKEN_KINDS = [
  "SAFE_WORD",
  "KNOWN_ABBREVIATION",
  "SHORT_AMBIGUOUS",
  "GENERIC_ROLE",
  "STOPWORD",
] as const;

export type SearchTokenKind = (typeof SEARCH_TOKEN_KINDS)[number];

const knownAbbreviations = new Set([
  "ai",
  "hr",
  "it",
  "qa",
  "qc",
  "ui",
  "ux",
  "c",
  "c++",
  "c#",
  ".net",
  "r",
]);

const genericRoleTokens = new Set([
  "staff",
  "specialist",
  "executive",
  "engineer",
  "developer",
  "manager",
  "head",
  "intern",
  "nhan",
  "vien",
  "chuyen",
  "ky",
  "su",
  "quan",
  "ly",
  "truong",
]);

const stopwords = new Set([
  "and",
  "or",
  "of",
  "the",
  "a",
  "an",
  "va",
  "cua",
  "cho",
]);

export function classifySearchToken(value: string): SearchTokenKind {
  const token = normalizeSearchText(value, 80);
  if (!token) return "STOPWORD";
  if (stopwords.has(token)) return "STOPWORD";
  if (knownAbbreviations.has(token)) return "KNOWN_ABBREVIATION";
  if (genericRoleTokens.has(token)) return "GENERIC_ROLE";
  if (Array.from(token).length <= 2) return "SHORT_AMBIGUOUS";
  return "SAFE_WORD";
}

export function isRetrievalSafeToken(value: string) {
  const kind = classifySearchToken(value);
  return kind !== "STOPWORD";
}

export function hasRetrievalSafeToken(tokens: readonly string[]) {
  return tokens.some(isRetrievalSafeToken);
}

/** Escape a token before it is sent as a PostgreSQL regular-expression value. */
export function escapePostgresRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function compactSearchToken(value: string) {
  return value.replace(/\s+/gu, "");
}
