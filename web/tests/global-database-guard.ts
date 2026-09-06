import { assertRequestedTestDatabase } from "./helpers/test-database-guard";

/**
 * Vitest executes global setup before test discovery. Keep this check in the
 * main process so `vitest run` cannot spend time collecting suites (or import
 * Prisma) before rejecting a non-isolated database endpoint.
 */
export default function globalDatabaseGuard() {
  if (process.env.SMART_HIRE_TEST_DATABASE_REQUIRED === "1") {
    assertRequestedTestDatabase();
  }
}
