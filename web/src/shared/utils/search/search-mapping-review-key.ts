/**
 * Canonical queue-key normalization shared by catalog bootstrap and runtime
 * projection. Keeping this helper free of database/server imports makes the
 * identity rule deterministic in scripts, API code and unit tests.
 */
export function normalizeSearchMappingReviewTitle(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}+#.]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ")
    .slice(0, 160);
}

export function searchMappingReviewTitleOpenKey(
  catalogVersion: string,
  canonicalTitleEn: string,
): string {
  const normalizedTitle = normalizeSearchMappingReviewTitle(canonicalTitleEn);
  if (!normalizedTitle) {
    throw new Error("SEARCH_MAPPING_REVIEW_TITLE_REQUIRED");
  }
  return `${catalogVersion}:${normalizedTitle}`.slice(0, 240);
}
