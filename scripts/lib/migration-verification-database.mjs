import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export function parseEnvironment(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const [key, rawValue = ""] = line.split(/=(.*)/s).slice(0, 2);
        const value = rawValue.trim();
        const unquoted =
          value.length >= 2 &&
          ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'")))
            ? value.slice(1, -1)
            : value;
        return [key.trim(), unquoted];
      }),
  );
}

async function readOptionalEnvironment(path) {
  try {
    return parseEnvironment(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

export function selectDatabaseConnectionString(
  environment,
  appEnvironment = {},
  rootEnvironment = {},
) {
  const connectionString =
    environment.DIRECT_URL ??
    environment.DATABASE_URL ??
    appEnvironment.DIRECT_URL ??
    appEnvironment.DATABASE_URL ??
    rootEnvironment.DIRECT_URL ??
    rootEnvironment.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "db:verify requires DIRECT_URL or DATABASE_URL in the process environment, web/.env.local, or .env.",
    );
  }

  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("db:verify received an invalid PostgreSQL connection URL.");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("db:verify requires a PostgreSQL connection URL.");
  }
  return connectionString;
}

export async function loadDatabaseConnectionString({
  environment = process.env,
  rootDirectory,
  appDirectory,
}) {
  const [rootEnvironment, appEnvironment] = await Promise.all([
    readOptionalEnvironment(resolve(rootDirectory, ".env")),
    readOptionalEnvironment(resolve(appDirectory, ".env.local")),
  ]);
  return selectDatabaseConnectionString(
    environment,
    appEnvironment,
    rootEnvironment,
  );
}

export function databaseUrlFor(connectionString, database) {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url;
}

export function quoteIdentifier(identifier) {
  if (!identifier) throw new Error("Database identifier must not be empty.");
  return `"${identifier.replaceAll('"', '""')}"`;
}
