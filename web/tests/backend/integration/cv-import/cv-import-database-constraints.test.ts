import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const expectedTables = [
  "CvAccountQuota",
  "CvUpload",
  "CvStoredArtifact",
  "CvScanAssessment",
  "CvExtraction",
  "CvParseJob",
  "CvRetryRequest",
  "CvDraft",
  "CvProcessingConsent",
  "CvImportConfirmation",
];

const enumValues = {
  CvDocumentKind: ["PDF", "DOCX", "DOC"],
  CvParserClass: ["DETERMINISTIC_INTERNAL", "EXTERNAL_OPENAI"],
  CvArtifactKind: ["SOURCE_DOCUMENT", "EXTRACTED_TEXT"],
  CvArtifactStatus: [
    "QUARANTINED",
    "AVAILABLE",
    "DELETE_PENDING",
    "DELETING",
    "DELETED",
    "DELETE_FAILED",
  ],
  CvScanStatus: [
    "QUEUED",
    "PROCESSING",
    "CLEAN",
    "INFECTED",
    "INDETERMINATE",
    "CANCELLED",
  ],
  CvExtractionStatus: [
    "QUEUED",
    "PROCESSING",
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
  ],
  CvParseStatus: ["QUEUED", "PROCESSING", "SUCCEEDED", "FAILED", "CANCELLED"],
  CvParseTrigger: ["INITIAL", "AUTOMATIC_RETRY", "CANDIDATE_RETRY"],
  CvRetryStage: ["SCAN", "PARSE"],
  CvDraftStatus: ["EDITABLE", "CONFIRMED", "DELETED", "EXPIRED"],
  CvConsentAction: ["GRANTED", "REVOKED"],
} as const;

async function seedOwnedUpload(client: PoolClient, suffix: string) {
  const accountId = `cv-account-${suffix}`;
  const profileId = `cv-profile-${suffix}`;
  const uploadId = `cv-upload-${suffix}`;
  const email = `${suffix}@example.invalid`;
  await client.query(
    `INSERT INTO "user" (
       "id", "name", "email", "normalizedEmail", "emailVerified", "state",
       "stateChangedAt", "createdAt", "updatedAt"
     ) VALUES ($1, 'Synthetic Candidate', $2, $2, true, 'ACTIVE', now(), now(), now())`,
    [accountId, email],
  );
  await client.query(
    `INSERT INTO "CandidateIdentity" ("userId", "createdAt", "updatedAt")
     VALUES ($1, now(), now())`,
    [accountId],
  );
  await client.query(
    `INSERT INTO "CandidateProfile" (
       "id", "candidateUserId", "revision", "createdAt", "updatedAt"
     ) VALUES ($1, $2, 0, now(), now())`,
    [profileId, accountId],
  );
  await client.query(
    `INSERT INTO "CvAccountQuota" (
       "accountId", "reservedBytes", "retainedBytes", "createdAt", "updatedAt"
     ) VALUES ($1, 524289, 0, now(), now())`,
    [accountId],
  );
  await client.query(
    `INSERT INTO "CvUpload" (
       "id", "accountId", "profileId", "documentKind", "parserClass", "status",
       "declaredMediaType", "declaredBytes", "quotaReservationBytes",
       "quotaReservationRemaining", "idempotencyDigest", "createBindingDigest",
       "expiresAt", "createdAt", "updatedAt"
     ) VALUES (
       $1, $2, $3, 'PDF', 'EXTERNAL_OPENAI', 'AWAITING_CONTENT',
       'application/pdf', 1, 524289, 524289, decode(repeat('11', 32), 'hex'),
       decode(repeat('22', 32), 'hex'), now() + interval '30 days', now(), now()
     )`,
    [uploadId, accountId, profileId],
  );
  return { accountId, profileId, uploadId };
}

beforeAll(async () => {
  const result = await pool.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [expectedTables],
  );
  expect(result.rows.map((row) => row.table_name).sort()).toEqual(
    [...expectedTables].sort(),
  );
});

afterAll(async () => pool.end());

