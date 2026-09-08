import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

export type CvRecoveryStage = "SCAN" | "EXTRACTION" | "PARSE";
export type CvRecoveryMode = "PROCESSING" | "TERMINAL_FAILURE";

export type SeededCvRecoveryImport = Readonly<{
  accountId: string;
  profileId: string;
  uploadId: string;
  sourceId: string;
  scanId: string;
  extractionId: string | null;
  outputId: string | null;
  parseId: string | null;
  leaseOwner: string;
}>;

export async function seedCvRecoveryImport(
  client: PoolClient,
  label: string,
  options: Readonly<{
    stage: CvRecoveryStage;
    mode?: CvRecoveryMode;
    parserClass?: "DETERMINISTIC_INTERNAL" | "EXTERNAL_OPENAI";
    now: Date;
    expired?: boolean;
    deletedSource?: boolean;
    automaticAttemptsUsed?: number;
    candidateRetriesUsed?: number;
    existingAccount?: Readonly<{ accountId: string; profileId: string }>;
  }>,
): Promise<SeededCvRecoveryImport> {
  const suffix = `${label}-${randomUUID()}`;
  const accountId =
    options.existingAccount?.accountId ?? `recovery-account-${suffix}`;
  const profileId =
    options.existingAccount?.profileId ?? `recovery-profile-${suffix}`;
  const uploadId = `recovery-upload-${suffix}`;
  const sourceId = `recovery-source-${suffix}`;
  const scanId = `recovery-scan-${suffix}`;
  const extractionId =
    options.stage === "SCAN" ? null : `recovery-extraction-${suffix}`;
  const outputId =
    options.stage === "PARSE" ? `recovery-output-${suffix}` : null;
  const parseId = options.stage === "PARSE" ? `recovery-parse-${suffix}` : null;
  const leaseOwner = `recovery-worker-${suffix}`;
  const mode = options.mode ?? "PROCESSING";
  const parserClass = options.parserClass ?? "DETERMINISTIC_INTERNAL";
  const automaticAttemptsUsed = options.automaticAttemptsUsed ?? 1;
  const candidateRetriesUsed = options.candidateRetriesUsed ?? 0;
  const email = `${suffix}@example.invalid`;
  const uploadStatus =
    mode === "PROCESSING"
      ? options.stage === "SCAN"
        ? "SCANNING"
        : options.stage === "EXTRACTION"
          ? "EXTRACTING"
          : "PARSING"
      : options.stage === "SCAN"
        ? "SCAN_FAILED"
        : options.stage === "EXTRACTION"
          ? "EXTRACTION_FAILED"
          : "PARSE_FAILED";
  const expiresAt = new Date(
    options.expired
      ? options.now.getTime() - 1
      : options.now.getTime() + 30 * 86_400_000,
  );
  const createdAt = new Date(expiresAt.getTime() - 30 * 86_400_000);

  if (!options.existingAccount) {
    await client.query(
      `INSERT INTO "user" (
       "id", "name", "email", "normalizedEmail", "emailVerified", "state",
       "stateChangedAt", "createdAt", "updatedAt"
     ) VALUES ($1, 'Synthetic Recovery Candidate', $2, $2, true, 'ACTIVE', $3, $3, $3)`,
      [accountId, email, createdAt],
    );
    await client.query(
      `INSERT INTO "CandidateIdentity" ("userId", "createdAt", "updatedAt")
     VALUES ($1, $2, $2)`,
      [accountId, createdAt],
    );
    await client.query(
      `INSERT INTO "CandidateProfile" (
       "id", "candidateUserId", "revision", "createdAt", "updatedAt"
     ) VALUES ($1, $2, 0, $3, $3)`,
      [profileId, accountId, createdAt],
    );
    await client.query(
      `INSERT INTO "CvAccountQuota" (
       "accountId", "reservedBytes", "retainedBytes", "createdAt", "updatedAt"
     ) VALUES ($1, 0, 2, $2, $2)`,
      [accountId, createdAt],
    );
  } else {
    await client.query(
      `INSERT INTO "CvAccountQuota" (
         "accountId", "reservedBytes", "retainedBytes", "createdAt", "updatedAt"
       ) VALUES ($1, 0, 2, $2, $2)
       ON CONFLICT ("accountId") DO UPDATE
         SET "retainedBytes" = "CvAccountQuota"."retainedBytes" + 2,
             "updatedAt" = EXCLUDED."updatedAt"`,
      [accountId, createdAt],
    );
  }
  await client.query(
    `INSERT INTO "CvUpload" (
       "id", "accountId", "profileId", "documentKind", "parserClass", "status",
       "declaredMediaType", "declaredBytes", "actualBytes", "quotaReservationBytes",
       "quotaReservationRemaining", "sourceSha256", "idempotencyDigest",
       "createBindingDigest", "failureCode", "automaticScanAttemptsUsed",
       "candidateScanRetriesUsed", "automaticParseAttemptsUsed",
       "candidateParseRetriesUsed", "contentReceivedAt", "expiresAt", "createdAt", "updatedAt"
     ) VALUES (
       $1, $2, $3, 'PDF', $4::"CvParserClass", $5::"CvUploadStatus",
       'application/pdf', 1, 1, 524289, 0, decode(repeat('31', 32), 'hex'),
       decode(md5($1) || md5($1 || ':fixture'), 'hex'),
       decode(repeat('33', 32), 'hex'),
       CASE WHEN $6 = 'PROCESSING' THEN NULL ELSE
         CASE WHEN $7 = 'SCAN' THEN 'SCANNER_UNAVAILABLE'
              WHEN $7 = 'EXTRACTION' THEN 'EXTRACTION_FAILED'
              ELSE 'PARSER_UNAVAILABLE' END
       END,
       CASE WHEN $7 = 'SCAN' THEN $8 ELSE 1 END,
       CASE WHEN $7 = 'SCAN' THEN $9 ELSE 0 END,
       CASE WHEN $7 = 'PARSE' THEN $8 ELSE 1 END,
       CASE WHEN $7 = 'PARSE' THEN $9 ELSE 0 END,
       $10::timestamp(3), $11::timestamp(3),
       $10::timestamp(3), $10::timestamp(3)
     )`,
    [
      uploadId,
      accountId,
      profileId,
      parserClass,
      uploadStatus,
      mode,
      options.stage,
      automaticAttemptsUsed,
      candidateRetriesUsed,
      createdAt,
      expiresAt,
    ],
  );
  await client.query(
    `INSERT INTO "CvStoredArtifact" (
       "id", "uploadId", "accountId", "kind", "status", "storageAdapter",
       "storageLocator", "encryptionKeyVersion", "encryptionIv", "authenticationTag",
       "plaintextBytes", "ciphertextBytes", "plaintextSha256", "availableAt",
       "contentInaccessibleAt", "deleteAfter", "deletedAt", "createdAt", "updatedAt"
     ) VALUES (
       $1, $2, $3, 'SOURCE_DOCUMENT', $4::"CvArtifactStatus", 'fixture-v1', $5, 1,
       decode(repeat('41', 12), 'hex'), decode(repeat('42', 16), 'hex'), 1, 1,
       decode(repeat('31', 32), 'hex'), $6::timestamp(3),
       CASE WHEN $7 THEN $6::timestamp(3) ELSE NULL END,
       CASE WHEN $7 THEN $6::timestamp(3) ELSE NULL END,
       CASE WHEN $7 THEN $6::timestamp(3) ELSE NULL END,
       $8::timestamp(3), $8::timestamp(3)
     )`,
    [
      sourceId,
      uploadId,
      accountId,
      options.deletedSource
        ? "DELETED"
        : options.stage === "SCAN"
          ? "QUARANTINED"
          : "AVAILABLE",
      `fixture/${sourceId}`,
      options.now,
      options.deletedSource ?? false,
      createdAt,
    ],
  );

  const scanStatus =
    options.stage === "SCAN"
      ? mode === "PROCESSING"
        ? "PROCESSING"
        : "INDETERMINATE"
      : "CLEAN";
  await client.query(
    `INSERT INTO "CvScanAssessment" (
       "id", "uploadId", "sourceArtifactId", "accountId", "attemptNumber",
       "candidateInitiated", "status", "engineName", "engineVersion",
       "signatureVersion", "signaturePublishedAt", "failureCode", "leaseOwner",
       "leaseExpiresAt", "startedAt", "completedAt", "createdAt"
     ) VALUES (
       $1, $2, $3, $4, 1, false, $5::"CvScanStatus",
       CASE WHEN $5 = 'CLEAN' THEN 'clamav' ELSE NULL END,
       CASE WHEN $5 = 'CLEAN' THEN '1.4.5' ELSE NULL END,
       CASE WHEN $5 = 'CLEAN' THEN 'fixture' ELSE NULL END,
       CASE WHEN $5 = 'CLEAN' THEN $6::timestamp(3) ELSE NULL END,
       CASE WHEN $5 = 'INDETERMINATE' THEN 'SCANNER_UNAVAILABLE' ELSE NULL END,
       CASE WHEN $5 = 'PROCESSING' THEN $7 ELSE NULL END,
       CASE WHEN $5 = 'PROCESSING' THEN $6::timestamp(3) + interval '1 minute' ELSE NULL END,
       $6::timestamp(3),
       CASE WHEN $5 IN ('CLEAN', 'INDETERMINATE') THEN $6::timestamp(3) ELSE NULL END,
       $8::timestamp(3)
     )`,
    [
      scanId,
      uploadId,
      sourceId,
      accountId,
      scanStatus,
      options.now,
      leaseOwner,
      createdAt,
    ],
  );

  if (extractionId) {
    const extractionStatus =
      options.stage === "EXTRACTION"
        ? mode === "PROCESSING"
          ? "PROCESSING"
          : "FAILED"
        : "SUCCEEDED";
    if (outputId)
      await client.query(
        `INSERT INTO "CvStoredArtifact" (
           "id", "uploadId", "accountId", "kind", "status", "storageAdapter",
           "storageLocator", "encryptionKeyVersion", "encryptionIv", "authenticationTag",
           "plaintextBytes", "ciphertextBytes", "plaintextSha256", "availableAt",
           "createdAt", "updatedAt"
         ) VALUES ($1, $2, $3, 'EXTRACTED_TEXT', 'AVAILABLE', 'fixture-v1', $4, 1,
           decode(repeat('51', 12), 'hex'), decode(repeat('52', 16), 'hex'), 1, 1,
           decode(repeat('53', 32), 'hex'), $5::timestamp(3),
           $6::timestamp(3), $6::timestamp(3))`,
        [
          outputId,
          uploadId,
          accountId,
          `fixture/${outputId}`,
          options.now,
          createdAt,
        ],
      );
    await client.query(
      `INSERT INTO "CvExtraction" (
         "id", "uploadId", "sourceArtifactId", "scanAssessmentId", "accountId",
         "outputArtifactId", "attemptNumber", "status", "extractorName",
         "extractorVersion", "rulesVersion", "pageCount", "segmentCount",
         "extractedUtf8Bytes", "failureCode", "leaseOwner", "leaseExpiresAt",
         "startedAt", "completedAt", "createdAt"
       ) VALUES (
         $1, $2, $3, $4, $5, $6, 1, $7::"CvExtractionStatus",
         CASE WHEN $7 = 'SUCCEEDED' THEN 'fixture' ELSE NULL END,
         CASE WHEN $7 = 'SUCCEEDED' THEN '1' ELSE NULL END,
         CASE WHEN $7 = 'SUCCEEDED' THEN '1' ELSE NULL END,
         CASE WHEN $7 = 'SUCCEEDED' THEN 1 ELSE NULL END,
         CASE WHEN $7 = 'SUCCEEDED' THEN 1 ELSE NULL END,
         CASE WHEN $7 = 'SUCCEEDED' THEN 1 ELSE NULL END,
         CASE WHEN $7 = 'FAILED' THEN 'EXTRACTION_FAILED' ELSE NULL END,
         CASE WHEN $7 = 'PROCESSING' THEN $8 ELSE NULL END,
         CASE WHEN $7 = 'PROCESSING' THEN $9::timestamp(3) + interval '1 minute' ELSE NULL END,
         $9::timestamp(3),
         CASE WHEN $7 IN ('SUCCEEDED', 'FAILED') THEN $9::timestamp(3) ELSE NULL END,
         $10::timestamp(3)
       )`,
      [
        extractionId,
        uploadId,
        sourceId,
        scanId,
        accountId,
        outputId,
        extractionStatus,
        leaseOwner,
        options.now,
        createdAt,
      ],
    );
  }

  if (parseId && extractionId) {
    const parseStatus = mode === "PROCESSING" ? "PROCESSING" : "FAILED";
    await client.query(
      `INSERT INTO "CvParseJob" (
         "id", "uploadId", "extractionId", "accountId", "attemptNumber", "trigger",
         "status", "parserClass", "provider", "model", "purposeVersion", "inputVersion",
         "instructionVersion", "schemaVersion", "failureCode", "leaseOwner",
         "leaseExpiresAt", "startedAt", "completedAt", "createdAt"
       ) VALUES (
         $1, $2, $3, $4, 1, 'INITIAL', $5::"CvParseStatus", $6::"CvParserClass",
         CASE WHEN $6 = 'EXTERNAL_OPENAI' THEN 'openai' ELSE 'smarthire' END,
         CASE WHEN $6 = 'EXTERNAL_OPENAI' THEN 'gpt-5.4-mini-2026-03-17' ELSE 'deterministic-v1' END,
         'cv-profile-fact-extraction-v1', 'cv-segments-v1', 'cv-extract-v1', 'cv-draft-v1',
         CASE WHEN $5 = 'FAILED' THEN 'PARSER_UNAVAILABLE' ELSE NULL END,
         CASE WHEN $5 = 'PROCESSING' THEN $7 ELSE NULL END,
         CASE WHEN $5 = 'PROCESSING' THEN $8::timestamp(3) + interval '1 minute' ELSE NULL END,
         $8::timestamp(3),
         CASE WHEN $5 = 'FAILED' THEN $8::timestamp(3) ELSE NULL END,
         $9::timestamp(3)
       )`,
      [
        parseId,
        uploadId,
        extractionId,
        accountId,
        parseStatus,
        parserClass,
        leaseOwner,
        options.now,
        createdAt,
      ],
    );
  }
  return {
    accountId,
    profileId,
    uploadId,
    sourceId,
    scanId,
    extractionId,
    outputId,
    parseId,
    leaseOwner,
  };
}

