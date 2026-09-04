import { z } from "zod";

const titleIdSchema = z.string().regex(/^title-[a-z0-9-]+$/u);
const occupationIdSchema = z.string().regex(/^occ-[a-z0-9-]+$/u);

const contextProvenanceRecordSchema = z
  .object({
    reviewId: z.string().min(1).max(180),
    catalogVersionId: z.string().min(1).max(180),
    source: z.literal("STATIC_JOB_POSTING"),
    sampleJobIds: z.array(z.string().min(1).max(180)).max(8),
    industryCode: z.string().min(1).max(64).nullable(),
    categoryIds: z.array(z.string().min(1).max(128)).max(16),
    contextOccupationIds: z.array(occupationIdSchema).max(16),
    profileSource: z.string().min(1).max(64).nullable(),
    translationStatus: z.string().min(1).max(64).nullable(),
    reviewVersion: z.number().int().positive(),
  })
  .strict();

export const searchMappingReviewContextProvenanceSchema = z
  .object({
    kind: z.literal("STATIC_JOB_POSTING_CONTEXT"),
    sourceManifestPath: z.string().min(1).max(500),
    activeCatalogVersionId: z.string().min(1).max(180),
    records: z.array(contextProvenanceRecordSchema).max(1000),
  })
  .strict();

export const searchMappingReviewBatchDecisionSchema = z.enum([
  "APPROVE",
  "INTENTIONAL_UNTRANSLATED",
  "MERGE",
  "REJECT",
]);

export const searchMappingReviewBatchItemSchema = z
  .object({
    reviewId: z.string().min(1).max(180).optional(),
    titleId: titleIdSchema,
    originalTitle: z.string().trim().min(1).max(160),
    canonicalEn: z.string().trim().min(1).max(160),
    canonicalVi: z.string().trim().min(1).max(160),
    aliasesVi: z.array(z.string().trim().min(1).max(160)).max(32),
    aliasesEn: z.array(z.string().trim().min(1).max(160)).max(32),
    abbreviations: z.array(z.string().trim().min(1).max(80)).max(32),
    occupationId: occupationIdSchema.nullable(),
    facetIds: z.array(z.string().trim().min(1).max(128)).max(16),
    proposedDecision: searchMappingReviewBatchDecisionSchema,
    mergeTargetTitleId: titleIdSchema.optional(),
    confidence: z.number().finite().min(0).max(1),
    rationale: z.string().trim().min(10).max(1000),
    humanApproved: z.boolean().default(false),
    reviewer: z
      .object({
        actorUserId: z.string().min(1).max(180),
        confirmedAt: z.string().datetime(),
        rationale: z.string().trim().min(10).max(1000),
      })
      .strict()
      .nullable()
      .default(null),
  })
  .strict()
  .superRefine((item, context) => {
    if (item.proposedDecision === "MERGE" && !item.mergeTargetTitleId) {
      context.addIssue({
        code: "custom",
        path: ["mergeTargetTitleId"],
        message: "MERGE requires mergeTargetTitleId",
      });
    }
    if (item.proposedDecision !== "MERGE" && item.mergeTargetTitleId) {
      context.addIssue({
        code: "custom",
        path: ["mergeTargetTitleId"],
        message: "mergeTargetTitleId is only valid for MERGE",
      });
    }
    if (item.proposedDecision === "INTENTIONAL_UNTRANSLATED") {
      if (item.canonicalVi !== item.canonicalEn) {
        context.addIssue({
          code: "custom",
          path: ["canonicalVi"],
          message:
            "INTENTIONAL_UNTRANSLATED must retain canonical English in the VI field",
        });
      }
      if (item.aliasesVi.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["aliasesVi"],
          message: "INTENTIONAL_UNTRANSLATED cannot carry Vietnamese aliases",
        });
      }
    }
    if (item.humanApproved && !item.reviewer) {
      context.addIssue({
        code: "custom",
        path: ["reviewer"],
        message:
          "A human reviewer record is required when humanApproved is true",
      });
    }
    if (!item.humanApproved && item.reviewer) {
      context.addIssue({
        code: "custom",
        path: ["reviewer"],
        message: "reviewer cannot be present before confirmation",
      });
    }
  });

export const searchMappingReviewBatchManifestSchema = z
  .object({
    schemaVersion: z.literal("search-mapping-review-batch-v1"),
    generatedAt: z.string().datetime(),
    catalogVersion: z.string().min(1).max(64),
    source: z.literal("TAXONOMY_CONTEXT_RULES"),
    humanApprovalRequired: z.literal(true),
    humanReviewConfirmed: z.boolean().default(false),
    reviewer: z
      .object({
        actorUserId: z.string().min(1).max(180),
        confirmedAt: z.string().datetime(),
        rationale: z.string().trim().min(10).max(1000),
      })
      .strict()
      .nullable()
      .default(null),
    counts: z
      .object({
        total: z.number().int().nonnegative(),
        approve: z.number().int().nonnegative(),
        intentionalUntranslated: z.number().int().nonnegative(),
        merge: z.number().int().nonnegative(),
        reject: z.number().int().nonnegative(),
      })
      .strict(),
    provenance: searchMappingReviewContextProvenanceSchema.optional(),
    items: z.array(searchMappingReviewBatchItemSchema),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (manifest.counts.total !== manifest.items.length) {
      context.addIssue({
        code: "custom",
        path: ["counts", "total"],
        message: "counts.total must equal items.length",
      });
    }
    const countByDecision = {
      APPROVE: manifest.counts.approve,
      INTENTIONAL_UNTRANSLATED: manifest.counts.intentionalUntranslated,
      MERGE: manifest.counts.merge,
      REJECT: manifest.counts.reject,
    } as const;
    for (const [decision, count] of Object.entries(countByDecision)) {
      const actual = manifest.items.filter(
        (item) => item.proposedDecision === decision,
      ).length;
      if (count !== actual) {
        context.addIssue({
          code: "custom",
          path: ["counts"],
          message: `count for ${decision} must equal ${actual}`,
        });
      }
    }
    if (manifest.humanReviewConfirmed && !manifest.reviewer) {
      context.addIssue({
        code: "custom",
        path: ["reviewer"],
        message: "A manifest-level reviewer is required when confirmed",
      });
    }
  });

export type SearchMappingReviewBatchItem = z.infer<
  typeof searchMappingReviewBatchItemSchema
>;
export type SearchMappingReviewBatchManifest = z.infer<
  typeof searchMappingReviewBatchManifestSchema
>;
export type SearchMappingReviewContextProvenance = z.infer<
  typeof searchMappingReviewContextProvenanceSchema
>;
