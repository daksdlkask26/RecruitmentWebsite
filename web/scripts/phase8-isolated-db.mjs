import fs from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const target = process.argv[3]?.trim();
const action = process.argv[2]?.trim();
const targetPattern = /(?:^|[-_])(test|tests|spec|e2e)(?:[-_]|$)/iu;

if (!(action === "create" || action === "drop" || action === "status")) {
  throw new Error("Usage: node phase8-isolated-db.mjs <create|drop|status> <database>");
}
if (!target || !/^[a-z_][a-z0-9_]{0,62}$/u.test(target) || !targetPattern.test(target)) {
  throw new Error("Database name must be a safe PostgreSQL identifier containing test/spec/e2e");
}

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(webRoot, ".env.local");
const databaseLine = fs
  .readFileSync(envPath, "utf8")
  .split(/\r?\n/u)
  .find((line) => line.startsWith("DATABASE_URL="));
if (!databaseLine) throw new Error("DATABASE_URL_MISSING");

const source = new URL(databaseLine.slice("DATABASE_URL=".length).trim());
const sourceDatabase = decodeURIComponent(source.pathname.replace(/^\//u, ""));
if (sourceDatabase !== "smarthire") throw new Error("REFUSED_UNEXPECTED_SOURCE_DATABASE");
if (!/^localhost$|^127\.0\.0\.1$|^::1$/u.test(source.hostname)) {
  throw new Error("REFUSED_NON_LOCAL_DATABASE_HOST");
}

const admin = new URL(source);
admin.pathname = "/postgres";
const client = new Client({ connectionString: admin.toString() });
const quoteIdentifier = (value) => `"${value.replace(/"/gu, '""')}"`;

await client.connect();
try {
  const targetIdentifier = quoteIdentifier(target);
  if (action === "create") {
    const existing = await client.query(
      "select 1 from pg_database where datname = $1",
      [target],
    );
    if (existing.rowCount) throw new Error("ISOLATED_DATABASE_ALREADY_EXISTS");
    await client.query(`CREATE DATABASE ${targetIdentifier}`);
    console.log(`isolated-db-created=${target}`);
  } else if (action === "drop") {
    await client.query(`DROP DATABASE IF EXISTS ${targetIdentifier}`);
    console.log(`isolated-db-dropped=${target}`);
  } else {
    const result = await client.query(
      `select pid, usename, application_name, client_addr, state from pg_stat_activity where datname = $1 order by pid`,
      [target],
    );
    console.log(JSON.stringify({ database: target, sessions: result.rows }));
  }
} finally {
  await client.end();
}