export async function grantExactRecoveryConsent(
  client: PoolClient,
  seeded: SeededCvRecoveryImport,
  now: Date,
) {
  const consentId = `recovery-consent-${randomUUID()}`;
  await client.query(
    `INSERT INTO "CvProcessingConsent" (
       "id", "accountId", "uploadId", "action", "provider", "providerClass",
       "model", "purposeVersion", "noticeVersion", "consentTextVersion",
       "occurredAt", "createdAt"
     ) VALUES ($1, $2, $3, 'GRANTED', 'openai', 'EXTERNAL_OPENAI',
       'gpt-5.4-mini-2026-03-17', 'cv-profile-fact-extraction-v1',
       'cv-processing.v1', 'cv-external-consent.v1',
       $4::timestamp(3), $4::timestamp(3))`,
    [consentId, seeded.accountId, seeded.uploadId, now],
  );
  return consentId;
}

export async function cleanupCvRecoveryAccounts(
  client: PoolClient,
  accountIds: readonly string[],
) {
  if (!accountIds.length) return;
  await client.query("BEGIN");
  try {
    await client.query(
      `SELECT set_config('smarthire.cv_retention_mode', 'on', true)`,
    );
    await client.query(
      `DELETE FROM "CandidateIdentity" WHERE "userId" = ANY($1::text[])`,
      [accountIds],
    );
    await client.query(`DELETE FROM "user" WHERE "id" = ANY($1::text[])`, [
      accountIds,
    ]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
