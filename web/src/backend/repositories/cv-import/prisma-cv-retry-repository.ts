import "server-only";

import { randomUUID } from "node:crypto";

import type { Prisma } from "@/backend/generated/prisma/client";
import { prisma } from "@/backend/database/prisma";
import { CvImportServiceError } from "@/backend/services/cv-import/cv-http-errors";
import type { CvExternalConsentBinding } from "./cv-consent-read-gateway";
import { CV_SECURITY_POLICY_VERSION } from "@/shared/contracts/cv-import/common";
import {
  CV_CANDIDATE_EXTRACTION_RETRY_LIMIT,
  CV_CANDIDATE_PARSE_RETRY_LIMIT,
  CV_CANDIDATE_SCAN_RETRY_LIMIT,
  CV_RETRYABLE_PARSE_FAILURE_CODES,
  CV_RETRYABLE_OCR_FAILURE_CODES,
  CV_RETRYABLE_SCAN_FAILURE_CODES,
  cvRetryAcceptedSchema,
  projectCvRetryRemainingCounts,
  type CvRetryAccepted,
} from "@/shared/contracts/cv-import/retry";
import { CV_PROCESSING_NOTICES } from "@/shared/contracts/cv-import/upload";

type CvDatabase = typeof prisma | Prisma.TransactionClient;
type RetryStage = "SCAN" | "EXTRACTION" | "PARSE";

const CV_EXTERNAL_CONSENT_TEXT_VERSION = "cv-external-consent.v1";
const retryableScanFailures = new Set<string>(CV_RETRYABLE_SCAN_FAILURE_CODES);
const retryableParseFailures = new Set<string>(
  CV_RETRYABLE_PARSE_FAILURE_CODES,
);
const retryableOcrFailures = new Set<string>(CV_RETRYABLE_OCR_FAILURE_CODES);

type RetryUpload = Readonly<{
  id: string;
  accountId: string;
  parserClass: "DETERMINISTIC_INTERNAL" | "EXTERNAL_OPENAI";
  status: string;
  failureCode: string | null;
  candidateScanRetriesUsed: number;
  candidateParseRetriesUsed: number;
  expired: boolean;
  contentInaccessibleAt: Date | null;
  deletedAt: Date | null;
}>;

type SourceArtifact = Readonly<{
  id: string;
  status: string;
  contentInaccessibleAt: Date | null;
  deletedAt: Date | null;
}>;

type ScanAttempt = Readonly<{
  id: string;
  sourceArtifactId: string;
  attemptNumber: number;
  status: string;
  failureCode: string | null;
  policyVersion: string;
  completedAt: Date | null;
}>;

type ExtractionAttempt = Readonly<{
  id: string;
  sourceArtifactId: string;
  scanAssessmentId: string;
  attemptNumber: number;
  status: string;
  failureCode: string | null;
}>;

type ParseAttempt = Readonly<{
  id: string;
  extractionId: string;
  attemptNumber: number;
  status: string;
  failureCode: string | null;
  parserClass: "DETERMINISTIC_INTERNAL" | "EXTERNAL_OPENAI";
  provider: string;
  model: string;
  purposeVersion: string;
  inputVersion: string;
  instructionVersion: string;
  schemaVersion: string;
}>;

type ExtractionInput = Readonly<{
  id: string;
  status: string;
  outputArtifactId: string | null;
}>;

type StoredRetry = Readonly<{
  uploadId: string;
  stage: RetryStage;
  priorScanAssessmentId: string | null;
  scanAssessmentId: string | null;
  priorParseJobId: string | null;
  parseJobId: string | null;
  priorExtractionId: string | null;
  extractionId: string | null;
  candidateScanRetriesUsed: number;
  candidateExtractionRetriesUsed: number;
  candidateParseRetriesUsed: number;
  parserClass: "DETERMINISTIC_INTERNAL" | "EXTERNAL_OPENAI";
}>;

export type CvCandidateRetryEligibility =
  | Readonly<{ stage: "SCAN"; parserClass: RetryUpload["parserClass"] }>
  | Readonly<{
      stage: "EXTRACTION";
      parserClass: RetryUpload["parserClass"];
    }>
  | Readonly<{
      stage: "PARSE";
      parserClass: RetryUpload["parserClass"];
      externalConsentBinding: CvExternalConsentBinding | null;
    }>;

export type CvCandidateRetryResult = Readonly<{
  outcome: CvRetryAccepted;
  replayed: boolean;
  stage: RetryStage;
  parserClass: RetryUpload["parserClass"];
}>;

type RetryLookup = Readonly<{
  accountId: string;
  uploadId: string;
  idempotencyDigest: Uint8Array;
}>;

type CreateCandidateRetryInput = RetryLookup &
  Readonly<{
    now: Date;
    consentId?: string | null;
  }>;

function digestHex(value: Uint8Array): string {
  if (value.byteLength !== 32) throw new Error("CV_DIGEST_LENGTH_INVALID");
  return Buffer.from(value).toString("hex");
}

function retryLimitReached(): CvImportServiceError {
  return new CvImportServiceError("RETRY_LIMIT_REACHED", {
    retryAfterSeconds: 60,
  });
}

