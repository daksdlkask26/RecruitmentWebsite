import {
  searchCatalogSchema,
  type BilingualJobTitleDefinition,
} from "@/shared/contracts/search/job-search-intent";
import releaseCatalogPayload from "./job-search-catalog-release-2026-09-04.json";

/**
 * Title definitions for the current immutable release. Keeping this export
 * backed by the same snapshot as `job-search-catalog.ts` prevents tests and
 * auxiliary consumers from falling back to the pre-review title corpus.
 */
export const BILINGUAL_JOB_TITLE_CATALOG_VERSION = "2026-09-04.1";

const parsedCatalog = searchCatalogSchema.parse(releaseCatalogPayload);

export const bilingualJobTitleDefinitions: readonly BilingualJobTitleDefinition[] =
  Object.freeze([...(parsedCatalog.titleDefinitions ?? [])]);

export function withBilingualJobTitleDefinitions(
  catalog: Record<string, unknown>,
) {
  return {
    ...catalog,
    titleDefinitions: [...bilingualJobTitleDefinitions],
  };
}
