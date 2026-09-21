import "server-only";

import { createHmac } from "node:crypto";
import { z } from "zod";

export const imageSearchSafeFailureCodeSchema = z.enum([
  "ADMISSION_LIMITED",
  "CLEANUP_NOT_READY",
  "CONTENT_LENGTH_MISMATCH",
  "DEADLINE_EXCEEDED",
  "DECODE_REJECTED",
  "INFECTED",
  "INTERPRETATION_FAILED",
  "MODEL_MISMATCH",
  "OCR_FAILED",
  "OCR_NO_TEXT",
  "OCR_PARTIAL",
  "OCR_DEADLINE_EXCEEDED",
  "SCAN_FAILED",
  "STAGE_RESULT_DISCARDED",
  "STORAGE_PREFLIGHT_INVALID",
]);

export const imageSearchTelemetryEventSchema = z
  .object({
    purpose: z.enum(["CV_IMPORT", "JOB_IMAGE_SEARCH"]),
    actorClass: z.enum(["VISITOR", "AUTHENTICATED", "SYSTEM"]),
    stage: z.enum([
      "ADMISSION",
      "UPLOAD",
      "SCAN",
      "DECODE",
      "OCR",
      "INTERPRET",
      "CONSUME",
      "CLEANUP",
      "RECONCILE",
    ]),
    result: z.enum(["SUCCESS", "FAILURE", "DENIED", "DISCARDED"]),
    failureCode: imageSearchSafeFailureCodeSchema.optional(),
    durationBucket: z.enum(["LT_100MS", "LT_1S", "LT_6S", "LT_20S", "GTE_20S"]),
    byteBucket: z
      .enum(["ZERO", "LT_32K", "LT_1M", "LT_5M", "LT_25M"])
      .optional(),
    countBucket: z
      .enum(["ZERO", "ONE", "TWO_TO_TEN", "ELEVEN_TO_100", "GT_100"])
      .optional(),
    engineVersion: z.string().max(40).optional(),
    modelVersion: z.string().max(160).optional(),
    policyVersion: z.string().max(100).optional(),
    schemaVersion: z.string().max(100).optional(),
    strategyVersion: z.literal("search-ocr-adaptive-tiles-v1").optional(),
    path: z
      .enum(["FULL_ONLY", "TILED_RECOVERY", "PREPROCESS_RECOVERY"])
      .optional(),
    normalizedDimensionBucket: z
      .enum(["LT_512", "LT_1024", "LT_2048", "GTE_2048"])
      .optional(),
    tileCount: z.number().int().min(0).max(4).optional(),
    tileBatchSize: z.number().int().min(1).max(4).optional(),
    mergedRegionBucket: z
      .enum(["ZERO", "ONE", "TWO_TO_TEN", "ELEVEN_TO_100", "GT_100"])
      .optional(),
    selectedRegionBucket: z
      .enum(["ZERO", "ONE", "TWO_TO_TEN", "ELEVEN_TO_100", "GT_100"])
      .optional(),
    skippedRegionBucket: z
      .enum(["ZERO", "ONE", "TWO_TO_TEN", "ELEVEN_TO_100", "GT_100"])
      .optional(),
    duplicateCountBucket: z
      .enum(["ZERO", "ONE", "TWO_TO_TEN", "ELEVEN_TO_100", "GT_100"])
      .optional(),
    boundaryFragmentBucket: z
      .enum(["ZERO", "ONE", "TWO_TO_TEN", "ELEVEN_TO_100", "GT_100"])
      .optional(),
    deadlineExitStage: z
      .enum(["NONE", "TILE_DETECTION", "RECOGNITION"])
      .optional(),
    consentPresent: z.boolean().optional(),
    consentRevoked: z.boolean().optional(),
    attemptNumber: z.number().int().min(1).max(20).optional(),
  })
  .strict();

export function auditTargetReference(input: {
  purpose: "CV_IMPORT" | "JOB_IMAGE_SEARCH";
  targetId: string;
  key: Uint8Array;
}): string {
  return createHmac("sha256", input.key)
    .update(`audit-target:${input.purpose}:`)
    .update(input.targetId, "utf8")
    .digest("base64url")
    .slice(0, 22);
}
