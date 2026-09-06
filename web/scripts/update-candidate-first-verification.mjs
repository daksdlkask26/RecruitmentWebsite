// Publish the current Candidate-first evidence index from the canonical Stage 0 record.
// This script never invents historical PASS counts and never mutates a database.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const auditRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../docs/audits",
);
const canonicalFile = "2026-09-06-gate0-stage0-final-verification.json";
const outputFile = resolve(auditRoot, "2026-09-06-verification.json");
const report = JSON.parse(
  await readFile(resolve(auditRoot, canonicalFile), "utf8"),
);
const rawFile = report.workItems?.["CF-002"]?.fullRaw;
const triageFile =
  "2026-09-06-gate0-recheck-final-source-triage.json";
if (!rawFile) throw new Error("CANONICAL_FULL_RAW_MISSING");
const raw = JSON.parse(await readFile(resolve(auditRoot, rawFile), "utf8"));
const triage = JSON.parse(
  await readFile(resolve(auditRoot, triageFile), "utf8"),
);
const expected = report.workItems["CF-002"].fullRawTotals;
const actual = {
  tests: raw.numTotalTests,
  passed: raw.numPassedTests,
  failed: raw.numFailedTests,
  skipped: raw.numPendingTests,
};
for (const key of Object.keys(expected)) {
  if (expected[key] !== actual[key])
    throw new Error("VERIFICATION_RAW_COUNT_MISMATCH:" + key);
}
if (
  report.decision !== "CLOSED_FOR_CANDIDATE_FIRST_SCOPE" ||
  !triage.gates.candidateFirst ||
  !triage.gates.changedScope
)
  throw new Error("CANONICAL_STAGE0_DECISION_INVALID");

const index = {
  schemaVersion: "candidate-first-verification-index-v1",
  generatedAt: new Date().toISOString(),
  canonicalVerification: canonicalFile,
  decision: report.decision,
  rawReport: rawFile,
  triageReport: triageFile,
  acceptanceScope: report.workItems["CF-002"].acceptanceScope,
  fullRawTotals: actual,
  workItems: report.workItems,
  staticVerification: report.staticVerification,
  cleanup: report.cleanup,
  postCleanupVerification: report.postCleanupVerification,
  sharedReadOnlyVerification: report.sharedReadOnlyVerification,
  runtimeReadOnlyVerification: report.runtimeReadOnlyVerification,
  remainingOutsideStage0: report.remainingOutsideStage0,
};
await writeFile(
  outputFile,
  JSON.stringify(index, null, 2) + "\n",
  "utf8",
);
console.log(
  JSON.stringify({
    canonicalFile,
    decision: report.decision,
    fullRawTotals: actual,
    acceptanceScope: report.workItems["CF-002"].acceptanceScope,
  }),
);
