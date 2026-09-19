// Isolated verification operator: no shared database mutation, no env file.
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { parse } from "dotenv";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const database = "smarthire_gate0_recheck_20260906_test";
const storage = resolve(root, ".local/gate0-recheck-test");
const audit = resolve(
  root,
  "../docs/audits/candidate-first/pre-phase/evidence",
);
const marker = resolve(audit, "gate0-recheck-resource.json");
const local = parse(await readFile(resolve(root, ".env.local"), "utf8"));
const base = new URL(local.DIRECT_URL ?? local.DATABASE_URL);
if (!["localhost", "127.0.0.1"].includes(base.hostname))
  throw new Error("LOCAL_DB_REQUIRED");
const target = new URL(base);
target.pathname = `/${database}`;
target.search = "";
const env = {
  ...process.env,
  DATABASE_URL: target.href,
  DIRECT_URL: target.href,
  CV_STORAGE_ADAPTER: "filesystem",
  CV_STORAGE_LOCAL_ROOT: storage,
  CV_ARTIFACT_ACTIVE_KEY_VERSION: "1",
  CV_ARTIFACT_KEY_V1: Buffer.alloc(32, 0x74).toString("base64"),
  CV_WORKER_ENABLED: "false",
  CV_OPENAI_ENABLED: "false",
  CV_PARSER_ADAPTER: "deterministic",
  CV_CONTAINER_TESTS: "true",
  CF003_DOCKER_BIN:
    "C:/Users/Uy/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3001",
  BETTER_AUTH_URL: "http://localhost:3001",
};
const clientFor = async (url) => {
  const c = new pg.Client({ connectionString: url.href });
  await c.connect();
  return c;
};
const action = process.argv[2];
if (action === "create") {
  const admin = new URL(base);
  admin.pathname = "/postgres";
  admin.search = "";
  const c = await clientFor(admin);
  try {
    if (
      (await c.query("SELECT 1 FROM pg_database WHERE datname=$1", [database]))
        .rowCount
    )
      throw new Error("TEST_DB_ALREADY_EXISTS");
    await c.query(`CREATE DATABASE ${database}`);
    await mkdir(storage, { recursive: true });
    await writeFile(
      marker,
      JSON.stringify(
        {
          database,
          createdBy: "run-gate0-recheck",
          storage,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      `created isolated database ${database}; both URLs bound to same endpoint`,
    );
  } finally {
    await c.end();
  }
} else if (action === "inspect-shared") {
  if (decodeURIComponent(base.pathname) !== "/smarthire")
    throw new Error("SHARED_DB_NAME_UNEXPECTED");
  const c = await clientFor(base);
  try {
    await c.query("BEGIN READ ONLY");
    const migration = (
      await c.query(
        'SELECT checksum, finished_at FROM "_prisma_migrations" WHERE migration_name=$1 AND rolled_back_at IS NULL',
        ["089_candidate_cv_artifact_reconciliation"],
      )
    ).rows;
    const digest = createHash("sha256")
      .update(
        await readFile(
          resolve(
            root,
            "prisma/migrations/089_candidate_cv_artifact_reconciliation/migration.sql",
          ),
        ),
      )
      .digest("hex");
    const counts = (
      await c.query(
        'SELECT (SELECT count(*)::int FROM "CandidateCvArtifactPromotion") AS candidate, (SELECT count(*)::int FROM "ApplicationArtifactPromotion") AS application',
      )
    ).rows[0];
    await c.query("COMMIT");
    const result = {
      checkedAt: new Date().toISOString(),
      transaction: "READ ONLY",
      database: "smarthire",
      migration089Applied:
        migration.length === 1 && Boolean(migration[0].finished_at),
      checksumMatches:
        migration.length === 1 && migration[0].checksum === digest,
      ledgerRows: counts,
    };
    await writeFile(
      resolve(audit, "gate0-recheck-shared-readonly.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
    console.log(JSON.stringify(result));
  } finally {
    await c.end();
  }
} else if (action === "cleanup") {
  const owned = JSON.parse(await readFile(marker, "utf8"));
  if (
    owned.database !== database ||
    owned.storage !== storage ||
    !database.endsWith("_test")
  )
    throw new Error("RESOURCE_OWNERSHIP_MISMATCH");
  const admin = new URL(base);
  admin.pathname = "/postgres";
  admin.search = "";
  const c = await clientFor(admin);
  try {
    await c.query(`DROP DATABASE ${database} WITH (FORCE)`);
  } finally {
    await c.end();
  }
  if (
    !storage.startsWith(resolve(root, ".local") + "/") &&
    !storage.startsWith(resolve(root, ".local") + "\\")
  )
    throw new Error("STORAGE_OUTSIDE_WORKSPACE");
  await rm(storage, { recursive: true, force: true });
  await writeFile(
    marker,
    JSON.stringify(
      {
        ...owned,
        cleanedAt: new Date().toISOString(),
        databaseDropped: true,
        storageRemoved: true,
        envFilesCreated: false,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("isolated resources cleaned; shared services untouched");
} else {
  const c = await clientFor(target);
  try {
    if (
      (await c.query("SELECT current_database() AS name")).rows[0].name !==
      database
    )
      throw new Error("WRONG_DATABASE");
  } finally {
    await c.end();
  }
  const args = process.argv.slice(3);
  let entry;
  if (action === "migrate") {
    entry = require.resolve("prisma/build/index.js");
    args.push("migrate", "deploy");
  } else if (action === "vitest" || action === "focused") {
    entry = resolve(
      dirname(require.resolve("vitest/package.json")),
      "vitest.mjs",
    );
    if (action === "focused") {
      const pkg = JSON.parse(
        await readFile(resolve(root, "package.json"), "utf8"),
      );
      args.unshift(
        ...pkg.scripts["test:candidate-first"]
          .split(/\s+/u)
          .slice(1)
          .filter((arg) => arg !== "--passWithNoTests"),
      );
    }
  } else throw new Error("INVALID_ACTION");
  console.log(`verified isolated endpoint: ${database}; action=${action}`);
  const child = spawn(process.execPath, [entry, ...args], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: "inherit",
  });
  process.exitCode = await new Promise((res, rej) => {
    child.on("error", rej);
    child.on("exit", (code) => res(code ?? 1));
  });
}
