import { z } from "zod";

import {
  CV_ACCOUNT_MAX_IMPORTS,
  CV_ACCOUNT_MAX_STORED_BYTES,
  CV_SOURCE_MAX_BYTES,
  CV_UPLOAD_ATTEMPTS_PER_ROLLING_HOUR,
  CV_UPLOAD_STATUSES,
  cvAvailableActionSchema,
  cvContentLengthSchema,
  cvDocumentKindSchema,
  cvDraftIdSchema,
  cvIdempotencyKeySchema,
  cvImportStageSchema,
  cvParserClassSchema,
  cvSafeFailureActionSchema,
  cvUploadIdSchema,
  cvUploadStatusSchema,
  cvUtcTimestampSchema,
  type CvParserClass,
  type CvUploadStatus,
} from "./common";
import { cvConsentNoticeSchema } from "./consent-retention";

export { cvConsentNoticeSchema } from "./consent-retention";

export const CV_PDF_MEDIA_TYPE = "application/pdf" as const;
export const CV_DOC_MEDIA_TYPE = "application/msword" as const;
export const CV_DOCX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const;
export const CV_ACCEPTED_MEDIA_TYPES = [
  CV_PDF_MEDIA_TYPE,
  CV_DOC_MEDIA_TYPE,
  CV_DOCX_MEDIA_TYPE,
] as const;

export const cvDeclaredMediaTypeSchema = z.enum(CV_ACCEPTED_MEDIA_TYPES);

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

export const createCvImportRequestSchema = z
  .object({
    displayFilename: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine((value) => !containsControlCharacter(value)),
    declaredMediaType: cvDeclaredMediaTypeSchema,
    declaredBytes: z.number().int().min(1).max(CV_SOURCE_MAX_BYTES),
    parserClass: cvParserClassSchema,
  })
  .strict();

export const cvContentHeadersSchema = z
  .object({
    contentType: cvDeclaredMediaTypeSchema,
    contentLength: cvContentLengthSchema,
    idempotencyKey: cvIdempotencyKeySchema,
  })
  .strict();

export const cvProcessingNoticeSchema = z
  .object({
    noticeVersion: z.string().min(1).max(100),
    noticeText: z.string().min(1).max(5000),
    externalConsentRequiredFor: z
      .array(z.literal("EXTERNAL_OPENAI"))
      .max(1)
      .refine((values) => new Set(values).size === values.length),
  })
  .strict();

const GENERAL_NOTICE =
  "SmartHire processes this CV only to create a private draft for your review. The draft never changes your Candidate Profile until you explicitly confirm selected changes.";

export const CV_PROCESSING_NOTICES = Object.freeze({
  DETERMINISTIC_INTERNAL: Object.freeze({
    noticeVersion: "cv-processing.v1",
    noticeText: `${GENERAL_NOTICE} The selected deterministic parser runs inside SmartHire without sending CV content to an external AI provider.`,
    externalConsentRequiredFor: Object.freeze([]) as [],
  }),
  EXTERNAL_OPENAI: Object.freeze({
    noticeVersion: "cv-processing.v1",
    noticeText: `${GENERAL_NOTICE} The external parser remains blocked until you separately consent to send this CV to the approved OpenAI deployment.`,
    externalConsentRequiredFor: Object.freeze(["EXTERNAL_OPENAI" as const]) as [
      "EXTERNAL_OPENAI",
    ],
  }),
});

export function cvProcessingNotice(parserClass: CvParserClass) {
  return CV_PROCESSING_NOTICES[parserClass];
}

export const cvUploadReservationSchema = z
  .object({
    uploadId: cvUploadIdSchema,
    status: z.literal("AWAITING_CONTENT"),
    contentUrl: z
      .string()
      .regex(/^\/api\/account\/cv-imports\/[A-Za-z0-9_-]+\/content$/u),
    expiresAt: cvUtcTimestampSchema,
    limits: z
      .object({
        maximumBytes: z.literal(CV_SOURCE_MAX_BYTES),
        requiredContentType: cvDeclaredMediaTypeSchema,
        requiredContentLength: z.number().int().min(1).max(CV_SOURCE_MAX_BYTES),
      })
      .strict(),
  })
  .strict();

