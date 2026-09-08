import { z } from "zod";

export const CV_SOURCE_MAX_BYTES = 5_000_000;
// Multipart framing (field headers, boundaries and CRLFs) is not part of the
// uploaded CV bytes. Keep the file limit strict while allowing the envelope.
export const CV_MULTIPART_MAX_TOTAL_BYTES = CV_SOURCE_MAX_BYTES + 64 * 1024;
export const CV_SECURITY_POLICY_VERSION = "unified-cv-v1";
export const CV_EXTRACTED_TEXT_MAX_BYTES = 512 * 1024;
export const CV_ACCOUNT_MAX_IMPORTS = 10;
export const CV_ACCOUNT_MAX_STORED_BYTES = 50 * 1024 * 1024;
export const CV_UPLOAD_ATTEMPTS_PER_ROLLING_HOUR = 5;

export const CV_DOCUMENT_KINDS = ["PDF", "DOC", "DOCX"] as const;
export const CV_PARSER_CLASSES = [
  "DETERMINISTIC_INTERNAL",
  "EXTERNAL_OPENAI",
] as const;
export const CV_UPLOAD_STATUSES = [
  "AWAITING_CONTENT",
  "VALIDATION_QUEUED",
  "SCAN_QUEUED",
  "SCANNING",
  "SECURITY_CLEAN",
  "EXTRACTION_QUEUED",
  "EXTRACTING",
  "AWAITING_CONSENT",
  "PARSE_QUEUED",
  "PARSING",
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
] as const;
export const CV_IMPORT_STAGES = [
  "UPLOAD",
  "VALIDATE",
  "SCAN",
  "EXTRACT",
  "OCR",
  "CONSENT",
  "PARSE",
  "REVIEW",
  "COMPLETE",
  "TERMINAL",
] as const;
export const CV_AVAILABLE_ACTIONS = [
  "UPLOAD_CONTENT",
  "GRANT_CONSENT",
  "REVOKE_CONSENT",
  "RETRY",
  "REVIEW",
  "DELETE",
  "MANUAL_PROFILE",
] as const;
export const CV_REVIEW_ACTIONS = ["ADD", "REPLACE", "SKIP"] as const;
export const CV_SAFE_FAILURE_ACTIONS = [
  "RETRY",
  "REPLACE_DOCUMENT",
  "MANUAL_PROFILE",
  "DELETE",
] as const;
export const CV_API_ERROR_CODES = [
  "VALIDATION_ERROR",
  "AUTHENTICATION_REQUIRED",
  "FORBIDDEN",
  "CSRF_REJECTED",
  "CV_IMPORT_NOT_FOUND",
  "CV_DRAFT_NOT_FOUND",
  "IDEMPOTENCY_KEY_REUSED",
  "DRAFT_REVISION_CONFLICT",
  "PROFILE_REVISION_CONFLICT",
  "IMPORT_STATE_CONFLICT",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "DOCUMENT_REJECTED",
  "UPLOAD_RATE_LIMITED",
  "CV_QUOTA_EXCEEDED",
  "RETRY_LIMIT_REACHED",
  "CONSENT_REQUIRED",
  "CV_PROCESSING_UNAVAILABLE",
] as const;

export const cvDocumentKindSchema = z.enum(CV_DOCUMENT_KINDS);
export const cvParserClassSchema = z.enum(CV_PARSER_CLASSES);
export const cvUploadStatusSchema = z.enum(CV_UPLOAD_STATUSES);
export const cvImportStageSchema = z.enum(CV_IMPORT_STAGES);
export const cvAvailableActionSchema = z.enum(CV_AVAILABLE_ACTIONS);
export const cvReviewActionSchema = z.enum(CV_REVIEW_ACTIONS);
export const cvSafeFailureActionSchema = z.enum(CV_SAFE_FAILURE_ACTIONS);
export const cvApiErrorCodeSchema = z.enum(CV_API_ERROR_CODES);

const opaqueId = z
  .string()
  .min(10)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/u);

