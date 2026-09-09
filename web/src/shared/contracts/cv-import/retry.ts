import { z } from "zod";

import { cvSafeFailureActionSchema, cvUploadIdSchema } from "./common";
import { CV_SAFE_FAILURE_CODES } from "./upload";

export const CV_CANDIDATE_SCAN_RETRY_LIMIT = 2;
export const CV_CANDIDATE_EXTRACTION_RETRY_LIMIT = 2;
export const CV_CANDIDATE_PARSE_RETRY_LIMIT = 2;

export const CV_RETRY_ACCEPTED_STATUSES = [
  "SCAN_QUEUED",
  "EXTRACTION_QUEUED",
  "PARSE_QUEUED",
] as const;

export const CV_RETRYABLE_SCAN_FAILURE_CODES = [
  "SCANNER_UNAVAILABLE",
  "SCANNER_DEFINITIONS_STALE",
] as const;

export const CV_RETRYABLE_PARSE_FAILURE_CODES = [
  "PARSER_TIMEOUT",
  "PARSER_UNAVAILABLE",
  "PARSER_OUTPUT_LIMIT_EXCEEDED",
] as const;

export const CV_RETRYABLE_OCR_FAILURE_CODES = [
  "OCR_UNAVAILABLE",
  "OCR_TIMEOUT",
  "OCR_OUTPUT_INVALID",
  "OCR_LOW_CONFIDENCE",
] as const;

export const cvRetryRequestSchema = z.object({}).strict();

export const cvRetryIdempotencyKeySchema = z
  .string()
  .min(16)
  .max(200)
  .regex(/^[\x21-\x7E]+$/u);

export const cvRetryHeadersSchema = z
  .object({ idempotencyKey: cvRetryIdempotencyKeySchema })
  .strict();

export const cvRetryRemainingCountsSchema = z
  .object({
    scanRetriesRemaining: z
      .number()
      .int()
      .min(0)
      .max(CV_CANDIDATE_SCAN_RETRY_LIMIT),
    parseRetriesRemaining: z
      .number()
      .int()
      .min(0)
      .max(CV_CANDIDATE_PARSE_RETRY_LIMIT),
    extractionRetriesRemaining: z
      .number()
      .int()
      .min(0)
      .max(CV_CANDIDATE_EXTRACTION_RETRY_LIMIT)
      .optional(),
  })
  .strict();

export const cvRetryAcceptedSchema = z
  .object({
    uploadId: cvUploadIdSchema,
    status: z.enum(CV_RETRY_ACCEPTED_STATUSES),
    scanRetriesRemaining:
      cvRetryRemainingCountsSchema.shape.scanRetriesRemaining,
    parseRetriesRemaining:
      cvRetryRemainingCountsSchema.shape.parseRetriesRemaining,
    extractionRetriesRemaining:
      cvRetryRemainingCountsSchema.shape.extractionRetriesRemaining,
  })
  .strict();

export const cvRetryUsageSchema = z
  .object({
    candidateScanRetriesUsed: z
      .number()
      .int()
      .min(0)
      .max(CV_CANDIDATE_SCAN_RETRY_LIMIT),
    candidateParseRetriesUsed: z
      .number()
      .int()
      .min(0)
      .max(CV_CANDIDATE_PARSE_RETRY_LIMIT),
    candidateExtractionRetriesUsed: z
      .number()
      .int()
      .min(0)
      .max(CV_CANDIDATE_EXTRACTION_RETRY_LIMIT)
      .optional(),
  })
  .strict();

export function projectCvRetryRemainingCounts(
  input: z.input<typeof cvRetryUsageSchema>,
): CvRetryRemainingCounts {
  const usage = cvRetryUsageSchema.parse(input);
  const counts = {
    scanRetriesRemaining:
      CV_CANDIDATE_SCAN_RETRY_LIMIT - usage.candidateScanRetriesUsed,
    parseRetriesRemaining:
      CV_CANDIDATE_PARSE_RETRY_LIMIT - usage.candidateParseRetriesUsed,
    ...(typeof usage.candidateExtractionRetriesUsed === "number"
      ? {
          extractionRetriesRemaining:
            CV_CANDIDATE_EXTRACTION_RETRY_LIMIT -
            usage.candidateExtractionRetriesUsed,
        }
      : {}),
  };
  return Object.freeze(cvRetryRemainingCountsSchema.parse(counts));
}

const cvRetryTerminalStateSchema = z
  .object({
    status: z.enum(["SCAN_FAILED", "EXTRACTION_FAILED", "PARSE_FAILED"]),
    failureCode: z.enum(CV_SAFE_FAILURE_CODES).nullable(),
    scanRetriesRemaining:
      cvRetryRemainingCountsSchema.shape.scanRetriesRemaining,
    parseRetriesRemaining:
      cvRetryRemainingCountsSchema.shape.parseRetriesRemaining,
    extractionRetriesRemaining:
      cvRetryRemainingCountsSchema.shape.extractionRetriesRemaining,
  })
  .strict();

const retryableScanFailures = new Set<string>(CV_RETRYABLE_SCAN_FAILURE_CODES);
const retryableParseFailures = new Set<string>(
  CV_RETRYABLE_PARSE_FAILURE_CODES,
);
const retryableOcrFailures = new Set<string>(CV_RETRYABLE_OCR_FAILURE_CODES);

export function isCvCandidateRetryAvailable(
  input: z.input<typeof cvRetryTerminalStateSchema>,
): boolean {
  const state = cvRetryTerminalStateSchema.parse(input);
  if (state.status === "SCAN_FAILED") {
    return (
      state.scanRetriesRemaining > 0 &&
      state.failureCode !== null &&
      retryableScanFailures.has(state.failureCode)
    );
  }
  if (state.status === "EXTRACTION_FAILED") {
    return (
      (state.extractionRetriesRemaining ?? 0) > 0 &&
      state.failureCode !== null &&
      retryableOcrFailures.has(state.failureCode)
    );
  }
  return (
    state.parseRetriesRemaining > 0 &&
    state.failureCode !== null &&
    retryableParseFailures.has(state.failureCode)
  );
}

export function cvRetryTerminalActions(
  input: z.input<typeof cvRetryTerminalStateSchema>,
): readonly CvRetryTerminalAction[] {
  const state = cvRetryTerminalStateSchema.parse(input);
  const actions: CvRetryTerminalAction[] = [];
  if (isCvCandidateRetryAvailable(state)) actions.push("RETRY");
  actions.push("REPLACE_DOCUMENT", "MANUAL_PROFILE", "DELETE");
  return Object.freeze(
    z.array(cvSafeFailureActionSchema).max(4).parse(actions),
  );
}

export type CvRetryHeaders = z.infer<typeof cvRetryHeadersSchema>;
export type CvRetryRequest = z.infer<typeof cvRetryRequestSchema>;
export type CvRetryAccepted = z.infer<typeof cvRetryAcceptedSchema>;
export type CvRetryRemainingCounts = z.infer<
  typeof cvRetryRemainingCountsSchema
>;
export type CvRetryTerminalAction = z.infer<typeof cvSafeFailureActionSchema>;
