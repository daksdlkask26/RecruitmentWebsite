import fs from "node:fs";
import pg from "pg";

const target = "candidate_phase3_test_20260911";
const line = fs
  .readFileSync(".env.local", "utf8")
  .split(/\r?\n/u)
  .find((value) => value.startsWith("DATABASE_URL="));
if (!line) throw new Error("DATABASE_URL_MISSING");
const source = new URL(line.slice("DATABASE_URL=".length));
const adminUrl = new URL(source);
adminUrl.pathname = "/postgres";
const client = new pg.Client({ connectionString: adminUrl.toString() });
await client.connect();
try {
  const current = await client.query("select current_database() as name");
  if (current.rows[0]?.name === "smarthire") {
    throw new Error("REFUSED_SHARED_DATABASE");
  }
  await client.query(`DROP DATABASE IF EXISTS ${target} WITH (FORCE)`);
  console.log(`isolated-db-dropped=${target}`);
} finally {
  await client.end();
}
