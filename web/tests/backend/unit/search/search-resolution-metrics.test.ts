import { describe, expect, it } from "vitest";
import { buildSearchResolutionMetric } from "@/backend/observability/search-resolution-metrics";
import { searchInterpretationSchema } from "@/shared/contracts/search/search-interpretation";

describe("search resolution metrics", () => {
  it("emits bounded, query-free dimensions for a corrected search", () => {
    const interpretation = searchInterpretationSchema.parse({
      mode: "SMART",
      originalQuery: "accountnat",
      normalizedQuery: "accountnat",
      effectiveQuery: "accountant",
      reason: "TYPO_CORRECTED",
      confidence: "HIGH",
      correction: { from: "accountnat", to: "accountant" },
      corrections: [
        {
          from: "accountnat",
          to: "accountant",
          confidence: "HIGH",
          reason: "TYPO",
        },
      ],
      autoCorrected: true,
      resolverVersion: "resolver-1",
      catalogVersion: "catalog-1",
      appliedTerms: ["accountant"],
      canSearchLiteral: true,
      usedFallback: true,
    });

    const metric = buildSearchResolutionMetric({
      context: "JOBS",
      interpretation,
      variantCount: 12,
      resultCount: 4,
      durationMs: 1_250,
      candidateCount: 420,
    });

    expect(metric).toMatchObject({
      event: "search_resolution",
      context: "JOBS",
      reason: "TYPO_CORRECTED",
      confidence: "HIGH",
      usedFallback: true,
      autoCorrected: true,
      variantCount: 8,
      resultCount: 4,
      candidateCount: 420,
      candidateSetSizeClass: "lt_1k",
      zeroResult: false,
      matchedTitle: false,
      correctionMode: "auto",
      literalOverride: false,
      projectionState: "unknown",
      candidateCapReached: false,
      durationClass: "lt_2s",
      resolverVersion: "resolver-1",
      catalogVersion: "catalog-1",
    });
    expect(JSON.stringify(metric)).not.toContain("accountnat");
    expect(JSON.stringify(metric)).not.toContain("accountant");
  });
});
