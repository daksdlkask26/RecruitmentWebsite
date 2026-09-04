import "server-only";

export type SearchCatalogRuntimeMetric = Readonly<{
  event: "search_catalog_runtime";
  outcome:
    | "DATABASE_LOAD_SUCCESS"
    | "DATABASE_LOAD_FAILURE"
    | "INVALID_CATALOG"
    | "STATIC_FALLBACK"
    | "CACHE_HIT"
    | "CACHE_INVALIDATED";
  source: "DATABASE" | "STATIC_FALLBACK";
  requestedVersion?: string;
  catalogVersion?: string;
  reason?:
    | "DATABASE_UNAVAILABLE"
    | "MISSING_PAYLOAD"
    | "RELATIONAL_MISMATCH"
    | "SCHEMA_INVALID"
    | "VERSION_UNAVAILABLE"
    | "FEATURE_DISABLED"
    | "EXPLICIT_INVALIDATION";
}>;

export type SearchCatalogRuntimeObservability = Readonly<{
  emit: (metric: SearchCatalogRuntimeMetric) => void;
}>;

const defaultObservability: SearchCatalogRuntimeObservability = {
  // The composition root replaces this in a running server. Keep direct
  // console output strictly as a development fallback for isolated scripts.
  emit: (metric) => {
    if (process.env.NODE_ENV !== "production")
      console.info("search_catalog_runtime", metric);
  },
};

let observability = defaultObservability;

export function configureSearchCatalogRuntimeObservability(
  adapter?: SearchCatalogRuntimeObservability,
) {
  observability = adapter ?? defaultObservability;
}

export function emitSearchCatalogRuntimeMetric(
  metric: SearchCatalogRuntimeMetric,
) {
  observability.emit(metric);
}
