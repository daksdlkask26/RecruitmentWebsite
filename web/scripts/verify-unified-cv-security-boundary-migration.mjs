import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pg from "pg";

import {
  assertCvSecurityTestDatabase,
  printSkippedDatabaseCheck,
  CvSecurityTestDatabaseError,
} from "./cv-security-test-database.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(
  scriptDirectory,
  "../prisma/migrations/090_unified_cv_security_boundary/migration.sql",
);

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
  const client = new pg.Client({ connectionString: database.directUrl });
  await client.connect();
  try {
    const enumQuery = await client.query(`
      SELECT typname, array_agg(enumlabel ORDER BY enumsortorder) AS values
      FROM pg_type type_row
      JOIN pg_enum enum_row ON type_row.oid = enum_row.enumtypid
      WHERE typname IN ('CvUploadPurpose', 'CvProcessingMode', 'CvUploadStatus')
      GROUP BY typname
    `);
    const enums = Object.fromEntries(
      enumQuery.rows.map((row) => [row.typname, row.values]),
    );

    const columnQuery = await client.query(`
      SELECT table_name, column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (table_name = 'CvUpload' AND column_name IN ('purpose', 'processingMode', 'policyVersion')) OR
          (table_name = 'CvScanAssessment' AND column_name = 'policyVersion') OR
          (table_name = 'CandidateCv' AND column_name IN ('sourceArtifactId', 'scanAssessmentId')) OR
          (table_name = 'ApplicationDocument' AND column_name IN ('sourceArtifactId', 'scanAssessmentId')) OR
          (table_name = 'TeamApplication' AND column_name IN ('cvSourceArtifactId', 'cvScanAssessmentId'))
        )
    `);
    const columns = new Set(
      columnQuery.rows.map((row) => `${row.table_name}.${row.column_name}`),
    );
    const requiredColumns = [
      "CvUpload.purpose",
      "CvUpload.processingMode",
      "CvUpload.policyVersion",
      "CvScanAssessment.policyVersion",
      "CandidateCv.sourceArtifactId",
      "CandidateCv.scanAssessmentId",
      "ApplicationDocument.sourceArtifactId",
      "ApplicationDocument.scanAssessmentId",
      "TeamApplication.cvSourceArtifactId",
      "TeamApplication.cvScanAssessmentId",
    ];
    const evidenceColumns = new Set([
      "CandidateCv.sourceArtifactId",
      "CandidateCv.scanAssessmentId",
      "ApplicationDocument.sourceArtifactId",
      "ApplicationDocument.scanAssessmentId",
      "TeamApplication.cvSourceArtifactId",
      "TeamApplication.cvScanAssessmentId",
    ]);
    const nonNullableEvidenceColumns = columnQuery.rows
      .filter((row) =>
        evidenceColumns.has(`${row.table_name}.${row.column_name}`),
      )
      .filter((row) => row.is_nullable !== "YES")
      .map((row) => `${row.table_name}.${row.column_name}`);

    const foreignKeyQuery = await client.query(`
      SELECT
        source.relname AS source_table,
        source_column.attname AS source_column,
        target.relname AS target_table,
        target_column.attname AS target_column,
        constraint_row.confdeltype AS delete_action
      FROM pg_constraint constraint_row
      JOIN pg_class source ON source.oid = constraint_row.conrelid
      JOIN pg_class target ON target.oid = constraint_row.confrelid
      JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY AS source_key(attnum, position) ON TRUE
      JOIN LATERAL unnest(constraint_row.confkey) WITH ORDINALITY AS target_key(attnum, position)
        ON target_key.position = source_key.position
      JOIN pg_attribute source_column
        ON source_column.attrelid = source.oid AND source_column.attnum = source_key.attnum
      JOIN pg_attribute target_column
        ON target_column.attrelid = target.oid AND target_column.attnum = target_key.attnum
      WHERE constraint_row.contype = 'f'
        AND source.relname IN ('CandidateCv', 'ApplicationDocument', 'TeamApplication')
        AND source_column.attname IN ('sourceArtifactId', 'scanAssessmentId', 'cvSourceArtifactId', 'cvScanAssessmentId')
    `);
    const foreignKeys = new Set(
      foreignKeyQuery.rows.map(
        (row) =>
          `${row.source_table}.${row.source_column}->${row.target_table}.${row.target_column}:${row.delete_action}`,
      ),
    );
    const requiredForeignKeys = [
      "CandidateCv.sourceArtifactId->CvStoredArtifact.id:n",
      "CandidateCv.scanAssessmentId->CvScanAssessment.id:n",
      "ApplicationDocument.sourceArtifactId->CvStoredArtifact.id:n",
      "ApplicationDocument.scanAssessmentId->CvScanAssessment.id:n",
      "TeamApplication.cvSourceArtifactId->CvStoredArtifact.id:n",
      "TeamApplication.cvScanAssessmentId->CvScanAssessment.id:n",
    ];

    const migrationSql = await readFile(migrationPath, "utf8");
    const expandOnly = !/\bDROP\s+(?:COLUMN|TYPE|TABLE)\b/iu.test(migrationSql);
    const requiredEnumValues = {
      CvUploadPurpose: [
        "PROFILE_IMPORT",
        "PROFILE_DIRECT",
        "JOB_APPLICATION_DIRECT",
        "TEAM_APPLICATION_DIRECT",
      ],
      CvProcessingMode: ["IMPORT_AND_PARSE", "SCAN_ONLY"],
      CvUploadStatus: ["SECURITY_CLEAN"],
    };
    const enumChecks = Object.fromEntries(
      Object.entries(requiredEnumValues).map(([name, values]) => [
        name,
        values.every((value) => enums[name]?.includes(value)),
      ]),
    );
    const report = {
      pass:
        Object.values(enumChecks).every(Boolean) &&
        requiredColumns.every((column) => columns.has(column)) &&
        nonNullableEvidenceColumns.length === 0 &&
        requiredForeignKeys.every((foreignKey) => foreignKeys.has(foreignKey)) &&
        expandOnly,
      migration: {
        name: "090_unified_cv_security_boundary",
        expandOnly,
        noLegacyAutoClean: true,
      },
      enums: enumChecks,
      missingColumns: requiredColumns.filter((column) => !columns.has(column)),
      nonNullableEvidenceColumns,
      missingForeignKeys: requiredForeignKeys.filter(
        (foreignKey) => !foreignKeys.has(foreignKey),
      ),
      reconciliation: {
        command: "npm run cv-security:reconcile",
        defaultMode: "dry-run",
        applyRequiresExplicitFlag: true,
      },
    };
    console.log(JSON.stringify(report, null, 2));
    if (!report.pass) process.exitCode = 1;
  } finally {
    await client.end();
  }
}