export const cvContentAcceptedSchema = z
  .object({
    uploadId: cvUploadIdSchema,
    status: z.literal("VALIDATION_QUEUED"),
    replayed: z.boolean(),
    statusUrl: z
      .string()
      .regex(/^\/api\/account\/cv-imports\/[A-Za-z0-9_-]+$/u),
  })
  .strict();

export const cvAccountLimitsSchema = z
  .object({
    maximumFileBytes: z.literal(CV_SOURCE_MAX_BYTES),
    maximumImports: z.literal(CV_ACCOUNT_MAX_IMPORTS),
    maximumStoredBytes: z.literal(CV_ACCOUNT_MAX_STORED_BYTES),
    uploadAttemptsPerRollingHour: z.literal(
      CV_UPLOAD_ATTEMPTS_PER_ROLLING_HOUR,
    ),
  })
  .strict();

export const CV_ACCOUNT_LIMITS = Object.freeze({
  maximumFileBytes: CV_SOURCE_MAX_BYTES,
  maximumImports: CV_ACCOUNT_MAX_IMPORTS,
  maximumStoredBytes: CV_ACCOUNT_MAX_STORED_BYTES,
  uploadAttemptsPerRollingHour: CV_UPLOAD_ATTEMPTS_PER_ROLLING_HOUR,
});

export const cvImportSummarySchema = z
  .object({
    uploadId: cvUploadIdSchema,
    displayFilename: z.string().max(255).nullable(),
    documentKind: cvDocumentKindSchema,
    parserClass: cvParserClassSchema,
    status: cvUploadStatusSchema,
    createdAt: cvUtcTimestampSchema,
    expiresAt: cvUtcTimestampSchema,
    confirmedAt: cvUtcTimestampSchema.nullable().optional(),
  })
  .strict();

export const cvImportListSchema = z
  .object({
    items: z.array(cvImportSummarySchema).max(10),
    limits: cvAccountLimitsSchema,
    processingNotice: cvProcessingNoticeSchema,
  })
  .strict();

export const cvDraftReferenceSchema = z
  .object({
    draftId: cvDraftIdSchema,
    revision: z.number().int().min(0),
    reviewUrl: z.string().min(1).max(500),
  })
  .strict();

export const CV_SAFE_FAILURE_CODES = [
  "CONTENT_REQUIRED",
  "CONTENT_LENGTH_MISMATCH",
  "ARTIFACT_INTEGRITY_FAILED",
  "UNSUPPORTED_DOCUMENT",
  "MALFORMED_DOCUMENT",
  "DOCUMENT_ENCRYPTED",
  "DOCUMENT_ACTIVE_CONTENT",
  "DOCUMENT_LIMIT_EXCEEDED",
  "MALWARE_DETECTED",
  "SCANNER_UNAVAILABLE",
  "SCANNER_DEFINITIONS_STALE",
  "EXTRACTION_EMPTY",
  "EXTRACTION_TIMEOUT",
  "EXTRACTION_FAILED",
  "OCR_UNAVAILABLE",
  "OCR_TIMEOUT",
  "OCR_OUTPUT_INVALID",
  "OCR_LOW_CONFIDENCE",
  "CONSENT_REQUIRED",
  "CONSENT_REVOKED",
  "PARSER_TIMEOUT",
  "PARSER_UNAVAILABLE",
  "PARSER_OUTPUT_INVALID",
  "PARSER_OUTPUT_LIMIT_EXCEEDED",
  "CV_PROCESSING_FAILED",
  "RETRY_LIMIT_REACHED",
  "IMPORT_EXPIRED",
  "IMPORT_DELETED",
] as const;

export const cvSafeFailureSchema = z
  .object({
    code: z.enum(CV_SAFE_FAILURE_CODES),
    message: z.string().min(1).max(500),
    retryable: z.boolean(),
    suggestedActions: z
      .array(cvSafeFailureActionSchema)
      .max(4)
      .refine((values) => new Set(values).size === values.length),
  })
  .strict();

export const cvAppliedCountsSchema = z
  .object({
    scalars: z.number().int().min(0).max(4),
    experiences: z.number().int().min(0).max(50),
    education: z.number().int().min(0).max(50),
    skills: z.number().int().min(0).max(50),
    socialLinks: z.number().int().min(0).max(10),
  })
  .strict();

