import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  evaluateSearchCanaryGate,
  SEARCH_CANARY_REPORT_VERSION,
  type SearchCanaryReport,
} from "../src/backend/services/search/search-canary-gate";

function passingReport(): SearchCanaryReport {
  return {
    schemaVersion: SEARCH_CANARY_REPORT_VERSION,
    owner: "search-platform-on-call",
    generatedAt: new Date().toISOString(),
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
  };
}

function reportPath() {
  const index = process.argv.indexOf("--report");
  const supplied = index >= 0 ? process.argv[index + 1] : undefined;
  return supplied?.trim() || process.env.SEARCH_CANARY_REPORT_PATH?.trim();
}

const raw = process.argv.includes("--self-test")
  ? passingReport()
  : (() => {
      const path = reportPath();
      if (!path) {
        throw new Error(
          "SEARCH_CANARY_REPORT_REQUIRED: pass --report <path> or SEARCH_CANARY_REPORT_PATH",
        );
      }
      return JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8"));
    })();

const result = evaluateSearchCanaryGate(raw);
console.log(
  `SEARCH_CANARY_GATE_RESULT\n${JSON.stringify(
    {
      passed: result.passed,
      owner: result.owner ?? null,
      sampleCount: result.sampleCount ?? null,
      stopLineReasons: result.stopLineReasons,
    },
    null,
    2,
  )}`,
);
if (!result.passed) process.exitCode = 1;
