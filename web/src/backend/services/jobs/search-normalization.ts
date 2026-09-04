import "server-only";
import { z } from "zod";
import { jobSortSchema } from "@/shared/contracts/jobs/discovery";

const cursorSchema = z
  .object({
    v: z.literal(1),
    sort: jobSortSchema,
    score: z.number().finite().optional(),
    urgent: z.boolean().optional(),
    publishedAt: z.string().datetime(),
    salaryMaximum: z
      .string()
      .regex(/^\d+(?:\.\d{1,2})?$/u)
      .nullable()
      .optional(),
    id: z.string().min(1).max(128),
  })
  .strict();

export type JobSearchCursor = z.infer<typeof cursorSchema>;

export function normalizeSearchText(value: string, maximum = 200): string {
  if (Array.from(value).length > maximum) {
    throw new Error("JOB_SEARCH_TEXT_TOO_LONG");
  }
  return (
    value
      .normalize("NFD")
      .replace(/[đĐ]/gu, "d")
      .replace(/\p{M}+/gu, "")
      .toLowerCase()
      // Keep technology identifiers searchable as identifiers.  `C++`, `C#`,
      // `.NET`, `Node.js`, and `React.js` must not collapse into unrelated
      // one-letter or generic tokens, while ordinary punctuation remains a
      // word separator.
      .replace(/[^\p{L}\p{N}+#.]+/gu, " ")
      .trim()
      .replace(/\s+/gu, " ")
  );
}

/**
 * The resolver keeps several intentionally separate representations of a
 * query.  `normalizedQuery` is the backwards-compatible value used by the
 * existing SQL predicates; `foldedQuery` is the accent-insensitive value used
 * by vocabulary matching and `compactQuery` is only used for compact aliases
 * (for example `ketoan`).  None of these values should be used as display
 * copy.
 */
export type SearchQueryRepresentations = Readonly<{
  originalQuery: string;
  normalizedQuery: string;
  foldedQuery: string;
  compactQuery: string;
  effectiveQuery: string;
}>;

export function foldSearchText(value: string, maximum = 200) {
  return normalizeSearchText(value, maximum);
}

export function compactSearchText(value: string, maximum = 200) {
  return foldSearchText(value, maximum).replace(/\s+/gu, "");
}

export function searchQueryRepresentations(
  originalQuery: string,
  effectiveQuery = originalQuery,
): SearchQueryRepresentations {
  const normalizedQuery = normalizeSearchText(originalQuery);
  const foldedQuery = foldSearchText(originalQuery);
  const normalizedEffectiveQuery = normalizeSearchText(effectiveQuery);
  return Object.freeze({
    originalQuery,
    normalizedQuery,
    foldedQuery,
    compactQuery: compactSearchText(originalQuery),
    effectiveQuery: normalizedEffectiveQuery,
  });
}

/**
 * Return the normalized terms used by the SQL search predicates.
 *
 * Keeping this split in one place makes free-text keyword and location
 * matching consistent.  The caller is expected to normalize the value first;
 * accepting repeated whitespace here keeps the helper safe for repository
 * callers and makes the intended AND-per-term semantics explicit.
 */
export function searchTextTokens(value: string): string[] {
  return value.trim().split(/\s+/u).filter(Boolean);
}

/**
 * Public job locations are projected as "district, city" before being
 * normalized. Compose the same canonical value for a district-level filter
 * so it can be matched exactly instead of as a broad text fragment.
 */
export function normalizedDistrictLocation(
  city: string,
  district: string,
): string {
  return [district, city].filter(Boolean).join(" ");
}

export function encodeJobCursor(cursor: JobSearchCursor): string {
  const parsed = cursorSchema.parse(cursor);
  return Buffer.from(JSON.stringify(parsed), "utf8").toString("base64url");
}

export function decodeJobCursor(
  value: string,
  expectedSort: z.infer<typeof jobSortSchema>,
): JobSearchCursor {
  try {
    if (value.length > 1024) throw new Error();
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const parsed = cursorSchema.parse(JSON.parse(decoded));
    if (parsed.sort !== expectedSort) throw new Error();
    return parsed;
  } catch {
    throw new Error("JOB_SEARCH_CURSOR_INVALID");
  }
}
