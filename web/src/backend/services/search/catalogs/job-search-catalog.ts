import {
  searchCatalogSchema,
  type SearchCatalog,
} from "@/shared/contracts/search/job-search-intent";
import releaseCatalogPayload from "./job-search-catalog-release-2026-09-04.json";

/**
 * Immutable release snapshot used when a database catalog is unavailable.
 *
 * The JSON payload is exported from the PUBLISHED/ACTIVE database catalog by
 * `search:catalog:export-release`; it is intentionally not rebuilt from the
 * pre-review taxonomy sources. This keeps the fallback and runtime catalog
 * semantically identical, including human-verified title translations.
 */
export const JOB_SEARCH_CATALOG_VERSION = "2026-09-04.1-2026-09-04.1";

const parsedReleaseCatalog: SearchCatalog = searchCatalogSchema.parse(
  releaseCatalogPayload,
);

if (parsedReleaseCatalog.version !== JOB_SEARCH_CATALOG_VERSION) {
  throw new Error(
    `Static search catalog version mismatch: expected ${JOB_SEARCH_CATALOG_VERSION}, found ${parsedReleaseCatalog.version}`,
  );
}

export const jobSearchCatalog = parsedReleaseCatalog;

export const jobSearchCatalogOccupationCount =
  jobSearchCatalog.occupations.length;
