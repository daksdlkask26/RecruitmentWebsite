import { afterEach, describe, expect, it } from "vitest";
import {
  configureSearchCatalogRuntimeObservability,
  type SearchCatalogRuntimeMetric,
} from "@/backend/observability/search-catalog-runtime-metrics";
import { resolveSearchQuery } from "@/backend/services/search/search-query-resolver";
import { PrismaSearchCatalogProvider } from "@/backend/services/search/catalogs/search-catalog-provider";
import {
  readSearchReleaseFlags,
  SEARCH_RELEASE_FLAGS_VERSION,
} from "@/backend/services/search/search-release-flags";

const flagNames = [
  "SEARCH_DB_CATALOG_ENABLED",
  "SEARCH_TYPO_V2_ENABLED",
  "SEARCH_RETRIEVAL_V2_ENABLED",
  "SEARCH_RANKING_V2_ENABLED",
  "SEARCH_RELAXATION_ENABLED",
  "SEARCH_SEMANTIC_FALLBACK_ENABLED",
] as const;
const originalFlags = Object.fromEntries(
  flagNames.map((name) => [name, process.env[name]]),
) as Record<(typeof flagNames)[number], string | undefined>;

afterEach(() => {
  for (const name of flagNames) {
    const value = originalFlags[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  configureSearchCatalogRuntimeObservability();
});

describe("search release flags", () => {
  it("defaults to the safe rollout configuration and parses explicit values", () => {
    for (const name of flagNames) delete process.env[name];
    expect(readSearchReleaseFlags()).toEqual({
      databaseCatalogEnabled: true,
      typoV2Enabled: true,
      retrievalV2Enabled: true,
      rankingV2Enabled: true,
      relaxationEnabled: true,
      semanticFallbackEnabled: false,
    });
    expect(SEARCH_RELEASE_FLAGS_VERSION).toBe("search-release-flags-v1");

    process.env.SEARCH_DB_CATALOG_ENABLED = "off";
    process.env.SEARCH_TYPO_V2_ENABLED = "0";
    process.env.SEARCH_RETRIEVAL_V2_ENABLED = "disabled";
    process.env.SEARCH_RANKING_V2_ENABLED = "false";
    process.env.SEARCH_RELAXATION_ENABLED = "no";
    process.env.SEARCH_SEMANTIC_FALLBACK_ENABLED = "on";
    expect(readSearchReleaseFlags()).toMatchObject({
      databaseCatalogEnabled: false,
      typoV2Enabled: false,
      retrievalV2Enabled: false,
      rankingV2Enabled: false,
      relaxationEnabled: false,
      semanticFallbackEnabled: true,
    });
  });

  it("fails closed to defaults for malformed flag values", () => {
    process.env.SEARCH_DB_CATALOG_ENABLED = "maybe";
    process.env.SEARCH_TYPO_V2_ENABLED = "unknown";
    process.env.SEARCH_SEMANTIC_FALLBACK_ENABLED = "maybe";

    expect(readSearchReleaseFlags()).toMatchObject({
      databaseCatalogEnabled: true,
      typoV2Enabled: true,
      semanticFallbackEnabled: false,
    });
  });

  it("disables automatic typo correction without changing literal mode", () => {
    process.env.SEARCH_TYPO_V2_ENABLED = "false";

    const result = resolveSearchQuery("ke tona", "JOBS", "vi");
    expect(result.correction).toBeUndefined();
    expect(result.variants).toEqual([
      expect.objectContaining({ value: "ke tona", source: "ORIGINAL" }),
    ]);
  });

  it("falls back atomically when the database catalog flag is disabled", async () => {
    process.env.SEARCH_DB_CATALOG_ENABLED = "false";
    const metrics: SearchCatalogRuntimeMetric[] = [];
    configureSearchCatalogRuntimeObservability({
      emit: (metric) => metrics.push(metric),
    });
    const provider = new PrismaSearchCatalogProvider({
      loader: async () => {
        throw new Error("loader must not run while disabled");
      },
    });

    const active = await provider.getActiveSnapshot();
    const explicit = await provider.getSnapshot("catalog-disabled");
    expect(active.source).toBe("STATIC_FALLBACK");
    expect(explicit).toBeNull();
    expect(metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outcome: "STATIC_FALLBACK",
          reason: "FEATURE_DISABLED",
        }),
        expect.objectContaining({
          outcome: "DATABASE_LOAD_FAILURE",
          reason: "FEATURE_DISABLED",
          requestedVersion: "catalog-disabled",
        }),
      ]),
    );
  });
});
