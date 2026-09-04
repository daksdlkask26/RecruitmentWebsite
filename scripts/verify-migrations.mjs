import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import {
  databaseUrlFor as buildDatabaseUrl,
  loadDatabaseConnectionString,
  quoteIdentifier,
} from "./lib/migration-verification-database.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = resolve(root, "web");
const prismaCli = resolve(root, "node_modules/prisma/build/index.js");
const databaseConnectionString = await loadDatabaseConnectionString({
  rootDirectory: root,
  appDirectory: app,
});
const verifyDatabase = "smarthire_migration_verify";
const shadowDatabase = "smarthire_migration_shadow";
const upgradeDatabase = "smarthire_migration_upgrade_verify";
const cvUpgradeDatabase = "smarthire_cv_migration_upgrade_verify";
const adminDatabase = process.env.MIGRATION_VERIFY_ADMIN_DATABASE ?? "postgres";
const baselineMigrations = [
  "001_identity_foundation",
  "002_email_outbox_worker",
  "003_totp_challenge_replay",
  "004_password_reset_recovery_operations",
  "005_full_account_recovery",
  "006_add_two_factor_lockout_fields",
];
const cvBaselineMigrations = [
  ...baselineMigrations,
  "007_candidate_profile_account_management",
];

function databaseUrlFor(database) {
  return buildDatabaseUrl(databaseConnectionString, database);
}

function databaseEnvironment(database) {
  const databaseUrl = databaseUrlFor(database);
  return {
    ...process.env,
    DATABASE_URL: databaseUrl.toString(),
    DIRECT_URL: databaseUrl.toString(),
    SHADOW_DATABASE_URL: databaseUrlFor(shadowDatabase).toString(),
  };
}

const environment = databaseEnvironment(verifyDatabase);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    encoding: "utf8",
    input: options.input,
  });
  if (result.status !== 0)
    throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}
function prisma(args, input, targetEnvironment = environment) {
  return run(process.execPath, [prismaCli, ...args], {
    cwd: app,
    env: targetEnvironment,
    input,
  });
}

run(process.execPath, [resolve(app, "scripts/check-migration-sequence.mjs")]);

async function expectConstraintRejection(client, statement, constraint) {
  await client.query("BEGIN");
  let rejected = false;
  try {
    await client.query(statement);
  } catch (error) {
    rejected = true;
    if (error?.constraint !== constraint) {
      throw new Error(
        `Expected ${constraint}, received ${error?.constraint ?? "an unknown database error"}.`,
      );
    }
  } finally {
    await client.query("ROLLBACK");
  }
  if (!rejected) throw new Error(`Expected database constraint ${constraint}.`);
}