describe.sequential("Feature 004 PostgreSQL constraints", () => {
  it("installs the exact state enums", async () => {
    for (const [typeName, expected] of Object.entries(enumValues)) {
      const result = await pool.query<{ enumlabel: string }>(
        `SELECT e.enumlabel
           FROM pg_type t
           JOIN pg_enum e ON e.enumtypid = t.oid
          WHERE t.typname = $1
          ORDER BY e.enumsortorder`,
        [typeName],
      );
      expect(
        result.rows.map((row) => row.enumlabel),
        typeName,
      ).toEqual(expected);
    }
  });

  it("owns every aggregate through account/profile foreign keys", async () => {
    const result = await pool.query<{
      table_name: string;
      column_name: string;
    }>(
      `SELECT tc.table_name, kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = tc.constraint_name
          AND kcu.constraint_schema = tc.constraint_schema
        WHERE tc.constraint_schema = 'public'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_name = ANY($1::text[])`,
      [expectedTables],
    );
    const pairs = new Set(
      result.rows.map((row) => `${row.table_name}.${row.column_name}`),
    );
    for (const pair of [
      "CvAccountQuota.accountId",
      "CvUpload.accountId",
      "CvUpload.profileId",
      "CvStoredArtifact.accountId",
      "CvStoredArtifact.uploadId",
      "CvScanAssessment.accountId",
      "CvExtraction.accountId",
      "CvParseJob.accountId",
      "CvRetryRequest.accountId",
      "CvDraft.accountId",
      "CvDraft.profileId",
      "CvProcessingConsent.accountId",
      "CvImportConfirmation.accountId",
      "CvImportConfirmation.profileId",
    ]) {
      expect(pairs.has(pair), pair).toBe(true);
    }
  });

  it("installs byte, state, quota, retention, and receipt checks", async () => {
    const expected = [
      "CvAccountQuota_bytes_nonnegative",
      "CvAccountQuota_total_cap",
      "CvUpload_declared_bytes",
      "CvUpload_actual_integrity",
      "CvUpload_quota_reservation",
      "CvUpload_terminal_access",
      "CvStoredArtifact_envelope_sizes",
      "CvStoredArtifact_state",
      "CvScanAssessment_attempt_number",
      "CvScanAssessment_terminal",
      "CvExtraction_success",
      "CvParseJob_terminal",
      "CvRetryRequest_stage_binding",
      "CvDraft_json_caps",
      "CvDraft_state",
      "CvImportConfirmation_revisions",
      "CvImportConfirmation_counts",
    ];
    const result = await pool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conname = ANY($1::text[])`,
      [expected],
    );
    expect(result.rows.map((row) => row.conname).sort()).toEqual(
      [...expected].sort(),
    );
  });

  it("rejects negative or over-cap quota counters in PostgreSQL", async () => {
    const client = await pool.connect();
    const suffix = randomUUID();
    try {
      await client.query("BEGIN");
      const { accountId } = await seedOwnedUpload(client, suffix);
      await expect(
        client.query(
          `UPDATE "CvAccountQuota" SET "reservedBytes" = -1 WHERE "accountId" = $1`,
          [accountId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await client.query("ROLLBACK");
      await client.query("BEGIN");
      const second = await seedOwnedUpload(client, `${suffix}-cap`);
      await expect(
        client.query(
          `UPDATE "CvAccountQuota"
              SET "reservedBytes" = 52428801, "retainedBytes" = 0
            WHERE "accountId" = $1`,
          [second.accountId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });

  it("installs partial active-job, cleanup, and claim indexes", async () => {
    const expected = [
      "CvParseJob_one_active_per_account_idx",
      "CvStoredArtifact_one_live_kind_idx",
      "CvUpload_delete_due_idx",
      "CvScanAssessment_claim_idx",
      "CvExtraction_claim_idx",
      "CvParseJob_claim_idx",
    ];
    const result = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
      [expected],
    );
    expect(result.rows.map((row) => row.indexname).sort()).toEqual(
      [...expected].sort(),
    );
  });

  it("makes retry, consent, confirmation, and terminal attempts immutable", async () => {
    const expected = [
      "CvRetryRequest_append_only",
      "CvProcessingConsent_append_only",
      "CvImportConfirmation_append_only",
      "CvScanAssessment_terminal_immutable",
      "CvExtraction_terminal_immutable",
      "CvParseJob_terminal_immutable",
    ];
    const result = await pool.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger
        WHERE NOT tgisinternal AND tgname = ANY($1::text[])`,
      [expected],
    );
    expect(result.rows.map((row) => row.tgname).sort()).toEqual(
      [...expected].sort(),
    );
  });

  it("finds only an exact latest non-revoked external consent binding", async () => {
    const client = await pool.connect();
    const suffix = randomUUID();
    try {
      await client.query("BEGIN");
      const owned = await seedOwnedUpload(client, suffix);
      const grantId = `cv-consent-grant-${suffix}`;
      await client.query(
        `INSERT INTO "CvProcessingConsent" (
           "id", "accountId", "uploadId", "action", "provider", "providerClass",
           "model", "purposeVersion", "noticeVersion", "consentTextVersion",
           "occurredAt", "createdAt"
         ) VALUES (
           $1, $2, $3, 'GRANTED', 'openai', 'EXTERNAL_OPENAI',
           'gpt-5.4-mini-2026-03-17', 'cv-extract-v1', 'cv-processing.v1',
           'cv-external-consent.v1', now(), now()
         )`,
        [grantId, owned.accountId, owned.uploadId],
      );

      const lookup = async (model: string) =>
        client.query<{ id: string }>(
          `SELECT consent_grant.id
             FROM "CvProcessingConsent" consent_grant
            WHERE consent_grant."accountId" = $1
              AND consent_grant."uploadId" = $2
              AND consent_grant.action = 'GRANTED'
              AND consent_grant.provider = 'openai'
              AND consent_grant."providerClass" = 'EXTERNAL_OPENAI'
              AND consent_grant.model = $3
              AND consent_grant."purposeVersion" = 'cv-extract-v1'
              AND consent_grant."noticeVersion" = 'cv-processing.v1'
              AND consent_grant."consentTextVersion" = 'cv-external-consent.v1'
              AND NOT EXISTS (
                SELECT 1 FROM "CvProcessingConsent" revoke
                 WHERE revoke."supersedesConsentId" = consent_grant.id
                   AND revoke.action = 'REVOKED'
                   AND revoke."occurredAt" >= consent_grant."occurredAt"
              )
            ORDER BY consent_grant."occurredAt" DESC, consent_grant.id DESC
            LIMIT 1`,
          [owned.accountId, owned.uploadId, model],
        );

      expect((await lookup("gpt-5.4-mini-2026-03-17")).rows[0]?.id).toBe(
        grantId,
      );
      expect((await lookup("mutable-model")).rowCount).toBe(0);

      await client.query(
        `INSERT INTO "CvProcessingConsent" (
           "id", "accountId", "uploadId", "action", "supersedesConsentId",
           "provider", "providerClass", "model", "purposeVersion", "noticeVersion",
           "consentTextVersion", "occurredAt", "createdAt"
         ) VALUES (
           $1, $2, $3, 'REVOKED', $4, 'openai', 'EXTERNAL_OPENAI',
           'gpt-5.4-mini-2026-03-17', 'cv-extract-v1', 'cv-processing.v1',
           'cv-external-consent.v1', now() + interval '1 second', now()
         )`,
        [
          `cv-consent-revoke-${suffix}`,
          owned.accountId,
          owned.uploadId,
          grantId,
        ],
      );
      expect((await lookup("gpt-5.4-mini-2026-03-17")).rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("documents a forward-only rollback-safe migration without touching 001-007", async () => {
    const migration = await readFile(
      resolve(
        process.cwd(),
        "prisma/migrations/008_cv_upload_parse_review/migration.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("Rollback safety");
    expect(migration).not.toMatch(
      /DROP\s+(?:TABLE|TYPE|COLUMN)\s+(?:"user"|"CandidateProfile"|"Session")/iu,
    );
    for (let index = 1; index <= 7; index += 1) {
      const migrationDirectory = (
        await readdir(resolve(process.cwd(), "prisma/migrations"))
      ).find((name) => name.startsWith(`00${index}_`));
      expect(migrationDirectory).toBeDefined();
    }
  });
});
