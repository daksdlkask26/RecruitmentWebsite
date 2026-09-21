import fs from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const phase7DatabaseOwnershipMarker =
  "nextgen-careers:candidate-first:phase7:task-owned:v1";

const phase7DatabaseNamePattern =
  /^candidate_phase7_[a-z0-9]+(?:_[a-z0-9]+)*_(?:test|spec|e2e)$/u;

export function assertPhase7DatabaseName(value) {
  if (!value || !phase7DatabaseNamePattern.test(value)) {
    throw new Error("PHASE7_ISOLATED_DATABASE_NAME_INVALID");
  }
  return value;
}

export function quotePhase7DatabaseIdentifier(value) {
  return `"${assertPhase7DatabaseName(value)}"`;
}

async function main() {
  const target = assertPhase7DatabaseName(process.env.PHASE7_DB_NAME);
  const quotedTarget = quotePhase7DatabaseIdentifier(target);
  const sourceLine = fs
    .readFileSync(".env.local", "utf8")
    .split(/\r?\n/u)
    .find((value) => value.startsWith("DATABASE_URL="));
  if (!sourceLine) throw new Error("DATABASE_URL_MISSING");

  const source = new URL(sourceLine.slice("DATABASE_URL=".length));
  const sourceDatabase = decodeURIComponent(
    source.pathname.replace(/^\//u, ""),
  );
  if (sourceDatabase !== "smarthire")
    throw new Error("UNEXPECTED_SOURCE_DATABASE");

  const adminUrl = new URL(source);
  adminUrl.pathname = "/postgres";
  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const current = await client.query("select current_database() as name");
    if (current.rows[0]?.name === "smarthire") {
      throw new Error("REFUSED_SHARED_DATABASE");
    }

    const operation = process.argv[2];
    if (operation === "create") {
      const existing = await client.query(
        "select 1 from pg_database where datname = $1",
        [target],
      );
      if (existing.rowCount)
        throw new Error("PHASE7_ISOLATED_DATABASE_ALREADY_EXISTS");

      await client.query(`CREATE DATABASE ${quotedTarget}`);
      try {
        await client.query(
          `COMMENT ON DATABASE ${quotedTarget} IS '${phase7DatabaseOwnershipMarker}'`,
        );
      } catch (error) {
        await client.query(`DROP DATABASE ${quotedTarget} WITH (FORCE)`);
        throw error;
      }
      console.log(`isolated-db-ready=${target}`);
    } else if (operation === "drop") {
      const ownership = await client.query(
        `SELECT shobj_description(oid, 'pg_database') AS marker
           FROM pg_database
          WHERE datname = $1`,
        [target],
      );
      if (!ownership.rowCount) {
        console.log(`isolated-db-absent=${target}`);
        return;
      }
      if (ownership.rows[0]?.marker !== phase7DatabaseOwnershipMarker) {
        throw new Error("PHASE7_DATABASE_NOT_TASK_OWNED");
      }
      await client.query(`DROP DATABASE ${quotedTarget} WITH (FORCE)`);
      console.log(`isolated-db-dropped=${target}`);
    } else {
      throw new Error(`UNKNOWN_OPERATION:${operation ?? "missing"}`);
    }
  } finally {
    await client.end();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) await main();
