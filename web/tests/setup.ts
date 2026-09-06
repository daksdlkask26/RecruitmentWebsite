import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { resolve } from "node:path";
import { afterEach, vi } from "vitest";
import { assertRequestedTestDatabase } from "./helpers/test-database-guard";

const cvTestEnvironment = {
  CV_STORAGE_ADAPTER: "filesystem",
  CV_STORAGE_LOCAL_ROOT: resolve(process.cwd(), ".local/cv-storage-test"),
  CV_ARTIFACT_ACTIVE_KEY_VERSION: "1",
  CV_ARTIFACT_KEY_V1: Buffer.alloc(32, 0x74).toString("base64"),
  CV_CLAMD_SOCKET_PATH: "/run/clamav/clamd.sock",
  CV_CLAMD_SIGNATURE_MAX_AGE_HOURS: "24",
  CV_PARSER_ADAPTER: "deterministic",
  CV_OPENAI_ENABLED: "false",
  CV_OPENAI_MODEL: "gpt-5.4-mini-2026-03-17",
  CV_OPENAI_DPA_APPROVED: "false",
  CV_OPENAI_CROSS_BORDER_APPROVED: "false",
  CV_OPENAI_ZDR_APPROVED: "false",
  CV_WORKER_ENABLED: "false",
  CV_CLEANUP_ENABLED: "true",
  CV_SOURCE_MAX_BYTES: "5000000",
  CV_UPLOAD_ATTEMPTS_PER_HOUR: "5",
  CV_ACCOUNT_MAX_IMPORTS: "10",
  CV_ACCOUNT_MAX_STORAGE_BYTES: "52428800",
  CV_REJECTED_RETENTION_HOURS: "24",
  CV_UNCONFIRMED_RETENTION_DAYS: "30",
  CV_CONFIRMED_RETENTION_DAYS: "7",
  CV_CANDIDATE_DELETE_RETENTION_HOURS: "24",
} as const;

// Vitest keeps a single worker process for the database-backed run. A suite
// that mutates process.env (or uses vi.stubEnv) therefore used to change the
// URLs and auth origins observed by later Route Handler suites. Capture the
// worker baseline after vitest.config has loaded .env.local and restore it
// after every test so order cannot change the contract under test.
const baselineEnvironment = new Map(Object.entries(process.env));

function restoreBaselineEnvironment() {
  for (const key of Object.keys(process.env)) {
    if (!baselineEnvironment.has(key)) delete process.env[key];
  }
  for (const [key, value] of baselineEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

for (const [key, value] of Object.entries(cvTestEnvironment)) {
  process.env[key] ??= value;
}

// Any explicitly selected integration/compatibility suite is allowed to
// reach Prisma only after proving that both connection URLs point at an
// isolated test endpoint. Definitively DB-free unit/component suites remain
// exempt; known identity units using real Prisma are marked in vitest.config.
const dbBackedSuiteRequested = process.argv.some((argument) =>
  /tests[\\/](?:backend[\\/](?:integration|compatibility)|system[\\/]e2e)(?:[\\/]|$)/u.test(
    argument,
  ),
);
if (
  dbBackedSuiteRequested ||
  process.env.SMART_HIRE_TEST_DATABASE_REQUIRED === "1"
) {
  assertRequestedTestDatabase();
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreBaselineEnvironment();
});
