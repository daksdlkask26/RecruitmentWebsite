import "dotenv/config";
import pg from "pg";

import {
  assertCvSecurityTestDatabase,
  CvSecurityTestDatabaseError,
  printSkippedDatabaseCheck,
} from "./cv-security-test-database.mjs";

const { Client } = pg;
const assertRollbackSafe = process.argv.includes("--assert-rollback-safe");

let database;
try {
  database = assertCvSecurityTestDatabase();
} catch (error) {
  if (error instanceof CvSecurityTestDatabaseError) {
    printSkippedDatabaseCheck(error);
    process.exitCode = 2;
  } else {
    throw error;
  }
}

if (database) {
  const client = new Client({ connectionString: database.directUrl });
  await client.connect();
  try {
    const migrationResult = await client.query(`
      SELECT migration_name, finished_at IS NOT NULL AS finished
      FROM "_prisma_migrations"
      WHERE migration_name IN (
        '095_company_deletion_manifest',
        '096_recruitment_notification_delivery'
      )
      ORDER BY migration_name
    `);
    const migrations = Object.fromEntries(
      migrationResult.rows.map((row) => [row.migration_name, row.finished]),
    );

    const enumResult = await client.query(`
      SELECT enumlabel
      FROM pg_type type_row
      JOIN pg_enum enum_row ON type_row.oid = enum_row.enumtypid
      WHERE type_row.typname = 'EmailKind'
      ORDER BY enum_row.enumsortorder
    `);
    const emailKinds = enumResult.rows.map((row) => row.enumlabel);

    const columnResult = await client.query(`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'RecruitmentNotificationWork'
        AND column_name IN ('leaseOwner', 'leaseExpiresAt')
      ORDER BY column_name
    `);
    const columns = Object.fromEntries(
      columnResult.rows.map((row) => [row.column_name, row.is_nullable]),
    );
    const indexResult = await client.query(`
      SELECT to_regclass('public."RecruitmentNotificationWork_leaseExpiresAt_idx"') IS NOT NULL AS present
    `);

    const outboxResult = await client.query(`
      SELECT "status", COUNT(*)::int AS count
      FROM "EmailOutbox"
      WHERE "kind" = 'RECRUITMENT_NOTIFICATION'::"EmailKind"
      GROUP BY "status"
      ORDER BY "status"
    `);
    const outboxByStatus = Object.fromEntries(
      outboxResult.rows.map((row) => [row.status, row.count]),
    );
    const activeStatuses = new Set(["PENDING", "PROCESSING", "RETRYABLE"]);
    const activeMaterializedRows = outboxResult.rows
      .filter((row) => activeStatuses.has(row.status))
      .reduce((total, row) => total + row.count, 0);
    const migrationDeployed =
      migrations["095_company_deletion_manifest"] === true &&
      migrations["096_recruitment_notification_delivery"] === true;
    const schemaCompatible =
      emailKinds.includes("RECRUITMENT_NOTIFICATION") &&
      columns.leaseOwner === "YES" &&
      columns.leaseExpiresAt === "YES" &&
      indexResult.rows[0]?.present === true;
    const rollbackReady = activeMaterializedRows === 0;
    const report = {
      pass: migrationDeployed && schemaCompatible,
      database: database.database.database,
      migrations: {
        "095_company_deletion_manifest":
          migrations["095_company_deletion_manifest"] === true,
        "096_recruitment_notification_delivery":
          migrations["096_recruitment_notification_delivery"] === true,
      },
      schema: {
        recruitmentNotificationEnum: emailKinds.includes(
          "RECRUITMENT_NOTIFICATION",
        ),
        nullableLeaseOwner: columns.leaseOwner === "YES",
        nullableLeaseExpiresAt: columns.leaseExpiresAt === "YES",
        leaseIndex: indexResult.rows[0]?.present === true,
        legacyWriterShape:
          columns.leaseOwner === "YES" && columns.leaseExpiresAt === "YES",
      },
      sharedRuntime: {
        boundary: "EmailOutbox",
        materializedRecruitmentNotificationOutbox: outboxByStatus,
        activeMaterializedRows,
      },
      rollback: {
        ready: rollbackReady,
        blockedByActiveMaterializedRows: !rollbackReady,
        precondition:
          "Drain RECRUITMENT_NOTIFICATION outbox rows before restoring the pre-096 shared email runtime.",
      },
    };
    console.log(JSON.stringify(report, null, 2));
    if (!report.pass || (assertRollbackSafe && !rollbackReady)) {
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}
