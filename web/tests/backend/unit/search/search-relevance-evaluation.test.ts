import { describe, expect, it } from "vitest";
import {
  evaluateJobSearchRelevance,
  SEARCH_RELEVANCE_CORPUS,
  SEARCH_RELEVANCE_CORPUS_VERSION,
} from "@/backend/services/search/search-relevance-evaluation";
import { jobSearchCatalogIndex } from "@/backend/services/search/catalogs/job-search-catalog-index";

describe("job search relevance evaluation", () => {
  it("passes the versioned corpus and full bilingual catalog coverage", () => {
    const result = evaluateJobSearchRelevance(jobSearchCatalogIndex);
    const titleCount =
      jobSearchCatalogIndex.catalog.titleDefinitions?.length ?? 0;

    expect(result.corpusVersion).toBe(SEARCH_RELEVANCE_CORPUS_VERSION);
    expect(result.caseCount).toBe(SEARCH_RELEVANCE_CORPUS.length);
    expect(result.catalogCoverageTotal).toBe(titleCount * 2);
    expect(result.catalogCoverageMatched).toBe(titleCount * 2);
    expect(result.catalogCoverageRate).toBe(1);
    expect(result.catalogCoverageFailures).toEqual([]);
    expect(result.recallAt10).toBe(1);
    expect(result.mrr).toBeGreaterThanOrEqual(0.9);
    expect(result.ndcgAt10).toBeGreaterThanOrEqual(0.85);
    expect(result.wrongCorrectionRate).toBeLessThanOrEqual(0.02);
    expect(result.zeroResultRate).toBe(0);
    expect(result.failedCases).toEqual([]);
    expect(result.passed).toBe(true);
  }, 120_000);
});
