import "server-only";

import { z } from "zod";

const ratio = z.number().finite().min(0).max(1);
const latency = z.number().finite().min(0).max(60_000);

export const SEARCH_CANARY_REPORT_VERSION = "search-canary-report-v1" as const;

export const searchCanaryReportSchema = z
  .object({
    schemaVersion: z.literal(SEARCH_CANARY_REPORT_VERSION),
    owner: z.string().trim().min(1).max(120),
    generatedAt: z.string().datetime(),
    sampleCount: z.number().int().min(1).max(10_000_000),
    errorRate: ratio,
    zeroResultRate: ratio,
    wrongCorrectionRate: ratio,
    criticalWrongCorrectionRate: ratio,
    fallbackRate: ratio,
    candidateCapRate: ratio,
    p95Ms: latency,
    p99Ms: latency,
    relevancePassed: z.boolean(),
    projectionInvariantPassed: z.boolean(),
    browserE2ePassed: z.boolean(),
    migrationPassed: z.boolean(),
    runtimeCatalogObserved: z.boolean(),
    rollbackReady: z.boolean(),
  })
  .strict();

export type SearchCanaryReport = z.infer<typeof searchCanaryReportSchema>;

export const SEARCH_CANARY_THRESHOLDS = Object.freeze({
  minimumSamples: 100,
  errorRate: 0.01,
  zeroResultRate: 0.02,
  wrongCorrectionRate: 0.01,
  fallbackRate: 0.05,
  candidateCapRate: 0.05,
  p95Ms: 2_000,
  p99Ms: 5_000,
});

export type SearchCanaryGateResult = Readonly<{
  passed: boolean;
  owner?: string;
  sampleCount?: number;
  stopLineReasons: readonly string[];
}>;

export function evaluateSearchCanaryGate(
  raw: unknown,
  thresholds = SEARCH_CANARY_THRESHOLDS,
): SearchCanaryGateResult {
  const parsed = searchCanaryReportSchema.safeParse(raw);
  if (!parsed.success) {
    return { passed: false, stopLineReasons: ["REPORT_INVALID"] };
  }

  const report = parsed.data;
  const reasons: string[] = [];
  if (report.sampleCount < thresholds.minimumSamples)
    reasons.push("SAMPLE_COUNT_BELOW_MINIMUM");
  if (report.errorRate > thresholds.errorRate) reasons.push("ERROR_RATE");
  if (report.zeroResultRate > thresholds.zeroResultRate)
    reasons.push("ZERO_RESULT_RATE");
  if (report.wrongCorrectionRate > thresholds.wrongCorrectionRate)
    reasons.push("WRONG_CORRECTION_RATE");
  if (report.criticalWrongCorrectionRate > 0)
    reasons.push("CRITICAL_WRONG_CORRECTION");
  if (report.fallbackRate > thresholds.fallbackRate)
    reasons.push("FALLBACK_RATE");
  if (report.candidateCapRate > thresholds.candidateCapRate)
    reasons.push("CANDIDATE_CAP_RATE");
  if (report.p95Ms > thresholds.p95Ms) reasons.push("P95_LATENCY");
  if (report.p99Ms > thresholds.p99Ms) reasons.push("P99_LATENCY");
  if (!report.relevancePassed) reasons.push("RELEVANCE_GATE");
  if (!report.projectionInvariantPassed) reasons.push("PROJECTION_INVARIANT");
  if (!report.browserE2ePassed) reasons.push("BROWSER_E2E_GATE");
  if (!report.migrationPassed) reasons.push("MIGRATION_GATE");
  if (!report.runtimeCatalogObserved)
    reasons.push("RUNTIME_CATALOG_UNOBSERVED");
  if (!report.rollbackReady) reasons.push("ROLLBACK_NOT_READY");

  return {
    passed: reasons.length === 0,
    owner: report.owner,
    sampleCount: report.sampleCount,
    stopLineReasons: reasons,
  };
}
