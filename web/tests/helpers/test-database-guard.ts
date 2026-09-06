import "server-only";

/**
 * Database guard for tests that create or mutate persistent fixtures.
 *
 * A local development URL is intentionally rejected even when it points to
 * loopback.  The database name must carry an explicit test marker, and the
 * host/schema are checked as separate dimensions so a copied production URL
 * cannot pass by accident.
 */

export type TestDatabaseEndpoint = Readonly<{
  host: string;
  port: string;
  database: string;
  schema: string;
}>;

export type TestDatabaseGuardOptions = Readonly<{
  databaseUrl?: string;
  directUrl?: string;
  expectedSchema?: string;
  allowedHosts?: readonly string[];
}>;

export class TestDatabaseGuardError extends Error {
  constructor(
    readonly code:
      | "TEST_DATABASE_URL_MISSING"
      | "TEST_DATABASE_URL_INVALID"
      | "TEST_DATABASE_HOST_UNSAFE"
      | "TEST_DATABASE_NAME_UNSAFE"
      | "TEST_DATABASE_SCHEMA_UNSAFE"
      | "TEST_DATABASE_ENDPOINT_MISMATCH",
    detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = "TestDatabaseGuardError";
  }
}

const TEST_NAME_MARKER = /(?:^|[-_])(test|tests|spec|e2e)(?:[-_]|$)/iu;
const UNSAFE_SCHEMA_NAMES = new Set([
  "main",
  "prod",
  "production",
  "development",
  "staging",
]);

function configuredHosts(fallback: readonly string[]) {
  const configured = process.env.SMART_HIRE_TEST_DB_HOSTS?.split(",")
    .map(normalizeHost)
    .filter(Boolean);
  return (configured?.length ? configured : fallback.map(normalizeHost)).filter(
    Boolean,
  );
}

function normalizeHost(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/u, "$1");
}

function endpointLabel(endpoint: TestDatabaseEndpoint) {
  return `${endpoint.host}:${endpoint.port}/${endpoint.database}?schema=${endpoint.schema}`;
}

export function parseTestDatabaseEndpoint(
  value: string,
  options: Pick<
    TestDatabaseGuardOptions,
    "expectedSchema" | "allowedHosts"
  > = {},
): TestDatabaseEndpoint {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TestDatabaseGuardError(
      "TEST_DATABASE_URL_INVALID",
      "DATABASE_URL must be a valid PostgreSQL URL",
    );
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new TestDatabaseGuardError(
      "TEST_DATABASE_URL_INVALID",
      "DATABASE_URL must use postgresql:// or postgres://",
    );
  }

  const host = normalizeHost(parsed.hostname);
  const allowedHosts = configuredHosts(
    options.allowedHosts ?? ["localhost", "127.0.0.1", "::1"],
  );
  if (!allowedHosts.includes(host)) {
    throw new TestDatabaseGuardError(
      "TEST_DATABASE_HOST_UNSAFE",
      `host ${host} is not in the test allowlist`,
    );
  }

  let database: string;
  try {
    database = decodeURIComponent(parsed.pathname.replace(/^\//u, ""));
  } catch {
    throw new TestDatabaseGuardError(
      "TEST_DATABASE_URL_INVALID",
      "DATABASE_URL contains an invalid encoded database name",
    );
  }
  if (!database || !TEST_NAME_MARKER.test(database)) {
    throw new TestDatabaseGuardError(
      "TEST_DATABASE_NAME_UNSAFE",
      "database name must contain an explicit test/spec/e2e marker",
    );
  }

  const schema = parsed.searchParams.get("schema")?.trim() || "public";
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/u.test(schema)) {
    throw new TestDatabaseGuardError(
      "TEST_DATABASE_SCHEMA_UNSAFE",
      "schema must be a plain PostgreSQL identifier",
    );
  }
  const requiredSchema =
    options.expectedSchema ?? process.env.SMART_HIRE_TEST_DB_SCHEMA;
  if (requiredSchema && schema !== requiredSchema) {
    throw new TestDatabaseGuardError(
      "TEST_DATABASE_SCHEMA_UNSAFE",
      `schema ${schema} does not match the configured test schema`,
    );
  }
  if (UNSAFE_SCHEMA_NAMES.has(schema.toLowerCase())) {
    throw new TestDatabaseGuardError(
      "TEST_DATABASE_SCHEMA_UNSAFE",
      `schema ${schema} is reserved for non-test data`,
    );
  }

  return {
    host,
    port: parsed.port || "5432",
    database,
    schema,
  };
}

export function assertTestDatabaseEnvironment(
  options: TestDatabaseGuardOptions = {},
): Readonly<{ database: TestDatabaseEndpoint; direct?: TestDatabaseEndpoint }> {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new TestDatabaseGuardError(
      "TEST_DATABASE_URL_MISSING",
      "DATABASE_URL is required for a database-backed test",
    );
  }

  const database = parseTestDatabaseEndpoint(databaseUrl, options);
  const directUrl = options.directUrl ?? process.env.DIRECT_URL;
  if (!directUrl) {
    throw new TestDatabaseGuardError(
      "TEST_DATABASE_URL_MISSING",
      "DIRECT_URL is required for a database-backed test",
    );
  }
  const direct = parseTestDatabaseEndpoint(directUrl, options);
  if (
    direct &&
    (direct.host !== database.host ||
      direct.port !== database.port ||
      direct.database !== database.database ||
      direct.schema !== database.schema)
  ) {
    throw new TestDatabaseGuardError(
      "TEST_DATABASE_ENDPOINT_MISMATCH",
      `DATABASE_URL ${endpointLabel(database)} differs from DIRECT_URL ${endpointLabel(direct)}`,
    );
  }

  return { database, direct };
}

/**
 * Test setup uses this when an invocation explicitly includes DB-backed
 * suites.  Unit tests remain database-free and do not need a URL.
 */
export function assertRequestedTestDatabase() {
  return assertTestDatabaseEnvironment();
}
