import { describe, expect, it } from "vitest";
import {
  evaluateSearchCanaryGate,
  SEARCH_CANARY_REPORT_VERSION,
} from "@/backend/services/search/search-canary-gate";

function report(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: SEARCH_CANARY_REPORT_VERSION,
    owner: "search-platform-on-call",
    generatedAt: "2026-09-03T00:00:00.000Z",
    sampleCount: 100,
    errorRate: 0,
    zeroResultRate: 0,
    wrongCorrectionRate: 0,
    criticalWrongCorrectionRate: 0,
    fallbackRate: 0,
    candidateCapRate: 0,
    p95Ms: 100,
    p99Ms: 200,
    relevancePassed: true,
    projectionInvariantPassed: true,
    browserE2ePassed: true,
    migrationPassed: true,
    runtimeCatalogObserved: true,
    rollbackReady: true,
    ...overrides,
  };
}

describe("search canary gate", () => {
  it("passes a complete healthy report", () => {
    expect(evaluateSearchCanaryGate(report())).toEqual({
      passed: true,
      owner: "search-platform-on-call",
      sampleCount: 100,
      stopLineReasons: [],
    });
  });

  it("stops the rollout for critical corrections, budgets, and missing gates", () => {
    const result = evaluateSearchCanaryGate(
      report({
        criticalWrongCorrectionRate: 0.001,
        p95Ms: 2_001,
        browserE2ePassed: false,
        rollbackReady: false,
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.stopLineReasons).toEqual([
      "CRITICAL_WRONG_CORRECTION",
      "P95_LATENCY",
      "BROWSER_E2E_GATE",
      "ROLLBACK_NOT_READY",
    ]);
  });

  it("rejects malformed or raw-query-bearing reports", () => {
    expect(
      evaluateSearchCanaryGate({
        ...report(),
        query: "kế toán",
      }),
    ).toEqual({ passed: false, stopLineReasons: ["REPORT_INVALID"] });
    expect(
      evaluateSearchCanaryGate({ ...report(), sampleCount: 99 }),
    ).toMatchObject({
      passed: false,
      stopLineReasons: ["SAMPLE_COUNT_BELOW_MINIMUM"],
    });
  });
});