export const cvUploadIdSchema = opaqueId.brand<"CvUploadId">();
export const cvDraftIdSchema = opaqueId.brand<"CvDraftId">();
export const cvArtifactIdSchema = opaqueId.brand<"CvArtifactId">();
export const cvParseJobIdSchema = opaqueId.brand<"CvParseJobId">();
export const cvRetryRequestIdSchema = opaqueId.brand<"CvRetryRequestId">();

export const cvIdempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[\x21-\x7E]+$/u);
export const cvCsrfTokenSchema = z.string().min(16).max(2048);
export const cvContentLengthSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(CV_SOURCE_MAX_BYTES);
export const cvRequestIdSchema = z.string().min(1).max(100);
export const cvUtcTimestampSchema = z.string().datetime({ offset: true });

export const cvRequestHeadersSchema = z
  .object({
    "idempotency-key": cvIdempotencyKeySchema.optional(),
    "x-csrf-token": cvCsrfTokenSchema.optional(),
    "content-length": cvContentLengthSchema.optional(),
  })
  .strict();

export const cvBoundedMetadataSchema = z
  .object({
    state: cvUploadStatusSchema,
    stage: cvImportStageSchema,
    availableActions: z
      .array(cvAvailableActionSchema)
      .max(7)
      .refine((values) => new Set(values).size === values.length),
    createdAt: cvUtcTimestampSchema,
    expiresAt: cvUtcTimestampSchema,
  })
  .strict();

export const cvConflictLatestSchema = z
  .object({
    draftRevision: z.number().int().min(0).nullable(),
    profileRevision: z.number().int().min(0).nullable(),
    draftUpdatedAt: cvUtcTimestampSchema.nullable(),
    profileUpdatedAt: cvUtcTimestampSchema.nullable(),
  })
  .strict();

export const cvFieldErrorSchema = z
  .object({
    path: z.string().min(1).max(200),
    code: z.string().min(1).max(100),
    message: z.string().min(1).max(300),
  })
  .strict();

export const cvApiErrorSchema = z
  .object({
    error: z
      .object({
        code: cvApiErrorCodeSchema,
        message: z.string().min(1).max(500),
        requestId: cvRequestIdSchema,
        fieldErrors: z.array(cvFieldErrorSchema).max(100),
        latest: cvConflictLatestSchema.nullable(),
      })
      .strict(),
  })
  .strict();

function canonicalize(value: unknown, seen: Set<object>): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON cannot contain non-finite numbers.");
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value))
      throw new TypeError("Canonical JSON cannot be cyclic.");
    seen.add(value);
    const result = value.map((item) => {
      if (
        item === undefined ||
        typeof item === "function" ||
        typeof item === "symbol"
      ) {
        throw new TypeError(
          "Canonical JSON cannot contain unsupported array values.",
        );
      }
      return canonicalize(item, seen);
    });
    seen.delete(value);
    return result;
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (Object.getPrototypeOf(object) !== Object.prototype) {
      throw new TypeError("Canonical JSON accepts only plain objects.");
    }
    if (seen.has(object))
      throw new TypeError("Canonical JSON cannot be cyclic.");
    seen.add(object);
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(object).sort()) {
      const item = object[key];
      if (
        item === undefined ||
        typeof item === "function" ||
        typeof item === "symbol"
      ) {
        throw new TypeError(
          "Canonical JSON cannot contain unsupported object values.",
        );
      }
      result[key] = canonicalize(item, seen);
    }
    seen.delete(object);
    return result;
  }
  throw new TypeError("Value cannot be represented as canonical JSON.");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value, new Set()));
}

export function canonicalJsonBytes(value: unknown): number {
  return new TextEncoder().encode(canonicalJson(value)).byteLength;
}

export type CvApiError = z.infer<typeof cvApiErrorSchema>;
export type CvDocumentKind = z.infer<typeof cvDocumentKindSchema>;
export type CvParserClass = z.infer<typeof cvParserClassSchema>;
export type CvUploadStatus = z.infer<typeof cvUploadStatusSchema>;
export type CvImportStage = z.infer<typeof cvImportStageSchema>;
export type CvReviewAction = z.infer<typeof cvReviewActionSchema>;
export type CvUploadId = z.infer<typeof cvUploadIdSchema>;
export type CvDraftId = z.infer<typeof cvDraftIdSchema>;
