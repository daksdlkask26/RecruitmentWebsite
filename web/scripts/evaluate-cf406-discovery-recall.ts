import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { config } from "dotenv";

config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

async function main() {
  const { assertTestDatabaseEnvironment } =
    await import("../tests/helpers/test-database-guard");
  assertTestDatabaseEnvironment();

  const { evaluateRuntimeJobSearchRelevance } =
    await import("../src/backend/services/search/search-relevance-evaluation");

  const result = await evaluateRuntimeJobSearchRelevance();
  const generatedAt = new Date().toISOString();
  const reportPath = resolve(
    process.cwd(),
    "..",
    "docs/audits/candidate-first/phase-4/evidence/cf406-discovery-recall.json",
  );
  const markdownPath = reportPath.replace(/\.json$/u, ".md");
  const report = {
    schemaVersion: "candidate-first-cf406-discovery-recall-v1",
    generatedAt,
    source: "active search catalog snapshot",
    corpus: result,
    baselineComparison: {
      status: "UNVERIFIED",
      reason:
        "The required same-run pre-change expected-ID baseline was not available without checking out or resetting the starting commit.",
      historicalArtifactsAreNotSubstituted: true,
    },
    limitations: [
      "The existing source-controlled corpus labels canonical catalog title IDs, not a newly seeded live JobPosting ID set.",
      "This report is a current catalog-resolution recall signal; it does not replace a live database broad-query recall rerun.",
    ],
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(
    markdownPath,
    [
      "# CF-406 discovery recall (current catalog run)",
      "",
      `- Generated: ${generatedAt}`,
      `- Corpus: ${result.corpusVersion}`,
      `- Cases: ${result.caseCount}`,
      `- Catalog coverage: ${result.catalogCoverageMatched}/${result.catalogCoverageTotal} (${(result.catalogCoverageRate * 100).toFixed(1)}%)`,
      `- Recall@10: ${(result.recallAt10 * 100).toFixed(1)}%`,
      `- Precision@10: ${(result.precisionAt10 * 100).toFixed(1)}%`,
      `- MRR: ${result.mrr.toFixed(3)}`,
      `- nDCG@10: ${result.ndcgAt10.toFixed(3)}`,
      `- Zero-result rate: ${(result.zeroResultRate * 100).toFixed(1)}%`,
      `- Passed: ${result.passed ? "yes" : "no"}`,
      "",
      "This is current catalog-resolution evidence. A same-run live JobPosting expected-ID baseline and mutation-to-read comparison remain UNVERIFIED; historical artifacts are not relabelled as current proof.",
      "",
    ].join("\n"),
    "utf8",
  );
  console.log(JSON.stringify(report, null, 2));
  if (!result.passed) process.exitCode = 1;
}

void main();