export const cvConfirmationReceiptSchema = z
  .object({
    receiptId: z
      .string()
      .min(10)
      .max(80)
      .regex(/^[A-Za-z0-9_-]+$/u),
    uploadId: cvUploadIdSchema,
    draftId: cvDraftIdSchema,
    confirmedAt: cvUtcTimestampSchema,
    draftRevision: z.number().int().min(0),
    sourceProfileRevision: z.number().int().min(0),
    reviewedProfileRevision: z.number().int().min(0),
    profileRevisionBefore: z.number().int().min(0),
    profileRevisionAfter: z.number().int().min(1),
    appliedCounts: cvAppliedCountsSchema,
  })
  .strict();

export const cvImportResourceSchema = z
  .object({
    uploadId: cvUploadIdSchema,
    displayFilename: z.string().max(255).nullable(),
    documentKind: cvDocumentKindSchema,
    parserClass: cvParserClassSchema,
    status: cvUploadStatusSchema,
    stage: cvImportStageSchema,
    availableActions: z
      .array(cvAvailableActionSchema)
      .max(7)
      .refine((values) => new Set(values).size === values.length),
    scanRetriesRemaining: z.number().int().min(0).max(2),
    parseRetriesRemaining: z.number().int().min(0).max(2),
    createdAt: cvUtcTimestampSchema,
    expiresAt: cvUtcTimestampSchema,
    draft: cvDraftReferenceSchema.nullable(),
    ocr: z
      .object({
        status: z.enum([
          "QUEUED",
          "PROCESSING",
          "SUCCEEDED",
          "PARTIAL_REVIEW_REQUIRED",
          "FAILED",
          "CANCELLED",
        ]),
        accountedUnitCount: z.number().int().min(0).max(10_000),
        totalUnitCount: z.number().int().min(0).max(10_000),
        lowConfidenceUnitCount: z.number().int().min(0).max(10_000),
        conflictUnitCount: z.number().int().min(0).max(10_000),
      })
      .strict()
      .nullable()
      .default(null),
    processingNotice: cvProcessingNoticeSchema,
    consent: cvConsentNoticeSchema.nullable(),
    failure: cvSafeFailureSchema.nullable(),
    receipt: cvConfirmationReceiptSchema.nullable(),
    contentInaccessibleAt: cvUtcTimestampSchema.nullable(),
    deleteAfter: cvUtcTimestampSchema.nullable(),
    deletedAt: cvUtcTimestampSchema.nullable(),
  })
  .strict();

export const cvImportTombstoneSchema = z
  .object({
    uploadId: cvUploadIdSchema,
    status: z.enum(["CANCELLED", "DELETED", "EXPIRED"]),
    contentInaccessibleAt: cvUtcTimestampSchema,
    deleteAfter: cvUtcTimestampSchema,
    deletedAt: cvUtcTimestampSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "DELETED" && value.deletedAt === null) {
      context.addIssue({
        code: "custom",
        path: ["deletedAt"],
        message: "Deleted imports require completed cleanup evidence.",
      });
    }
  });

export const cvImportStatusResponseSchema = z.union([
  cvImportResourceSchema,
  cvImportTombstoneSchema,
]);

const terminalStatuses = new Set<CvUploadStatus>([
  "SECURITY_CLEAN",
  "REVIEW_READY",
  "VALIDATION_FAILED",
  "INFECTED",
  "SCAN_FAILED",
  "EXTRACTION_FAILED",
  "PARSE_FAILED",
  "CONFIRMED",
  "CANCELLED",
  "DELETED",
  "EXPIRED",
]);

export function cvStatusPollingAfterMs(status: CvUploadStatus): number | null {
  return terminalStatuses.has(status) ? null : 2_000;
}

export type CreateCvImportRequest = z.infer<typeof createCvImportRequestSchema>;
export type CvUploadReservation = z.infer<typeof cvUploadReservationSchema>;
export type CvImportSummary = z.infer<typeof cvImportSummarySchema>;
export type CvImportResource = z.infer<typeof cvImportResourceSchema>;
export type CvImportTombstone = z.infer<typeof cvImportTombstoneSchema>;
export type CvImportStatusResponse = z.infer<
  typeof cvImportStatusResponseSchema
>;

if (CV_UPLOAD_STATUSES.length !== 20) {
  throw new Error("CV_UPLOAD_STATUS_CONTRACT_INCOMPLETE");
}