async function verifyFeatureOneUpgrade() {
  const upgradeEnvironment = databaseEnvironment(upgradeDatabase);
  for (const migration of baselineMigrations) {
    const sql = await readFile(
      resolve(app, "prisma/migrations", migration, "migration.sql"),
      "utf8",
    );
    prisma(["db", "execute", "--stdin"], sql, upgradeEnvironment);
    prisma(
      ["migrate", "resolve", "--applied", migration],
      undefined,
      upgradeEnvironment,
    );
  }

  prisma(
    ["db", "execute", "--stdin"],
    `INSERT INTO "user" (
       "id", "name", "email", "normalizedEmail", "emailVerified", "state",
       "updatedAt"
     ) VALUES
       (
         'upgrade_user_1', 'Upgrade Candidate One',
         'upgrade-one@example.test', 'upgrade-one@example.test', true,
         'ACTIVE', CURRENT_TIMESTAMP
       ),
       (
         'upgrade_user_2', 'Upgrade Candidate Two',
         'upgrade-two@example.test', 'upgrade-two@example.test', true,
         'ACTIVE', CURRENT_TIMESTAMP
       );
     INSERT INTO "CandidateIdentity" ("userId", "updatedAt") VALUES
       ('upgrade_user_1', CURRENT_TIMESTAMP),
       ('upgrade_user_2', CURRENT_TIMESTAMP);`,
    upgradeEnvironment,
  );

  prisma(["migrate", "deploy"], undefined, upgradeEnvironment);
  prisma(["migrate", "status"], undefined, upgradeEnvironment);
  prisma(
    [
      "migrate",
      "diff",
      "--from-migrations",
      "prisma/migrations",
      "--to-config-datasource",
      "--exit-code",
    ],
    undefined,
    upgradeEnvironment,
  );

  const client = new Client({
    connectionString: databaseUrlFor(upgradeDatabase).toString(),
  });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM "CandidateIdentity") AS identity_count,
         (SELECT COUNT(*) FROM "CandidateProfile") AS profile_count,
         (
           SELECT COUNT(*)
           FROM "CandidateIdentity" AS identity
           LEFT JOIN "CandidateProfile" AS profile
             ON profile."candidateUserId" = identity."userId"
           WHERE profile."id" IS NULL
         ) AS missing_profile_count`,
    );
    const counts = result.rows[0];
    if (
      Number(counts.identity_count) !== 2 ||
      Number(counts.profile_count) !== 2 ||
      Number(counts.missing_profile_count) !== 0
    ) {
      throw new Error("Feature 001 candidate-profile backfill counts differ.");
    }

    await expectConstraintRejection(
      client,
      `INSERT INTO "AccountPreferences" (
         "userId", "accountSecurityEmail", "updatedAt"
       ) VALUES ('upgrade_user_1', false, CURRENT_TIMESTAMP)`,
      "account_preferences_security_mail_required",
    );
  } finally {
    await client.end();
  }

  console.log(
    "Feature 001 upgrade, profile backfill, drift, and constraint verification passed.",
  );
}

async function verifyFeatureFourUpgrade() {
  const upgradeEnvironment = databaseEnvironment(cvUpgradeDatabase);
  for (const migration of cvBaselineMigrations) {
    const sql = await readFile(
      resolve(app, "prisma/migrations", migration, "migration.sql"),
      "utf8",
    );
    prisma(["db", "execute", "--stdin"], sql, upgradeEnvironment);
    prisma(
      ["migrate", "resolve", "--applied", migration],
      undefined,
      upgradeEnvironment,
    );
  }

  prisma(
    ["db", "execute", "--stdin"],
    `INSERT INTO "user" (
       "id", "name", "email", "normalizedEmail", "emailVerified", "state",
       "updatedAt"
     ) VALUES (
       'cv_upgrade_user', 'CV Upgrade Candidate',
       'cv-upgrade@example.test', 'cv-upgrade@example.test', true,
       'ACTIVE', CURRENT_TIMESTAMP
     );
     INSERT INTO "CandidateIdentity" ("userId", "updatedAt")
       VALUES ('cv_upgrade_user', CURRENT_TIMESTAMP);
     INSERT INTO "CandidateProfile" (
       "id", "candidateUserId", "headline", "revision", "updatedAt"
     ) VALUES (
       'cv_upgrade_profile', 'cv_upgrade_user',
       'Existing profile survives Feature 004', 7, CURRENT_TIMESTAMP
     );`,
    upgradeEnvironment,
  );

  prisma(["migrate", "deploy"], undefined, upgradeEnvironment);
  prisma(["migrate", "status"], undefined, upgradeEnvironment);
  prisma(
    [
      "migrate",
      "diff",
      "--from-migrations",
      "prisma/migrations",
      "--to-config-datasource",
      "--exit-code",
    ],
    undefined,
    upgradeEnvironment,
  );

  const client = new Client({
    connectionString: databaseUrlFor(cvUpgradeDatabase).toString(),
  });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT profile."headline", profile."revision",
              (SELECT COUNT(*) FROM "CvAccountQuota") AS quota_count,
              to_regclass('"CvUpload"') IS NOT NULL AS cv_upload_exists,
              EXISTS (
                SELECT 1 FROM pg_indexes
                 WHERE indexname = 'CvParseJob_one_active_per_account_idx'
              ) AS active_parse_index_exists,
              EXISTS (
                SELECT 1 FROM pg_trigger
                 WHERE tgname = 'CvProcessingConsent_append_only'
                   AND NOT tgisinternal
              ) AS consent_trigger_exists,
              (
                SELECT COUNT(*) FROM "_prisma_migrations"
                 WHERE migration_name = '008_cv_upload_parse_review'
                   AND finished_at IS NOT NULL
              ) AS cv_migration_count
         FROM "CandidateProfile" profile
        WHERE profile."id" = 'cv_upgrade_profile'`,
    );
    const row = result.rows[0];
    if (
      result.rows.length !== 1 ||
      row.headline !== "Existing profile survives Feature 004" ||
      Number(row.revision) !== 7 ||
      Number(row.quota_count) !== 0 ||
      !row.cv_upload_exists ||
      !row.active_parse_index_exists ||
      !row.consent_trigger_exists ||
      Number(row.cv_migration_count) !== 1
    ) {
      throw new Error("Feature 004 forward-upgrade verification differed.");
    }
  } finally {
    await client.end();
  }

  console.log(
    "Feature 004 migration over 001-007, data preservation, drift, index, trigger, and lazy-quota verification passed.",
  );
}

const temporaryDatabases = [
  verifyDatabase,
  shadowDatabase,
  upgradeDatabase,
  cvUpgradeDatabase,
];
const adminClient = new Client({
  connectionString: databaseUrlFor(adminDatabase).toString(),
});

async function dropDatabase(database) {
  await adminClient.query(
    `DROP DATABASE IF EXISTS ${quoteIdentifier(database)} WITH (FORCE)`,
  );
}

async function createDatabase(database) {
  await adminClient.query(`CREATE DATABASE ${quoteIdentifier(database)}`);
}

await adminClient.connect();
try {
  await adminClient.query("SELECT 1");
  for (const database of temporaryDatabases) await dropDatabase(database);
  for (const database of temporaryDatabases) await createDatabase(database);
  prisma(["migrate", "deploy"]);
  prisma(["migrate", "status"]);
  prisma([
    "migrate",
    "diff",
    "--from-migrations",
    "prisma/migrations",
    "--to-config-datasource",
    "--exit-code",
  ]);
  prisma(["db", "execute", "--stdin"], "SELECT 1;");
  console.log(
    "Fresh migration, drift, and Prisma connectivity verification passed.",
  );
  await verifyFeatureOneUpgrade();
  await verifyFeatureFourUpgrade();
} finally {
  for (const database of temporaryDatabases) {
    try {
      await dropDatabase(database);
    } catch {
      console.error(`Could not remove temporary database ${database}.`);
    }
  }
  await adminClient.end();
}
