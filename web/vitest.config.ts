import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { config as loadEnvironment } from "dotenv";

loadEnvironment({ path: ".env.local", quiet: true });

// Vitest runs setup files inside worker processes whose argv may no longer
// contain the selected test path. Propagate the database-backed-suite marker
// while the main config process still sees the original CLI arguments, so the
// setup guard cannot be bypassed by a worker argv shape. A path-less invocation
// (`vitest run`) is treated as database-backed because it can collect an
// integration suite; only definitively DB-free unit/component paths remain
// exempt, while known identity units using real Prisma are included below.
const hasExplicitTestPath = process.argv.some((argument) =>
  /(?:^|[\\/])tests[\\/]/u.test(argument),
);
const hasDatabaseBackedTestPath = process.argv.some((argument) =>
  /tests[\\/](?:backend[\\/](?:integration|compatibility)|system[\\/]e2e)(?:[\\/]|$)/u.test(
    argument,
  ) ||
  /tests[\\/]backend[\\/]unit[\\/]identity[\\/](?:login|session-service)\.test\.[jt]sx?$/u.test(
    argument,
  ),
);
const databaseRequiredForInvocation =
  !hasExplicitTestPath || hasDatabaseBackedTestPath;
if (databaseRequiredForInvocation)
  process.env.SMART_HIRE_TEST_DATABASE_REQUIRED = "1";

// The interactive local app may opt in to the external parser, but the normal
// automated suite must stay deterministic and network-free. The dedicated
// synthetic live compatibility test is the only opt-in exception.
if (process.env.CV_OPENAI_LIVE_SYNTHETIC !== "1") {
  process.env.CV_PARSER_ADAPTER = "deterministic";
  process.env.CV_OPENAI_ENABLED = "false";
  process.env.CV_OPENAI_LOCAL_DEV_ENABLED = "false";
  process.env.OPENAI_API_KEY = "";
  // The normal suite injects interpreters and must never start a credentialed
  // image-search worker. Runtime/local validation still requires the shared
  // API key whenever the real worker is enabled.
  process.env.IMAGE_SEARCH_WORKER_ENABLED = "false";
}
// PostgreSQL timestamp columns are timezone-naive. Run tests in UTC so the
// controlled clocks used by lease, retry, and retention tests stay portable.
process.env.TZ = "UTC";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./tests/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    // Run the database guard before Vitest collects the full repository. This
    // makes a pathless invocation fail closed immediately instead of spending
    // minutes loading suites while still carrying a development URL.
    globalSetup: ["./tests/global-database-guard.ts"],
    // Playwright performance specs are collected by their Playwright config;
    // keeping them out of Vitest prevents a browser control from being
    // executed as a Node test while preserving a separate explicit E2E gate.
    exclude: [
      "tests/system/e2e/**",
      "tests/performance/**/*.spec.ts",
      "node_modules/**",
    ],
    // Integration files share one local PostgreSQL service and several cleanup
    // workers intentionally claim across uploads. Run files sequentially so
    // independent fixtures cannot deadlock or consume each other's due work.
    maxWorkers: 1,
    testTimeout: 15_000,
    // `process.env` mutations in the config process are not guaranteed to be
    // inherited by Vitest worker contexts. Explicitly pass the marker so a
    // pathless/full invocation cannot bypass the database guard.
    env: {
      SMART_HIRE_TEST_DATABASE_REQUIRED: databaseRequiredForInvocation
        ? "1"
        : "0",
    },
  },
});
