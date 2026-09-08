import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: resolve(webRoot, ".env.local"), quiet: true });
config({ path: resolve(webRoot, ".env"), quiet: true });

const testNameMarker = /(?:^|[-_])(test|tests|spec|e2e)(?:[-_]|$)/iu;
const unsafeSchemaNames = new Set([
  "main",
  "prod",
  "production",
  "development",
  "staging",
]);

function normalizeHost(value) {
  return value.trim().toLowerCase().replace(/^\[(.*)\]$/u, "$1");
}

function allowedHosts() {
  const configured = process.env.SMART_HIRE_TEST_DB_HOSTS?.split(",")
    .map(normalizeHost)
    .filter(Boolean);
  return configured?.length
    ? configured
    : ["localhost", "127.0.0.1", "::1"];
}

export class CvSecurityTestDatabaseError extends Error {
  constructor(code) {
    super(code);
    this.name = "CvSecurityTestDatabaseError";
    this.code = code;
  }
}

function parseEndpoint(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new CvSecurityTestDatabaseError("TEST_DATABASE_URL_INVALID");
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:")
    throw new CvSecurityTestDatabaseError("TEST_DATABASE_URL_INVALID");

  const host = normalizeHost(parsed.hostname);
  if (!allowedHosts().includes(host))
    throw new CvSecurityTestDatabaseError("TEST_DATABASE_HOST_UNSAFE");

  let database;
  try {
    database = decodeURIComponent(parsed.pathname.replace(/^\//u, ""));
  } catch {
    throw new CvSecurityTestDatabaseError("TEST_DATABASE_URL_INVALID");
  }
  if (!database || !testNameMarker.test(database))
    throw new CvSecurityTestDatabaseError("TEST_DATABASE_NAME_UNSAFE");

  const schema = parsed.searchParams.get("schema")?.trim() || "public";
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/u.test(schema))
    throw new CvSecurityTestDatabaseError("TEST_DATABASE_SCHEMA_UNSAFE");
  const requiredSchema = process.env.SMART_HIRE_TEST_DB_SCHEMA;
  if (requiredSchema && schema !== requiredSchema)
    throw new CvSecurityTestDatabaseError("TEST_DATABASE_SCHEMA_UNSAFE");
  if (unsafeSchemaNames.has(schema.toLowerCase()))
    throw new CvSecurityTestDatabaseError("TEST_DATABASE_SCHEMA_UNSAFE");

  return {
    host,
    port: parsed.port || "5432",
    database,
    schema,
  };
}

export function assertCvSecurityTestDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  const directUrl = process.env.DIRECT_URL;
  if (!databaseUrl || !directUrl)
    throw new CvSecurityTestDatabaseError("TEST_DATABASE_URL_MISSING");
  const database = parseEndpoint(databaseUrl);
  const direct = parseEndpoint(directUrl);
  if (
    database.host !== direct.host ||
    database.port !== direct.port ||
    database.database !== direct.database ||
    database.schema !== direct.schema
  )
    throw new CvSecurityTestDatabaseError("TEST_DATABASE_ENDPOINT_MISMATCH");
  return Object.freeze({ databaseUrl, directUrl, database });
}

export function printSkippedDatabaseCheck(error) {
  console.log(
    JSON.stringify(
      {
        pass: false,
        skipped: true,
        reason: "TEST_DATABASE_CONFIGURATION_REQUIRED",
        code: error?.code ?? "TEST_DATABASE_CONFIGURATION_REQUIRED",
      },
      null,
      2,
    ),
  );
}
