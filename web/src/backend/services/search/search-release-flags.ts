import "server-only";

/**
 * Runtime switches used by the Search V2 rollout. They are intentionally
 * read on every request so an operator can disable a risky branch without a
 * rebuild. Values are server-side only; never expose them to the browser.
 */
export const SEARCH_RELEASE_FLAGS_VERSION = "search-release-flags-v1" as const;

export type SearchReleaseFlags = Readonly<{
  databaseCatalogEnabled: boolean;
  typoV2Enabled: boolean;
  retrievalV2Enabled: boolean;
  rankingV2Enabled: boolean;
  relaxationEnabled: boolean;
  semanticFallbackEnabled: boolean;
}>;

type FlagEnvironment = Readonly<Record<string, string | undefined>>;

function booleanFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "on", "yes", "enabled"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "off", "no", "disabled"].includes(normalized)) {
    return false;
  }
  return fallback;
}

export function readSearchReleaseFlags(
  environment: FlagEnvironment = process.env,
): SearchReleaseFlags {
  return Object.freeze({
    databaseCatalogEnabled: booleanFlag(
      environment.SEARCH_DB_CATALOG_ENABLED,
      true,
    ),
    typoV2Enabled: booleanFlag(environment.SEARCH_TYPO_V2_ENABLED, true),
    retrievalV2Enabled: booleanFlag(
      environment.SEARCH_RETRIEVAL_V2_ENABLED,
      true,
    ),
    rankingV2Enabled: booleanFlag(environment.SEARCH_RANKING_V2_ENABLED, true),
    relaxationEnabled: booleanFlag(environment.SEARCH_RELAXATION_ENABLED, true),
    semanticFallbackEnabled: booleanFlag(
      environment.SEARCH_SEMANTIC_FALLBACK_ENABLED,
      false,
    ),
  });
}

export function searchReleaseFlags(): SearchReleaseFlags {
  return readSearchReleaseFlags();
}