function retryOutcome(
  upload: Readonly<{
    id: string;
    candidateScanRetriesUsed: number;
    candidateParseRetriesUsed: number;
    candidateExtractionRetriesUsed?: number;
  }>,
  stage: RetryStage,
): CvRetryAccepted {
  const remaining = projectCvRetryRemainingCounts({
    candidateScanRetriesUsed: upload.candidateScanRetriesUsed,
    candidateParseRetriesUsed: upload.candidateParseRetriesUsed,
    ...(stage === "EXTRACTION" &&
    typeof upload.candidateExtractionRetriesUsed === "number"
      ? {
          candidateExtractionRetriesUsed: upload.candidateExtractionRetriesUsed,
        }
      : {}),
  });
  return Object.freeze(
    cvRetryAcceptedSchema.parse({
      uploadId: upload.id,
      status:
        stage === "SCAN"
          ? "SCAN_QUEUED"
          : stage === "EXTRACTION"
            ? "EXTRACTION_QUEUED"
            : "PARSE_QUEUED",
      ...remaining,
    }),
  );
}

function assertUsableDate(now: Date): void {
  if (Number.isNaN(now.getTime()))
    throw new CvImportServiceError("VALIDATION_ERROR");
}

function assertBaseRetryState(
  upload: RetryUpload,
  source: SourceArtifact | null,
): RetryStage {
  if (
    upload.expired ||
    upload.contentInaccessibleAt !== null ||
    upload.deletedAt !== null ||
    !source ||
    source.contentInaccessibleAt !== null ||
    source.deletedAt !== null
  ) {
    throw new CvImportServiceError("IMPORT_STATE_CONFLICT");
  }
  if (upload.status === "SCAN_FAILED") {
    if (!["QUARANTINED", "AVAILABLE"].includes(source.status))
      throw new CvImportServiceError("IMPORT_STATE_CONFLICT");
    return "SCAN";
  }
  if (upload.status === "EXTRACTION_FAILED") {
    if (
      source.status !== "AVAILABLE" ||
      !upload.failureCode ||
      !retryableOcrFailures.has(upload.failureCode)
    )
      throw new CvImportServiceError("IMPORT_STATE_CONFLICT");
    return "EXTRACTION";
  }
  if (upload.status === "PARSE_FAILED") {
    if (source.status !== "AVAILABLE")
      throw new CvImportServiceError("IMPORT_STATE_CONFLICT");
    return "PARSE";
  }
  // Extraction and validation failures intentionally have no retry path.
  throw new CvImportServiceError("IMPORT_STATE_CONFLICT");
}

function assertScanEligibility(upload: RetryUpload, prior: ScanAttempt | null) {
  if (
    upload.candidateScanRetriesUsed >= CV_CANDIDATE_SCAN_RETRY_LIMIT ||
    (prior?.attemptNumber ?? 5) >= 5
  ) {
    throw retryLimitReached();
  }
  const validPrior =
    prior?.status === "INDETERMINATE" &&
    Boolean(prior.failureCode && retryableScanFailures.has(prior.failureCode));
  if (!prior || !validPrior) {
    throw new CvImportServiceError("IMPORT_STATE_CONFLICT");
  }
}

function assertExtractionEligibility(
  upload: RetryUpload,
  prior: ExtractionAttempt | null,
  cleanScan: ScanAttempt | null,
  extractionRetriesUsed: number,
) {
  if (
    extractionRetriesUsed >= CV_CANDIDATE_EXTRACTION_RETRY_LIMIT ||
    (prior?.attemptNumber ?? 5) >= 5
  ) {
    throw retryLimitReached();
  }
  if (
    !prior ||
    prior.status !== "FAILED" ||
    !prior.failureCode ||
    !retryableOcrFailures.has(prior.failureCode) ||
    !cleanScan ||
    cleanScan.status !== "CLEAN" ||
    cleanScan.completedAt === null ||
    cleanScan.policyVersion !== CV_SECURITY_POLICY_VERSION ||
    cleanScan.sourceArtifactId !== prior.sourceArtifactId
  ) {
    throw new CvImportServiceError("IMPORT_STATE_CONFLICT");
  }
  if (upload.status !== "EXTRACTION_FAILED")
    throw new CvImportServiceError("IMPORT_STATE_CONFLICT");
}

function assertParseEligibility(
  upload: RetryUpload,
  prior: ParseAttempt | null,
) {
  if (
    upload.candidateParseRetriesUsed >= CV_CANDIDATE_PARSE_RETRY_LIMIT ||
    (prior?.attemptNumber ?? 5) >= 5
  ) {
    throw retryLimitReached();
  }
  if (
    !prior ||
    prior.status !== "FAILED" ||
    prior.parserClass !== upload.parserClass ||
    !prior.failureCode ||
    !retryableParseFailures.has(prior.failureCode)
  ) {
    throw new CvImportServiceError("IMPORT_STATE_CONFLICT");
  }
}

function isRetryableTransactionConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    meta?: { code?: unknown };
  };
  return (
    candidate.code === "P2034" ||
    candidate.code === "40001" ||
    candidate.meta?.code === "40001" ||
    (typeof candidate.message === "string" &&
      /write conflict|deadlock|serialization failure/u.test(candidate.message))
  );
}

function isActiveParseConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    meta?: { code?: unknown; constraint?: unknown };
  };
  return (
    (candidate.code === "23505" || candidate.meta?.code === "23505") &&
    `${String(candidate.meta?.constraint ?? "")} ${String(candidate.message ?? "")}`.includes(
      "CvParseJob_one_active_per_account_idx",
    )
  );
}

async function candidateRetryCount(
  database: CvDatabase,
  uploadId: string,
  stage: RetryStage,
): Promise<number> {
  const rows = await database.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count
      FROM "CvRetryRequest"
     WHERE "uploadId" = ${uploadId}
       AND "stage" = ${stage}::"CvRetryStage"
  `;
  return rows[0]?.count ?? 0;
}

async function findReplayIn(
  database: CvDatabase,
  input: RetryLookup,
): Promise<CvCandidateRetryResult | null> {
  const rows = await database.$queryRaw<StoredRetry[]>`
    SELECT retry."uploadId", retry."stage"::text AS "stage",
           retry."priorScanAssessmentId", retry."scanAssessmentId",
           retry."priorParseJobId", retry."parseJobId",
           retry."priorExtractionId", retry."extractionId",
           CASE WHEN retry."stage" = 'SCAN' THEN (
             SELECT COUNT(*)::int
               FROM "CvRetryRequest" candidate_retry
               JOIN "CvScanAssessment" candidate_attempt
                 ON candidate_attempt."id" = candidate_retry."scanAssessmentId"
               JOIN "CvScanAssessment" replay_attempt
                 ON replay_attempt."id" = retry."scanAssessmentId"
              WHERE candidate_retry."uploadId" = retry."uploadId"
                AND candidate_retry."stage" = 'SCAN'
                AND candidate_attempt."attemptNumber" <= replay_attempt."attemptNumber"
           ) ELSE (
             SELECT COUNT(*)::int FROM "CvRetryRequest" candidate_retry
              WHERE candidate_retry."uploadId" = retry."uploadId"
                AND candidate_retry."stage" = 'SCAN'
           ) END AS "candidateScanRetriesUsed",
           CASE WHEN retry."stage" = 'PARSE' THEN (
             SELECT COUNT(*)::int
               FROM "CvRetryRequest" candidate_retry
               JOIN "CvParseJob" candidate_attempt
                 ON candidate_attempt."id" = candidate_retry."parseJobId"
               JOIN "CvParseJob" replay_attempt
                 ON replay_attempt."id" = retry."parseJobId"
              WHERE candidate_retry."uploadId" = retry."uploadId"
                AND candidate_retry."stage" = 'PARSE'
                AND candidate_attempt."attemptNumber" <= replay_attempt."attemptNumber"
            ) ELSE 0 END AS "candidateParseRetriesUsed",
           CASE WHEN retry."stage" = 'EXTRACTION' THEN (
             SELECT COUNT(*)::int
               FROM "CvRetryRequest" candidate_retry
               JOIN "CvExtraction" candidate_attempt
                 ON candidate_attempt."id" = candidate_retry."extractionId"
               JOIN "CvExtraction" replay_attempt
                 ON replay_attempt."id" = retry."extractionId"
              WHERE candidate_retry."uploadId" = retry."uploadId"
                AND candidate_retry."stage" = 'EXTRACTION'
                AND candidate_attempt."attemptNumber" <= replay_attempt."attemptNumber"
           ) ELSE 0 END AS "candidateExtractionRetriesUsed",
           upload."parserClass"::text AS "parserClass"
      FROM "CvRetryRequest" retry
      JOIN "CvUpload" upload ON upload."id" = retry."uploadId"
     WHERE retry."accountId" = ${input.accountId}
       AND retry."idempotencyDigest" = decode(${digestHex(input.idempotencyDigest)}, 'hex')
     LIMIT 1
  `;
  const stored = rows[0];
  if (!stored) return null;
  if (stored.uploadId !== input.uploadId)
    throw new CvImportServiceError("IDEMPOTENCY_KEY_REUSED");
  const exactBinding =
    stored.stage === "SCAN"
      ? Boolean(
          stored.priorScanAssessmentId &&
          stored.scanAssessmentId &&
          !stored.priorParseJobId &&
          !stored.parseJobId &&
          !stored.priorExtractionId &&
          !stored.extractionId,
        )
      : stored.stage === "EXTRACTION"
        ? Boolean(
            stored.priorExtractionId &&
            stored.extractionId &&
            !stored.priorScanAssessmentId &&
            !stored.scanAssessmentId &&
            !stored.priorParseJobId &&
            !stored.parseJobId,
          )
        : Boolean(
            stored.priorParseJobId &&
            stored.parseJobId &&
            !stored.priorScanAssessmentId &&
            !stored.scanAssessmentId &&
            !stored.priorExtractionId &&
            !stored.extractionId,
          );
  if (!exactBinding) throw new Error("CV_RETRY_BINDING_INVALID");
  return Object.freeze({
    outcome: retryOutcome(
      {
        id: stored.uploadId,
        candidateScanRetriesUsed: stored.candidateScanRetriesUsed,
        candidateParseRetriesUsed: stored.candidateParseRetriesUsed,
        candidateExtractionRetriesUsed: stored.candidateExtractionRetriesUsed,
      },
      stored.stage,
    ),
    replayed: true,
    stage: stored.stage,
    parserClass: stored.parserClass,
  });
}

async function findOwnedUpload(
  database: CvDatabase,
  accountId: string,
  uploadId: string,
  now: Date,
): Promise<RetryUpload | null> {
  const rows = await database.$queryRaw<RetryUpload[]>`
    SELECT upload."id", upload."accountId",
           upload."parserClass"::text AS "parserClass",
           upload."status"::text AS "status", upload."failureCode",
           upload."candidateScanRetriesUsed", upload."candidateParseRetriesUsed",
           (EXTRACT(EPOCH FROM upload."expiresAt") * 1000 <= ${now.getTime()}) AS "expired",
           upload."contentInaccessibleAt", upload."deletedAt"
      FROM "CvUpload" upload
      JOIN "user" account ON account."id" = upload."accountId"
     WHERE upload."id" = ${uploadId} AND upload."accountId" = ${accountId}
       AND account."state" = 'ACTIVE' AND account."deletedAt" IS NULL
     LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findSourceArtifact(
  database: CvDatabase,
  accountId: string,
  uploadId: string,
  lock = false,
): Promise<SourceArtifact | null> {
  const rows = lock
    ? await database.$queryRaw<SourceArtifact[]>`
        SELECT artifact."id", artifact."status"::text AS "status",
               artifact."contentInaccessibleAt", artifact."deletedAt"
          FROM "CvStoredArtifact" artifact
         WHERE artifact."uploadId" = ${uploadId}
           AND artifact."accountId" = ${accountId}
           AND artifact."kind" = 'SOURCE_DOCUMENT'
         ORDER BY artifact."createdAt" DESC, artifact."id" DESC
         LIMIT 1 FOR UPDATE
      `
    : await database.$queryRaw<SourceArtifact[]>`
        SELECT artifact."id", artifact."status"::text AS "status",
               artifact."contentInaccessibleAt", artifact."deletedAt"
          FROM "CvStoredArtifact" artifact
         WHERE artifact."uploadId" = ${uploadId}
           AND artifact."accountId" = ${accountId}
           AND artifact."kind" = 'SOURCE_DOCUMENT'
         ORDER BY artifact."createdAt" DESC, artifact."id" DESC
         LIMIT 1
      `;
  return rows[0] ?? null;
}

async function findLatestScan(
  database: CvDatabase,
  accountId: string,
  uploadId: string,
  lock = false,
): Promise<ScanAttempt | null> {
  const rows = lock
    ? await database.$queryRaw<ScanAttempt[]>`
        SELECT assessment."id", assessment."sourceArtifactId",
               assessment."attemptNumber", assessment."status"::text AS "status",
               assessment."failureCode", assessment."policyVersion",
               assessment."completedAt"
          FROM "CvScanAssessment" assessment
         WHERE assessment."uploadId" = ${uploadId}
           AND assessment."accountId" = ${accountId}
         ORDER BY assessment."attemptNumber" DESC
         LIMIT 1 FOR UPDATE
      `
    : await database.$queryRaw<ScanAttempt[]>`
        SELECT assessment."id", assessment."sourceArtifactId",
               assessment."attemptNumber", assessment."status"::text AS "status",
               assessment."failureCode", assessment."policyVersion",
               assessment."completedAt"
          FROM "CvScanAssessment" assessment
         WHERE assessment."uploadId" = ${uploadId}
           AND assessment."accountId" = ${accountId}
         ORDER BY assessment."attemptNumber" DESC
         LIMIT 1
      `;
  return rows[0] ?? null;
}

async function findScanById(
  database: CvDatabase,
  accountId: string,
  uploadId: string,
  scanAssessmentId: string,
  lock = false,
): Promise<ScanAttempt | null> {
  const rows = lock
    ? await database.$queryRaw<ScanAttempt[]>`
        SELECT assessment."id", assessment."sourceArtifactId",
               assessment."attemptNumber", assessment."status"::text AS "status",
               assessment."failureCode", assessment."policyVersion",
               assessment."completedAt"
          FROM "CvScanAssessment" assessment
         WHERE assessment."id" = ${scanAssessmentId}
           AND assessment."uploadId" = ${uploadId}
           AND assessment."accountId" = ${accountId}
         LIMIT 1 FOR UPDATE
      `
    : await database.$queryRaw<ScanAttempt[]>`
        SELECT assessment."id", assessment."sourceArtifactId",
               assessment."attemptNumber", assessment."status"::text AS "status",
               assessment."failureCode", assessment."policyVersion",
               assessment."completedAt"
          FROM "CvScanAssessment" assessment
         WHERE assessment."id" = ${scanAssessmentId}
           AND assessment."uploadId" = ${uploadId}
           AND assessment."accountId" = ${accountId}
         LIMIT 1
      `;
  return rows[0] ?? null;
}

async function findLatestExtraction(
  database: CvDatabase,
  accountId: string,
  uploadId: string,
  lock = false,
): Promise<ExtractionAttempt | null> {
  const rows = lock
    ? await database.$queryRaw<ExtractionAttempt[]>`
        SELECT extraction."id", extraction."sourceArtifactId",
               extraction."scanAssessmentId", extraction."attemptNumber",
               extraction."status"::text AS "status", extraction."failureCode"
          FROM "CvExtraction" extraction
         WHERE extraction."uploadId" = ${uploadId}
           AND extraction."accountId" = ${accountId}
         ORDER BY extraction."attemptNumber" DESC
         LIMIT 1 FOR UPDATE
      `
    : await database.$queryRaw<ExtractionAttempt[]>`
        SELECT extraction."id", extraction."sourceArtifactId",
               extraction."scanAssessmentId", extraction."attemptNumber",
               extraction."status"::text AS "status", extraction."failureCode"
          FROM "CvExtraction" extraction
         WHERE extraction."uploadId" = ${uploadId}
           AND extraction."accountId" = ${accountId}
         ORDER BY extraction."attemptNumber" DESC
         LIMIT 1
      `;
  return rows[0] ?? null;
}

async function findLatestParse(
  database: CvDatabase,
  accountId: string,
  uploadId: string,
  lock = false,
): Promise<ParseAttempt | null> {
  const rows = lock
    ? await database.$queryRaw<ParseAttempt[]>`
        SELECT job."id", job."extractionId", job."attemptNumber",
               job."status"::text AS "status", job."failureCode",
               job."parserClass"::text AS "parserClass", job."provider", job."model",
               job."purposeVersion", job."inputVersion", job."instructionVersion",
               job."schemaVersion"
          FROM "CvParseJob" job
         WHERE job."uploadId" = ${uploadId} AND job."accountId" = ${accountId}
         ORDER BY job."attemptNumber" DESC
         LIMIT 1 FOR UPDATE
      `
    : await database.$queryRaw<ParseAttempt[]>`
        SELECT job."id", job."extractionId", job."attemptNumber",
               job."status"::text AS "status", job."failureCode",
               job."parserClass"::text AS "parserClass", job."provider", job."model",
               job."purposeVersion", job."inputVersion", job."instructionVersion",
               job."schemaVersion"
          FROM "CvParseJob" job
         WHERE job."uploadId" = ${uploadId} AND job."accountId" = ${accountId}
         ORDER BY job."attemptNumber" DESC
         LIMIT 1
      `;
  return rows[0] ?? null;
}

async function lockRetryUpload(
  database: Prisma.TransactionClient,
  accountId: string,
  uploadId: string,
  now: Date,
): Promise<RetryUpload | null> {
  const rows = await database.$queryRaw<RetryUpload[]>`
    SELECT upload."id", upload."accountId",
           upload."parserClass"::text AS "parserClass",
           upload."status"::text AS "status", upload."failureCode",
           upload."candidateScanRetriesUsed", upload."candidateParseRetriesUsed",
           (EXTRACT(EPOCH FROM upload."expiresAt") * 1000 <= ${now.getTime()}) AS "expired",
           upload."contentInaccessibleAt", upload."deletedAt"
      FROM "CvUpload" upload
      JOIN "CvAccountQuota" quota ON quota."accountId" = upload."accountId"
      JOIN "user" account ON account."id" = upload."accountId"
     WHERE upload."id" = ${uploadId} AND upload."accountId" = ${accountId}
       AND account."state" = 'ACTIVE' AND account."deletedAt" IS NULL
     FOR UPDATE OF upload, quota
  `;
  return rows[0] ?? null;
}

async function lockExtractionInput(
  database: Prisma.TransactionClient,
  accountId: string,
  uploadId: string,
  extractionId: string,
): Promise<ExtractionInput | null> {
  const rows = await database.$queryRaw<ExtractionInput[]>`
    SELECT extraction."id", extraction."status"::text AS "status",
           extraction."outputArtifactId"
      FROM "CvExtraction" extraction
     WHERE extraction."id" = ${extractionId}
       AND extraction."uploadId" = ${uploadId}
       AND extraction."accountId" = ${accountId}
     FOR UPDATE
  `;
  return rows[0] ?? null;
}

async function lockOutputArtifact(
  database: Prisma.TransactionClient,
  accountId: string,
  uploadId: string,
  artifactId: string,
): Promise<SourceArtifact | null> {
  const rows = await database.$queryRaw<SourceArtifact[]>`
    SELECT artifact."id", artifact."status"::text AS "status",
           artifact."contentInaccessibleAt", artifact."deletedAt"
      FROM "CvStoredArtifact" artifact
     WHERE artifact."id" = ${artifactId}
       AND artifact."uploadId" = ${uploadId}
       AND artifact."accountId" = ${accountId}
       AND artifact."kind" = 'EXTRACTED_TEXT'
     FOR UPDATE
  `;
  return rows[0] ?? null;
}

async function auditNewRetry(
  database: Prisma.TransactionClient,
  input: {
    accountId: string;
    uploadId: string;
    stage: RetryStage;
    parserClass: RetryUpload["parserClass"];
    attemptNumber: number;
    now: Date;
  },
) {
  await database.auditEvent.create({
    data: {
      id: randomUUID(),
      occurredAt: input.now,
      actorType: "user",
      actorUserId: input.accountId,
      action: "cv_import.retry_requested",
      targetType: "cv_import",
      targetId: input.uploadId,
      result: "SUCCESS",
      correlationId: randomUUID(),
      context: {
        stage: input.stage,
        status: "QUEUED",
        attemptCount: input.attemptNumber,
        parserClass: input.parserClass,
      },
    },
    select: { id: true },
  });
}

export class PrismaCvRetryRepository {
  async findReplay(input: RetryLookup): Promise<CvCandidateRetryResult | null> {
    return findReplayIn(prisma, input);
  }

  async inspectCandidateRetry(input: {
    accountId: string;
    uploadId: string;
    now: Date;
  }): Promise<CvCandidateRetryEligibility> {
    assertUsableDate(input.now);
    const upload = await findOwnedUpload(
      prisma,
      input.accountId,
      input.uploadId,
      input.now,
    );
    if (!upload) throw new CvImportServiceError("CV_IMPORT_NOT_FOUND");
    const source = await findSourceArtifact(
      prisma,
      input.accountId,
      input.uploadId,
    );
    const stage = assertBaseRetryState(upload, source);
    if (stage === "SCAN") {
      const prior = await findLatestScan(
        prisma,
        input.accountId,
        input.uploadId,
      );
      assertScanEligibility(upload, prior);
      if (prior?.sourceArtifactId !== source?.id)
        throw new CvImportServiceError("IMPORT_STATE_CONFLICT");
      return Object.freeze({ stage, parserClass: upload.parserClass });
    }
    if (stage === "EXTRACTION") {
      const prior = await findLatestExtraction(
        prisma,
        input.accountId,
        input.uploadId,
      );
      const cleanScan = prior
        ? await findScanById(
            prisma,
            input.accountId,
            input.uploadId,
            prior.scanAssessmentId,
          )
        : null;
      const extractionRetriesUsed = await candidateRetryCount(
        prisma,
        input.uploadId,
        stage,
      );
      assertExtractionEligibility(
        upload,
        prior,
        cleanScan,
        extractionRetriesUsed,
      );
      return Object.freeze({ stage, parserClass: upload.parserClass });
    }
    const prior = await findLatestParse(
      prisma,
      input.accountId,
      input.uploadId,
    );
    assertParseEligibility(upload, prior);
    const externalConsentBinding =
      prior?.parserClass === "EXTERNAL_OPENAI"
        ? Object.freeze({
            accountId: input.accountId,
            uploadId: input.uploadId,
            provider: prior.provider,
            providerClass: "EXTERNAL_OPENAI" as const,
            model: prior.model,
            purposeVersion: prior.purposeVersion,
            noticeVersion: CV_PROCESSING_NOTICES.EXTERNAL_OPENAI.noticeVersion,
            consentTextVersion: CV_EXTERNAL_CONSENT_TEXT_VERSION,
          })
        : null;
    return Object.freeze({
      stage,
      parserClass: upload.parserClass,
      externalConsentBinding,
    });
  }

  async createCandidateRetry(
    input: CreateCandidateRetryInput,
  ): Promise<CvCandidateRetryResult> {
    assertUsableDate(input.now);
    const operation = () =>
      prisma.$transaction(
        async (transaction) => {
          const replay = await findReplayIn(transaction, input);
          if (replay) return replay;
          const upload = await lockRetryUpload(
            transaction,
            input.accountId,
            input.uploadId,
            input.now,
          );
          if (!upload) throw new CvImportServiceError("CV_IMPORT_NOT_FOUND");
          // A request may have committed while this transaction waited for the
          // account/upload lock. The immutable binding wins over later state.
          const lockedReplay = await findReplayIn(transaction, input);
          if (lockedReplay) return lockedReplay;
          const source = await findSourceArtifact(
            transaction,
            input.accountId,
            input.uploadId,
            true,
          );
          const stage = assertBaseRetryState(upload, source);
          const idempotencyHex = digestHex(input.idempotencyDigest);
          const retryId = randomUUID();

          if (stage === "SCAN") {
            const prior = await findLatestScan(
              transaction,
              input.accountId,
              input.uploadId,
              true,
            );
            assertScanEligibility(upload, prior);
            if (!prior || prior.sourceArtifactId !== source?.id)
              throw new CvImportServiceError("IMPORT_STATE_CONFLICT");
            const existingBinding = await transaction.$queryRaw<
              Array<{ id: string }>
            >`
              SELECT "id" FROM "CvRetryRequest"
               WHERE "priorScanAssessmentId" = ${prior.id}
               LIMIT 1
            `;
            if (existingBinding[0])
              throw new CvImportServiceError("IMPORT_STATE_CONFLICT");
            const newAttemptId = randomUUID();
            const attemptNumber = prior.attemptNumber + 1;
            await transaction.cvScanAssessment.create({
              data: {
                id: newAttemptId,
                uploadId: input.uploadId,
                sourceArtifactId: prior.sourceArtifactId,
                accountId: input.accountId,
                attemptNumber,
                candidateInitiated: true,
                status: "QUEUED",
                createdAt: input.now,
              },
              select: { id: true },
            });
            await transaction.$executeRaw`
              INSERT INTO "CvRetryRequest" (
                "id", "accountId", "uploadId", "stage", "idempotencyDigest",
                "priorScanAssessmentId", "scanAssessmentId", "createdAt"
              ) VALUES (
                ${retryId}, ${input.accountId}, ${input.uploadId}, 'SCAN',
                decode(${idempotencyHex}, 'hex'), ${prior.id}, ${newAttemptId}, ${input.now}
              )
            `;
            const changed = await transaction.cvUpload.updateMany({
              where: {
                id: input.uploadId,
                accountId: input.accountId,
                status: upload.status as "SCAN_FAILED" | "EXTRACTION_FAILED",
                candidateScanRetriesUsed: upload.candidateScanRetriesUsed,
              },
              data: {
                status: "SCAN_QUEUED",
                failureCode: null,
                candidateScanRetriesUsed: { increment: 1 },
                updatedAt: input.now,
              },
            });
            if (changed.count !== 1)
              throw new CvImportServiceError("IMPORT_STATE_CONFLICT");
            await auditNewRetry(transaction, {
              accountId: input.accountId,
              uploadId: input.uploadId,
              stage,
              parserClass: upload.parserClass,
              attemptNumber,
              now: input.now,
            });
            return Object.freeze({
              outcome: retryOutcome(
                {
                  id: upload.id,
                  candidateScanRetriesUsed: upload.candidateScanRetriesUsed + 1,
                  candidateParseRetriesUsed: upload.candidateParseRetriesUsed,
                },
                stage,
              ),
              replayed: false,
              stage,
              parserClass: upload.parserClass,
            });
          }

          if (stage === "EXTRACTION") {
            const prior = await findLatestExtraction(
              transaction,
              input.accountId,
              input.uploadId,
              true,
            );
            if (!prior) throw new CvImportServiceError("IMPORT_STATE_CONFLICT");
            const cleanScan = await findScanById(
              transaction,
              input.accountId,
              input.uploadId,
              prior.scanAssessmentId,
              true,
            );
            const extractionRetriesUsed = await candidateRetryCount(
              transaction,
              input.uploadId,
              stage,
            );
            assertExtractionEligibility(
              upload,
              prior,
              cleanScan,
              extractionRetriesUsed,
            );
            const existingBinding = await transaction.$queryRaw<
              Array<{ id: string }>
            >`
              SELECT "id" FROM "CvRetryRequest"
               WHERE "priorExtractionId" = ${prior.id}
               LIMIT 1
            `;
            if (existingBinding[0])
              throw new CvImportServiceError("IMPORT_STATE_CONFLICT");
            const newAttemptId = randomUUID();
            const attemptNumber = prior.attemptNumber + 1;
            await transaction.cvExtraction.create({
              data: {
                id: newAttemptId,
                uploadId: input.uploadId,
                sourceArtifactId: prior.sourceArtifactId,
                scanAssessmentId: prior.scanAssessmentId,
                accountId: input.accountId,
                attemptNumber,
                status: "QUEUED",
                createdAt: input.now,
              },
              select: { id: true },
            });
            await transaction.$executeRaw`
              INSERT INTO "CvRetryRequest" (
                "id", "accountId", "uploadId", "stage", "idempotencyDigest",
                "priorExtractionId", "extractionId", "createdAt"
              ) VALUES (
                ${retryId}, ${input.accountId}, ${input.uploadId}, 'EXTRACTION',
                decode(${idempotencyHex}, 'hex'), ${prior.id}, ${newAttemptId}, ${input.now}
              )
            `;
            const changed = await transaction.cvUpload.updateMany({
              where: {
                id: input.uploadId,
                accountId: input.accountId,
                status: "EXTRACTION_FAILED",
              },
              data: {
                status: "EXTRACTION_QUEUED",
                failureCode: null,
                updatedAt: input.now,
              },
            });
            if (changed.count !== 1)
              throw new CvImportServiceError("IMPORT_STATE_CONFLICT");
            await auditNewRetry(transaction, {
              accountId: input.accountId,
              uploadId: input.uploadId,
              stage,
              parserClass: upload.parserClass,
              attemptNumber,
              now: input.now,
            });
            return Object.freeze({
              outcome: retryOutcome(
                {
                  id: upload.id,
                  candidateScanRetriesUsed: upload.candidateScanRetriesUsed,
                  candidateExtractionRetriesUsed: extractionRetriesUsed + 1,
                  candidateParseRetriesUsed: upload.candidateParseRetriesUsed,
                },
                stage,
              ),
              replayed: false,
              stage,
              parserClass: upload.parserClass,
            });
          }

          const prior = await findLatestParse(
            transaction,
            input.accountId,
            input.uploadId,
            true,
          );
          assertParseEligibility(upload, prior);
          if (!prior) throw new CvImportServiceError("IMPORT_STATE_CONFLICT");
          const extraction = await lockExtractionInput(
            transaction,
            input.accountId,
            input.uploadId,
            prior.extractionId,
          );
          const output = extraction?.outputArtifactId
            ? await lockOutputArtifact(
                transaction,
                input.accountId,
                input.uploadId,
                extraction.outputArtifactId,
              )
            : null;
          if (
            extraction?.status !== "SUCCEEDED" ||
            !output ||
            output.status !== "AVAILABLE" ||
            output.contentInaccessibleAt !== null ||
            output.deletedAt !== null
          ) {
            throw new CvImportServiceError("IMPORT_STATE_CONFLICT");
          }
          let consentEventId: string | null = null;
          if (prior.parserClass === "EXTERNAL_OPENAI") {
            if (!input.consentId)
              throw new CvImportServiceError("CONSENT_REQUIRED");
            const grants = await transaction.$queryRaw<Array<{ id: string }>>`
              SELECT consent_grant."id"
                FROM "CvProcessingConsent" consent_grant
               WHERE consent_grant."id" = ${input.consentId}
                 AND consent_grant."accountId" = ${input.accountId}
                 AND consent_grant."uploadId" = ${input.uploadId}
                 AND consent_grant."action" = 'GRANTED'
                 AND consent_grant."provider" = ${prior.provider}
                 AND consent_grant."providerClass" = 'EXTERNAL_OPENAI'
                 AND consent_grant."model" = ${prior.model}
                 AND consent_grant."purposeVersion" = ${prior.purposeVersion}
                 AND consent_grant."noticeVersion" = ${CV_PROCESSING_NOTICES.EXTERNAL_OPENAI.noticeVersion}
                 AND consent_grant."consentTextVersion" = ${CV_EXTERNAL_CONSENT_TEXT_VERSION}
                 AND NOT EXISTS (
                   SELECT 1 FROM "CvProcessingConsent" revoke
                    WHERE revoke."supersedesConsentId" = consent_grant."id"
                      AND revoke."action" = 'REVOKED'
                      AND revoke."occurredAt" >= consent_grant."occurredAt"
                 )
               FOR SHARE OF consent_grant
            `;
            if (!grants[0]) throw new CvImportServiceError("CONSENT_REQUIRED");
            consentEventId = grants[0].id;
          }
          const active = await transaction.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "CvParseJob"
             WHERE "accountId" = ${input.accountId}
               AND "status" IN ('QUEUED', 'PROCESSING')
             LIMIT 1 FOR UPDATE
          `;
          if (active[0])
            throw new CvImportServiceError("IMPORT_STATE_CONFLICT");
          const nextAttempt = await transaction.$queryRaw<
            Array<{ id: string }>
          >`
            SELECT "id" FROM "CvParseJob"
             WHERE "previousAttemptId" = ${prior.id}
             LIMIT 1
          `;
          if (nextAttempt[0])
            throw new CvImportServiceError("IMPORT_STATE_CONFLICT");
          const newAttemptId = randomUUID();
          const attemptNumber = prior.attemptNumber + 1;
          await transaction.cvParseJob.create({
            data: {
              id: newAttemptId,
              uploadId: input.uploadId,
              extractionId: prior.extractionId,
              accountId: input.accountId,
              consentEventId,
              previousAttemptId: prior.id,
              attemptNumber,
              trigger: "CANDIDATE_RETRY",
              status: "QUEUED",
              parserClass: prior.parserClass,
              provider: prior.provider,
              model: prior.model,
              purposeVersion: prior.purposeVersion,
              inputVersion: prior.inputVersion,
              instructionVersion: prior.instructionVersion,
              schemaVersion: prior.schemaVersion,
              createdAt: input.now,
            },
            select: { id: true },
          });
          await transaction.$executeRaw`
            INSERT INTO "CvRetryRequest" (
              "id", "accountId", "uploadId", "stage", "idempotencyDigest",
              "priorParseJobId", "parseJobId", "createdAt"
            ) VALUES (
              ${retryId}, ${input.accountId}, ${input.uploadId}, 'PARSE',
              decode(${idempotencyHex}, 'hex'), ${prior.id}, ${newAttemptId}, ${input.now}
            )
          `;
          const changed = await transaction.cvUpload.updateMany({
            where: {
              id: input.uploadId,
              accountId: input.accountId,
              status: "PARSE_FAILED",
              candidateParseRetriesUsed: upload.candidateParseRetriesUsed,
            },
            data: {
              status: "PARSE_QUEUED",
              failureCode: null,
              candidateParseRetriesUsed: { increment: 1 },
              updatedAt: input.now,
            },
          });
          if (changed.count !== 1)
            throw new CvImportServiceError("IMPORT_STATE_CONFLICT");
          await auditNewRetry(transaction, {
            accountId: input.accountId,
            uploadId: input.uploadId,
            stage,
            parserClass: upload.parserClass,
            attemptNumber,
            now: input.now,
          });
          return Object.freeze({
            outcome: retryOutcome(
              {
                id: upload.id,
                candidateScanRetriesUsed: upload.candidateScanRetriesUsed,
                candidateParseRetriesUsed: upload.candidateParseRetriesUsed + 1,
              },
              stage,
            ),
            replayed: false,
            stage,
            parserClass: upload.parserClass,
          });
        },
        { isolationLevel: "Serializable" },
      );

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (error instanceof CvImportServiceError) throw error;
        const replay = await this.findReplay(input);
        if (replay) return replay;
        if (isActiveParseConflict(error))
          throw new CvImportServiceError("IMPORT_STATE_CONFLICT");
        if (attempt < 2 && isRetryableTransactionConflict(error)) continue;
        throw error;
      }
    }
    throw new Error("CV_RETRY_TRANSACTION_EXHAUSTED");
  }
}
