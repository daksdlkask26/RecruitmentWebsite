import { describe, expect, it } from "vitest";
import { searchInterpretationSchema } from "@/shared/contracts/search/search-interpretation";

describe("Search observability composition", () => {
  it("routes bounded search events through the production composition channel", async () => {
    const { configureSearchObservability, searchObservabilityChannel } =
      await import("@/backend/observability/search-observability-composition");
    const { emitSearchCatalogRuntimeMetric } =
      await import("@/backend/observability/search-catalog-runtime-metrics");
    const { emitSearchResolutionMetric } =
      await import("@/backend/observability/search-resolution-metrics");
    const events: unknown[] = [];
    const channel = searchObservabilityChannel();
    const listener = (event: unknown) => events.push(event);
    channel.subscribe(listener);
    try {
      configureSearchObservability();
      emitSearchCatalogRuntimeMetric({
        event: "search_catalog_runtime",
        outcome: "CACHE_HIT",
        source: "DATABASE",
        catalogVersion: "catalog-1",
      });
      emitSearchResolutionMetric({
        context: "JOBS",
        interpretation: searchInterpretationSchema.parse({
          mode: "SMART",
          originalQuery: "frotend",
          normalizedQuery: "frotend",
          effectiveQuery: "frontend",
          reason: "TYPO_CORRECTED",
          confidence: "HIGH",
          correction: { from: "frotend", to: "frontend" },
          appliedTerms: ["frontend"],
          canSearchLiteral: true,
        }),
        variantCount: 2,
        resultCount: 1,
        durationMs: 12,
      });
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        event: "search_catalog_runtime",
        outcome: "CACHE_HIT",
      });
      expect(events[1]).toMatchObject({
        event: "search_resolution",
        reason: "TYPO_CORRECTED",
        candidateSetSizeClass: "unknown",
      });
      expect(JSON.stringify(events)).not.toContain("frotend");
    } finally {
      channel.unsubscribe(listener);
    }
  });
});
