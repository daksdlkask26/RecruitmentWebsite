import fs from "node:fs";
import pg from "pg";

const target = "candidate_phase5_final_20260917_e2e_test";
const sourceLine = fs
  .readFileSync(".env.local", "utf8")
  .split(/\r?\n/u)
  .find((value) => value.startsWith("DATABASE_URL="));
if (!sourceLine) throw new Error("DATABASE_URL_MISSING");

const source = new URL(sourceLine.slice("DATABASE_URL=".length));
const sourceDatabase = decodeURIComponent(source.pathname.replace(/^\//u, ""));
if (sourceDatabase !== "smarthire")
  throw new Error("UNEXPECTED_SOURCE_DATABASE");
if (!/(?:^|[-_])(test|tests|spec|e2e)(?:[-_]|$)/iu.test(target)) {
  throw new Error("ISOLATED_DATABASE_NAME_INVALID");
}

const adminUrl = new URL(source);
adminUrl.pathname = "/postgres";
const client = new pg.Client({ connectionString: adminUrl.toString() });
await client.connect();
try {
  const current = await client.query("select current_database() as name");
  if (current.rows[0]?.name === "smarthire")
    throw new Error("REFUSED_SHARED_DATABASE");
  const operation = process.argv[2] ?? "create";
  if (operation === "create") {
    const existing = await client.query(
      "select 1 from pg_database where datname = $1",
      [target],
    );
    if (!existing.rowCount) {
      await client.query(`CREATE DATABASE "${target}"`);
    }
    console.log(`isolated-db-ready=${target}`);
  } else if (operation === "drop") {
    await client.query(`DROP DATABASE IF EXISTS "${target}" WITH (FORCE)`);
    console.log(`isolated-db-dropped=${target}`);
  } else {
    throw new Error(`UNKNOWN_OPERATION:${operation}`);
  }
} finally {
  await client.end();
}
